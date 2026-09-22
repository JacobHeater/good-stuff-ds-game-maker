const PROJECT_FILES = [
  "res://project.gsds",
  "res://scenes/main.scene",
  "res://sprites/player.png",
  "res://sprites/enemy.png",
  "res://audio/bgm.wav"
];

/**
 * FileSystem dock stand-in. Lists project resources; no real filesystem
 * wiring yet since this scaffold is frontend-only.
 */
export function FileSystemPanel(): JSX.Element {
  return (
    <div className="flex h-48 shrink-0 flex-col border-t border-editor-border">
      <div className="shrink-0 border-b border-editor-border px-2 py-1.5 text-xs font-semibold text-editor-text-muted">
        FileSystem
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {PROJECT_FILES.map((file) => (
          <div key={file} className="truncate px-2 py-0.5 text-xs text-editor-text-muted hover:bg-editor-panel-alt">
            {file}
          </div>
        ))}
      </div>
    </div>
  );
}
