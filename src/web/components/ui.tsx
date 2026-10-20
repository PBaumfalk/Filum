import { Check, Copy } from 'lucide-react';
import { cloneElement, isValidElement, useCallback, useId, useState, type ReactElement, type ReactNode } from 'react';
import { STATE_LABEL } from '../lib/format';
import type { Color, LinkState } from '../lib/types';
import { useToast } from './toast';

/** Bildmarke: ein Faden, der einmal eine Schlaufe legt – der lange Weg, gefaltet. */
export function Logo({ size = 28, className = 'brand-mark' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#18202b" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="#ffffff" strokeOpacity="0.08" />
      <path
        d="M6 22.5c5.2 0 6.4-12.5 11.6-12.5 3.3 0 3.8 3.9 1.3 5.4-2.7 1.6-5.4-.8-3.3-3.3C17.4 9.7 21.4 8.2 26 8.2"
        fill="none"
        stroke="var(--thread)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Der Faden als Verbindungsstück zwischen Kurzlink und Ziel */
export function ThreadGlyph({ draw = false, className = '' }: { draw?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 14" className={`thread-svg ${draw ? 'thread-draw' : ''} ${className}`} aria-hidden="true" preserveAspectRatio="none">
      <path pathLength={1} d="M1 7 C 14 7, 18 2, 26 2 S 34 12, 40 12 S 52 7, 63 7" />
    </svg>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback für unsichere Kontexte (http im Intranet)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function useCopy() {
  const toast = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(
    async (text: string, label = 'Kopiert') => {
      const ok = await copyText(text);
      if (ok) {
        setCopied(text);
        toast.ok(label);
        window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1600);
      } else toast.error('Kopieren nicht möglich. Bitte manuell markieren.');
      return ok;
    },
    [toast],
  );
  return { copy, copied };
}

export function CopyButton({ text, label = 'Kopieren', size = 'sm', toastText }: { text: string; label?: string; size?: 'sm' | 'md'; toastText?: string }) {
  const { copy, copied } = useCopy();
  const done = copied === text;
  return (
    <button
      type="button"
      className={`btn ghost icon ${size === 'sm' ? 'sm' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        void copy(text, toastText ?? 'In die Zwischenablage kopiert');
      }}
      aria-label={label}
      title={label}
    >
      {done ? <Check style={{ color: 'var(--ok)' }} /> : <Copy />}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  // Beschriftung immer mit dem Feld verknüpfen (Screenreader, Klick auf die Beschriftung)
  const auto = `fld-${useId().replace(/:/g, '')}`;
  const descId = `${auto}-d`;
  let control = children;
  let id = htmlFor;
  if (!id && isValidElement(children)) {
    const el = children as ReactElement<{ id?: string; 'aria-describedby'?: string }>;
    id = el.props.id ?? auto;
    control = cloneElement(el, { id, 'aria-describedby': error || hint ? descId : undefined });
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control}
      {error ? (
        <span className="error-text" role="alert" id={descId}>
          {error}
        </span>
      ) : hint ? (
        <span className="hint" id={descId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Switch({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children && <span>{children}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TagChip({
  name,
  color = 'slate',
  onRemove,
  icon,
  title,
}: {
  name: string;
  color?: Color;
  onRemove?: () => void;
  /** Kleines Symbol vor dem Namen, z. B. für Sammlung oder Kampagne */
  icon?: ReactNode;
  title?: string;
}) {
  return (
    <span className="tag" data-color={color} title={title ?? name}>
      {icon}
      <span className="tag-label">{name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Schlagwort ${name} entfernen`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}

type Health = { status: 'ok' | 'broken' | 'warning' | 'skipped' | null; code: number | null; detail: string | null };

/**
 * Eine einzige Statusaussage je Link. Ist das Ziel gestört, steht das hier in Bernstein
 * („Aktiv · Ziel 404“) statt als zusätzliches Warnsymbol neben einem grünen „Aktiv“.
 */
export function StateBadge({ state, archived, health }: { state: LinkState; archived?: boolean; health?: Health }) {
  const label = archived ? 'Archiviert' : STATE_LABEL[state];
  const dot = archived ? 'disabled' : state;
  if (health?.status === 'broken') {
    const what = health.code ? `Ziel ${health.code}` : 'Ziel gestört';
    const tip = `Die Weiterleitung ist ${label.toLowerCase()}, aber das Ziel antwortet nicht wie erwartet${health.detail ? `: ${health.detail}` : '.'}`;
    return (
      <span className="row-state health-broken" title={tip}>
        <span className="state-dot broken" />
        <span className="row-state-text">
          {label} · {what}
        </span>
        <span className="sr-only">. {tip}</span>
      </span>
    );
  }
  return (
    <span className="row-state">
      <span className={`state-dot ${dot}`} />
      {label}
    </span>
  );
}

/** 14 Tage als Mini-Balken: liest sich auch bei wenigen Aufrufen eindeutig */
export function Spark({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const w = 64;
  const h = 18;
  const bw = w / data.length;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {data.map((v, i) => {
        const bh = v ? Math.max(2, (v / max) * (h - 1)) : 1;
        return <rect key={i} x={i * bw + 0.5} y={h - bh} width={bw - 1.2} height={bh} rx={0.8} className={v ? 'on' : 'off'} />;
      })}
    </svg>
  );
}

export function Empty({ title, children, action, art = true }: { title: string; children?: ReactNode; action?: ReactNode; art?: boolean }) {
  return (
    <div className="empty">
      {art && (
        <svg className="empty-art" viewBox="0 0 120 60" fill="none" aria-hidden="true">
          <path d="M4 44c22 0 26-30 48-30 14 0 16 16 5 22-11 7-22-3-13-14C52 12 72 8 116 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="4" cy="44" r="3" fill="var(--thread)" />
        </svg>
      )}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 14 }: { w?: number | string; h?: number }) {
  return <div className="skeleton" style={{ width: w, height: h }} />;
}

export function useFieldId(prefix = 'f') {
  return `${prefix}-${useId().replace(/:/g, '')}`;
}

/**
 * Kurzadresse „host/slug“. Der Slug wird nie gekürzt; wenn Platz fehlt, weicht der Host
 * (Ellipse) bzw. entfällt bei `hostMode="quiet"` (nur eine Domain) ganz, sobald der Inspector offen ist.
 */
export function ShortLabel({
  host,
  slug,
  className = 'row-short',
  hostMode = 'show',
}: {
  host: string;
  slug: string;
  className?: string;
  hostMode?: 'show' | 'quiet';
}) {
  return (
    <span className={`${className} host-${hostMode}`} title={`${host}/${slug}`}>
      <span className="host">{host}/</span>
      <span className="slug">{slug}</span>
    </span>
  );
}
