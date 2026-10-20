import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '../lib/log.js';
import { migrations } from './migrations.js';

export type DB = Database.Database;

export function openDatabase(file: string, log: Logger, backupDir?: string): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existed = fs.existsSync(file);
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -16000');

  const check = db.pragma('quick_check', { simple: true });
  if (check !== 'ok') {
    throw new Error(`Die Datenbank ${file} ist beschädigt (quick_check: ${check}). Bitte eine Sicherung zurückspielen (docs/sicherung.md).`);
  }
  migrate(db, log, existed ? backupDir : undefined);
  return db;
}

/**
 * Öffnet eine bestehende Datenbank nur lesend, ohne Migration und ohne Pragmas,
 * die schreiben. Für Befehle der Kommandozeile, die nur nachsehen.
 */
export function openDatabaseReadonly(file: string): DB {
  if (!fs.existsSync(file)) throw new Error(`Keine Datenbank unter ${file}. Ist Filum schon einmal gestartet worden?`);
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
}

export function currentSchemaVersion(db: DB): number {
  return db.pragma('user_version', { simple: true }) as number;
}

export function migrate(db: DB, log: Logger, backupDir?: string): void {
  const current = currentSchemaVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;
  if (current > latest) {
    throw new Error(
      `Die Datenbank hat Schemaversion ${current}, diese Filum-Version kennt nur bis ${latest}. ` +
        'Ein Downgrade ist nicht möglich: bitte die neuere Version starten oder eine passende Sicherung zurückspielen.',
    );
  }
  const pending = migrations.filter((m) => m.version > current);
  if (!pending.length) return;

  // Vor einer Migration bestehender Daten: automatische Sicherung.
  if (backupDir && current > 0) {
    fs.mkdirSync(backupDir, { recursive: true });
    const target = path.join(backupDir, `vor-migration-v${current}-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    log.info({ target }, 'Sicherung vor Datenbankmigration angelegt');
  }

  for (const m of pending) {
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    });
    run();
    log.info({ version: m.version, name: m.name }, 'Datenbankmigration ausgeführt');
  }
}
