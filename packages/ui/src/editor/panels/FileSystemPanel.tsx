import { useEffect, useState } from "react";

import { useEditorStore } from "../state/editor-store";

type ListingState =
  | { status: "no-project" }
  | { status: "loading" }
  | { status: "loaded"; files: string[] }
  | { status: "error"; message: string };

/**
 * FileSystem dock: lists the real files alongside the open project's
 * saved location. Shows a "no project open" placeholder until the
 * project has been saved at least once (there's nothing on disk to
 * list before that).
 */
export function FileSystemPanel(): JSX.Element {
  const { state } = useEditorStore();
  const [listing, setListing] = useState<ListingState>({ status: "no-project" });

  useEffect(() => {
    if (!state.projectFilePath) {
      setListing({ status: "no-project" });
      return;
    }
    let cancelled = false;
    setListing({ status: "loading" });
    window.goodstuff.project.listDirectory(state.projectFilePath).then((result) => {
      if (cancelled) return;
      if (result.outcome === "ok") {
        setListing({ status: "loaded", files: result.files ?? [] });
      } else {
        setListing({ status: "error", message: result.message ?? "Failed to list project files." });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [state.projectFilePath]);

  return (
    <div className="flex h-48 shrink-0 flex-col border-t border-editor-border">
      <div className="shrink-0 border-b border-editor-border px-2 py-1.5 text-xs font-semibold text-editor-text-muted">
        FileSystem
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {listing.status === "no-project" && (
          <div className="px-2 py-1 text-xs text-editor-text-muted">No project open yet — save one to see its files here.</div>
        )}
        {listing.status === "loading" && <div className="px-2 py-1 text-xs text-editor-text-muted">Loading…</div>}
        {listing.status === "error" && <div className="px-2 py-1 text-xs text-red-400">{listing.message}</div>}
        {listing.status === "loaded" &&
          (listing.files.length === 0 ? (
            <div className="px-2 py-1 text-xs text-editor-text-muted">No other files here yet.</div>
          ) : (
            listing.files.map((file) => (
              <div key={file} className="truncate px-2 py-0.5 text-xs text-editor-text-muted hover:bg-editor-panel-alt">
                {file}
              </div>
            ))
          ))}
      </div>
    </div>
  );
}
