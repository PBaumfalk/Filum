import dns from 'node:dns/promises';
import type { DB } from '../db/db.js';
import { conflict, notFound, badRequest } from '../lib/errors.js';
import { randomToken } from '../lib/crypto.js';
import { iso, now } from '../lib/time.js';
import { validateHost } from '../lib/validate.js';

export interface DomainRow {
  id: number;
  host: string;
  kind: 'internal' | 'public';
  is_default: number;
  status: 'pending' | 'active' | 'disabled';
  verify_token: string;
  verify_method: string | null;
  verified_at: number | null;
  https: number;
  root_url: string | null;
  not_found_url: string | null;
  slug_length: number;
  permanent_max_age: number;
  preview_suffix: number;
  note: string;
  last_check_at: number | null;
  last_check_result: string | null;
  created_at: number;
}

export function domainBase(d: Pick<DomainRow, 'host' | 'https'>): string {
  return `${d.https ? 'https' : 'http'}://${d.host}`;
}

export function serializeDomain(d: DomainRow, linkCount?: number) {
  return {
    id: d.id,
    host: d.host,
    baseUrl: domainBase(d),
    kind: d.kind,
    isDefault: Boolean(d.is_default),
    status: d.status,
    verifyToken: d.verify_token,
    verifyMethod: d.verify_method,
    verifiedAt: iso(d.verified_at),
    https: Boolean(d.https),
    rootUrl: d.root_url,
    notFoundUrl: d.not_found_url,
    slugLength: d.slug_length,
    permanentMaxAge: d.permanent_max_age,
    previewSuffix: Boolean(d.preview_suffix),
    note: d.note,
    lastCheckAt: iso(d.last_check_at),
    lastCheck: d.last_check_result ? JSON.parse(d.last_check_result) : null,
    createdAt: iso(d.created_at),
    linkCount: linkCount ?? null,
  };
}

/** Name des TXT-Eintrags für den Besitznachweis */
export const txtRecordName = (host: string) => `_filum-challenge.${host.split(':')[0]}`;

export class Domains {
  private byHost = new Map<string, DomainRow>();
  private byId = new Map<number, DomainRow>();

  constructor(private db: DB) {
    this.reload();
  }

  reload(): void {
    this.byHost.clear();
    this.byId.clear();
    for (const d of this.db.prepare('SELECT * FROM domains').all() as DomainRow[]) {
      this.byHost.set(d.host.toLowerCase(), d);
      this.byId.set(d.id, d);
    }
  }

  all(): DomainRow[] {
    return [...this.byId.values()].sort((a, b) => b.is_default - a.is_default || a.host.localeCompare(b.host));
  }

  find(host: string): DomainRow | undefined {
    return this.byHost.get(host.toLowerCase());
  }

  get(id: number): DomainRow {
    const d = this.byId.get(id);
    if (!d) throw notFound('Domain');
    return d;
  }

  default(): DomainRow | undefined {
    return this.all().find((d) => d.is_default && d.status !== 'disabled') ?? this.all().find((d) => d.status === 'active');
  }

  hosts(): string[] {
    return [...this.byHost.keys()];
  }

  linkCounts(): Map<number, number> {
    const rows = this.db.prepare('SELECT domain_id, COUNT(*) n FROM links GROUP BY domain_id').all() as { domain_id: number; n: number }[];
    return new Map(rows.map((r) => [r.domain_id, r.n]));
  }

  create(input: {
    host: string;
    kind: 'internal' | 'public';
    https?: boolean;
    isDefault?: boolean;
    note?: string;
    /** Interne Domains darf ein Admin direkt freischalten. */
    activate?: boolean;
  }): DomainRow {
    const host = validateHost(input.host);
    if (this.find(host)) throw conflict(`Die Domain ${host} ist bereits eingerichtet.`, 'host');
    const t = now();
    const status = input.activate && input.kind === 'internal' ? 'active' : 'pending';
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO domains(host, kind, is_default, status, verify_token, verify_method, verified_at, https, note, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          host,
          input.kind,
          0,
          status,
          `filum-verify=${randomToken(18)}`,
          status === 'active' ? 'admin' : null,
          status === 'active' ? t : null,
          input.https === false ? 0 : 1,
          input.note ?? '',
          t,
        ).lastInsertRowid,
    );
    if (input.isDefault || this.all().length === 0) this.setDefault(id);
    this.reload();
    return this.get(id);
  }

  setDefault(id: number): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE domains SET is_default = 0').run();
      this.db.prepare('UPDATE domains SET is_default = 1 WHERE id = ?').run(id);
    })();
    this.reload();
  }

  update(
    id: number,
    patch: Partial<{
      kind: 'internal' | 'public';
      https: boolean;
      rootUrl: string | null;
      notFoundUrl: string | null;
      slugLength: number;
      permanentMaxAge: number;
      previewSuffix: boolean;
      note: string;
      status: 'active' | 'disabled';
      isDefault: boolean;
    }>,
  ): DomainRow {
    const d = this.get(id);
    const needsProof = patch.kind === 'public' && d.kind === 'internal' && d.verify_method === 'admin';
    // Auch nach „deaktiviert“ oder im selben Schritt wie der Wechsel zu öffentlich wird nur eine bestätigte Domain aktiv.
    if (patch.status === 'active' && (needsProof || (d.status !== 'active' && !d.verified_at))) {
      throw badRequest('Eine unbestätigte Domain wird über „Besitz prüfen“ aktiviert.', 'status');
    }
    if (needsProof) {
      // Wechsel zu öffentlich: Nachweis über DNS oder HTTP nötig.
      this.db.prepare("UPDATE domains SET status = 'pending', verify_method = NULL, verified_at = NULL WHERE id = ?").run(id);
    }
    const map: Record<string, [string, unknown]> = {
      kind: ['kind', patch.kind],
      https: ['https', patch.https === undefined ? undefined : patch.https ? 1 : 0],
      rootUrl: ['root_url', patch.rootUrl],
      notFoundUrl: ['not_found_url', patch.notFoundUrl],
      slugLength: ['slug_length', patch.slugLength],
      permanentMaxAge: ['permanent_max_age', patch.permanentMaxAge],
      previewSuffix: ['preview_suffix', patch.previewSuffix === undefined ? undefined : patch.previewSuffix ? 1 : 0],
      note: ['note', patch.note],
      status: ['status', patch.status],
    };
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [col, val] of Object.values(map)) {
      if (val !== undefined) {
        sets.push(`${col} = ?`);
        args.push(val);
      }
    }
    if (sets.length) this.db.prepare(`UPDATE domains SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    if (patch.isDefault) this.setDefault(id);
    this.reload();
    return this.get(id);
  }

  markVerified(id: number, method: 'dns' | 'http' | 'admin'): DomainRow {
    this.db.prepare("UPDATE domains SET status = 'active', verify_method = ?, verified_at = ? WHERE id = ?").run(method, now(), id);
    this.reload();
    return this.get(id);
  }

  saveCheck(id: number, result: unknown): void {
    this.db.prepare('UPDATE domains SET last_check_at = ?, last_check_result = ? WHERE id = ?').run(now(), JSON.stringify(result), id);
    this.reload();
  }

  remove(id: number): void {
    const d = this.get(id);
    const n = (this.db.prepare('SELECT COUNT(*) n FROM links WHERE domain_id = ?').get(id) as { n: number }).n;
    if (n > 0) {
      throw conflict(
        `Auf ${d.host} liegen noch ${n} Links. Bitte die Links zuerst auf eine andere Domain verschieben oder die Domain nur deaktivieren.`,
      );
    }
    // Reservierte Kurzadressen hängen an der Domain und würden mitgelöscht.
    const reserved = (this.db.prepare('SELECT COUNT(*) n FROM slug_tombstones WHERE domain_id = ?').get(id) as { n: number }).n;
    if (reserved > 0) {
      throw conflict(
        `Auf ${d.host} sind noch ${reserved} Kurzadressen gelöschter oder umbenannter Links reserviert. Beim Löschen der Domain würden sie frei – bitte die Domain nur deaktivieren.`,
      );
    }
    this.db.prepare('DELETE FROM domains WHERE id = ?').run(id);
    this.reload();
    if (d.is_default) {
      const next = this.all()[0];
      if (next) this.setDefault(next.id);
    }
  }

  /** Sucht den TXT-Eintrag _filum-challenge.<host> mit dem Prüfwert. */
  async checkDns(id: number): Promise<{ ok: boolean; found: string[]; error?: string }> {
    const d = this.get(id);
    try {
      const records = (await dns.resolveTxt(txtRecordName(d.host))).map((r) => r.join(''));
      return { ok: records.includes(d.verify_token), found: records.slice(0, 5) };
    } catch (e) {
      const code = (e as { code?: string }).code;
      return {
        ok: false,
        found: [],
        error:
          code === 'ENOTFOUND' || code === 'ENODATA'
            ? `Kein TXT-Eintrag unter ${txtRecordName(d.host)} gefunden. DNS-Änderungen brauchen manchmal einige Minuten.`
            : `DNS-Abfrage fehlgeschlagen (${code ?? 'unbekannt'}).`,
      };
    }
  }
}
