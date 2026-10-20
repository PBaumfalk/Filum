import { useEffect, useId, useMemo, useState } from 'react';
import { Switch } from '../../components/ui';
import { can, useSession, useSettings } from '../../lib/queries';
import type { Settings } from '../../lib/types';
import { SettingRow, useSaveSettings } from './common';

const SCHEMES: { v: string; label: string }[] = [
  { v: 'http', label: 'http' },
  { v: 'https', label: 'https' },
  { v: 'mailto', label: 'mailto (E-Mail)' },
  { v: 'tel', label: 'tel (Telefon)' },
  { v: 'sms', label: 'sms' },
  { v: 'geo', label: 'geo (Ort)' },
];

/** IANA-Zeitzonen des Browsers für die Vorschlagsliste; ältere Browser liefern nichts. */
function timeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return fn ? fn('timeZone') : [];
  } catch {
    return [];
  }
}

export function General() {
  const ids = useId();
  const zones = useMemo(timeZones, []);
  const settings = useSettings();
  const session = useSession();
  const admin = can(session.data?.user?.role, 'admin');
  const save = useSaveSettings();
  const [org, setOrg] = useState('');
  const [tz, setTz] = useState('');
  useEffect(() => {
    if (settings.data) {
      setOrg(settings.data.organizationName);
      setTz(settings.data.timezone);
    }
  }, [settings.data]);
  if (!settings.data) return <div className="panel panel-pad muted">Lädt …</div>;
  const s = settings.data;
  const tzValid = !tz.trim() ? false : zones.length === 0 || zones.includes(tz.trim()) || ['UTC', s.timezone].includes(tz.trim());
  const toggle = (k: keyof Settings) => (v: boolean) => void save({ [k]: v } as Partial<Settings>);

  return (
    <fieldset disabled={!admin} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {!admin && <p className="small muted" style={{ marginBottom: 12 }}>Diese Einstellungen ändern Admins.</p>}
      <div className="panel">
        <SettingRow title="Name der Organisation" description="Erscheint in der Seitenleiste und auf den Hinweisseiten der Kurzlinks.">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (org.trim() && org !== s.organizationName) void save({ organizationName: org.trim() });
            }}
          >
            <label className="sr-only" htmlFor={`${ids}-org`}>
              Name der Organisation
            </label>
            <input id={`${ids}-org`} className="input" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="z. B. Kanzlei Muster" maxLength={120} />
            <button className="btn" type="submit" disabled={!org.trim() || org === s.organizationName}>
              Speichern
            </button>
          </form>
        </SettingRow>
        <SettingRow title="Zeitzone" description="Für Zeitpläne, Regeln nach Uhrzeit und Tageswerte in der Statistik.">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (tzValid && tz !== s.timezone) void save({ timezone: tz.trim() });
            }}
          >
            <label className="sr-only" htmlFor={`${ids}-tz`}>
              Zeitzone
            </label>
            <input
              id={`${ids}-tz`}
              className="input"
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              placeholder="z. B. Europe/Berlin"
              list={`${ids}-tz-list`}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!tzValid || undefined}
              aria-describedby={`${ids}-tz-hint`}
            />
            <datalist id={`${ids}-tz-list`}>
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <button className="btn" type="submit" disabled={!tzValid || tz === s.timezone}>
              Speichern
            </button>
          </form>
          <p id={`${ids}-tz-hint`} className="xsmall" style={{ color: tzValid ? 'var(--muted)' : 'var(--danger)' }}>
            {tzValid ? 'Tippen Sie den Ort, z. B. „Berlin“, und wählen Sie aus der Liste.' : 'Diese Zeitzone ist unbekannt. Bitte aus der Liste wählen, z. B. Europe/Berlin.'}
          </p>
        </SettingRow>
        <SettingRow title="Automatische Kurzadressen" description="Wie Filum eine Kurzadresse wählt, wenn niemand eine eigene vergibt.">
          <div className="radio-cards">
            <label className="radio-card">
              <input type="radio" checked={s.slugStyle === 'random'} onChange={() => void save({ slugStyle: 'random' })} />
              <strong>Zufällig und telefontauglich</strong>
              <span>z. B. „k7mxq2“, ohne verwechselbare Zeichen wie 0/O oder 1/l</span>
            </label>
            <label className="radio-card">
              <input type="radio" checked={s.slugStyle === 'readable'} onChange={() => void save({ slugStyle: 'readable' })} />
              <strong>Lesbar aus dem Ziel</strong>
              <span>z. B. „fristenrechner-2026“ aus der Zieladresse</span>
            </label>
          </div>
        </SettingRow>
        <SettingRow title="Standard-Weiterleitung" description="Für neue Links. Temporär (302) ist fast immer richtig.">
          <select className="select" value={s.defaultRedirectType} onChange={(e) => void save({ defaultRedirectType: Number(e.target.value) as 302 })}>
            <option value={302}>Temporär (302)</option>
            <option value={307}>Temporär, Methode bleibt (307)</option>
            <option value={301}>Permanent (301)</option>
            <option value={308}>Permanent, Methode bleibt (308)</option>
          </select>
        </SettingRow>
        <SettingRow title="Erlaubte Zielarten" description="Webadressen sind immer sinnvoll. E-Mail- oder Telefon-Links eignen sich zum Beispiel für QR-Codes.">
          <div className="row wrap" style={{ gap: 12 }}>
            {SCHEMES.map((sc) => (
              <label className="check" key={sc.v}>
                <input
                  type="checkbox"
                  checked={s.allowedSchemes.includes(sc.v)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...s.allowedSchemes, sc.v] : s.allowedSchemes.filter((x) => x !== sc.v);
                    if (next.length) void save({ allowedSchemes: next });
                  }}
                />
                {sc.label}
              </label>
            ))}
          </div>
        </SettingRow>
        <SettingRow title="Vorschau und Zielprüfung" description="Filum lädt Titel und Vorschaubild des Ziels und prüft regelmäßig, ob es noch erreichbar ist. Abrufe laufen über einen geschützten Weg, der keine internen Dienste erreicht.">
          <Switch checked={s.fetchPreviews} onChange={toggle('fetchPreviews')}>
            Titel und Vorschaubild laden
          </Switch>
          <Switch checked={s.healthChecks} onChange={toggle('healthChecks')}>
            Ziele regelmäßig prüfen
          </Switch>
        </SettingRow>
        <SettingRow title="Mitglieder" description="Mitglieder legen eigene Links an.">
          <Switch checked={s.memberCanCreateTags} onChange={toggle('memberCanCreateTags')}>
            dürfen neue Schlagwörter anlegen
          </Switch>
        </SettingRow>
      </div>
    </fieldset>
  );
}
