import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent, request } from 'undici';
import { hostMatches } from './validate.js';

/**
 * Serverseitiger Abruf fremder Adressen (Vorschau, Zielprüfung) mit SSRF-Schutz:
 *
 * 1. Nur http/https, nur übliche Ports.
 * 2. Der Hostname wird selbst aufgelöst; ALLE Adressen müssen erlaubt sein.
 * 3. Die Verbindung geht genau an die geprüfte IP (kein zweites DNS → kein DNS-Rebinding).
 * 4. Weiterleitungen werden einzeln verfolgt und jede Station erneut geprüft.
 * 5. Zeit- und Größenlimits.
 */

export class FetchBlockedError extends Error {
  constructor(
    message: string,
    public reason: 'scheme' | 'port' | 'address' | 'dns' | 'redirects' | 'size' | 'timeout',
  ) {
    super(message);
  }
}

export interface FetchPolicy {
  allowHosts: string[];
  allowPrivate: boolean;
  timeoutMs: number;
  userAgent: string;
}

const ALWAYS_BLOCKED = new net.BlockList();
const PRIVATE = new net.BlockList();

// Nie erreichbar, auch nicht mit FETCH_ALLOW_PRIVATE: Loopback, Link-Local (Cloud-Metadaten
// 169.254.169.254), unspezifiziert, Multicast, reserviert, Dokumentation, Übergangsnetze.
for (const [net4, prefix] of [
  ['0.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  ALWAYS_BLOCKED.addSubnet(net4, prefix, 'ipv4');
}
for (const [net6, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  ALWAYS_BLOCKED.addSubnet(net6, prefix, 'ipv6');
}
// Private Netze: nur mit FETCH_ALLOW_PRIVATE=true oder ausdrücklicher Freigabe.
for (const [net4, prefix] of [
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  PRIVATE.addSubnet(net4, prefix, 'ipv4');
}
PRIVATE.addSubnet('fc00::', 7, 'ipv6');

/** Holt eine eingebettete IPv4-Adresse aus IPv4-mapped (::ffff:a.b.c.d) und NAT64 (64:ff9b::/96). */
function embeddedV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const m = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (m) return m[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const a = Number.parseInt(hex[1], 16);
    const b = Number.parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

export type AddressClass = 'public' | 'private' | 'blocked';

export function classifyAddress(ip: string): AddressClass {
  const family = net.isIP(ip);
  if (!family) return 'blocked';
  if (family === 6) {
    const v4 = embeddedV4(ip);
    if (v4) return classifyAddress(v4);
    if (ip.toLowerCase().startsWith('::ffff:') || ip.toLowerCase().startsWith('64:ff9b:')) return 'blocked';
  }
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (ALWAYS_BLOCKED.check(ip, type)) return 'blocked';
  if (PRIVATE.check(ip, type)) return 'private';
  return 'public';
}

function allowListed(host: string, ip: string, policy: FetchPolicy): boolean {
  for (const entry of policy.allowHosts) {
    if (entry.includes('/')) {
      const [base, bits] = entry.split('/');
      const fam = net.isIP(base);
      const ipFam = net.isIP(ip);
      if (fam && fam === ipFam) {
        const bl = new net.BlockList();
        bl.addSubnet(base, Number(bits), fam === 4 ? 'ipv4' : 'ipv6');
        if (bl.check(ip, fam === 4 ? 'ipv4' : 'ipv6')) return true;
      }
    } else if (net.isIP(entry)) {
      if (entry === ip) return true;
    } else if (hostMatches(host, entry)) {
      return true;
    }
  }
  return false;
}

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export async function resolveTarget(rawUrl: string, policy: FetchPolicy): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchBlockedError('Ungültige Adresse.', 'scheme');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchBlockedError('Nur http- und https-Adressen werden abgerufen.', 'scheme');
  }
  if (url.username || url.password) throw new FetchBlockedError('Adressen mit Zugangsdaten werden nicht abgerufen.', 'scheme');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;

  let addresses: { address: string; family: number }[];
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) }];
  } else {
    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new FetchBlockedError(`Der Servername „${host}“ lässt sich nicht auflösen.`, 'dns');
    }
  }
  if (!addresses.length) throw new FetchBlockedError(`Der Servername „${host}“ lässt sich nicht auflösen.`, 'dns');

  // Alle Adressen müssen erlaubt sein – sonst könnte ein Angreifer eine öffentliche
  // und eine interne Adresse mischen.
  for (const a of addresses) {
    if (allowListed(host, a.address, policy)) continue;
    const cls = classifyAddress(a.address);
    if (cls === 'blocked') {
      throw new FetchBlockedError(`Die Adresse ${host} zeigt auf ein geschütztes Netz (${a.address}) und wird nicht abgerufen.`, 'address');
    }
    if (cls === 'private' && !policy.allowPrivate) {
      throw new FetchBlockedError(
        `Die Adresse ${host} liegt im internen Netz (${a.address}). Interne Ziele prüft Filum nur, wenn sie in FETCH_ALLOW_HOSTS freigegeben sind.`,
        'address',
      );
    }
    if (!ALLOWED_PORTS.has(port) && !allowListed(host, a.address, policy)) {
      throw new FetchBlockedError(`Port ${port} wird nicht abgerufen (erlaubt: 80, 443, 8080, 8443).`, 'port');
    }
  }
  const first = addresses[0];
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}

export interface SafeResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
  finalUrl: string;
  hops: { url: string; status: number }[];
  ms: number;
}

export async function safeFetch(
  rawUrl: string,
  policy: FetchPolicy,
  opts: { maxBytes?: number; maxRedirects?: number; accept?: string } = {},
): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 5;
  const hops: { url: string; status: number }[] = [];
  const started = Date.now();
  let current = rawUrl;

  for (let i = 0; i <= maxRedirects; i++) {
    const target = await resolveTarget(current, policy);
    const agent = new Agent({
      connect: {
        timeout: policy.timeoutMs,
        // Feste IP: undici fragt das DNS nicht erneut.
        lookup: (_hostname, options, cb) => {
          if ((options as { all?: boolean }).all) {
            (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
              { address: target.address, family: target.family },
            ]);
          } else {
            cb(null, target.address, target.family);
          }
        },
      },
      headersTimeout: policy.timeoutMs,
      bodyTimeout: policy.timeoutMs,
    });
    try {
      const res = await request(target.url, {
        method: 'GET',
        dispatcher: agent,
        headers: {
          'user-agent': policy.userAgent,
          accept: opts.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'accept-language': 'de,en;q=0.8',
        },
        signal: AbortSignal.timeout(policy.timeoutMs),
      });
      hops.push({ url: target.url.toString(), status: res.statusCode });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      }
      if (res.statusCode >= 300 && res.statusCode < 400 && headers.location) {
        await res.body.dump();
        current = new URL(headers.location, target.url).toString();
        continue;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      for await (const chunk of res.body) {
        const buf = chunk as Buffer;
        if (size + buf.length > maxBytes) {
          chunks.push(buf.subarray(0, maxBytes - size));
          size = maxBytes;
          truncated = true;
          res.body.destroy();
          break;
        }
        chunks.push(buf);
        size += buf.length;
      }
      return {
        status: res.statusCode,
        headers,
        body: Buffer.concat(chunks),
        truncated,
        finalUrl: target.url.toString(),
        hops,
        ms: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof FetchBlockedError) throw err;
      const e = err as Error & { code?: string; name?: string };
      if (e.name === 'TimeoutError' || e.code === 'UND_ERR_CONNECT_TIMEOUT' || e.code === 'UND_ERR_HEADERS_TIMEOUT') {
        throw new FetchBlockedError(`Keine Antwort innerhalb von ${Math.round(policy.timeoutMs / 1000)} Sekunden.`, 'timeout');
      }
      throw err;
    } finally {
      agent.close().catch(() => {});
    }
  }
  throw new FetchBlockedError(`Mehr als ${maxRedirects} Weiterleitungen hintereinander.`, 'redirects');
}
