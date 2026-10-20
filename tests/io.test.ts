import Papa from 'papaparse';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { csvCell } from '../src/server/admin/routes/io.js';
import { createTestApp, location, type TestApp } from './helpers.js';

let t: TestApp;
const BOM = String.fromCharCode(0xfeff);

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('Export', () => {
  beforeAll(async () => {
    await t.admin.createLink({ url: 'https://export.example/1', slug: 'exp-formel', title: '=HYPERLINK("https://evil.example","klick")', notes: '+SUMME(A1)', tags: ['@cmd', 'normal'] });
    await t.admin.createLink({ url: 'https://export.example/2', slug: 'exp-normal', title: 'Ganz normal, mit "Anführungszeichen"', notes: '-2' });
    const arch = await t.admin.createLink({ url: 'https://export.example/3', slug: 'exp-archiv' });
    await t.admin.json('PATCH', `/api/v1/links/${arch.id}`, { archived: true });
  });

  it('csvCell entschärft Formeln', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@a')).toBe("'@a");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('\rx')).toBe("'\rx");
    expect(csvCell('a=1')).toBe('a=1');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('CSV mit BOM, Kopfzeile und entschärften Formeln', async () => {
    const res = await t.admin.get('/api/v1/export?format=csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="filum-links-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.body.startsWith(BOM)).toBe(true);
    const parsed = Papa.parse<Record<string, string>>(res.body.slice(1), { header: true, skipEmptyLines: true });
    expect(parsed.meta.fields?.slice(0, 4)).toEqual(['short_url', 'domain', 'slug', 'url']);
    const bySlug = Object.fromEntries(parsed.data.map((r) => [r.slug, r]));
    expect(bySlug['exp-formel'].title).toBe('\'=HYPERLINK("https://evil.example","klick")');
    expect(bySlug['exp-formel'].notes).toBe("'+SUMME(A1)");
    expect(bySlug['exp-formel'].tags).toBe("'@cmd;normal");
    expect(bySlug['exp-normal'].title).toBe('Ganz normal, mit "Anführungszeichen"');
    expect(bySlug['exp-normal'].notes).toBe("'-2");
    expect(bySlug['exp-normal'].short_url).toBe('https://go.test/exp-normal');
    // Export enthält standardmäßig auch archivierte Links
    expect(bySlug['exp-archiv'].state).toBe('archived');
    // keine Zelle beginnt mit einem Formelzeichen
    for (const row of parsed.data) for (const v of Object.values(row)) expect(v).not.toMatch(/^[=+\-@]/);
  });

  it('JSON-Export und Filter', async () => {
    const res = await t.admin.get('/api/v1/export?format=json&q=exp-');
    expect(res.headers['content-type']).toContain('application/json');
    const data = res.json();
    expect(data.count).toBe(3);
    expect(data.links).toHaveLength(3);
    expect(data.links.map((l: { slug: string }) => l.slug).sort()).toEqual(['exp-archiv', 'exp-formel', 'exp-normal']);
    expect(data.links[0]).not.toHaveProperty('canEdit');
    expect(data.links[0]).not.toHaveProperty('spark');
    expect(JSON.stringify(data)).not.toContain('password_hash');
    const live = (await t.admin.get('/api/v1/export?format=json&q=exp-&state=live')).json();
    expect(live.count).toBe(2);
  });

  it('auch viewer darf exportieren', async () => {
    const viewer = await t.createUser('viewer');
    expect((await viewer.get('/api/v1/export?format=json')).statusCode).toBe(200);
    expect((await viewer.post('/api/v1/import/preview', { csv: 'url\nhttps://a.example' })).statusCode).toBe(403);
  });
});

describe('Import', () => {
  beforeAll(async () => {
    await t.admin.createLink({ url: 'https://vorhanden.example/', slug: 'yl-vorhanden', title: 'Alt' });
  });

  it('Vorschau erkennt YOURLS-Spalten (keyword,url,title) und meldet Konflikte', async () => {
    const csv = [
      'keyword,url,title,timestamp,ip,clicks',
      'yl-eins,https://yourls.example/1,Eins,2024-01-01,1.2.3.4,5',
      'yl-vorhanden,https://yourls.example/2,Zwei,2024-01-01,1.2.3.4,5',
      'yl-js,javascript:alert(1),Drei,2024-01-01,1.2.3.4,5',
      'YL-EINS,https://yourls.example/4,Doppelt,2024-01-01,1.2.3.4,5',
      'api,https://yourls.example/5,Reserviert,2024-01-01,1.2.3.4,5',
      ',yourls.example/6,Ohne Slug,,,',
    ].join('\n');
    const res = await t.admin.req('POST', '/api/v1/import/preview', undefined, { raw: csv, headers: { 'content-type': 'text/csv' } });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.columns).toEqual({ slug: 'keyword', url: 'url', title: 'title' });
    expect(p.total).toBe(6);
    const byLine = Object.fromEntries(p.rows.map((r: { line: number }) => [r.line, r]));
    expect(byLine[2]).toMatchObject({ status: 'ok', slug: 'yl-eins', title: 'Eins', url: 'https://yourls.example/1' });
    expect(byLine[3].status).toBe('conflict');
    expect(byLine[4].status).toBe('invalid');
    expect(byLine[5]).toMatchObject({ status: 'conflict', message: 'Kurzadresse kommt in der Datei mehrfach vor.' });
    expect(byLine[6].status).toBe('invalid');
    expect(byLine[7]).toMatchObject({ status: 'ok', url: 'https://yourls.example/6' });
    expect(p).toMatchObject({ ok: 2, conflicts: 2, invalid: 2 });
    // Vorschau speichert nichts
    expect((await t.admin.json('GET', '/api/v1/slug/check?slug=yl-eins')).available).toBe(true);
  });

  it('Vorschau als JSON {csv}, mit BOM und Semikolon-Trenner', async () => {
    const csv = `${BOM}Kurzadresse;Zieladresse;Titel;Ablaufdatum\nsemi-1;https://semi.example/1;Semi;31.12.2030\n`;
    const p = await t.admin.json('POST', '/api/v1/import/preview', { csv });
    expect(p.columns).toMatchObject({ slug: 'Kurzadresse', url: 'Zieladresse', title: 'Titel', expiresAt: 'Ablaufdatum' });
    expect(p.rows[0].row.expiresAt).toMatch(/^2030-12-31T/);
    expect(p.ok).toBe(1);
  });

  it('Liste ohne Kopfzeile: eine Adresse pro Zeile', async () => {
    const p = await t.admin.json('POST', '/api/v1/import/preview', { csv: 'https://liste.example/1\r\nwww.liste.example/2\n\nliste.example/3\n' });
    expect(p.columns).toEqual({ url: '(eine Adresse pro Zeile)' });
    expect(p.rows.map((r: { url: string }) => r.url)).toEqual(['https://liste.example/1', 'https://www.liste.example/2', 'https://liste.example/3']);
    expect(p.ok).toBe(3);
  });

  it('unbrauchbare Datei → 400 mit Hinweis', async () => {
    const res = await t.admin.post('/api/v1/import/preview', { csv: 'foo,bar\n1,2\n' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('import_columns');
    expect(res.json().error.message).toContain('foo, bar');
  });

  it('Import mit skip, rename und update', async () => {
    const rows = [
      { line: 2, url: 'https://import.example/neu', slug: 'imp-neu', title: 'Neu', tags: ['import'] },
      { line: 3, url: 'https://import.example/geaendert', slug: 'yl-vorhanden', title: 'Aktualisiert' },
    ];
    const skip = await t.admin.json('POST', '/api/v1/import', { rows, onConflict: 'skip', tags: ['charge'] });
    expect(skip).toMatchObject({ created: 1, updated: 0, skipped: 1, failed: [] });
    expect(location(await t.pub('/yl-vorhanden'))).toBe('https://vorhanden.example/');
    const neu = (await t.admin.json('GET', '/api/v1/links?q=imp-neu')).items[0];
    expect(neu.tags.map((x: { name: string }) => x.name).sort()).toEqual(['charge', 'import']);

    const rename = await t.admin.json('POST', '/api/v1/import', { rows: [rows[1]], onConflict: 'rename' });
    expect(rename).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    const renamed = (await t.admin.json('GET', `/api/v1/lookup?url=${encodeURIComponent('https://import.example/geaendert')}`)).items;
    expect(renamed).toHaveLength(1);
    expect(renamed[0].slug).not.toBe('yl-vorhanden');
    expect(location(await t.pub('/yl-vorhanden'))).toBe('https://vorhanden.example/');

    const update = await t.admin.json('POST', '/api/v1/import', { rows: [rows[1]], onConflict: 'update' });
    expect(update).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(location(await t.pub('/yl-vorhanden'))).toBe('https://import.example/geaendert');
    const updated = (await t.admin.json('GET', '/api/v1/links?q=yl-vorhanden')).items[0];
    expect(updated.title).toBe('Aktualisiert');
  });

  it('fehlerhafte Zeilen werden einzeln gemeldet', async () => {
    const res = await t.admin.json('POST', '/api/v1/import', {
      rows: [
        { line: 2, url: 'https://import.example/ok', slug: 'imp-ok' },
        { line: 3, url: 'javascript:alert(1)', slug: 'imp-js' },
        { line: 4, url: 'https://import.example/x', slug: 'mit leerzeichen' },
      ],
    });
    expect(res.created).toBe(1);
    expect(res.failed.map((f: { line: number }) => f.line)).toEqual([3, 4]);
  });

  it('Import eines gelöschten (reservierten) Slugs: skip überspringt, update vergibt eine neue Adresse', async () => {
    const l = await t.admin.createLink({ url: 'https://tomb.example/', slug: 'imp-tomb' });
    await t.admin.json('DELETE', `/api/v1/links/${l.id}`);
    const row = { line: 2, url: 'https://tomb.example/neu', slug: 'imp-tomb' };
    expect(await t.admin.json('POST', '/api/v1/import', { rows: [row], onConflict: 'skip' })).toMatchObject({ created: 0, skipped: 1 });
    const upd = await t.admin.json('POST', '/api/v1/import', { rows: [row], onConflict: 'update' });
    // Es gibt keinen Link zum Aktualisieren: wie „rename“ – die reservierte Adresse bleibt unangetastet
    expect(upd).toMatchObject({ created: 1, updated: 0 });
    const created = (await t.admin.json('GET', `/api/v1/lookup?url=${encodeURIComponent('https://tomb.example/neu')}`)).items;
    expect(created).toHaveLength(1);
    expect(created[0].slug).not.toBe('imp-tomb');
    expect((await t.pub('/imp-tomb')).statusCode).toBe(410);
  });

  it('member darf importieren; Links gehören dann dem member', async () => {
    const member = await t.createUser('member');
    const res = await member.json('POST', '/api/v1/import', { rows: [{ line: 1, url: 'https://member-import.example/' }] });
    expect(res.created).toBe(1);
    const mine = await member.json('GET', '/api/v1/links?owner=me');
    expect(mine.items.map((x: { url: string }) => x.url)).toContain('https://member-import.example/');
  });
});
