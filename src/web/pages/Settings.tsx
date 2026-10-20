import { Activity, Archive, Building2, FileClock, FolderTree, KeyRound, Shield, ShieldCheck, Upload, User, Users } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { NavLink, Navigate, useParams } from 'react-router';
import { can, useSession } from '../lib/queries';
import { useDocumentTitle } from '../lib/title';
import type { Role } from '../lib/types';

const General = lazy(() => import('./settings/General').then((m) => ({ default: m.General })));
const Privacy = lazy(() => import('./settings/Privacy').then((m) => ({ default: m.Privacy })));
const Security = lazy(() => import('./settings/Security').then((m) => ({ default: m.Security })));
const Team = lazy(() => import('./settings/Team').then((m) => ({ default: m.Team })));
const Organize = lazy(() => import('./settings/Organize').then((m) => ({ default: m.Organize })));
const Tokens = lazy(() => import('./settings/Tokens').then((m) => ({ default: m.Tokens })));
const Import = lazy(() => import('./settings/Import').then((m) => ({ default: m.Import })));
const Backups = lazy(() => import('./settings/Backups').then((m) => ({ default: m.Backups })));
const Audit = lazy(() => import('./settings/Audit').then((m) => ({ default: m.Audit })));
const System = lazy(() => import('./settings/System').then((m) => ({ default: m.System })));
const Account = lazy(() => import('./settings/Account').then((m) => ({ default: m.Account })));

const TABS: { key: string; label: string; icon: ReactNode; min: Role; el: ReactNode }[] = [
  { key: 'konto', label: 'Mein Konto', icon: <User />, min: 'viewer', el: <Account /> },
  { key: 'allgemein', label: 'Allgemein', icon: <Building2 />, min: 'viewer', el: <General /> },
  { key: 'ordnung', label: 'Sammlungen & Vorlagen', icon: <FolderTree />, min: 'viewer', el: <Organize /> },
  { key: 'import', label: 'Import', icon: <Upload />, min: 'member', el: <Import /> },
  { key: 'api', label: 'API & Lesezeichen', icon: <KeyRound />, min: 'viewer', el: <Tokens /> },
  { key: 'datenschutz', label: 'Datenschutz', icon: <ShieldCheck />, min: 'viewer', el: <Privacy /> },
  { key: 'team', label: 'Team & Rollen', icon: <Users />, min: 'editor', el: <Team /> },
  { key: 'sicherheit', label: 'Sicherheit', icon: <Shield />, min: 'editor', el: <Security /> },
  { key: 'sicherung', label: 'Sicherung', icon: <Archive />, min: 'admin', el: <Backups /> },
  { key: 'protokoll', label: 'Protokoll', icon: <FileClock />, min: 'admin', el: <Audit /> },
  { key: 'system', label: 'System', icon: <Activity />, min: 'admin', el: <System /> },
];

export function SettingsPage() {
  const { tab } = useParams();
  const session = useSession();
  const role = session.data?.user?.role ?? 'viewer';
  const visible = TABS.filter((t) => can(role, t.min));
  const current = visible.find((t) => t.key === tab);
  const navRef = useRef<HTMLElement>(null);
  useDocumentTitle(current?.label, 'Einstellungen');

  // Mobil ist die Reiterleiste horizontal scrollbar: aktiven Reiter sichtbar halten.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('.nav-item.active');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const a = active.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    const left = nav.scrollLeft + (a.left - n.left) - (nav.clientWidth - a.width) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [current?.key]);

  if (!current) return <Navigate to="/einstellungen/allgemein" replace />;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Einstellungen</h1>
          </div>
        </div>
        <div className="settings-layout">
          <nav ref={navRef} className="settings-nav" aria-label="Einstellungsbereiche">
            {visible.map((t) => (
              <NavLink key={t.key} to={`/einstellungen/${t.key}`} className="nav-item">
                {t.icon}
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div style={{ minWidth: 0 }}>
            <Suspense fallback={<div className="panel panel-pad muted">Lädt …</div>}>{current.el}</Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

