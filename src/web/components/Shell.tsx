import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  Braces,
  ChevronDown,
  Globe,
  KeyRound,
  Link2,
  LogOut,
  Megaphone,
  Menu,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Sun,
  User,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { compact, initials, num, ROLE_LABEL } from '../lib/format';
import { can, useCollections, useCounts, useTags } from '../lib/queries';
import { applyTheme, storedTheme, type Theme } from '../lib/theme';
import type { Session } from '../lib/types';
import { useRecentLinkTracker } from '../lib/recent';
import { CommandPalette, ShortcutHelp } from './CommandPalette';
import { MenuItem, Popover } from './overlay';
import { Logo } from './ui';

const COLLAPSE_KEY = 'filum:nav-collapsed';
function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** Einklappbare Abschnitte der Seitenleiste; Zustand pro Browser in localStorage. */
function useCollapsed() {
  const [state, setState] = useState<Record<string, boolean>>(readCollapsed);
  const toggle = (key: string) =>
    setState((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* privater Modus o. Ä.: nur für diese Sitzung */
      }
      return next;
    });
  return [state, toggle] as const;
}

function NavSection({ id, title, collapsed, onToggle }: { id: string; title: string; collapsed: boolean; onToggle: (id: string) => void }) {
  return (
    <button type="button" className="nav-section" aria-expanded={!collapsed} aria-controls={`nav-${id}`} onClick={() => onToggle(id)}>
      {title}
      <ChevronDown aria-hidden />
    </button>
  );
}

const NAV_TAGS = 6;
const NAV_COLLECTIONS = 8;

export function Shell({ session, children }: { session: Session; children: ReactNode }) {
  const user = session.user!;
  const counts = useCounts();
  const collections = useCollections();
  const tags = useTags();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [theme, setTheme] = useState<Theme>(storedTheme());
  const userRef = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();
  const [collapsed, toggleSection] = useCollapsed();
  useRecentLinkTracker();

  useEffect(() => setNavOpen(false), [location.pathname, location.search]);

  useEffect(() => {
    let lastG = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        if (location.pathname !== '/') navigate('/');
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('filum:compose')), 30);
      } else if (e.key === '/') {
        e.preventDefault();
        if (location.pathname !== '/' && !location.pathname.startsWith('/links')) navigate('/');
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('filum:search')), 30);
      } else if (e.key === 'g') {
        lastG = Date.now();
      } else if (Date.now() - lastG < 900) {
        const map: Record<string, string> = { l: '/', a: '/analyse', k: '/kampagnen', d: '/domains', e: '/einstellungen' };
        if (map[e.key]) navigate(map[e.key]);
        lastG = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [location.pathname, navigate]);

  const logout = async () => {
    await api.post('/api/v1/logout').catch(() => {});
    qc.clear();
    window.location.href = '/';
  };

  const chooseTheme = (t: Theme) => {
    applyTheme(t);
    setTheme(t);
  };

  const c = counts.data;
  const usedTags = (tags.data?.items ?? []).filter((t) => (t.count ?? 0) > 0).sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const isList = location.pathname === '/' || location.pathname.startsWith('/links');
  const viewActive = (key: string, val: string) => isList && params.get(key) === val;
  const plain = isList && ![...params.keys()].some((k) => ['favorite', 'owner', 'health', 'collectionId', 'tag', 'protected', 'campaignId'].includes(k));

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <a
        href="#inhalt"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('inhalt')?.focus();
        }}
      >
        Zum Inhalt
      </a>
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
      <aside className="sidebar" aria-label="Hauptnavigation">
        <RouterLink to="/" className="brand">
          <Logo />
          <span>
            <span className="brand-name">Filum</span>
            {session.organization && <span className="brand-org">{session.organization}</span>}
          </span>
        </RouterLink>

        <button className="nav-item" onClick={() => setPaletteOpen(true)} style={{ marginBottom: 6 }}>
          <Search />
          Suchen
          <span className="kbd" style={{ marginLeft: 'auto' }}>
            ⌘K
          </span>
        </button>

        <RouterLink to="/" className={`nav-item ${plain ? 'active' : ''}`} aria-current={plain ? 'page' : undefined}>
          <Link2 />
          Links
          <span className="nav-count">{c ? compact(c.live) : ''}</span>
        </RouterLink>
        <NavLink to="/analyse" className="nav-item">
          <BarChart3 />
          Analyse
        </NavLink>
        <NavLink to="/kampagnen" className="nav-item">
          <Megaphone />
          Kampagnen
        </NavLink>
        <NavLink to="/domains" className="nav-item">
          <Globe />
          Domains
        </NavLink>

        <NavSection id="ansichten" title="Ansichten" collapsed={!!collapsed.ansichten} onToggle={toggleSection} />
        <div id="nav-ansichten" style={{ display: collapsed.ansichten ? 'none' : 'contents' }}>
          <RouterLink to="/?favorite=1" className={`nav-item ${viewActive('favorite', '1') ? 'active' : ''}`}>
            <Star />
            Favoriten
            <span className="nav-count">{c?.favorites ? compact(c.favorites) : ''}</span>
          </RouterLink>
          <RouterLink to="/?owner=me" className={`nav-item ${viewActive('owner', 'me') ? 'active' : ''}`}>
            <User />
            Meine Links
            <span className="nav-count">{c?.mine ? compact(c.mine) : ''}</span>
          </RouterLink>
          <RouterLink to="/?protected=1" className={`nav-item ${viewActive('protected', '1') ? 'active' : ''}`}>
            <ShieldCheck />
            Verteilt & geschützt
            <span className="nav-count">{c?.protected ? compact(c.protected) : ''}</span>
          </RouterLink>
          {(!!c?.broken || viewActive('health', 'broken')) && (
            <RouterLink
              to="/?health=broken"
              className={`nav-item nav-warn ${viewActive('health', 'broken') ? 'active' : ''}`}
              title="Links, deren Ziel bei der letzten Prüfung nicht erreichbar war"
            >
              <AlertTriangle />
              Ziel gestört
              <span className="nav-count">{c?.broken ? compact(c.broken) : ''}</span>
            </RouterLink>
          )}
        </div>

        {!!collections.data?.items.length && (
          <>
            <NavSection id="sammlungen" title="Sammlungen" collapsed={!!collapsed.sammlungen} onToggle={toggleSection} />
            <div id="nav-sammlungen" style={{ display: collapsed.sammlungen ? 'none' : 'contents' }}>
              {collections.data.items.slice(0, NAV_COLLECTIONS).map((col) => (
                <RouterLink
                  key={col.id}
                  to={`/?collectionId=${col.id}`}
                  className={`nav-item ${viewActive('collectionId', String(col.id)) ? 'active' : ''}`}
                >
                  <span className="nav-dot" data-color={col.color} />
                  <span className="ellipsis">{col.name}</span>
                  <span className="nav-count">{col.count ? compact(col.count) : ''}</span>
                </RouterLink>
              ))}
              {collections.data.items.length > NAV_COLLECTIONS && (
                <RouterLink to="/einstellungen/ordnung" className="nav-item nav-more">
                  Alle Sammlungen ({num(collections.data.items.length)}) …
                </RouterLink>
              )}
            </div>
          </>
        )}

        {!!usedTags.length && (
          <>
            <NavSection id="schlagwoerter" title="Schlagwörter" collapsed={!!collapsed.schlagwoerter} onToggle={toggleSection} />
            <div id="nav-schlagwoerter" style={{ display: collapsed.schlagwoerter ? 'none' : 'contents' }}>
              {usedTags
                .filter((t, i) => i < NAV_TAGS || viewActive('tag', t.name))
                .map((t) => (
                  <RouterLink key={t.id} to={`/?tag=${encodeURIComponent(t.name)}`} className={`nav-item ${viewActive('tag', t.name) ? 'active' : ''}`}>
                    <span className="nav-dot" data-color={t.color} style={{ borderRadius: 2 }} />
                    <span className="ellipsis">{t.name}</span>
                    <span className="nav-count">{t.count ? compact(t.count) : ''}</span>
                  </RouterLink>
                ))}
              {usedTags.length > NAV_TAGS && (
                <RouterLink to="/einstellungen/ordnung" className="nav-item nav-more">
                  Alle Schlagwörter ({num(usedTags.length)}) …
                </RouterLink>
              )}
            </div>
          </>
        )}

        <div className="sidebar-foot">
          <NavLink to="/api" className="nav-item">
            <Braces />
            API
          </NavLink>
          <NavLink to="/einstellungen" className={({ isActive }) => `nav-item ${isActive || location.pathname.startsWith('/einstellungen') ? 'active' : ''}`}>
            <Settings />
            Einstellungen
          </NavLink>
          <button ref={userRef} className="nav-item user-chip" onClick={() => setUserMenu((o) => !o)} aria-haspopup="menu" aria-expanded={userMenu}>
            <span className="avatar" aria-hidden>
              {initials(user.name || user.email)}
            </span>
            <span style={{ minWidth: 0, display: 'grid', lineHeight: 1.25 }}>
              <span className="ellipsis" style={{ fontWeight: 600 }}>
                {user.name || user.email}
              </span>
              <span className="xsmall faint">{ROLE_LABEL[user.role]}</span>
            </span>
          </button>
          <Popover anchor={userRef} open={userMenu} onClose={() => setUserMenu(false)} role="menu" label="Konto">
            <div className="menu-label">{user.email}</div>
            <MenuItem
              icon={<KeyRound />}
              onSelect={() => {
                setUserMenu(false);
                navigate('/einstellungen/konto');
              }}
            >
              Mein Konto
            </MenuItem>
            <div className="menu-sep" />
            <div className="menu-label">Darstellung</div>
            <MenuItem icon={<Monitor />} onSelect={() => chooseTheme('system')}>
              Wie das System {theme === 'system' && '✓'}
            </MenuItem>
            <MenuItem icon={<Sun />} onSelect={() => chooseTheme('light')}>
              Hell {theme === 'light' && '✓'}
            </MenuItem>
            <MenuItem icon={<Moon />} onSelect={() => chooseTheme('dark')}>
              Dunkel {theme === 'dark' && '✓'}
            </MenuItem>
            <div className="menu-sep" />
            <MenuItem icon={<LogOut />} onSelect={() => void logout()}>
              Abmelden
            </MenuItem>
          </Popover>
        </div>
      </aside>

      <div className="main">
        <div className="mobile-bar">
          <button className="btn ghost icon" onClick={() => setNavOpen(true)} aria-label="Navigation öffnen">
            <Menu />
          </button>
          <RouterLink to="/" className="row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Logo size={24} className="" />
            <strong>Filum</strong>
          </RouterLink>
          <span className="spacer" />
          <button className="btn ghost icon" onClick={() => setPaletteOpen(true)} aria-label="Suchen">
            <Search />
          </button>
          {can(user.role, 'member') && (
            <button
              className="btn thread icon"
              aria-label="Neuer Link"
              onClick={() => {
                navigate('/');
                window.setTimeout(() => window.dispatchEvent(new CustomEvent('filum:compose')), 30);
              }}
            >
              <Plus />
            </button>
          )}
        </div>
        <main id="inhalt" className="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} role={user.role} onTheme={chooseTheme} onHelp={() => setHelpOpen(true)} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
