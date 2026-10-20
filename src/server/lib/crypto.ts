import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

// scrypt mit N=2^15, r=8, p=1: ~32 MiB Speicher, ca. 50–100 ms je Prüfung.
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Gleiche Rechenzeit wie bei einer echten Prüfung, damit die Antwortzeit nichts verrät.
    await scrypt('x', 'filum-dummy-salt', KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return crypto.timingSafeEqual(key, expected);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Zufällige Kurzadresse aus einem telefontauglichen Alphabet:
 * keine leicht verwechselbaren Zeichen (0/O, 1/l/I), nur Kleinbuchstaben und Ziffern.
 */
const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomSlug(length: number): string {
  const out: string[] = [];
  const max = 256 - (256 % SLUG_ALPHABET.length);
  while (out.length < length) {
    for (const b of crypto.randomBytes(length * 2)) {
      if (b < max) out.push(SLUG_ALPHABET[b % SLUG_ALPHABET.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/** Ziffernfolge für den Einrichtungscode beim ersten Start */
export function setupCode(): string {
  const n = crypto.randomInt(0, 1_000_000_000);
  return String(n).padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1-$2-$3');
}
