import {
  getTouchArea2D,
  getTouchArea3D,
  TOUCH_AREA_2D_MAX_HEIGHT,
  TOUCH_AREA_2D_MAX_WIDTH,
  TOUCH_AREA_3D_SHAPES,
  type SceneNode,
  type TouchArea3DShape
} from "@goodstuff/core";
import type { TouchArea2DChange, TouchArea3DChange } from "../state/editor-store";
import { Field, inputClasses, NumberInput } from "./inspector-fields";

const SHAPE_LABELS: Record<TouchArea3DShape, string> = { box: "Box", sphere: "Sphere" };

/**
 * A TouchArea2D in the Inspector (requirements/touch/STORY.touch-areas.md): the size of its rectangle on the touch screen, in pixels, centered on the
 * node's position. The 2D viewport draws the same numbers.
 */
export function TouchArea2DField({ node, onChange }: { node: SceneNode; onChange: (change: TouchArea2DChange) => void }): JSX.Element {
  const area = getTouchArea2D(node);
  return (
    <div className="flex flex-col gap-2.5" data-testid="touch-area-2d">
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="Width" value={area.width} onChange={(width) => onChange({ width })} />
        <NumberInput label="Height" value={area.height} onChange={(height) => onChange({ height })} />
      </div>
      <div className="text-[10px] text-editor-text-muted">
        Up to {TOUCH_AREA_2D_MAX_WIDTH} x {TOUCH_AREA_2D_MAX_HEIGHT} pixels. Only the bottom screen senses the stylus. This does nothing until a script asks it,
        like <span className="font-mono">if $Button.is_touched():</span>.
      </div>
    </div>
  );
}

/**
 * A TouchArea3D in the Inspector: a box or a sphere in the 3D scene. When the stylus touches the screen showing the 3D view, a ray from the camera through that
 * point is tested against it, so a 3D object can be touched. The node's Scale (and its parents') scales it.
 */
export function TouchArea3DField({ node, onChange }: { node: SceneNode; onChange: (change: TouchArea3DChange) => void }): JSX.Element {
  const area = getTouchArea3D(node);
  return (
    <div className="flex flex-col gap-2.5" data-testid="touch-area-3d">
      <Field label="Shape">
        <select value={area.shape} onChange={(event) => onChange({ shape: event.target.value as TouchArea3DShape })} className={inputClasses} aria-label="Shape">
          {TOUCH_AREA_3D_SHAPES.map((shape) => (
            <option key={shape} value={shape}>
              {SHAPE_LABELS[shape]}
            </option>
          ))}
        </select>
      </Field>
      {area.shape === "box" ? (
        <div className="grid grid-cols-3 gap-2">
          <NumberInput label="Size X" value={area.size.x} onChange={(x) => onChange({ size: { x } })} />
          <NumberInput label="Size Y" value={area.size.y} onChange={(y) => onChange({ size: { y } })} />
          <NumberInput label="Size Z" value={area.size.z} onChange={(z) => onChange({ size: { z } })} />
        </div>
      ) : (
        <NumberInput label="Radius" value={area.radius} onChange={(radius) => onChange({ radius })} />
      )}
      <div className="text-[10px] text-editor-text-muted">
        Needs the 3D engine on the bottom screen (the touch screen). This does nothing until a script asks it, like{" "}
        <span className="font-mono">if $Pick.is_touched():</span>.
      </div>
    </div>
  );
}
