import { useEffect, useRef, useState, type ReactNode } from "react";

export function MenuItem({
  label,
  icon,
  disabled,
  onSelect
}: {
  label: string;
  icon?: string;
  disabled?: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
        disabled ? "cursor-not-allowed text-editor-text-muted/40" : "text-editor-text hover:bg-editor-accent/20"
      }`}
    >
      {icon && <span className="w-4 text-center">{icon}</span>}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function MenuSeparator(): JSX.Element {
  return <div className="my-1 h-px bg-editor-border" />;
}

export function MenuSectionLabel({ label }: { label: string }): JSX.Element {
  return <div className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-editor-text-muted">{label}</div>;
}

/**
 * A top-bar dropdown: click the label to open, click outside to close.
 * `children` receives `run`, which performs an action and then closes the menu.
 */
export function MenuDropdown({
  label,
  children
}: {
  label: string;
  children: (run: (action: () => void) => () => void) => ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const run = (action: () => void) => (): void => {
    action();
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`rounded px-2 py-1 text-xs ${
          open ? "bg-editor-panel-alt text-editor-text" : "text-editor-text-muted hover:bg-editor-panel-alt hover:text-editor-text"
        }`}
      >
        {label}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-[75vh] w-56 overflow-y-auto rounded border border-editor-border bg-editor-panel py-1 shadow-lg">
          {children(run)}
        </div>
      )}
    </div>
  );
}
