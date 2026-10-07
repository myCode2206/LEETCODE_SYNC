import { useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { normalizeLabels } from '@lcsync/shared';

interface Props {
  label: string;
  values: string[];
  suggestions: readonly string[];
  placeholder?: string;
  onChange: (values: string[]) => void;
}

/** Free-form label input (patterns, custom tags) with suggestions. */
export function LabelEditor({ label, values, suggestions, placeholder, onChange }: Props) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = (raw: string) => {
    if (!raw.trim()) return;
    onChange(normalizeLabels([...values, raw]));
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  const lower = new Set(values.map((v) => v.toLowerCase()));
  return (
    <div className="field">
      <span>{label}</span>
      {values.length > 0 && (
        <div className="chips">
          {values.map((v) => (
            <span key={v} className="tag">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="input"
        list={listId}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          // Picking a datalist suggestion adds it immediately.
          if (suggestions.includes(v)) add(v);
          else setDraft(v);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !lower.has(s.toLowerCase()))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
