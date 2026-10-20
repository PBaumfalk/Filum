import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CodeBlock } from '../../components/CodeBlock';
import { useToast } from '../../components/toast';
import { Switch } from '../../components/ui';
import { api } from '../../lib/api';
import { can, useSession, useSettings } from '../../lib/queries';
import { SectionTitle, SettingRow, useSaveSettings } from './common';

export function Privacy() {
  const settings = useSettings();
  const session = useSession();
  const admin = can(session.data?.user?.role, 'admin');
  const save = useSaveSettings();
  const toast = useToast();
  const notice = useQuery({ queryKey: ['privacy-notice', settings.data], queryFn: () => api.get<{ text: string }>('/api/v1/settings/privacy-notice'), enabled: Boolean(settings.data) });
  const [ret, setRet] = useState({ retentionDays: '', detailRetentionDays: '' });
  const [confirm, setConfirm] = useState<null | 'all' | 'details'>(null);
  useEffect(() => {
    if (settings.data) setRet({ retentionDays: String(settings.data.retentionDays), detailRetentionDays: String(settings.data.detailRetentionDays) });
  }, [settings.data]);
  if (!settings.data) return <div className="panel panel-pad muted">Lädt …</div>;
  const s = settings.data;

  return (
    <div>
      <div className="callout ok" style={{ marginBottom: 16 }}>
        <ShieldCheck />
        <span>
          Grundsatz: Filum speichert <strong>keine IP-Adressen, keine Cookies bei Besuchern, keine Gerätekennungen</strong> und erstellt keine Profile. Es gibt keine externen Analysedienste und keine Telemetrie. Weiterleitungen funktionieren in jedem Modus gleich.
        </span>
      </div>
      <fieldset disabled={!admin} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="panel">
          <SettingRow title="Statistik" description="Was bei einem Aufruf gezählt wird.">
            <div className="radio-cards" role="radiogroup" aria-label="Statistikmodus">
              <label className="radio-card">
                <input type="radio" checked={s.analyticsMode === 'off'} onChange={() => void save({ analyticsMode: 'off' }, 'Statistik abgeschaltet')} />
                <strong>Aus</strong>
                <span>Nur eine Gesamtzahl je Link, damit Aufruflimits funktionieren. Keine Zeitreihen.</span>
              </label>
              <label className="radio-card">
                <input type="radio" checked={s.analyticsMode === 'basic'} onChange={() => void save({ analyticsMode: 'basic' }, 'Grundstatistik aktiv')} />
                <strong>Grundstatistik (Standard)</strong>
                <span>Aufrufe je Link und Stunde, Anteil per QR-Code, Bots getrennt, Fehlaufrufe. Keine Angaben über Besucher.</span>
              </label>
              <label className="radio-card">
                <input type="radio" checked={s.analyticsMode === 'extended'} onChange={() => void save({ analyticsMode: 'extended' }, 'Erweiterte Statistik aktiv')} />
                <strong>Erweitert</strong>
                <span>Zusätzlich Tagessummen nach Herkunfts-Website (nur Domain), Geräteklasse, Betriebssystem, Browserfamilie und Sprache. Weiterhin ohne IP-Adressen und ohne Einzelereignisse.</span>
              </label>
            </div>
          </SettingRow>
          <SettingRow title="Aufbewahrung" description="Ältere Statistik wird automatisch gelöscht.">
            <div className="grid-2">
              <label className="field">
                <span className="label">Aufrufe je Stunde (Tage)</span>
                <input className="input" type="number" min={7} max={3650} value={ret.retentionDays} onChange={(e) => setRet({ ...ret, retentionDays: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">Detailauswertungen (Tage)</span>
                <input className="input" type="number" min={7} max={3650} value={ret.detailRetentionDays} onChange={(e) => setRet({ ...ret, detailRetentionDays: e.target.value })} />
              </label>
            </div>
            {(ret.retentionDays !== String(s.retentionDays) || ret.detailRetentionDays !== String(s.detailRetentionDays)) && (
              <button className="btn" style={{ justifySelf: 'start' }} onClick={() => void save({ retentionDays: Number(ret.retentionDays), detailRetentionDays: Number(ret.detailRetentionDays) })}>
                Fristen speichern
              </button>
            )}
          </SettingRow>
          <SettingRow title="Fehlaufrufe merken" description="Für das Vertipper-Radar: welche nicht vorhandenen Kurzadressen aufgerufen wurden (höchstens 2000 je Domain und Tag, 90 Tage).">
            <Switch checked={s.trackUnknownSlugs} onChange={(v) => void save({ trackUnknownSlugs: v })}>
              Unbekannte Kurzadressen zählen
            </Switch>
          </SettingRow>
          <SettingRow title="Statistik löschen" description="Unwiderruflich. Links und Weiterleitungen bleiben unberührt.">
            {confirm ? (
              <div className="row wrap">
                <button
                  className="btn danger solid"
                  onClick={async () => {
                    try {
                      await api.del(`/api/v1/stats?scope=${confirm === 'details' ? 'details' : 'all'}`);
                      toast.ok(confirm === 'details' ? 'Detailauswertungen gelöscht' : 'Gesamte Statistik gelöscht');
                    } catch (e) {
                      toast.error(e);
                    }
                    setConfirm(null);
                  }}
                >
                  Ja, {confirm === 'details' ? 'Detailauswertungen' : 'alles'} löschen
                </button>
                <button className="btn" onClick={() => setConfirm(null)}>
                  Abbrechen
                </button>
              </div>
            ) : (
              <div className="row wrap">
                <button className="btn" onClick={() => setConfirm('details')}>
                  Nur Detailauswertungen löschen
                </button>
                <button className="btn danger" onClick={() => setConfirm('all')}>
                  Gesamte Statistik löschen
                </button>
              </div>
            )}
          </SettingRow>
        </div>
      </fieldset>

      <SectionTitle title="Textbaustein für Ihre Datenschutzerklärung">
        Passt sich automatisch an die gewählte Einstellung an. Bitte vor der Veröffentlichung prüfen.
      </SectionTitle>
      <CodeBlock label="Textbaustein" code={notice.data?.text ?? '…'} copyLabel="Text kopieren" prose />
    </div>
  );
}
