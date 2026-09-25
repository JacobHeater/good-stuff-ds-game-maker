import { checkScript, flattenSceneTree, getAnimationPlayer, type ProjectScript, type SceneNode, type ScriptDiagnostic, type ScriptSceneContext } from "@goodstuff/core";
import { useEffect, useMemo, useRef, useState } from "react";

import { useEditorStore } from "../state/editor-store";
import { CodeEditor } from "./CodeEditor";

/** How long after the last keystroke the script is checked again. */
const CHECK_DELAY_MS = 250;

const buttonClasses =
  "rounded border border-editor-border bg-editor-panel-alt px-2 py-1 text-xs text-editor-text hover:bg-editor-accent/20 disabled:cursor-not-allowed disabled:opacity-50";

/** The nodes that use `script`, by name and kind (what the checker needs to know about `self`). */
function useAttachedNodes(scriptId: string | undefined) {
  const { state } = useEditorStore();
  return useMemo(
    () => (scriptId ? flattenSceneTree(state.sceneRoot).filter((node) => node.scriptId === scriptId) : []),
    [state.sceneRoot, scriptId]
  );
}

/** The nodes a script is attached to, as the checker and auto-complete want to hear about them. */
function toAttachedContext(nodes: readonly SceneNode[]): ScriptSceneContext["attached"] {
  return nodes.map((node) => ({
    name: node.name,
    kind: node.kind,
    hasShape: flattenSceneTree(node).some((n) => n.kind === "CollisionShape3D"),
    animations: node.kind === "AnimationPlayer" ? getAnimationPlayer(node).animations.map((animation) => animation.name) : undefined
  }));
}

/**
 * A script's problems, recomputed a moment after typing stops and whenever the scene changes (a `$Name` can start or stop resolving when a node
 * is added or renamed). The check runs against the scene as it is now and the kinds of node the script is attached to.
 */
function useScriptDiagnostics(script: ProjectScript | undefined): ScriptDiagnostic[] {
  const { state } = useEditorStore();
  const attached = useAttachedNodes(script?.id);
  // Remember which script the problems belong to, so another script never shows them while its own are being worked out.
  const [checked, setChecked] = useState<{ id: string | undefined; list: ScriptDiagnostic[] }>({ id: undefined, list: [] });
  useEffect(() => {
    if (!script) return undefined;
    const timer = setTimeout(
      () =>
        setChecked({
          id: script.id,
          list: checkScript(script.source, { root: state.sceneRoot, attached: toAttachedContext(attached) }).diagnostics
        }),
      CHECK_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [script, state.sceneRoot, attached]);
  return script && checked.id === script.id ? checked.list : NONE;
}

const NONE: ScriptDiagnostic[] = [];

function ScriptNameField({ script }: { script: ProjectScript }): JSX.Element {
  const { renameScript } = useEditorStore();
  const [draft, setDraft] = useState(script.name);
  const input = useRef<HTMLInputElement>(null);
  // An undo (or opening another script) changes the name from outside; show it unless the field is being typed in.
  useEffect(() => {
    if (document.activeElement !== input.current) setDraft(script.name);
  }, [script.id, script.name]);
  return (
    <input
      ref={input}
      type="text"
      value={draft}
      aria-label="Script name"
      onChange={(event) => {
        setDraft(event.target.value);
        renameScript(script.id, event.target.value);
      }}
      onBlur={() => setDraft(script.name)}
      className="w-48 rounded border border-editor-border bg-editor-panel-alt px-2 py-1 text-xs font-semibold text-editor-text"
    />
  );
}

/**
 * The Script tab (requirements/scripting/TASK.script-editor-and-attachment.md): the project's scripts on the left, and the selected one in a code
 * editor with its problems listed below. Scripts are compiled into the ROM; nothing here runs them.
 */
export function ScriptWorkspace(): JSX.Element {
  const { state, selectScript, createScript, deleteScript, setScriptSource } = useEditorStore();
  const scripts = state.project?.scripts ?? [];
  const script = scripts.find((candidate) => candidate.id === state.selectedScriptId);
  const attached = useAttachedNodes(script?.id);
  const diagnostics = useScriptDiagnostics(script);
  const [goTo, setGoTo] = useState<{ line: number; column: number; nonce: number } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => setConfirmingDelete(false), [script?.id]);

  const usedBy = (id: string): number => flattenSceneTree(state.sceneRoot).filter((node) => node.scriptId === id).length;
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  return (
    <div className="flex min-h-0 flex-1 bg-editor-bg" data-testid="script-workspace">
      <aside className="flex w-52 shrink-0 flex-col border-r border-editor-border bg-editor-panel">
        <div className="flex items-center justify-between border-b border-editor-border px-2 py-1.5">
          <span className="text-xs font-semibold text-editor-text-muted">Scripts</span>
          <button type="button" className={buttonClasses} onClick={() => createScript(null)}>
            New Script
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1" role="listbox" aria-label="Scripts">
          {scripts.length === 0 && <div className="p-2 text-xs text-editor-text-muted">No scripts yet.</div>}
          {scripts.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="option"
              aria-selected={candidate.id === script?.id}
              onClick={() => selectScript(candidate.id)}
              className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs ${
                candidate.id === script?.id ? "bg-editor-accent/25 text-editor-text" : "text-editor-text-muted hover:bg-editor-panel-alt"
              }`}
            >
              <span className="truncate">{candidate.name}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-editor-text-muted" title="nodes that use this script">
                {usedBy(candidate.id)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {script ? (
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-editor-border bg-editor-panel px-2 py-1.5">
            <ScriptNameField script={script} />
            <span className="min-w-0 truncate text-[11px] text-editor-text-muted" data-testid="script-used-by">
              {attached.length === 0 ? "Not attached to any node." : `Attached to ${attached.map((node) => node.name).join(", ")}.`}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {confirmingDelete ? (
                <>
                  <span className="text-xs text-editor-text-muted">
                    {attached.length > 0 ? `Delete it? ${attached.length} node${attached.length === 1 ? "" : "s"} will have no script.` : "Delete this script?"}
                  </span>
                  <button type="button" className={`${buttonClasses} border-red-500/60`} onClick={() => deleteScript(script.id)}>
                    Delete
                  </button>
                  <button type="button" className={buttonClasses} onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className={buttonClasses} onClick={() => setConfirmingDelete(true)}>
                  Delete Script
                </button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <CodeEditor
              documentKey={script.id}
              value={script.source}
              onChange={(text) => setScriptSource(script.id, text)}
              diagnostics={diagnostics}
              goTo={goTo}
              getCompletionContext={() => ({ root: state.sceneRoot, attached: toAttachedContext(attached) })}
            />
          </div>
          <div className="flex h-32 shrink-0 flex-col border-t border-editor-border bg-editor-panel" data-testid="script-problems">
            <div className="border-b border-editor-border px-2 py-1 text-xs font-semibold text-editor-text-muted">
              Problems ({errors.length} error{errors.length === 1 ? "" : "s"}, {warnings.length} warning{warnings.length === 1 ? "" : "s"})
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {diagnostics.length === 0 && <div className="p-1 text-xs text-editor-text-muted">No problems.</div>}
              {diagnostics.map((d, index) => (
                <button
                  key={`${d.line}:${d.column}:${index}`}
                  type="button"
                  onClick={() => setGoTo({ line: d.line, column: d.column, nonce: Date.now() + index })}
                  className="flex w-full gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-editor-panel-alt"
                  data-severity={d.severity}
                >
                  <span className={d.severity === "error" ? "text-red-400" : "text-yellow-400"}>{d.severity === "error" ? "●" : "▲"}</span>
                  <span className="shrink-0 tabular-nums text-editor-text-muted">
                    {d.line}:{d.column}
                  </span>
                  <span className="min-w-0 flex-1">{d.message}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 text-xs text-editor-text-muted">
          <div>{scripts.length === 0 ? "This project has no scripts yet." : "Choose a script on the left."}</div>
          {scripts.length === 0 && (
            <button type="button" className={buttonClasses} onClick={() => createScript(null)}>
              New Script
            </button>
          )}
          <div className="max-w-sm text-center text-[11px]">
            A script is attached to a node from the Inspector, and runs on the DS when you press Play or export a ROM.
          </div>
        </div>
      )}
    </div>
  );
}
