import { useMemo, useRef, useState } from 'react';
import { useTags } from '../lib/queries';
import { TagChip } from './ui';

/** Schlagwörter: Tippen, Enter oder Komma übernimmt; Vorschläge aus vorhandenen Schlagwörtern. */
export function TagInput({ value, onChange, id, disabled }: { value: string[]; onChange: (v: string[]) => void; id?: string; disabled?: boolean }) {
  const tags = useTags();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const colors = useMemo(() => new Map((tags.data?.items ?? []).map((t) => [t.name.toLowerCase(), t.color])), [tags.data]);

  const suggestions = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const have = new Set(value.map((v) => v.toLowerCase()));
    return (tags.data?.items ?? [])
      .filter((t) => !have.has(t.name.toLowerCase()) && (!needle || t.name.toLowerCase().includes(needle)))
      .slice(0, 6);
  }, [text, value, tags.data]);

  const add = (name: string) => {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!clean || value.some((v) => v.toLowerCase() === clean.toLowerCase())) {
      setText('');
      return;
    }
    onChange([...value, clean]);
    setText('');
    setActive(0);
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        className="input"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', minHeight: 38, paddingBlock: 6, cursor: 'text' }}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((t) => (
          <TagChip key={t} name={t} color={colors.get(t.toLowerCase()) ?? 'slate'} onRemove={disabled ? undefined : () => onChange(value.filter((x) => x !== t))} />
        ))}
        <input
          id={id}
          ref={inputRef}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) add(v.slice(0, -1));
            else {
              setText(v);
              setOpen(true);
            }
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (open && suggestions[active] && (!text || suggestions[active].name.toLowerCase().startsWith(text.toLowerCase()))) add(suggestions[active].name);
              else add(text);
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={value.length ? '' : 'z. B. Mandanten, Newsletter'}
          aria-label="Schlagwort hinzufügen"
          style={{ border: 0, outline: 0, background: 'none', flex: 1, minWidth: 90, padding: 0 }}
          autoComplete="off"
        />
      </div>
      {open && (suggestions.length > 0 || text.trim()) && (
        <div className="popover" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4 }} role="listbox">
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={i === active}
              className="menu-item"
              data-active={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                add(s.name);
              }}
            >
              <TagChip name={s.name} color={s.color} />
              <span className="xsmall faint" style={{ marginLeft: 'auto' }}>
                {s.count ?? 0}
              </span>
            </button>
          ))}
          {text.trim() && !suggestions.some((s) => s.name.toLowerCase() === text.trim().toLowerCase()) && (
            <button
              type="button"
              className="menu-item"
              onMouseDown={(e) => {
                e.preventDefault();
                add(text);
              }}
            >
              Neues Schlagwort „{text.trim()}“
            </button>
          )}
        </div>
      )}
    </div>
  );
}
