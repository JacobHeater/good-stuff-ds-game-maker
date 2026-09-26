import { getSpriteTransform, SPRITE_SCALE_MAX, SPRITE_SCALE_MIN, type SceneNode } from "@goodstuff/core";
import type { SpriteTransformChange } from "../state/editor-store";
import { NumberInput } from "./inspector-fields";

/**
 * A Sprite2D's rotation and scale in the Inspector (requirements/scene-designer/STORY.script-and-rotate-2d-nodes.md): the picture turns and grows about its center,
 * which is the node's position. Rotation is in degrees, clockwise; a negative scale flips the picture. The 2D viewport draws the same numbers, and the ROM starts a
 * sprite this way (a script can change it: `rotation`, `scale.x`, `scale.y`).
 */
export function SpriteTransformField({ node, onChange }: { node: SceneNode; onChange: (change: SpriteTransformChange) => void }): JSX.Element {
  const transform = getSpriteTransform(node);
  return (
    <div className="flex flex-col gap-2.5" data-testid="sprite-transform">
      <NumberInput label="Rotation (deg)" value={transform.rotation} onChange={(rotation) => onChange({ rotation })} />
      <div className="grid grid-cols-2 gap-2">
        <NumberInput label="Scale X" value={transform.scale.x} onChange={(scaleX) => onChange({ scaleX })} />
        <NumberInput label="Scale Y" value={transform.scale.y} onChange={(scaleY) => onChange({ scaleY })} />
      </div>
      <div className="text-[10px] text-editor-text-muted">
        Clockwise, about the sprite's center. Scale {SPRITE_SCALE_MIN} to {SPRITE_SCALE_MAX}; a negative value flips it. The DS turns and scales at most 32 sprites on a screen.
      </div>
    </div>
  );
}
