import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Shell } from './components/Shell';
import { Logo } from './components/ui';
import { useSession } from './lib/queries';
import { AuthPage } from './pages/Auth';
import { LinksPage } from './pages/Links';

const AnalyticsPage = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.AnalyticsPage })));
const CampaignsPage = lazy(() => import('./pages/Campaigns').then((m) => ({ default: m.CampaignsPage })));
const DomainsPage = lazy(() => import('./pages/Domains').then((m) => ({ default: m.DomainsPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const ApiDocsPage = lazy(() => import('./pages/ApiDocs').then((m) => ({ default: m.ApiDocsPage })));

function Splash() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }} aria-busy="true" aria-label="Filum lädt">
      <Logo size={40} className="" />
    </div>
  );
}

export function App() {
  const session = useSession();
  const location = useLocation();
  const qc = useQueryClient();

  useEffect(() => {
    const onUnauthorized = () => void qc.invalidateQueries({ queryKey: ['session'] });
    window.addEventListener('filum:unauthorized', onUnauthorized);
    return () => window.removeEventListener('filum:unauthorized', onUnauthorized);
  }, [qc]);

  if (session.isLoading) return <Splash />;
  if (session.isError || !session.data) {
    return (
      <div className="empty" style={{ height: '100%', alignContent: 'center' }}>
        <h2>Filum ist gerade nicht erreichbar</h2>
        <p>Der Server antwortet nicht. Bitte in einem Moment neu laden.</p>
        <button className="btn primary" onClick={() => location && window.location.reload()}>
          Neu laden
        </button>
      </div>
    );
  }
  const s = session.data;

  if (location.pathname.startsWith('/einladung/')) return <AuthPage mode="invite" session={s} />;
  if (s.setupRequired) return <AuthPage mode="setup" session={s} />;
  if (!s.user) return <AuthPage mode="login" session={s} />;

  return (
    <Shell session={s}>
      <Suspense fallback={<div className="page" />}>
        <Routes>
          <Route path="/" element={<LinksPage />} />
          <Route path="/links/:id" element={<LinksPage />} />
          <Route path="/neu" element={<LinksPage />} />
          <Route path="/analyse" element={<AnalyticsPage />} />
          <Route path="/kampagnen" element={<CampaignsPage />} />
          <Route path="/domains" element={<DomainsPage />} />
          <Route path="/einstellungen" element={<Navigate to="/einstellungen/allgemein" replace />} />
          <Route path="/einstellungen/:tab" element={<SettingsPage />} />
          <Route path="/api" element={<ApiDocsPage />} />
          <Route path="/anmelden" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
