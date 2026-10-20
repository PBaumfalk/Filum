import { Download, ExternalLink, Palette } from 'lucide-react';
import { useState } from 'react';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/queries';
import type { Link } from '../lib/types';
import { useToast } from './toast';
import { Field, Segmented, Switch } from './ui';

const INKS = [
  { hex: '18202b', label: 'Tinte' },
  { hex: '000000', label: 'Schwarz' },
  { hex: 'b3122f', label: 'Karmin' },
  { hex: '1f3a68', label: 'Marine' },
  { hex: '24563b', label: 'Tanne' },
];

const EC_HINT: Record<'L' | 'M' | 'Q' | 'H', string> = {
  L: 'Bis 7 % des Codes dürfen fehlen. Kleinster Code, für saubere Bildschirme.',
  M: 'Bis 15 % des Codes dürfen fehlen. Guter Standard für Bildschirm und Druck.',
  Q: 'Bis 25 % des Codes dürfen fehlen. Für raues Papier oder kleine Formate.',
  H: 'Bis 30 % des Codes dürfen fehlen. Für Plakate im Freien oder ein Logo in der Mitte – der Code wird dichter.',
};

export function LinkQr({ link }: { link: Link }) {
  const session = useSession();
  const toast = useToast();
  const [dark, setDark] = useState('18202b');
  const [transparent, setTransparent] = useState(false);
  const [ec, setEc] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [size, setSize] = useState('1024');
  const [track, setTrack] = useState(true);
  const [busy, setBusy] = useState(false);

  const params = (format: string, extra: Record<string, string> = {}) =>
    qs({ format, dark, light: transparent ? 'transparent' : 'ffffff', ec, margin: 4, track: track ? 1 : 0, ...extra });
  const preview = `/api/v1/links/${link.id}/qr${params('svg')}`;

  const tessera = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ editorUrl: string }>(`/api/v1/links/${link.id}/tessera`);
      window.open(r.editorUrl, '_blank', 'noopener');
      toast.ok('In Tessera angelegt');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inspector-body">
      <div className="qr-stage">
        <img src={preview} alt={`QR-Code für ${link.domain.host}/${link.slug}`} style={transparent ? { background: 'transparent', boxShadow: 'none' } : undefined} />
      </div>
      <p className="small muted" style={{ textAlign: 'center' }}>
        {link.domain.host}/{link.slug}
        {track ? '?qr' : ''}
      </p>

      <div className="field">
        <span className="label">Farbe</span>
        <div className="swatch-row">
          {INKS.map((c) => (
            <button key={c.hex} type="button" className="swatch" style={{ background: `#${c.hex}` }} aria-pressed={dark === c.hex} aria-label={c.label} title={c.label} onClick={() => setDark(c.hex)} />
          ))}
          <label className="swatch" style={{ display: 'grid', placeItems: 'center', background: 'var(--surface)', overflow: 'hidden', position: 'relative' }} title="Eigene Farbe">
            <Palette size={14} />
            <input type="color" value={`#${dark}`} onChange={(e) => setDark(e.target.value.slice(1))} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} aria-label="Eigene Farbe" />
          </label>
        </div>
      </div>

      <Field label="Fehlerkorrektur" hint={EC_HINT[ec]}>
        <Segmented
          label="Fehlerkorrektur"
          value={ec}
          onChange={setEc}
          options={[
            { value: 'L', label: 'Niedrig' },
            { value: 'M', label: 'Mittel' },
            { value: 'Q', label: 'Hoch' },
            { value: 'H', label: 'Sehr hoch' },
          ]}
        />
      </Field>
      <Field label="PNG-Größe">
        <select className="select" value={size} onChange={(e) => setSize(e.target.value)}>
          <option value="512">512 px – Bildschirm</option>
          <option value="1024">1024 px – Standard</option>
          <option value="2048">2048 px – Druck</option>
          <option value="4096">4096 px – Plakat</option>
        </select>
      </Field>
      <Switch checked={transparent} onChange={setTransparent}>
        Transparenter Hintergrund
      </Switch>
      <Switch checked={track} onChange={setTrack}>
        QR-Aufrufe getrennt zählen
      </Switch>
      <p className="xsmall muted" style={{ marginTop: -8 }}>
        Der Code enthält dann <code>?qr</code>. Filum entfernt das vor der Weiterleitung und zeigt in der Statistik, wie viele Besucher über den Code kamen.
      </p>
      <div className="row wrap">
        <a className="btn primary" href={`/api/v1/links/${link.id}/qr${params('png', { size, download: '1' })}`}>
          <Download /> PNG
        </a>
        <a className="btn" href={`/api/v1/links/${link.id}/qr${params('svg', { download: '1' })}`}>
          <Download /> SVG (Vektor)
        </a>
      </div>
      {session.data?.tessera ? (
        <div className="callout">
          <Palette />
          <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
            <span>
              Logo, Rahmen, Druckvorschau und Lesbarkeitsprüfung: in <strong>Tessera</strong> weiter gestalten.
            </span>
            <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => void tessera()} disabled={busy}>
              {busy ? <span className="spinner" /> : <ExternalLink />} In Tessera gestalten
            </button>
          </div>
        </div>
      ) : (
        session.data?.user?.role === 'admin' && (
          <p className="xsmall muted">
            Optional lässt sich Tessera (QR-Studio mit Logo, Rahmen und Druckvorschau) anbinden, siehe Handbuch, Kapitel QR-Codes.
          </p>
        )
      )}
    </div>
  );
}
