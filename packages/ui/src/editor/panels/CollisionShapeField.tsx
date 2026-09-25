import { COLLISION_SHAPE_KINDS, getCollisionShape, type CollisionShapeKind, type SceneNode } from "@goodstuff/core";
import type { CollisionShapeChange } from "../state/editor-store";
import { Field, inputClasses, NumberInput } from "./inspector-fields";

const SHAPE_LABELS: Record<CollisionShapeKind, string> = { box: "Box", sphere: "Sphere", capsule: "Capsule", cylinder: "Cylinder" };

/**
 * The shape of a CollisionShape3D in the Inspector (requirements/collision/TASK.collision-shape-inspector-and-viewport.md): which shape, and
 * the sizes that shape has. The viewport draws the same numbers.
 */
export function CollisionShapeField({ node, onChange }: { node: SceneNode; onChange: (change: CollisionShapeChange) => void }): JSX.Element {
  const shape = getCollisionShape(node);
  return (
    <div className="flex flex-col gap-2.5" data-testid="collision-shape">
      <Field label="Shape">
        <select value={shape.shape} onChange={(event) => onChange({ shape: event.target.value as CollisionShapeKind })} className={inputClasses} aria-label="Shape">
          {COLLISION_SHAPE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {SHAPE_LABELS[kind]}
            </option>
          ))}
        </select>
      </Field>
      {shape.shape === "box" && (
        <div className="grid grid-cols-3 gap-2">
          <NumberInput label="Size X" value={shape.size.x} onChange={(x) => onChange({ size: { x } })} />
          <NumberInput label="Size Y" value={shape.size.y} onChange={(y) => onChange({ size: { y } })} />
          <NumberInput label="Size Z" value={shape.size.z} onChange={(z) => onChange({ size: { z } })} />
        </div>
      )}
      {shape.shape !== "box" && (
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="Radius" value={shape.radius} onChange={(radius) => onChange({ radius })} />
          {shape.shape !== "sphere" && <NumberInput label="Height" value={shape.height} onChange={(height) => onChange({ height })} />}
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-editor-text-muted">
        <input type="checkbox" checked={shape.solid} onChange={(event) => onChange({ solid: event.target.checked })} aria-label="Solid" />
        Solid (a body moved with move_and_collide() is stopped by it: ground, walls, ceilings)
      </label>
      <div className="text-[10px] text-editor-text-muted">
        This shape does nothing until a script passes it to overlaps(), like <span className="font-mono">$Player.overlaps($Coin)</span>. Its node's Scale
        (and its parents') scales it.
      </div>
    </div>
  );
}
