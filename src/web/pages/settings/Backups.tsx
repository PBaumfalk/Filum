import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, CheckCircle2, CircleAlert, Download, Plus, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useToast } from '../../components/toast';
import { Empty } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { bytes, date, num, relative } from '../../lib/format';
import { SectionTitle } from './common';

interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
  kind: 'auto' | 'manuell' | 'migration' | 'wiederherstellung' | 'andere';
}

const KIND: Record<string, string> = {
  auto: 'Automatisch',
  manuell: 'Von Hand',
  migration: 'Vor Update',
  wiederherstellung: 'Vor Wiederherstellung',
  andere: 'Andere',
};

export function Backups() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<{ items: BackupInfo[]; intervalHours: number; keep: number; directory: string; lastError: string | null }>('/api/v1/backups'),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [uploadInfo, setUploadInfo] = useState<{ file: File; ok: boolean; error?: string; links?: number; users?: number; domains?: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    setBusy('create');
    try {
      const b = await api.post<BackupInfo>('/api/v1/backups');
      void qc.invalidateQueries({ queryKey: ['backups'] });
      toast.ok(`Sicherung erstellt (${bytes(b.size)})`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const waitForRestart = async (msg: string) => {
    setRestarting(msg);
    const started = Date.now();
    await new Promise((r) => setTimeout(r, 2500));
    while (Date.now() - started < 120_000) {
      try {
        const r = await fetch('/healthz', { cache: 'no-store' });
        if (r.ok) {
          window.location.href = '/';
          return;
        }
      } catch {
        /* noch nicht wieder da */
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setRestarting('Filum ist noch nicht wieder erreichbar. Bitte den Container prüfen: docker compose ps / docker compose logs filum');
  };

  const restore = async (name: string) => {
    setBusy(name);
    try {
      const r = await api.post<{ message: string; links: number }>(`/api/v1/backups/${encodeURIComponent(name)}/restore`);
      void waitForRestart(`${r.message} (${r.links} Links)`);
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };

  const checkUpload = async (file: File) => {
    setUploadInfo(null);
    try {
      const r = await api.raw<{ ok: boolean; error?: string; links?: number; users?: number; domains?: number }>('POST', '/api/v1/backups/upload', file, 'application/octet-stream');
      setUploadInfo({ file, ...r });
    } catch (e) {
      setUploadInfo({ file, ok: false, error: e instanceof ApiError ? e.message : 'Prüfung fehlgeschlagen' });
    }
  };

  const restoreUpload = async () => {
    if (!uploadInfo) return;
    setBusy('upload');
    try {
      const r = await api.raw<{ message: string }>('POST', '/api/v1/backups/upload?restore=1', uploadInfo.file, 'application/octet-stream');
      void waitForRestart(r.message);
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };

  if (restarting) {
    return (
      <div className="panel panel-pad row" style={{ gap: 14 }}>
        <span className="spinner" />
        <span>{restarting}</span>
      </div>
    );
  }

  const d = list.data;
  return (
    <div>
      <div className="callout" style={{ marginBottom: 16 }}>
        <ArchiveRestore />
        <span>
          Eine Sicherung ist eine einzige Datei mit allem: Links, Domains, Konten, Einstellungen, Statistik.{' '}
          {d && (d.intervalHours > 0 ? `Filum sichert automatisch alle ${d.intervalHours} Stunden und behält die letzten ${d.keep} automatischen Sicherungen.` : 'Automatische Sicherungen sind abgeschaltet.')} Die Dateien liegen im Container unter <code>{d?.directory ?? '/data/backups'}</code>. Kopieren Sie sie zusätzlich auf ein anderes System, etwa mit Ihrer Server-Sicherung.
        </span>
      </div>
      {d?.lastError && (
        <div className="callout danger" style={{ marginBottom: 16 }}>
          <CircleAlert />
          <span>Letzte automatische Sicherung fehlgeschlagen: {d.lastError}</span>
        </div>
      )}
      <button className="btn primary" onClick={() => void create()} disabled={busy !== null}>
        {busy === 'create' ? <span className="spinner" /> : <Plus />} Jetzt sichern
      </button>

      <SectionTitle title="Vorhandene Sicherungen" />
      <div className="panel table-wrap">
        {d?.items.length === 0 && <Empty title="Noch keine Sicherungen" art={false} />}
        {!!d?.items.length && (
          <table className="table backup-table">
            <thead>
              <tr>
                <th>Erstellt</th>
                <th>Art</th>
                <th>Größe</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.items.flatMap((b) => [
                <tr key={b.name}>
                  <td>
                    <div>{date(b.createdAt, true)}</div>
                    <div className="xsmall muted mono">{b.name}</div>
                  </td>
                  <td>{KIND[b.kind]}</td>
                  <td className="muted num">{bytes(b.size)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      <a className="btn sm ghost" href={`/api/v1/backups/${encodeURIComponent(b.name)}/download`} download>
                        <Download /> Herunterladen
                      </a>
                      <button
                        className="btn sm caution"
                        onClick={() => setConfirm(confirm === b.name ? null : b.name)}
                        aria-expanded={confirm === b.name}
                        disabled={busy !== null}
                      >
                        <ArchiveRestore /> Wiederherstellen …
                      </button>
                      {deleting === b.name ? (
                        <button
                          className="btn sm danger solid"
                          onClick={async () => {
                            await api.del(`/api/v1/backups/${encodeURIComponent(b.name)}`).catch((e) => toast.error(e));
                            setDeleting(null);
                            void qc.invalidateQueries({ queryKey: ['backups'] });
                          }}
                        >
                          Wirklich löschen
                        </button>
                      ) : (
                        <button className="btn sm ghost icon" aria-label={`Sicherung ${b.name} löschen`} title="Sicherung löschen" onClick={() => setDeleting(b.name)}>
                          <Trash2 />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>,
                confirm === b.name && (
                  <tr key={`${b.name}-confirm`} className="restore-confirm">
                    <td colSpan={4}>
                      <div className="callout warn" role="alert">
                        <TriangleAlert />
                        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
                          <span>
                            <strong>Stand vom {date(b.createdAt, true)} ({relative(b.createdAt)}) wiederherstellen?</strong> Alles, was seitdem geändert wurde, ist danach nicht mehr da. Filum sichert den
                            aktuellen Stand vorher automatisch, startet neu, und alle müssen sich wieder anmelden.
                          </span>
                          <div className="row wrap">
                            <button className="btn sm caution solid" onClick={() => void restore(b.name)} disabled={busy !== null}>
                              {busy === b.name ? <span className="spinner" /> : <ArchiveRestore />} Wiederherstellen und neu starten
                            </button>
                            <button className="btn sm" onClick={() => setConfirm(null)}>
                              Abbrechen
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ),
              ])}
            </tbody>
          </table>
        )}
      </div>

      <SectionTitle title="Sicherung von einem anderen System einspielen">Zum Beispiel beim Umzug auf einen neuen Server. Die Datei wird zuerst geprüft.</SectionTitle>
      <div className="panel panel-pad stack" style={{ '--gap': '12px' } as React.CSSProperties}>
        <input ref={fileRef} type="file" accept=".db,.sqlite,.sqlite3,application/octet-stream" hidden onChange={(e) => e.target.files?.[0] && void checkUpload(e.target.files[0])} />
        <button className="btn" style={{ justifySelf: 'start' }} onClick={() => fileRef.current?.click()}>
          <Upload /> Sicherungsdatei auswählen
        </button>
        {uploadInfo && !uploadInfo.ok && (
          <div className="callout danger">
            <CircleAlert />
            <span>{uploadInfo.error}</span>
          </div>
        )}
        {uploadInfo?.ok && (
          <div className="callout warn" role="alert">
            <TriangleAlert />
            <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
              <span>
                <CheckCircle2 size={14} style={{ verticalAlign: -2, color: 'var(--ok)' }} /> <strong>{uploadInfo.file.name}</strong> ist eine gültige Filum-Sicherung mit {num(uploadInfo.links ?? 0)} Links,{' '}
                {num(uploadInfo.domains ?? 0)} Domains und {num(uploadInfo.users ?? 0)} Konten.
              </span>
              <span className="small">
                Beim Einspielen ersetzt sie alle Daten dieser Installation. Filum sichert den aktuellen Stand vorher automatisch, startet neu, und alle müssen sich wieder anmelden.
              </span>
              <div className="row wrap">
                <button className="btn sm caution solid" onClick={() => void restoreUpload()} disabled={busy !== null}>
                  {busy === 'upload' ? <span className="spinner" /> : <ArchiveRestore />} Einspielen und neu starten
                </button>
                <button className="btn sm" onClick={() => setUploadInfo(null)}>
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
