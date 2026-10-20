import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RESTORE_STAGING, verifyBackupFile } from '../src/server/services/backup.js';
import { ADMIN_EMAIL, createTestApp, location, makeDataDir, testConfig, silentLog, type TestApp } from './helpers.js';
import { createApp } from '../src/server/app.js';

const cleanup: TestApp[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const t of cleanup.splice(0)) await t.close({ keepDir: true }).catch(() => {});
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function fresh(dataDir?: string) {
  const t = await createTestApp({ dataDir });
  cleanup.push(t);
  if (!dirs.includes(t.dataDir)) dirs.push(t.dataDir);
  return t;
}

describe('Sicherungen', () => {
  it('POST /api/v1/backups erstellt eine gültige, vollständige Datei', async () => {
    const t = await fresh();
    await t.admin.createLink({ url: 'https://backup.example/1', slug: 'b1' });
    await t.admin.createLink({ url: 'https://backup.example/2', slug: 'b2' });
    const res = await t.admin.post('/api/v1/backups');
    expect(res.statusCode).toBe(201);
    const b = res.json();
    expect(b.name).toMatch(/^manuell-.*\.db$/);
    expect(b.kind).toBe('manuell');
    expect(b.size).toBeGreaterThan(0);
    const file = path.join(t.dataDir, 'backups', b.name);
    // eine Sicherung ist genau eine Datei – keine verwaisten -wal/-shm-Dateien
    expect(fs.readdirSync(path.join(t.dataDir, 'backups'))).toEqual([b.name]);
    const v = verifyBackupFile(file);
    expect(fs.readdirSync(path.join(t.dataDir, 'backups'))).toEqual([b.name]);
    expect(v).toMatchObject({ ok: true, links: 2, users: 1, domains: 1 });
    expect(v.schema).toBeGreaterThan(0);

    const list = await t.admin.json('GET', '/api/v1/backups');
    expect(list.items.map((x: { name: string }) => x.name)).toContain(b.name);

    const dl = await t.admin.get(`/api/v1/backups/${b.name}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/vnd.sqlite3');
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="filum-${b.name}"`);
    expect(dl.rawPayload.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\u0000');
    expect(dl.rawPayload.equals(fs.readFileSync(file))).toBe(true);

    // Prüfen einer hochgeladenen Datei (ohne Wiederherstellung)
    const up = await t.admin.req('POST', '/api/v1/backups/upload', undefined, { raw: fs.readFileSync(file), headers: { 'content-type': 'application/octet-stream' } });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ ok: true, links: 2 });
    // die temporäre Upload-Datei wird samt Nebendateien entfernt
    expect(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(`filum-upload-${process.pid}-`))).toEqual([]);

    expect((await t.admin.json('DELETE', `/api/v1/backups/${b.name}`)).ok).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('ungültige Dateien und Namen werden abgelehnt', async () => {
    const t = await fresh();
    const garbage = await t.admin.req('POST', '/api/v1/backups/upload', undefined, { raw: Buffer.from('kein sqlite'), headers: { 'content-type': 'application/octet-stream' } });
    expect(garbage.statusCode).toBe(200);
    expect(garbage.json()).toMatchObject({ ok: false, error: 'Das ist keine SQLite-Datenbank.' });
    // Mit restore=1 wird nichts bereitgelegt
    const restore = await t.admin.req('POST', '/api/v1/backups/upload?restore=1', undefined, { raw: Buffer.from('kein sqlite'), headers: { 'content-type': 'application/octet-stream' } });
    expect(restore.statusCode).toBe(400);
    expect(restore.json().error.code).toBe('invalid_backup');
    expect(fs.existsSync(path.join(t.dataDir, RESTORE_STAGING))).toBe(false);

    // Eine fremde SQLite-Datei ist keine Filum-Sicherung
    const Database = (await import('better-sqlite3')).default;
    const foreign = path.join(t.dataDir, 'fremd.db');
    const db = new Database(foreign);
    db.exec('CREATE TABLE x(a)');
    db.close();
    expect(verifyBackupFile(foreign)).toMatchObject({ ok: false, error: 'Die Datei ist keine Filum-Datenbank.' });
    expect(() => t.ctx.jobs.backups.stage(foreign)).toThrow(/keine Filum-Datenbank/);

    expect((await t.admin.get('/api/v1/backups/..%2Ffilum.db/download')).statusCode).toBe(400);
    expect((await t.admin.get('/api/v1/backups/gibtsnicht.db/download')).statusCode).toBe(404);
    expect((await t.admin.del('/api/v1/backups/..%2F..%2Fetwas.db')).statusCode).toBe(400);
    expect(fs.existsSync(t.ctx.config.dbPath)).toBe(true);
  });

  it('Wiederherstellung: bereitgelegte Sicherung wird beim nächsten Start eingespielt', async () => {
    const t = await fresh();
    await t.admin.createLink({ url: 'https://restore.example/vorher', slug: 'vorher' });
    await t.admin.json('PATCH', '/api/v1/settings', { organizationName: 'Stand A' });
    const b = await t.admin.json('POST', '/api/v1/backups', undefined, 201);
    await t.admin.createLink({ url: 'https://restore.example/nachher', slug: 'nachher' });
    await t.admin.json('PATCH', '/api/v1/settings', { organizationName: 'Stand B' });

    const info = t.ctx.jobs.backups.stage(path.join(t.dataDir, 'backups', b.name));
    expect(info.links).toBe(1);
    expect(fs.existsSync(path.join(t.dataDir, RESTORE_STAGING))).toBe(true);
    await t.close({ keepDir: true });
    cleanup.splice(cleanup.indexOf(t), 1);

    const t2 = await fresh(t.dataDir);
    expect(fs.readdirSync(t.dataDir).filter((f) => f.startsWith(RESTORE_STAGING))).toEqual([]);
    expect((await t2.pub('/vorher')).statusCode).toBe(302);
    expect(location(await t2.pub('/vorher'))).toBe('https://restore.example/vorher');
    expect((await t2.pub('/nachher')).statusCode).toBe(404);
    expect(t2.ctx.settings.get().organizationName).toBe('Stand A');
    const slugs = (await t2.admin.json('GET', '/api/v1/links')).items.map((l: { slug: string }) => l.slug);
    expect(slugs).toEqual(['vorher']);

    // Der vorherige Stand wurde gesichert und enthält den neueren Link
    const backups = await t2.admin.json('GET', '/api/v1/backups');
    const pre = backups.items.find((x: { kind: string }) => x.kind === 'wiederherstellung');
    expect(pre).toBeTruthy();
    expect(pre.name).toMatch(/^vor-wiederherstellung-.*\.db$/);
    expect(verifyBackupFile(path.join(t.dataDir, 'backups', pre.name))).toMatchObject({ ok: true, links: 2 });
    expect(t2.admin.userId).toBeGreaterThan(0);
    expect((await t2.admin.json('GET', '/api/v1/session')).user.email).toBe(ADMIN_EMAIL);
  });

  it('eine beschädigte bereitgelegte Datei verhindert den Start und wird beiseitegelegt', async () => {
    const t = await fresh();
    await t.admin.createLink({ url: 'https://restore.example/bleibt', slug: 'bleibt' });
    await t.close({ keepDir: true });
    cleanup.splice(cleanup.indexOf(t), 1);
    fs.writeFileSync(path.join(t.dataDir, RESTORE_STAGING), 'SQLite format 3\u0000kaputt'.padEnd(4096, 'x'));
    await expect(createApp(testConfig(t.dataDir), silentLog)).rejects.toThrow(/ungültig/);
    expect(fs.existsSync(path.join(t.dataDir, RESTORE_STAGING))).toBe(false);
    expect(fs.readdirSync(t.dataDir).some((f) => f.startsWith(`${RESTORE_STAGING}.ungueltig-`))).toBe(true);
    // Der nächste Start läuft mit dem unveränderten Datenstand
    const t2 = await fresh(t.dataDir);
    expect(location(await t2.pub('/bleibt'))).toBe('https://restore.example/bleibt');
  });

  it('Rotation behält nur die letzten automatischen Sicherungen', async () => {
    const dir = makeDataDir();
    dirs.push(dir);
    const t = await fresh(dir);
    const backups = t.ctx.jobs.backups;
    for (let i = 0; i < 5; i++) {
      const name = `auto-2025-01-0${i + 1}T00-00-00.db`;
      fs.writeFileSync(path.join(dir, 'backups', name), 'x');
      const time = new Date(Date.UTC(2025, 0, i + 1));
      fs.utimesSync(path.join(dir, 'backups', name), time, time);
    }
    fs.writeFileSync(path.join(dir, 'backups', 'manuell-x.db'), 'x');
    expect(backups.rotate(2)).toBe(3);
    const left = backups.list().map((b) => b.name).sort();
    expect(left).toEqual(['auto-2025-01-04T00-00-00.db', 'auto-2025-01-05T00-00-00.db', 'manuell-x.db']);
  });
});
