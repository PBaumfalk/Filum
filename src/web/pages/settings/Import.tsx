import { CheckCircle2, CircleAlert, FileUp, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { useToast } from '../../components/toast';
import { Field } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { num } from '../../lib/format';
import { useCampaigns, useCollections, useDomains, useInvalidateLinks } from '../../lib/queries';
import { SectionTitle } from './common';

interface PreviewRow {
  line: number;
  url: string;
  slug?: string;
  title?: string;
  status: 'ok' | 'conflict' | 'invalid';
  message?: string;
  row: Record<string, unknown>;
}
interface Preview {
  columns: Record<string, string>;
  total: number;
  ok: number;
  conflicts: number;
  invalid: number;
  rows: PreviewRow[];
  errors: { line: number; message: string }[];
}

const COLUMN_LABEL: Record<string, string> = {
  url: 'Ziel',
  slug: 'Kurzadresse',
  shortUrl: 'Kurzlink',
  title: 'Titel',
  notes: 'Notiz',
  tags: 'Schlagwörter',
  expiresAt: 'Ablauf',
  startsAt: 'Start',
  redirectType: 'Weiterleitung',
  fallbackUrl: 'Ersatzziel',
  maxClicks: 'Limit',
};

export function Import() {
  const domains = useDomains();
  const collections = useCollections();
  const campaigns = useCampaigns();
  const invalidate = useInvalidateLinks();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [domainId, setDomainId] = useState<number | ''>('');
  const [onConflict, setOnConflict] = useState<'skip' | 'rename' | 'update'>('skip');
  const [tags, setTags] = useState('');
  const [collectionId, setCollectionId] = useState<number | ''>('');
  const [campaignId, setCampaignId] = useState<number | ''>('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; failed: { line: number; message: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const readFile = async (f: File) => {
    if (f.size > 10 * 1024 * 1024) return setError('Die Datei ist größer als 10 MB. Bitte aufteilen.');
    setFileName(f.name);
    setText(await f.text());
    setPreview(null);
    setResult(null);
  };

  const check = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await api.raw<Preview>('POST', `/api/v1/import/preview${domainId ? `?domainId=${domainId}` : ''}`, text, 'text/csv'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Prüfung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const rows = preview.rows.filter((r) => r.status === 'ok' || (r.status === 'conflict' && onConflict !== 'skip')).map((r) => r.row);
      const res = await api.post<typeof result>('/api/v1/import', {
        rows,
        domainId: domainId || undefined,
        onConflict,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        collectionId: collectionId || null,
        campaignId: campaignId || null,
      });
      setResult(res);
      setPreview(null);
      invalidate();
      toast.ok(`${num(res!.created)} Links importiert`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Import fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const importable = preview ? preview.ok + (onConflict !== 'skip' ? preview.conflicts : 0) : 0;

  return (
    <div>
      <p className="small muted" style={{ maxWidth: '70ch', marginBottom: 14 }}>
        CSV-Dateien aus Excel, LibreOffice oder anderen Link-Diensten (z. B. YOURLS, Shlink, Bitly). Filum erkennt die Spalten selbst; nötig ist nur eine Spalte mit der Zieladresse. Eine einfache Liste mit einer Adresse pro Zeile geht auch. Erst nach der Prüfung wird etwas gespeichert.
      </p>

      <div
        className="panel"
        style={{ padding: 24, display: 'grid', gap: 12, justifyItems: 'center', textAlign: 'center', borderStyle: 'dashed', borderColor: dragOver ? 'var(--select-line)' : undefined, background: dragOver ? 'var(--select-bg)' : undefined }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void readFile(f);
        }}
      >
        <FileUp size={28} className="muted" />
        <div>
          <strong>{fileName ?? 'CSV-Datei hierher ziehen'}</strong>
          <div className="small muted">{fileName ? `${num(text.split(/\r?\n/).filter(Boolean).length)} Zeilen gelesen` : 'oder auswählen, oder unten Text einfügen'}</div>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Datei auswählen
        </button>
      </div>

      <Field label="Oder Inhalt einfügen">
        <textarea
          className="textarea mono"
          rows={5}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName(null);
            setPreview(null);
          }}
          placeholder={'url,slug,title,tags\nhttps://www.beispiel.de/angebot,angebot,Angebot,Vertrieb;Herbst'}
          spellCheck={false}
          style={{ marginTop: 6, fontSize: '0.75rem' }}
        />
      </Field>

      <SectionTitle title="Einstellungen für den Import" />
      <div className="panel panel-pad stack" style={{ '--gap': '14px' } as React.CSSProperties}>
        <div className="grid-3">
          <Field label="Domain">
            <select className="select" value={domainId} onChange={(e) => setDomainId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Standard</option>
              {domains.data?.items
                .filter((d) => d.status === 'active')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.host}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Sammlung">
            <select className="select" value={collectionId} onChange={(e) => setCollectionId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Keine</option>
              {collections.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kampagne">
            <select className="select" value={campaignId} onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Keine</option>
              {campaigns.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Zusätzliche Schlagwörter" hint="Kommagetrennt, z. B. „Import Oktober“. Hilft, den Import später wiederzufinden.">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label="Wenn eine Kurzadresse schon vergeben ist">
          <select className="select" value={onConflict} onChange={(e) => setOnConflict(e.target.value as 'skip')}>
            <option value="skip">Zeile überspringen</option>
            <option value="rename">Mit neuer, zufälliger Kurzadresse anlegen</option>
            <option value="update">Vorhandenen Link aktualisieren (Ziel, Titel …)</option>
          </select>
        </Field>
        <div className="row">
          <button className={`btn ${preview ? '' : 'primary'}`} onClick={() => void check()} disabled={!text.trim() || busy}>
            {busy && !preview ? <span className="spinner" /> : null} Prüfen
          </button>
          {preview && (
            <button className="btn primary" onClick={() => void run()} disabled={busy || importable === 0}>
              {busy ? <span className="spinner" /> : null} {num(importable)} Links importieren
            </button>
          )}
        </div>
        {error && (
          <div className="callout danger">
            <CircleAlert />
            <span>{error}</span>
          </div>
        )}
      </div>

      {result && (
        <div className="callout ok" style={{ marginTop: 16 }}>
          <CheckCircle2 />
          <span>
            Fertig: {num(result.created)} angelegt, {num(result.updated)} aktualisiert, {num(result.skipped)} übersprungen
            {result.failed.length ? `, ${result.failed.length} mit Fehlern (z. B. Zeile ${result.failed[0].line}: ${result.failed[0].message})` : ''}.{' '}
            <RouterLink to="/">Zu den Links</RouterLink>
          </span>
        </div>
      )}

      {preview && (
        <>
          <SectionTitle title="Prüfergebnis">
            Erkannte Spalten:{' '}
            {Object.entries(preview.columns)
              .map(([k, v]) => `${COLUMN_LABEL[k] ?? k} ← „${v}“`)
              .join(', ')}
          </SectionTitle>
          <div className="row wrap" style={{ marginBottom: 10 }}>
            <span className="pill ok">
              <CheckCircle2 /> {num(preview.ok)} bereit
            </span>
            {preview.conflicts > 0 && (
              <span className="pill warn">
                <TriangleAlert /> {num(preview.conflicts)} Kurzadresse vergeben
              </span>
            )}
            {preview.invalid > 0 && (
              <span className="pill danger">
                <CircleAlert /> {num(preview.invalid)} ungültig
              </span>
            )}
          </div>
          <div className="panel table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Zeile</th>
                  <th>Kurzadresse</th>
                  <th>Ziel</th>
                  <th>Ergebnis</th>
                </tr>
              </thead>
              <tbody>
                {[...preview.errors.map((e) => ({ line: e.line, url: '', status: 'invalid' as const, message: e.message })), ...preview.rows]
                  .sort((a, b) => (a.status === b.status ? a.line - b.line : a.status === 'ok' ? 1 : b.status === 'ok' ? -1 : 0))
                  .slice(0, 300)
                  .map((r) => (
                    <tr key={`${r.line}-${r.status}`}>
                      <td className="muted num">{r.line}</td>
                      <td className="mono">{'slug' in r && r.slug ? r.slug : <span className="faint">automatisch</span>}</td>
                      <td className="ellipsis" style={{ maxWidth: 320 }} title={r.url}>
                        {r.url}
                      </td>
                      <td>
                        {r.status === 'ok' ? (
                          <span className="pill ok">bereit</span>
                        ) : (
                          <span className={`small ${r.status === 'conflict' ? '' : ''}`} style={{ color: r.status === 'conflict' ? 'var(--warn)' : 'var(--danger)' }}>
                            {r.message}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
