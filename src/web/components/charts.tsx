import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { compact, num } from '../lib/format';

/** Mindestabstand in px zwischen der letzten (rechtsbündigen) und der vorherigen Achsenbeschriftung */
const MIN_LAST_LABEL_GAP = 72;

/** Nice ticks: 1-2-5-Raster */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * exp;
}

export interface SeriesPoint {
  label: string;
  value: number;
  secondary?: number;
}

/**
 * Flächendiagramm mit Zeigerhilfe. Linke Achse mit drei Hilfslinien, untere Achse
 * mit wenigen, lesbaren Beschriftungen. Tastatur: Pfeiltasten wandern durch Punkte.
 */
export function AreaChart({
  data,
  height = 220,
  formatLabel = (s) => s,
  secondaryLabel,
  valueLabel = 'Aufrufe',
}: {
  data: SeriesPoint[];
  height?: number;
  formatLabel?: (s: string) => string;
  secondaryLabel?: string;
  valueLabel?: string;
}) {
  const gid = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(800);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const pad = { l: 40, r: 10, t: 12, b: 26 };
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.value, d.secondary ?? 0))));
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;

  const { line, area, line2 } = useMemo(() => {
    const pts = data.map((d, i) => [x(i), y(d.value)] as const);
    const l = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
    const a = pts.length ? `${l} L${x(data.length - 1).toFixed(1)},${pad.t + ih} L${x(0).toFixed(1)},${pad.t + ih} Z` : '';
    const l2 = data.some((d) => d.secondary !== undefined)
      ? data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.secondary ?? 0).toFixed(1)}`).join(' ')
      : '';
    return { line: l, area: a, line2: l2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, max, height, W]);

  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(W / 90))));
  // Die letzte Beschriftung steht immer (rechtsbündig); eine reguläre davor nur mit genug Abstand, sonst überlappen sie

  const onMove = (e: React.PointerEvent) => {
    const svg = ref.current;
    if (!svg || !data.length) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / iw) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  const h = hover !== null ? data[hover] : null;
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <svg
        ref={ref}
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        tabIndex={0}
        role="img"
        aria-label={`${valueLabel} im Zeitverlauf, insgesamt ${num(total)}`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHover((v) => Math.min((v ?? -1) + 1, data.length - 1));
          if (e.key === 'ArrowLeft') setHover((v) => Math.max((v ?? data.length) - 1, 0));
        }}
        onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`area-${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="grid">
          {ticks.map((t) => (
            <line key={t} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        <g className="axis">
          {ticks.map((t) => (
            <text key={t} x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {compact(t)}
            </text>
          ))}
          {data.map((d, i) =>
            i === data.length - 1 || (i % labelEvery === 0 && x(data.length - 1) - x(i) >= MIN_LAST_LABEL_GAP) ? (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>
                {formatLabel(d.label)}
              </text>
            ) : null,
          )}
        </g>
        {area && <path d={area} fill={`url(#area-${gid})`} />}
        {line2 && <path d={line2} className="line secondary" vectorEffect="non-scaling-stroke" />}
        {line && <path d={line} className="line" vectorEffect="non-scaling-stroke" />}
        {h && hover !== null && (
          <>
            <line className="hover-line" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {h && hover !== null && (
        <>
          <span
            style={{
              position: 'absolute',
              left: `${(x(hover) / W) * 100}%`,
              top: (y(h.value) / H) * height,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--surface)',
              border: '2px solid var(--chart-1)',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          />
          <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: (y(h.value) / H) * height }}>
            <strong className="num">{num(h.value)}</strong> {valueLabel}
            {secondaryLabel && h.secondary !== undefined && (
              <span style={{ opacity: 0.7 }}>
                {' '}
                · {num(h.secondary)} {secondaryLabel}
              </span>
            )}
            <div style={{ opacity: 0.7, fontSize: 11 }}>{formatLabel(h.label)}</div>
          </div>
        </>
      )}
    </div>
  );
}

export function BarList({
  items,
  empty = 'Keine Daten im Zeitraum.',
  format = num,
}: {
  items: { key: string | number; label: ReactNode; value: number; href?: string; onClick?: () => void; title?: string }[];
  empty?: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="muted small" style={{ padding: '8px 10px' }}>{empty}</p>;
  return (
    <div className="bar-list">
      {items.map((it, i) => {
        const style = { '--w': String(Math.max(0, it.value) / max) } as React.CSSProperties;
        const inner = (
          <>
            <span className="label">{it.label}</span>
            <span className="value">{format(it.value)}</span>
          </>
        );
        return it.href || it.onClick ? (
          <a
            key={it.key}
            className={`bar-item ${i === 0 ? 'lead' : ''}`}
            style={style}
            href={it.href ?? '#'}
            title={it.title}
            onClick={(e) => {
              if (it.onClick) {
                e.preventDefault();
                it.onClick();
              }
            }}
          >
            {inner}
          </a>
        ) : (
          <div key={it.key} className={`bar-item ${i === 0 ? 'lead' : ''}`} style={style} title={it.title}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Wochentag × Stunde. Farbintensität relativ zum Maximum. */
export function Heatmap({ data }: { data: number[][] }) {
  const max = Math.max(1, ...data.flat());
  const total = data.flat().reduce((a, b) => a + b, 0);
  let best = { d: 0, h: 0, v: -1 };
  data.forEach((row, d) => row.forEach((v, h) => v > best.v && (best = { d, h, v })));
  return (
    <div>
      <div className="heatmap" role="img" aria-label={total ? `Am meisten Aufrufe ${DAYS[best.d]} gegen ${best.h} Uhr` : 'Noch keine Aufrufe'}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} style={{ textAlign: 'center' }}>
            {h % 6 === 0 ? h : ''}
          </span>
        ))}
        {data.map((row, d) => (
          <Row key={d} day={DAYS[d]} row={row} max={max} />
        ))}
      </div>
      {total > 0 && (
        <p className="small muted" style={{ marginTop: 10 }}>
          Stärkste Stunde: <strong style={{ color: 'var(--ink)' }}>{DAYS[best.d]}, {best.h}–{best.h + 1} Uhr</strong> mit {num(best.v)} Aufrufen.
        </p>
      )}
    </div>
  );
}

function Row({ day, row, max }: { day: string; row: number[]; max: number }) {
  return (
    <>
      <span className="heat-label">{day}</span>
      {row.map((v, h) => (
        <span
          key={h}
          className="heat-cell"
          title={`${day} ${h}–${h + 1} Uhr: ${num(v)}`}
          style={v ? { background: `color-mix(in srgb, var(--chart-1) ${Math.round(12 + (v / max) * 88)}%, var(--heat-0))` } : undefined}
        />
      ))}
    </>
  );
}

/**
 * Anteil in Prozent, lesbar gerundet: 0 bleibt „0 %“, Werte unter 1 % erscheinen als „< 1 %“
 * statt als irreführende 0.
 */
export function percent(part: number, whole: number): string {
  if (!whole || !part) return '0 %';
  const p = (part / whole) * 100;
  if (Math.abs(p) < 1) return '< 1 %';
  return `${num(Math.round(p))} %`;
}

export function Delta({ now, before }: { now: number; before: number }) {
  if (!before && !now) return <span className="delta flat">keine Aufrufe</span>;
  if (!before) return <span className="delta flat" title="Im Zeitraum davor gab es keine Aufrufe.">kein Vergleichswert</span>;
  const raw = ((now - before) / before) * 100;
  const pct = Math.round(raw);
  const cls = raw > 0 ? 'up' : raw < 0 ? 'down' : 'flat';
  const text = raw !== 0 && Math.abs(raw) < 1 ? `${raw > 0 ? '+' : '−'} < 1 %` : `${pct > 0 ? '+' : ''}${num(pct)} %`;
  return (
    <span className={`delta ${cls}`} title={`Vorheriger Zeitraum: ${num(before)}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {raw > 0 ? <path d="M7 17 17 7M9 7h8v8" /> : raw < 0 ? <path d="M7 7l10 10M17 9v8H9" /> : <path d="M5 12h14" />}
      </svg>
      {text} gegenüber dem Zeitraum davor
    </span>
  );
}

export function formatBucket(label: string, granularity: 'hour' | 'day'): string {
  if (granularity === 'hour') return label;
  const d = new Date(`${label}T12:00:00`);
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}
