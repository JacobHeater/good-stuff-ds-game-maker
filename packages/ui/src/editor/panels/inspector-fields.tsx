import { useEffect, useRef, useState, type ReactNode } from "react";

/** A labelled Inspector field. Shared by the Inspector's own fields and the audio player. */
export function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-editor-text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClasses = "rounded border border-editor-border bg-editor-panel-alt px-2 py-1 text-xs text-editor-text";

export const buttonClasses =
  "rounded border border-editor-border bg-editor-panel-alt px-2 py-1 text-xs text-editor-text hover:bg-editor-accent/20 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * A number the user types: it keeps its own text while the field has focus, so half-typed values ("0." on the way to "0.5", or an empty
 * field) aren't rewritten under them, and reports each complete number as it is typed. When the field is left it shows the stored value.
 */
export function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== input.current) setDraft(String(value));
  }, [value]);
  return (
    <Field label={label}>
      <input
        ref={input}
        type="number"
        step={0.1}
        min={0}
        value={draft}
        aria-label={label}
        onChange={(event) => {
          setDraft(event.target.value);
          const typed = event.target.value.trim() === "" ? NaN : Number(event.target.value);
          if (Number.isFinite(typed)) onChange(typed);
        }}
        onBlur={() => setDraft(String(value))}
        className={inputClasses}
      />
    </Field>
  );
}
