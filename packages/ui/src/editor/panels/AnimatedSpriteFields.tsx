import { useEffect, useState } from "react";

import {
  formatFrameList,
  getSpriteAnimations,
  getSpriteByteSize,
  getSpriteFrames,
  MAX_SPRITE_ANIMATION_FPS,
  MIN_SPRITE_ANIMATION_FPS,
  parseFrameList,
  SPRITE_SIZES,
  type ImportedSprite,
  type SceneNode,
  type SpriteAnimation
} from "@goodstuff/core";

import type { SpriteAnimationChange } from "../state/editor-store";
import { spriteDataUrl, spriteFrameDataUrl } from "../viewport/sprite-image";
import { buttonClasses, Field, inputClasses } from "./inspector-fields";

/**
 * An AnimatedSprite2D's sprite sheet and animations in the Inspector (requirements/scene-designer/STORY.animated-sprites.md): the sheet it takes its frames from (a PNG of equal
 * frames in a grid, imported with the size of one frame), and named animations that each play some of those frames at a speed. What the viewport shows is what the DS draws.
 */

/**
 * A text field that changes the project only when the person is done (Enter, or leaving the field); Escape puts the old text back. What was typed goes back to what the project has
 * once it has been offered, unless `onCommit` answers false (the text is wrong in a way the message beside the field explains, and is kept to be fixed).
 */
function CommitInput({ label, value, onCommit, testId, error }: { label: string; value: string; onCommit: (text: string) => boolean | void; testId?: string; error?: string | null }): JSX.Element {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field label={label}>
      <input
        value={text}
        data-testid={testId}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text === value) return;
          if (onCommit(text) !== false) setText(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setText(value);
        }}
        className={`${inputClasses} ${error ? "border-red-500" : ""}`}
      />
      {error && <div className="mt-0.5 text-[10px] text-red-400">{error}</div>}
    </Field>
  );
}

/** The sheet drawn with its frames numbered, so the numbers an animation uses can be read off it. */
function SheetPreview({ sheet }: { sheet: ImportedSprite }): JSX.Element | null {
  const url = spriteDataUrl(sheet);
  const frames = getSpriteFrames(sheet);
  if (!url) return null;
  const scale = Math.max(1, Math.min(4, Math.floor(232 / sheet.width)));
  return (
    <div className="relative inline-block border border-editor-border bg-black/60" style={{ width: sheet.width * scale, height: sheet.height * scale }} data-testid="sheet-preview">
      <img src={url} alt="" style={{ width: sheet.width * scale, height: sheet.height * scale, imageRendering: "pixelated" }} />
      {frames.count > 1 && (
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${frames.columns}, 1fr)`, gridTemplateRows: `repeat(${frames.rows}, 1fr)` }}>
          {Array.from({ length: frames.count }, (_, index) => (
            <div key={index} className="border border-dashed border-white/40 text-[9px] leading-none text-white/80" style={{ textShadow: "0 0 2px #000" }}>
              {index}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Which sheet an AnimatedSprite2D uses, and importing one: pick the size of a frame, then a PNG that is a grid of frames that size. */
export function SpriteSheetField({
  node,
  sprites,
  onChoose,
  onImport
}: {
  node: SceneNode;
  sprites: readonly ImportedSprite[];
  onChoose: (spriteId: string | null) => void;
  onImport: (frame: { width: number; height: number }) => void;
}): JSX.Element {
  const [frameSize, setFrameSize] = useState("32x32");
  const current = node.spriteId;
  const sheet = sprites.find((sprite) => sprite.id === current);
  const missing = current !== undefined && sheet === undefined;
  const frames = sheet ? getSpriteFrames(sheet) : null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="sprite-sheet-field">
      <Field label="Sprite sheet">
        <select value={current ?? ""} onChange={(event) => onChoose(event.target.value === "" ? null : event.target.value)} className={inputClasses}>
          <option value="">None</option>
          {sprites.map((sprite) => (
            <option key={sprite.id} value={sprite.id}>
              {sprite.name} ({getSpriteFrames(sprite).count} frame{getSpriteFrames(sprite).count === 1 ? "" : "s"})
            </option>
          ))}
          {missing && (
            <option value={current} disabled>
              (missing image)
            </option>
          )}
        </select>
      </Field>
      <div className="flex items-end gap-2">
        <Field label="Frame size">
          <select value={frameSize} onChange={(event) => setFrameSize(event.target.value)} className={inputClasses} data-testid="frame-size">
            {SPRITE_SIZES.map((size) => (
              <option key={`${size.width}x${size.height}`} value={`${size.width}x${size.height}`}>
                {size.width} x {size.height}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className={buttonClasses}
          data-testid="import-sheet"
          onClick={() => {
            const [width, height] = frameSize.split("x").map(Number);
            onImport({ width, height });
          }}
        >
          Import sheet PNG...
        </button>
      </div>
      {sheet && frames && (
        <div className="flex flex-col gap-1 text-[11px] text-editor-text-muted">
          <SheetPreview sheet={sheet} />
          <span>
            {frames.count} frame{frames.count === 1 ? "" : "s"} of {frames.frameWidth} x {frames.frameHeight} ({frames.columns} across, {frames.rows} down), {getSpriteByteSize(sheet)} bytes of sprite memory
          </span>
        </div>
      )}
    </div>
  );
}

/** A picture that plays one animation, for the row being previewed: the frames one after another at the animation's speed, once or round and round. */
function AnimationPreview({ sheet, animation }: { sheet: ImportedSprite; animation: SpriteAnimation }): JSX.Element | null {
  const [position, setPosition] = useState(0);
  // The frames as text: the list itself is a new array on every render, and an effect that depends on it would start over on every tick.
  const framesKey = animation.frames.join(",");
  useEffect(() => {
    setPosition(0);
    if (animation.frames.length < 2) return undefined;
    const timer = setInterval(() => {
      setPosition((now) => {
        if (now + 1 < animation.frames.length) return now + 1;
        return animation.loop ? 0 : now;
      });
    }, 1000 / animation.fps);
    return () => clearInterval(timer);
  }, [framesKey, animation.fps, animation.loop]);
  const url = spriteFrameDataUrl(sheet, animation.frames[Math.min(position, animation.frames.length - 1)] ?? 0);
  if (!url) return null;
  return <img src={url} alt="" data-testid="animation-preview" className="max-h-16 max-w-16 border border-editor-border bg-black/60" style={{ imageRendering: "pixelated" }} />;
}

/** The animations list: add, name, choose frames ("0-3, 5"), speed, looping, remove, and which one starts. */
export function SpriteAnimationsField({
  node,
  sheet,
  onAdd,
  onChange,
  onRemove,
  onStart,
  poseCount
}: {
  node: SceneNode;
  sheet: ImportedSprite | undefined;
  /** For a 3D model with several poses: how many (its frames are poses; there is no picture to preview). */
  poseCount?: number;
  onAdd: () => void;
  onChange: (index: number, change: SpriteAnimationChange) => void;
  onRemove: (index: number) => void;
  onStart: (name: string | null) => void;
}): JSX.Element {
  const data = getSpriteAnimations(node);
  const frameCount = poseCount ?? (sheet ? getSpriteFrames(sheet).count : 1);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [frameErrors, setFrameErrors] = useState<Record<number, string | null>>({});
  return (
    <div className="flex flex-col gap-2" data-testid="sprite-animations">
      <div className="text-[11px] font-semibold text-editor-text">Animations</div>
      {data.animations.length === 0 && <div className="text-[11px] text-editor-text-muted">{poseCount !== undefined ? "No animations yet: the model shows its first pose." : "No animations yet: the sprite shows the first frame of its sheet."}</div>}
      {data.animations.map((animation, index) => (
        <div key={index} className="flex flex-col gap-1.5 rounded border border-editor-border p-2" data-testid={`animation-${index}`}>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <CommitInput label="Name" value={animation.name} onCommit={(name) => onChange(index, { name })} testId={`animation-name-${index}`} />
            </div>
            <button type="button" className={buttonClasses} onClick={() => setPreviewing(previewing === index ? null : index)} data-testid={`animation-preview-toggle-${index}`}>
              {previewing === index ? "Hide" : "Preview"}
            </button>
            <button type="button" className={buttonClasses} onClick={() => onRemove(index)} data-testid={`animation-remove-${index}`}>
              Remove
            </button>
          </div>
          <CommitInput
            label={`${poseCount !== undefined ? "Poses" : "Frames"} (0 to ${frameCount - 1})`}
            value={formatFrameList(animation.frames)}
            testId={`animation-frames-${index}`}
            error={frameErrors[index] ?? null}
            onCommit={(text) => {
              const parsed = parseFrameList(text, frameCount);
              if (parsed.ok) {
                setFrameErrors((errors) => ({ ...errors, [index]: null }));
                onChange(index, { frames: parsed.frames });
                return true;
              }
              setFrameErrors((errors) => ({ ...errors, [index]: parsed.error }));
              return false;
            }}
          />
          <div className="flex items-end gap-3">
            <Field label={poseCount !== undefined ? "Poses a second" : "Frames a second"}>
              <input
                type="number"
                min={MIN_SPRITE_ANIMATION_FPS}
                max={MAX_SPRITE_ANIMATION_FPS}
                step={1}
                value={animation.fps}
                data-testid={`animation-fps-${index}`}
                onChange={(event) => {
                  const fps = Number(event.target.value);
                  if (event.target.value !== "" && Number.isFinite(fps)) onChange(index, { fps });
                }}
                className={`${inputClasses} w-20`}
              />
            </Field>
            <label className="flex items-center gap-1.5 pb-1 text-xs text-editor-text-muted">
              <input type="checkbox" checked={animation.loop} data-testid={`animation-loop-${index}`} onChange={(event) => onChange(index, { loop: event.target.checked })} />
              Loop
            </label>
          </div>
          {previewing === index && sheet && <AnimationPreview sheet={sheet} animation={animation} />}
        </div>
      ))}
      <button type="button" className={buttonClasses} onClick={onAdd} data-testid="animation-add">
        Add animation
      </button>
      {data.animations.length > 0 && (
        <Field label="Plays at the start">
          <select value={data.start ?? ""} onChange={(event) => onStart(event.target.value === "" ? null : event.target.value)} className={inputClasses} data-testid="animation-start">
            <option value="">Nothing (shows frame 0)</option>
            {data.animations.map((animation) => (
              <option key={animation.name} value={animation.name}>
                {animation.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="text-[10px] text-editor-text-muted">A script can start one by name: play("run"), stop() it, or ask is_playing().</div>
    </div>
  );
}
