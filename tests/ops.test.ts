import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/server/config.js';
import { ensureDataDir } from '../src/server/app.js';
import { openDatabase, openDatabaseReadonly } from '../src/server/db/db.js';
import { Backups } from '../src/server/services/backup.js';
import { silentLog } from './helpers.js';

const saved = { ...process.env };
const dirs: string[] = [];
afterEach(() => {
  process.env = { ...saved };
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'filum-ops-'));
  dirs.push(d);
  return d;
}

describe('Konfiguration', () => {
  it('liest Wahrheitswerte unabhängig von Groß- und Kleinschreibung', () => {
    process.env.STRICT_ADMIN_HOST = 'True';
    process.env.DISABLE_LOCAL_LOGIN = 'FALSE';
    const c = loadConfig();
    expect(c.strictAdminHost).toBe(true);
    expect(c.disableLocalLogin).toBe(false);
  });

  it('lehnt unklare Wahrheitswerte mit Variablennamen ab', () => {
    process.env.STRICT_ADMIN_HOST = 'vielleicht';
    expect(() => loadConfig()).toThrow(/STRICT_ADMIN_HOST/);
  });

  it('TRUST_PROXY true/false unabhängig von der Schreibweise', () => {
    process.env.TRUST_PROXY = 'False';
    expect(loadConfig().trustProxy).toBe(false);
    process.env.TRUST_PROXY = 'TRUE';
    expect(loadConfig().trustProxy).toBe(true);
    process.env.TRUST_PROXY = '172.18.0.0/16, 10.0.0.5';
    expect(loadConfig().trustProxy).toEqual(['172.18.0.0/16', '10.0.0.5']);
  });

  it('Zahlen nur aus Ziffern', () => {
    process.env.BACKUP_INTERVAL_HOURS = '24h';
    expect(() => loadConfig()).toThrow(/BACKUP_INTERVAL_HOURS/);
    process.env.BACKUP_INTERVAL_HOURS = ' 12 ';
    expect(loadConfig().backup.intervalHours).toBe(12);
  });

  it('prüft LOG_LEVEL gegen die bekannten Stufen', () => {
    process.env.LOG_LEVEL = 'WARN';
    expect(loadConfig().logLevel).toBe('warn');
    process.env.LOG_LEVEL = 'warning';
    expect(() => loadConfig()).toThrow(/LOG_LEVEL muss einer dieser Werte sein/);
  });

  it('kennt nur noch DATA_DIR', () => {
    const d = tmpDir();
    process.env.DATA_DIR = d;
    process.env.FILUM_DATA_DIR = '/anderswo';
    expect(loadConfig().dataDir).toBe(path.resolve(d));
  });
});

describe('Datenverzeichnis und Sicherungen', () => {
  it('legt ein fehlendes Datenverzeichnis an', () => {
    const d = path.join(tmpDir(), 'neu', 'data');
    ensureDataDir(d);
    expect(fs.existsSync(d)).toBe(true);
  });

  it.skipIf(process.getuid?.() === 0)('meldet ein nicht beschreibbares Datenverzeichnis verständlich', () => {
    const d = tmpDir();
    fs.chmodSync(d, 0o555);
    try {
      expect(() => ensureDataDir(d)).toThrow(/nicht beschreibbar.*chown/);
    } finally {
      fs.chmodSync(d, 0o755);
    }
  });

  it('schreibt Sicherungen atomar und hinterlässt keine .tmp-Dateien', async () => {
    const d = tmpDir();
    const db = openDatabase(path.join(d, 'filum.db'), silentLog);
    const backups = new Backups(db, path.join(d, 'backups'), d);
    // Eine liegengebliebene .tmp-Datei taucht in der Liste nicht auf
    fs.writeFileSync(path.join(d, 'backups', 'auto-alt.db.tmp'), 'halb');
    const b = await backups.create('manuell');
    db.close();
    expect(backups.list().map((x) => x.name)).toEqual([b.name]);
    expect(fs.readdirSync(path.join(d, 'backups')).filter((f) => f.endsWith('.tmp') && f !== 'auto-alt.db.tmp')).toEqual([]);
  });

  it('öffnet die Datenbank lesend ohne Migration', () => {
    const d = tmpDir();
    const file = path.join(d, 'filum.db');
    expect(() => openDatabaseReadonly(file)).toThrow(/Keine Datenbank/);
    openDatabase(file, silentLog).close();
    const ro = openDatabaseReadonly(file);
    expect(() => ro.exec('CREATE TABLE x(a)')).toThrow(/readonly/);
    ro.close();
  });
});
