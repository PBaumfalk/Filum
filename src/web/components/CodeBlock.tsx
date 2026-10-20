import type { CSSProperties, ReactNode } from 'react';
import { CopyButton } from './ui';

/**
 * Codeblock mit Kopfzeile: Beschriftung links, Kopieren rechts – das Symbol liegt nie über dem Code.
 * Der Block selbst scrollt horizontal (lange Zeilen werden nicht umbrochen, außer `wrap`).
 */
export function CodeBlock({
  code,
  label,
  copyLabel = 'Kopieren',
  copyText,
  wrap = false,
  prose = false,
  children,
}: {
  code: string;
  label?: ReactNode;
  copyLabel?: string;
  /** Abweichender Kopiertext (z. B. nur der Prüfwert statt der ganzen Zeile). */
  copyText?: string;
  wrap?: boolean;
  /** Fließtext statt Code (UI-Schrift, umbrechend). */
  prose?: boolean;
  children?: ReactNode;
}) {
  const style: CSSProperties | undefined = prose
    ? { whiteSpace: 'pre-wrap', fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-sm)' }
    : wrap
      ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
      : undefined;
  return (
    <div className="code-frame">
      <div className="code-head">
        <span className="code-label">{label}</span>
        <CopyButton text={copyText ?? code} label={copyLabel} />
      </div>
      <pre className="code-block" style={style} tabIndex={0}>
        {children ?? code}
      </pre>
    </div>
  );
}
