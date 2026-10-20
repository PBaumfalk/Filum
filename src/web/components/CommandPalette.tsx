import { useQuery } from '@tanstack/react-query';
import { BarChart3, Braces, Copy, CornerDownLeft, Globe, History, Keyboard, Link2, Megaphone, Moon, Plus, Search, Settings, Sparkles, Sun, Upload } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { api, qs } from '../lib/api';
import { can } from '../lib/queries';
import { recentLinks } from '../lib/recent';
import type { LinkList, Role } from '../lib/types';
import { Dialog } from './overlay';
import { copyText } from './ui';
import { useToast } from './toast';

const URLISH = /^(https?:\/\/|www\.)\S+$|^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]{2,})+(:\d+)?(\/\S*)?$/iu;

const SHORTCUTS: [string[], string][] = [
  [['⌘', 'K'], 'Befehlspalette öffnen (Strg + K unter Windows/Linux)'],
  [['N'], 'Neuen Kurzlink anlegen'],
  [['/'], 'Links durchsuchen'],
  [['G', 'L'], 'Zu den Links'],
  [['G', 'A'], 'Zur Analyse'],
  [['G', 'K'], 'Zu den Kampagnen'],
  [['G', 'D'], 'Zu den Domains'],
  [['G', 'E'], 'Zu den Einstellungen'],
  [['Esc'], 'Eingabe leeren, Dialog oder Inspector schließen'],
  [['?'], 'Diese Übersicht'],
];

/** Übersicht der Tastenkürzel (Taste „?“). */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} label="Tastenkürzel">
      <div style={{ padding: 20, display: 'grid', gap: 14 }}>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>Tastenkürzel</h2>
        <dl className="kv" style={{ margin: 0 }}>
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what} style={{ display: 'contents' }}>
              <dt>
                {keys.map((k, i) => (
                  <span key={i}>
                    {i > 0 && ' '}
                    <span className="kbd">{k}</span>
                  </span>
                ))}
              </dt>
              <dd style={{ margin: 0 }}>{what}</dd>
            </div>
          ))}
        </dl>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </Dialog>
  );
}

interface Item {
  id: string;
  icon: ReactNode;
  label: ReactNode;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  role,
  onTheme,
  onHelp,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
  onTheme: (t: 'light' | 'dark') => void;
  onHelp?: () => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (!open) {
      setQ('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 140);
    return () => window.clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ['palette', debounced],
    queryFn: () => api.get<LinkList>(`/api/v1/links${qs({ q: debounced, limit: 8, state: 'all', sort: 'clicks' })}`),
    enabled: open && debounced.length > 0,
  });

  const go = (path: string) => () => {
    onClose();
    navigate(path);
  };

  const actions: Item[] = useMemo(
    () => [
      ...(can(role, 'member')
        ? [
            {
              id: 'new',
              icon: <Plus />,
              label: 'Neuen Kurzlink anlegen',
              hint: 'N',
              run: () => {
                onClose();
                navigate('/');
                window.setTimeout(() => window.dispatchEvent(new CustomEvent('filum:compose')), 40);
              },
            },
            { id: 'import', icon: <Upload />, label: 'Links importieren (CSV)', run: go('/einstellungen/import') },
          ]
        : []),
      { id: 'links', icon: <Link2 />, label: 'Alle Links', hint: 'G L', run: go('/') },
      { id: 'analyse', icon: <BarChart3 />, label: 'Analyse', hint: 'G A', run: go('/analyse') },
      { id: 'kampagnen', icon: <Megaphone />, label: 'Kampagnen', hint: 'G K', run: go('/kampagnen') },
      { id: 'domains', icon: <Globe />, label: 'Domains', hint: 'G D', run: go('/domains') },
      { id: 'settings', icon: <Settings />, label: 'Einstellungen', hint: 'G E', run: go('/einstellungen') },
      { id: 'api', icon: <Braces />, label: 'API-Dokumentation', run: go('/api') },
      { id: 'light', icon: <Sun />, label: 'Helle Darstellung', run: () => (onTheme('light'), onClose()) },
      { id: 'dark', icon: <Moon />, label: 'Dunkle Darstellung', run: () => (onTheme('dark'), onClose()) },
      ...(onHelp ? [{ id: 'help', icon: <Keyboard />, label: 'Tastenkürzel anzeigen', hint: '?', run: () => (onClose(), onHelp()) }] : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role],
  );

  // Ohne Eingabe: zuletzt geöffnete Links (bei jedem Öffnen frisch gelesen).
  const recent = useMemo(() => (open ? recentLinks() : []), [open]);

  const items: Item[] = useMemo(() => {
    const raw = q.trim();
    const needle = raw.toLowerCase();
    const shorten: Item[] =
      can(role, 'member') && !/\s/.test(raw) && URLISH.test(raw)
        ? [
            {
              id: 'shorten',
              icon: <Sparkles />,
              label: (
                <span className="ellipsis" style={{ display: 'block' }}>
                  „{raw.length > 60 ? `${raw.slice(0, 57)}…` : raw}“ kürzen
                </span>
              ),
              hint: 'Neu',
              run: () => {
                onClose();
                navigate(`/neu?url=${encodeURIComponent(raw)}`);
              },
            },
          ]
        : [];
    const recentItems: Item[] = raw
      ? []
      : recent.map((r) => ({
          id: `r${r.id}`,
          icon: <History />,
          label: (
            <span className="ellipsis" style={{ display: 'grid' }}>
              <span className="mono" style={{ fontWeight: 600 }}>
                {r.short}
              </span>
              <span className="xsmall muted ellipsis">{r.title}</span>
            </span>
          ),
          hint: 'Zuletzt',
          run: go(`/links/${r.id}`),
        }));
    const acts = needle ? actions.filter((a) => String(a.label).toLowerCase().includes(needle)) : actions;
    const links: Item[] = (results.data?.items ?? []).flatMap((l) => [
      {
        id: `l${l.id}`,
        icon: <Link2 />,
        label: (
          <span className="ellipsis" style={{ display: 'grid' }}>
            <span className="mono" style={{ fontWeight: 600 }}>
              {l.domain.host}/{l.slug}
            </span>
            <span className="xsmall muted ellipsis">{l.title || l.url}</span>
          </span>
        ),
        hint: 'Öffnen',
        run: go(`/links/${l.id}`),
      },
    ]);
    const copyFirst: Item[] = results.data?.items[0]
      ? [
          {
            id: 'copy-first',
            icon: <Copy />,
            label: `${results.data.items[0].domain.host}/${results.data.items[0].slug} kopieren`,
            run: () => {
              void copyText(results.data!.items[0].shortUrl).then((ok) => ok && toast.ok('Kurzlink kopiert'));
              onClose();
            },
          },
        ]
      : [];
    return [...shorten, ...recentItems, ...links, ...copyFirst, ...acts];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, actions, results.data, recent]);

  useEffect(() => setActive(0), [items.length]);

  return (
    <Dialog open={open} onClose={onClose} label="Befehlspalette" className="palette">
      <div className="palette-input">
        <Search aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Link suchen oder Befehl eingeben …"
          aria-label="Suchen"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[active] ? `pi-${items[active].id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              items[active]?.run();
            }
          }}
        />
        {results.isFetching && <span className="spinner" style={{ color: 'var(--faint)' }} />}
      </div>
      <div className="palette-list" id="palette-list" role="listbox">
        {items.length === 0 && <div className="empty" style={{ padding: 24 }}>Nichts gefunden.</div>}
        {items.map((it, i) => (
          <button
            key={it.id}
            id={`pi-${it.id}`}
            role="option"
            aria-selected={i === active}
            data-active={i === active}
            className="menu-item"
            onMouseMove={() => setActive(i)}
            onClick={it.run}
          >
            {it.icon}
            <span style={{ minWidth: 0, flex: 1 }}>{it.label}</span>
            {it.hint && <span className="kbd">{it.hint}</span>}
          </button>
        ))}
      </div>
      <div className="palette-foot">
        <span>
          <span className="kbd">↑</span> <span className="kbd">↓</span> auswählen
        </span>
        <span>
          <span className="kbd">
            <CornerDownLeft size={11} />
          </span>{' '}
          ausführen
        </span>
        <span>
          <span className="kbd">Esc</span> schließen
        </span>
      </div>
    </Dialog>
  );
}
