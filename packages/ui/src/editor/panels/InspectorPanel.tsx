import type { ScreenId, Vector3 } from "@goodstuff/core";
import { findSceneNode } from "@goodstuff/core";
import type { ReactNode } from "react";

import { useEditorStore, type Transform3DField } from "../state/editor-store";

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-editor-text-muted">{label}</span>
      {children}
    </label>
  );
}

const inputClasses = "rounded border border-editor-border bg-editor-panel-alt px-2 py-1 text-xs text-editor-text";

function Vector3Field({
  label,
  value,
  onChange
}: {
  label: string;
  value: Vector3;
  onChange: (next: Vector3) => void;
}): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[11px] text-editor-text-muted">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <Field key={axis} label={axis.toUpperCase()}>
            <input
              type="number"
              value={value[axis]}
              onChange={(event) => onChange({ ...value, [axis]: Number(event.target.value) })}
              className={inputClasses}
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

/**
 * The Inspector dock: edits properties of the currently selected scene node.
 * 3D nodes get position/rotation/scale vector fields (and mesh info); 2D
 * nodes keep the flat X/Y position editor.
 */
export function InspectorPanel(): JSX.Element {
  const { state, moveNode, setTransform3D, toggleVisible } = useEditorStore();
  const node = findSceneNode(state.sceneRoot, state.selectedNodeId);

  if (!node) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-editor-border px-2 py-1.5 text-xs font-semibold text-editor-text-muted">
          Inspector
        </div>
        <div className="p-3 text-xs text-editor-text-muted">No node selected.</div>
      </div>
    );
  }

  const setField = (field: Transform3DField) => (value: Vector3): void => setTransform3D(node.id, field, value);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-editor-border px-2 py-1.5 text-xs font-semibold text-editor-text-muted">
        Inspector
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3">
        <div>
          <div className="text-sm font-semibold">{node.name}</div>
          <div className="text-[11px] text-editor-text-muted">{node.kind}</div>
        </div>

        <Field label="Screen">
          <select value={node.screen} className={inputClasses} disabled>
            {(["top", "bottom"] as ScreenId[]).map((screen) => (
              <option key={screen} value={screen}>
                {screen}
              </option>
            ))}
          </select>
        </Field>

        {node.transform3D ? (
          <>
            <Vector3Field label="Position" value={node.transform3D.position} onChange={setField("position")} />
            <Vector3Field label="Rotation (deg)" value={node.transform3D.rotation} onChange={setField("rotation")} />
            <Vector3Field label="Scale" value={node.transform3D.scale} onChange={setField("scale")} />
            {node.mesh && (
              <div className="flex items-center justify-between text-[11px] text-editor-text-muted">
                <span>Mesh: {node.mesh.primitive}</span>
                <span>{node.mesh.triangleCount} tris</span>
              </div>
            )}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Position X">
              <input
                type="number"
                value={node.position.x}
                onChange={(event) => moveNode(node.id, Number(event.target.value), node.position.y)}
                className={inputClasses}
              />
            </Field>
            <Field label="Position Y">
              <input
                type="number"
                value={node.position.y}
                onChange={(event) => moveNode(node.id, node.position.x, Number(event.target.value))}
                className={inputClasses}
              />
            </Field>
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-editor-text-muted">
          <input type="checkbox" checked={node.visible} onChange={() => toggleVisible(node.id)} />
          Visible
        </label>
      </div>
    </div>
  );
}
