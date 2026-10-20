import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  CircleOff,
  Copy,
  ExternalLink,
  History,
  MoreHorizontal,
  PenLine,
  Play,
  QrCode,
  RefreshCw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../lib/api';
import { date, num, relative } from '../lib/format';
import { useInvalidateLinks } from '../lib/queries';
import type { Link } from '../lib/types';
import { LinkEditor } from './LinkEditor';
import { LinkHistory } from './LinkHistory';
import { LinkQr } from './LinkQr';
import { LinkStats } from './LinkStats';
import { MenuItem, Popover } from './overlay';
import { useToast } from './toast';
import { CopyButton, Skeleton, StateBadge } from './ui';

type Tab = 'edit' | 'stats' | 'qr' | 'history';

export function Inspector({ id, onClose }: { id: number; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('edit');
  const link = useQuery({ queryKey: ['link', id], queryFn: () => api.get<Link>(`/api/v1/links/${id}`) });
  const panelRef = useRef<HTMLElement>(null);
  // Erlaubt das Schließen ohne Rückfrage zu ungespeicherten Änderungen (nach dem Löschen gibt es nichts mehr zu speichern)
  const leaveRef = useRef(false);

  useEffect(() => {
    panelRef.current?.focus();
  }, [id]);

  useEffect(() => {
    // Vorschau wird im Hintergrund geladen – kurz nachfragen, solange sie fehlt.
    if (link.data && !link.data.meta.fetchedAt && Date.now() - new Date(link.data.createdAt).getTime() < 60_000) {
      const t = window.setTimeout(() => void link.refetch(), 2500);
      return () => window.clearTimeout(t);
    }
  }, [link.data, link]);

  return (
    <aside
      className="inspector"
      ref={panelRef}
      tabIndex={-1}
      aria-label="Link bearbeiten"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea, select')) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {link.isLoading && (
        <div className="inspector-body">
          <Skeleton h={22} w="70%" />
          <Skeleton h={14} w="50%" />
          <Skeleton h={120} />
        </div>
      )}
      {link.isError && (
        <div className="inspector-body">
          <div className="callout danger">{link.error instanceof ApiError && link.error.status === 404 ? 'Diesen Link gibt es nicht mehr.' : 'Der Link konnte nicht geladen werden.'}</div>
          <button className="btn" onClick={onClose}>
            Schließen
          </button>
        </div>
      )}
      {link.data && (
        <>
          <Header
            link={link.data}
            onClose={onClose}
            onDeleted={() => {
              leaveRef.current = true;
              onClose();
            }}
          />
          <div className="tabs" role="tablist" aria-label="Bereiche" style={{ padding: '0 10px', borderBottom: '1px solid var(--line)' }}>
            {(
              [
                ['edit', 'Bearbeiten', <PenLine key="i" size={15} />],
                ['stats', 'Statistik', <BarChart3 key="i" size={15} />],
                ['qr', 'QR-Code', <QrCode key="i" size={15} />],
                ['history', 'Verlauf', <History key="i" size={15} />],
              ] as const
            ).map(([k, label, icon]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {icon}
                {label}
              </button>
            ))}
          </div>
          {/* Der Editor bleibt montiert (auch nach dem Speichern und auf anderen Reitern): Entwurf, Abschnitte und Scrollposition bleiben erhalten. */}
          <LinkEditor key={link.data.id} link={link.data} hidden={tab !== 'edit'} leaveRef={leaveRef} onReveal={() => setTab('edit')} />
          {tab === 'stats' && <LinkStats link={link.data} />}
          {tab === 'qr' && <LinkQr link={link.data} />}
          {tab === 'history' && <LinkHistory link={link.data} />}
        </>
      )}
    </aside>
  );
}

function Header({ link, onClose, onDeleted }: { link: Link; onClose: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateLinks();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const short = link.shortUrl.replace(/^https?:\/\//, '');
  const slash = short.indexOf('/');

  const act = async (fn: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) => {
    setMenu(false);
    try {
      await fn();
      invalidate();
      toast.ok(msg, undo ? { label: 'Rückgängig', run: () => void undo().then(invalidate) } : undefined);
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/api/v1/links/${link.id}${link.protected ? '?confirm=protected' : ''}`);
      invalidate();
      toast.ok(`${link.domain.host}/${link.slug} gelöscht. Die Kurzadresse bleibt reserviert.`);
      onDeleted();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="inspector-head" style={{ borderBottom: 0, paddingBottom: 12 }}>
      <div className="inspector-top">
        <StateBadge state={link.state} archived={link.archived} />
        <span className="spacer" />
        <button
          className="btn ghost icon sm"
          aria-pressed={link.favorite}
          aria-label={link.favorite ? 'Favorit entfernen' : 'Als Favorit merken'}
          title={link.favorite ? 'Favorit entfernen' : 'Als Favorit merken'}
          onClick={() => void act(() => api.post(`/api/v1/links/${link.id}/favorite`, { favorite: !link.favorite }), link.favorite ? 'Aus Favoriten entfernt' : 'Als Favorit gemerkt')}
        >
          <Star fill={link.favorite ? 'var(--thread)' : 'none'} style={link.favorite ? { color: 'var(--thread)' } : undefined} />
        </button>
        <button ref={menuRef} className="btn ghost icon sm" onClick={() => setMenu((o) => !o)} aria-label="Weitere Aktionen" aria-haspopup="menu">
          <MoreHorizontal />
        </button>
        <Popover anchor={menuRef} open={menu} onClose={() => setMenu(false)} role="menu" align="end">
          {link.canEdit && (
            <>
              <MenuItem
                icon={<Copy />}
                onSelect={() =>
                  void act(async () => {
                    const copy = await api.post<Link>(`/api/v1/links/${link.id}/duplicate`);
                    navigate(`/links/${copy.id}${window.location.search}`);
                  }, 'Kopie angelegt – Sie bearbeiten jetzt die Kopie')
                }
              >
                Duplizieren
              </MenuItem>
              <MenuItem icon={<RefreshCw />} onSelect={() => void act(() => api.post(`/api/v1/links/${link.id}/refresh`), 'Vorschau und Zielprüfung aktualisiert')}>
                Ziel jetzt prüfen
              </MenuItem>
              <div className="menu-sep" />
              {link.enabled ? (
                <MenuItem
                  icon={<CircleOff />}
                  onSelect={() =>
                    void act(
                      () => api.patch(`/api/v1/links/${link.id}`, { enabled: false }),
                      'Deaktiviert – Besucher sehen eine Hinweisseite',
                      () => api.patch(`/api/v1/links/${link.id}`, { enabled: true }),
                    )
                  }
                >
                  Deaktivieren
                </MenuItem>
              ) : (
                <MenuItem icon={<Play />} onSelect={() => void act(() => api.patch(`/api/v1/links/${link.id}`, { enabled: true }), 'Wieder aktiv')}>
                  Reaktivieren
                </MenuItem>
              )}
              {link.archived ? (
                <MenuItem icon={<ArchiveRestore />} onSelect={() => void act(() => api.patch(`/api/v1/links/${link.id}`, { archived: false }), 'Aus dem Archiv geholt')}>
                  Aus Archiv holen
                </MenuItem>
              ) : (
                <MenuItem
                  icon={<Archive />}
                  onSelect={() =>
                    void act(
                      () => api.patch(`/api/v1/links/${link.id}`, { archived: true }),
                      'Archiviert – der Link funktioniert weiter',
                      () => api.patch(`/api/v1/links/${link.id}`, { archived: false }),
                    )
                  }
                >
                  Archivieren
                </MenuItem>
              )}
              <div className="menu-sep" />
              <MenuItem
                icon={<Trash2 />}
                danger
                onSelect={() => {
                  setMenu(false);
                  setConfirmDelete(true);
                }}
              >
                Löschen …
              </MenuItem>
            </>
          )}
          {!link.canEdit && <div className="menu-label">Sie können diesen Link nur ansehen.</div>}
        </Popover>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Schließen" title="Schließen (Esc)">
          <X />
        </button>
      </div>

      <div className="row" style={{ alignItems: 'flex-start', gap: 6 }}>
        <div className="inspector-short" style={{ flex: 1 }}>
          <span className="host">{short.slice(0, slash + 1)}</span>
          {short.slice(slash + 1)}
        </div>
        <CopyButton text={link.shortUrl} label="Kurzlink kopieren" size="md" toastText="Kurzlink kopiert" />
        <a className="btn ghost icon" href={link.shortUrl} target="_blank" rel="noreferrer" aria-label="Kurzlink testen" title="Kurzlink in neuem Tab testen">
          <ExternalLink />
        </a>
      </div>
      <p className="xsmall muted">
        {num(link.clicks)} {link.clicks === 1 ? 'Aufruf' : 'Aufrufe'}
        {link.lastClickAt ? `, zuletzt ${relative(link.lastClickAt)}` : ''} · angelegt {date(link.createdAt)}
        {link.owner ? ` von ${link.owner.name}` : ''}
      </p>

      {confirmDelete && (
        <div className="callout danger" role="alertdialog" aria-label="Löschen bestätigen">
          <Trash2 />
          <div className="stack" style={{ '--gap': '10px', flex: 1 } as React.CSSProperties}>
            <span>
              {link.protected
                ? 'Dieser Link ist als verteilt markiert. Wer ihn gedruckt oder verschickt hat, landet nach dem Löschen auf einer Hinweisseite.'
                : 'Der Link wird gelöscht, seine Statistik ebenfalls.'}{' '}
              Die Kurzadresse bleibt reserviert und wird nicht neu vergeben. Wenn Sie den Link nur vorübergehend nicht brauchen, ist Deaktivieren oder Archivieren besser.
            </span>
            <div className="row">
              <button className="btn sm danger solid" onClick={() => void remove()} autoFocus>
                Endgültig löschen
              </button>
              <button className="btn sm" onClick={() => setConfirmDelete(false)}>
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
