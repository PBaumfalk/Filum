import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase, openDatabaseReadonly } from './db/db.js';
import { hashPassword, randomToken } from './lib/crypto.js';
import { createLogger } from './lib/log.js';
import { Backups, RESTORE_STAGING, verifyBackupFile } from './services/backup.js';

/**
 * Verwaltung auf der Kommandozeile, z. B.:
 *   docker compose exec filum filum backup
 *   docker compose exec filum filum restore /data/backups/manuell-….db
 */

const HELP = `Filum – Befehle

  backup                   Sicherung in ${'<DATA_DIR>'}/backups anlegen
  backups                  Sicherungen auflisten
  verify <datei>           Sicherungsdatei prüfen
  restore <datei>          Sicherung zur Wiederherstellung bereitlegen; wird beim
                           nächsten Start eingespielt (vorher automatische Sicherung)
  reset-password <e-mail>  Neues Zufallspasswort für ein Konto setzen
  setup-code               Einrichtungscode anzeigen (nur vor dem ersten Konto)
  integrity                Datenbank auf Beschädigungen prüfen
  health                   Beide Dienste über /healthz prüfen (Exit-Code 0 = gesund)

Nur backup, restore und reset-password schreiben; die übrigen Befehle öffnen die
Datenbank nur lesend und funktionieren auch, wenn Filum selbst nicht startet.
`;

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const config = loadConfig();
  const log = createLogger('warn');
  const out = (s: string) => process.stdout.write(`${s}\n`);

  switch (cmd) {
    case 'backup': {
      const db = openDatabase(config.dbPath, log, config.backupDir);
      const b = await new Backups(db, config.backupDir, config.dataDir).create('manuell');
      db.close();
      out(`Sicherung erstellt: ${path.join(config.backupDir, b.name)} (${(b.size / 1024).toFixed(0)} KB)`);
      break;
    }
    case 'backups': {
      // Ohne Datenbank: Das Verzeichnis lässt sich auch lesen, wenn filum.db fehlt oder beschädigt ist.
      if (!fs.existsSync(config.backupDir)) {
        out(`Keine Sicherungen (${config.backupDir} existiert nicht).`);
        break;
      }
      const files = fs
        .readdirSync(config.backupDir)
        .filter((f) => f.endsWith('.db'))
        .map((name) => ({ name, st: fs.statSync(path.join(config.backupDir, name)) }))
        .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
      for (const { name, st } of files) out(`${st.mtime.toISOString()}  ${String(Math.round(st.size / 1024)).padStart(8)} KB  ${name}`);
      if (!files.length) out('Keine Sicherungen.');
      break;
    }
    case 'verify': {
      if (!arg) throw new Error('Bitte eine Datei angeben.');
      const v = verifyBackupFile(arg);
      if (!v.ok) {
        out(`Ungültig: ${v.error}`);
        process.exitCode = 2;
      } else out(`In Ordnung: Schema ${v.schema}, ${v.links} Links, ${v.domains} Domains, ${v.users} Konten.`);
      break;
    }
    case 'restore': {
      if (!arg) throw new Error('Bitte die Sicherungsdatei angeben.');
      const v = verifyBackupFile(arg);
      if (!v.ok) throw new Error(`Die Sicherung ist ungültig: ${v.error}`);
      fs.copyFileSync(arg, path.join(config.dataDir, RESTORE_STAGING));
      out(`Bereitgelegt: ${v.links} Links, ${v.domains} Domains, ${v.users} Konten.`);
      out('Jetzt Filum neu starten (docker compose restart filum). Die aktuelle Datenbank wird dabei automatisch gesichert.');
      break;
    }
    case 'reset-password': {
      if (!arg) throw new Error('Bitte die E-Mail-Adresse angeben.');
      const db = openDatabase(config.dbPath, log, config.backupDir);
      const pw = randomToken(12);
      const r = db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE email = ? COLLATE NOCASE').run(await hashPassword(pw), Math.floor(Date.now() / 1000), arg);
      if (!r.changes) throw new Error(`Kein Konto mit der Adresse ${arg}.`);
      db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ? COLLATE NOCASE)').run(arg);
      db.close();
      out(`Neues Passwort für ${arg}: ${pw}`);
      out('Bitte nach der Anmeldung unter „Mein Konto“ ändern.');
      break;
    }
    case 'setup-code': {
      const db = openDatabaseReadonly(config.dbPath);
      const row = db.prepare("SELECT value FROM meta WHERE key = 'setup_code'").get() as { value: string } | undefined;
      db.close();
      out(row ? `Einrichtungscode: ${row.value}` : 'Es gibt bereits Konten; ein Einrichtungscode wird nicht mehr benötigt.');
      break;
    }
    case 'integrity': {
      const db = openDatabaseReadonly(config.dbPath);
      out(`integrity_check: ${String(db.pragma('integrity_check', { simple: true }))}`);
      db.close();
      break;
    }
    case 'health': {
      const check = async (port: number) => {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(4000) });
          return r.ok ? 'ok' : `HTTP ${r.status}`;
        } catch (e) {
          return (e as Error).message;
        }
      };
      const [pub, admin] = await Promise.all([check(config.publicPort), check(config.adminPort)]);
      out(`öffentlich (${config.publicPort}): ${pub}`);
      out(`intern (${config.adminPort}): ${admin}`);
      if (pub !== 'ok' || admin !== 'ok') process.exitCode = 1;
      break;
    }
    default:
      out(HELP);
      if (cmd && cmd !== 'help') process.exitCode = 1;
  }
}

main().catch((e) => {
  process.stderr.write(`Fehler: ${(e as Error).message}\n`);
  process.exit(1);
});
