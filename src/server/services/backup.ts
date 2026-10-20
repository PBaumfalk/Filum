import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/db.js';
import { migrations } from '../db/migrations.js';
import { AppError } from '../lib/errors.js';

/**
 * Sicherungen der SQLite-Datenbank. Sie entstehen im laufenden Betrieb über die
 * Online-Backup-Schnittstelle von SQLite und sind daher in sich konsistent.
 * Eine Sicherung ist eine einzelne .db-Datei, die alles enthält: Links, Domains,
 * Konten, Einstellungen und Statistik.
 */

export const RESTORE_STAGING = 'wiederherstellung-ausstehend.db';
const NAME_RE = /^[\w.-]+\.db$/;

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
  kind: 'auto' | 'manuell' | 'migration' | 'wiederherstellung' | 'andere';
}

function kindOf(name: string): BackupInfo['kind'] {
  if (name.startsWith('auto-')) return 'auto';
  if (name.startsWith('manuell-')) return 'manuell';
  if (name.startsWith('vor-migration')) return 'migration';
  if (name.startsWith('vor-wiederherstellung')) return 'wiederherstellung';
  return 'andere';
}

function stamp(): string {
  return new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
}

export class Backups {
  constructor(
    private db: DB,
    private dir: string,
    private dataDir: string,
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }

  list(): BackupInfo[] {
    return fs
      .readdirSync(this.dir)
      .filter((f) => NAME_RE.test(f))
      .map((name) => {
        const st = fs.statSync(path.join(this.dir, name));
        return { name, size: st.size, createdAt: st.mtime.toISOString(), kind: kindOf(name) };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  pathOf(name: string): string {
    if (!NAME_RE.test(name) || name.includes('..')) throw new AppError(400, 'invalid', 'Ungültiger Dateiname.');
    const p = path.join(this.dir, name);
    if (!fs.existsSync(p)) throw new AppError(404, 'not_found', 'Sicherung nicht gefunden.');
    return p;
  }

  async create(kind: 'auto' | 'manuell'): Promise<BackupInfo> {
    const name = `${kind}-${stamp()}.db`;
    const target = path.join(this.dir, name);
    // Erst unter .tmp schreiben (list() ignoriert diese Endung), prüfen, dann umbenennen:
    // Ein Absturz mittendrin hinterlässt nie eine halbe Datei, die wie eine Sicherung aussieht.
    const tmp = `${target}.tmp`;
    try {
      await this.db.backup(tmp);
      const v = verifyBackupFile(tmp);
      if (!v.ok) throw new AppError(500, 'backup_failed', `Die Sicherung ist unvollständig: ${v.error}`);
      fs.renameSync(tmp, target);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    return this.list().find((b) => b.name === name)!;
  }

  rotate(keep: number): number {
    const autos = this.list().filter((b) => b.kind === 'auto');
    let removed = 0;
    for (const b of autos.slice(keep)) {
      fs.rmSync(path.join(this.dir, b.name), { force: true });
      removed++;
    }
    // Sicherungen vor Migrationen/Wiederherstellungen: die letzten 5 behalten
    for (const kind of ['migration', 'wiederherstellung'] as const) {
      for (const b of this.list().filter((x) => x.kind === kind).slice(5)) {
        fs.rmSync(path.join(this.dir, b.name), { force: true });
        removed++;
      }
    }
    return removed;
  }

  remove(name: string): void {
    fs.rmSync(this.pathOf(name));
  }

  /** Legt eine Datei zur Wiederherstellung beim nächsten Start bereit. */
  stage(source: string): { links: number; schema: number } {
    const v = verifyBackupFile(source);
    if (!v.ok) throw new AppError(400, 'invalid_backup', v.error!);
    fs.copyFileSync(source, path.join(this.dataDir, RESTORE_STAGING));
    return { links: v.links!, schema: v.schema! };
  }
}

/** Prüft, ob eine Datei eine intakte Filum-Datenbank ist, die diese Version lesen kann. */
export function verifyBackupFile(file: string): { ok: boolean; error?: string; links?: number; users?: number; domains?: number; schema?: number } {
  let head: Buffer;
  try {
    const fd = fs.openSync(file, 'r');
    head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
  } catch {
    return { ok: false, error: 'Datei nicht lesbar.' };
  }
  if (head.toString('latin1') !== 'SQLite format 3\u0000') return { ok: false, error: 'Das ist keine SQLite-Datenbank.' };
  // Beim Öffnen einer Datei im WAL-Modus legt SQLite -wal/-shm an; nur diese werden danach wieder entfernt.
  const sidecars = ['-wal', '-shm'].map((s) => `${file}${s}`).filter((f) => !fs.existsSync(f));
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const check = db.pragma('integrity_check', { simple: true });
    if (check !== 'ok') return { ok: false, error: `Die Datei ist beschädigt (${String(check)}).` };
    const schema = db.pragma('user_version', { simple: true }) as number;
    const latest = migrations.at(-1)!.version;
    if (schema < 1) return { ok: false, error: 'Die Datei ist keine Filum-Datenbank.' };
    if (schema > latest) return { ok: false, error: `Die Sicherung stammt von einer neueren Filum-Version (Schema ${schema}). Bitte zuerst Filum aktualisieren.` };
    const n = (t: string) => (db!.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
    return { ok: true, links: n('links'), users: n('users'), domains: n('domains'), schema };
  } catch (e) {
    return { ok: false, error: `Die Datei ist keine gültige Filum-Datenbank (${(e as Error).message}).` };
  } finally {
    db?.close();
    for (const f of sidecars) fs.rmSync(f, { force: true });
  }
}

/**
 * Beim Start: Liegt eine Wiederherstellung bereit, wird die aktuelle Datenbank
 * gesichert und durch die bereitgelegte Datei ersetzt.
 */
export function applyStagedRestore(dataDir: string, dbPath: string, backupDir: string): { restored: boolean; previous?: string } {
  const staged = path.join(dataDir, RESTORE_STAGING);
  if (!fs.existsSync(staged)) return { restored: false };
  const v = verifyBackupFile(staged);
  if (!v.ok) {
    fs.renameSync(staged, `${staged}.ungueltig-${Date.now()}`);
    throw new Error(`Bereitgelegte Wiederherstellung ist ungültig und wurde beiseitegelegt: ${v.error}`);
  }
  fs.mkdirSync(backupDir, { recursive: true });
  let previous: string | undefined;
  if (fs.existsSync(dbPath)) {
    previous = path.join(backupDir, `vor-wiederherstellung-${stamp()}.db`);
    const cur = new Database(dbPath);
    try {
      cur.pragma('wal_checkpoint(TRUNCATE)');
      cur.exec(`VACUUM INTO '${previous.replace(/'/g, "''")}'`);
    } finally {
      cur.close();
    }
  }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.renameSync(staged, dbPath);
  return { restored: true, previous };
}
