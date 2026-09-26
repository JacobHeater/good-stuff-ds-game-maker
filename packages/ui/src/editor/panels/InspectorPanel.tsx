import { listScenes, withSceneTree } from "@goodstuff/core";
import { getMeshFrameCount, getSpriteByteSize, type ImportedSprite, type ImportedTexture, type MeshInstance3DData, type MeshPrimitive, type SceneNode, type ScreenId, type Vector3 } from "@goodstuff/core";
import { findSceneNode, flattenSceneTree, getImportedTriangleCount, getLightIntensity, lightLevelFromIntensity, getPrimitiveTriangleCount, MESH_PRIMITIVES, resolveMeshGeometry } from "@goodstuff/core";
import { useEditorStore, type Transform3DField } from "../state/editor-store";
import { AnimationPlayerField } from "./AnimationPlayerField";
import { AudioPlayerField } from "./AudioPlayerField";
import { CollisionShapeField } from "./CollisionShapeField";
import { SpriteAnimationsField, SpriteSheetField } from "./AnimatedSpriteFields";
import { SpriteTransformField } from "./SpriteTransformField";
import { TouchArea2DField, TouchArea3DField } from "./TouchAreaFields";
import { LabelField } from "./LabelFields";
import { NameField } from "./NameField";
import { ScriptField } from "./ScriptField";
import { spriteDataUrl } from "../viewport/sprite-image";
import { buttonClasses, Field, inputClasses } from "./inspector-fields";

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
 * A directional light's intensity, 0 to 100%. On the DS a light is a *color*: intensity is the brightness of a white light,
 * `round(31 * intensity)` per channel, so there are 31 real steps and nothing brighter than 100%
 * (requirements/scene-designer/STORY.directional-light-intensity.md).
 */
function IntensityField({
  intensity,
  onChange,
  onGestureBoundary
}: {
  intensity: number;
  onChange: (intensity: number) => void;
  /** The pointer was pressed or released on the slider, or it lost focus: the next change is a new undo step. */
  onGestureBoundary: () => void;
}): JSX.Element {
  const percent = Math.round(intensity * 100);
  return (
    <Field label="Intensity">
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          aria-label="Intensity"
          onChange={(event) => onChange(Number(event.target.value) / 100)}
          onPointerDown={onGestureBoundary}
          onPointerUp={onGestureBoundary}
          onBlur={onGestureBoundary}
          className="flex-1"
        />
        <span className="w-10 text-right tabular-nums text-editor-text-muted">{percent}%</span>
      </div>
      <span className="text-[10px] text-editor-text-muted">
        The DS has 31 light levels; this is level {lightLevelFromIntensity(intensity)}.
      </span>
    </Field>
  );
}

/**
 * A mesh's texture: none, or one of the project's imported textures, plus a button that imports a PNG and puts it on
 * this mesh. A model with no texture coordinates can't take a texture, and says so.
 */
function TextureField({
  node,
  textures,
  hasUvs,
  onChoose,
  onImport
}: {
  node: SceneNode;
  textures: readonly ImportedTexture[];
  hasUvs: boolean;
  onChoose: (textureId: string | null) => void;
  onImport: () => void;
}): JSX.Element {
  const current = node.mesh?.textureId;
  const missing = current !== undefined && !textures.some((texture) => texture.id === current);
  return (
    <div className="flex flex-col gap-1.5">
      <Field label="Texture">
        <select
          value={current ?? ""}
          disabled={!hasUvs}
          onChange={(event) => onChoose(event.target.value === "" ? null : event.target.value)}
          className={`${inputClasses} disabled:opacity-50`}
        >
          <option value="">None</option>
          {textures.map((texture) => (
            <option key={texture.id} value={texture.id}>
              {texture.name} ({texture.width} x {texture.height})
            </option>
          ))}
          {missing && (
            <option value={current} disabled>
              (missing texture)
            </option>
          )}
        </select>
      </Field>
      <button type="button" disabled={!hasUvs} onClick={onImport} className={buttonClasses}>
        Import PNG...
      </button>
      {!hasUvs && (
        <div className="text-[11px] text-editor-text-muted">This model has no texture coordinates (UVs), so it can't be textured.</div>
      )}
    </div>
  );
}

/**
 * A Sprite2D's picture: none, or one of the project's imported sprite images (256 colors, one of the DS's sprite sizes), plus a button
 * that imports a PNG and puts it on this sprite. Shows the picture as the DS draws it.
 */
function SpriteImageField({
  node,
  sprites,
  onChoose,
  onImport
}: {
  node: SceneNode;
  sprites: readonly ImportedSprite[];
  onChoose: (spriteId: string | null) => void;
  onImport: () => void;
}): JSX.Element {
  const current = node.spriteId;
  const image = sprites.find((sprite) => sprite.id === current);
  const missing = current !== undefined && image === undefined;
  const url = image ? spriteDataUrl(image) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <Field label="Image">
        <select value={current ?? ""} onChange={(event) => onChoose(event.target.value === "" ? null : event.target.value)} className={inputClasses}>
          <option value="">None</option>
          {sprites.map((sprite) => (
            <option key={sprite.id} value={sprite.id}>
              {sprite.name} ({sprite.width} x {sprite.height})
            </option>
          ))}
          {missing && (
            <option value={current} disabled>
              (missing image)
            </option>
          )}
        </select>
      </Field>
      <button type="button" onClick={onImport} className={buttonClasses}>
        Import PNG...
      </button>
      {image && url && (
        <div className="flex items-center gap-2 text-[11px] text-editor-text-muted">
          <img src={url} alt="" data-testid="sprite-preview" className="max-h-16 max-w-16 border border-editor-border bg-black/60" style={{ imageRendering: "pixelated" }} />
          <span>
            {image.width} x {image.height}, {getSpriteByteSize(image)} bytes of sprite memory
          </span>
        </div>
      )}
      {!image && !missing && <div className="text-[11px] text-editor-text-muted">No image: nothing is drawn for this sprite in the ROM.</div>}
    </div>
  );
}

/** The Mesh select's values: a primitive's own name, or `imported:` followed by a model's id. */
const IMPORTED_PREFIX = "imported:";

function meshSelectValue(mesh: MeshInstance3DData): string {
  return mesh.importedMeshId !== undefined ? `${IMPORTED_PREFIX}${mesh.importedMeshId}` : (mesh.primitive ?? "cube");
}

function parseMeshSelectValue(value: string): { primitive: MeshPrimitive } | { importedMeshId: string } {
  return value.startsWith(IMPORTED_PREFIX)
    ? { importedMeshId: value.slice(IMPORTED_PREFIX.length) }
    : { primitive: value as MeshPrimitive };
}

/**
 * The Inspector dock: edits properties of the currently selected scene node.
 * 3D nodes get position/rotation/scale vector fields (and mesh info); 2D
 * nodes keep the flat X/Y position editor.
 */
export function InspectorPanel(): JSX.Element {
  const { state, moveNode, setTransform3D, toggleVisible, setMeshSource, setMeshTexture, setMeshColor, importTexture, setSpriteImage, setNodeScreen, importSprite, setAudioSound, setAudioPlayer, setCollisionShape, setTouchArea2D, setTouchArea3D, setLabel, setSpriteTransform, switchScene, addSpriteAnimation, setSpriteAnimation, removeSpriteAnimation, setSpriteStartAnimation, renameNode, importSound, setLightIntensity, endEditGesture, attachScript, createScript, openScript } =
    useEditorStore();
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

  const sameNameCount = flattenSceneTree(state.sceneRoot).filter((other) => other.id !== node.id && other.name === node.name).length;
  const setField = (field: Transform3DField) => (value: Vector3): void => setTransform3D(node.id, field, value);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-editor-border px-2 py-1.5 text-xs font-semibold text-editor-text-muted">
        Inspector
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3">
        {state.extraSelectedIds.length > 0 && (
          <div className="rounded border border-editor-border bg-editor-panel-alt px-2 py-1 text-[11px] text-editor-text-muted" data-testid="multi-selection-note">
            {state.extraSelectedIds.length + 1} nodes are selected. This shows the one you clicked last; Delete, Duplicate and dragging in the Scene tree act on all of them.
          </div>
        )}
        <div>
          <NameField key={node.id} node={node} sameNameCount={sameNameCount} onRename={(name) => renameNode(node.id, name)} />
          <div className="mt-1 text-[11px] text-editor-text-muted">{node.kind}</div>
        </div>

        <Field label="Screen">
          {/* In a 2D project each node is on the screen it says (the scene root excepted); in a 3D project a node's screen follows from what draws it. */}
          <select
            value={node.screen}
            className={`${inputClasses} disabled:opacity-50`}
            disabled={state.project?.mode !== "2D" || node.id === state.sceneRoot.id}
            onChange={(event) => setNodeScreen(node.id, event.target.value as ScreenId)}
          >
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
              <div className="flex items-center gap-2" data-testid="mesh-color">
                <label className="flex items-center gap-2 text-xs text-editor-text-muted">
                  Color
                  <input
                    type="color"
                    aria-label="Color"
                    value={node.mesh.color ?? "#c1c1c1"}
                    onChange={(event) => setMeshColor(node.id, event.target.value)}
                    className="h-6 w-10 cursor-pointer rounded border border-editor-border bg-editor-panel-alt"
                  />
                </label>
                <button type="button" className={buttonClasses} disabled={node.mesh.color === undefined} onClick={() => setMeshColor(node.id, null)}>
                  Default
                </button>
              </div>
            )}
            {node.mesh && (
              <Field label="Mesh">
                <select
                  value={meshSelectValue(node.mesh)}
                  onChange={(event) => setMeshSource(node.id, parseMeshSelectValue(event.target.value))}
                  className={inputClasses}
                >
                  {MESH_PRIMITIVES.map((primitive) => (
                    <option key={primitive} value={primitive}>
                      {primitive} ({getPrimitiveTriangleCount(primitive)} tris)
                    </option>
                  ))}
                  {(state.project?.meshes ?? []).map((model) => (
                    <option key={model.id} value={`${IMPORTED_PREFIX}${model.id}`}>
                      {model.name} ({getImportedTriangleCount(model)} tris, imported)
                    </option>
                  ))}
                  {node.mesh.importedMeshId !== undefined &&
                    !state.project?.meshes?.some((model) => model.id === node.mesh?.importedMeshId) && (
                      <option value={meshSelectValue(node.mesh)} disabled>
                        (missing model)
                      </option>
                    )}
                </select>
              </Field>
            )}
            {node.kind === "CollisionShape3D" && (
              <CollisionShapeField key={node.id} node={node} onChange={(change) => setCollisionShape(node.id, change)} />
            )}
            {node.kind === "TouchArea3D" && <TouchArea3DField key={node.id} node={node} onChange={(change) => setTouchArea3D(node.id, change)} />}
            {node.kind === "DirectionalLight3D" && (
              <IntensityField
                intensity={getLightIntensity(node)}
                onChange={(intensity) => setLightIntensity(node.id, intensity)}
                onGestureBoundary={endEditGesture}
              />
            )}
            {node.mesh && (
              <TextureField
                node={node}
                textures={state.project?.textures ?? []}
                hasUvs={resolveMeshGeometry(node.mesh, state.project?.meshes)?.uvs !== undefined}
                onChoose={(textureId) => setMeshTexture(node.id, textureId)}
                onImport={() => void importTexture(node.id)}
              />
            )}
          </>
        ) : node.kind === "AudioStreamPlayer" ? (
          // A player has no place in the scene (it makes sound, it isn't drawn), so it has no position to edit.
          <AudioPlayerField
            key={node.id}
            node={node}
            sounds={state.project?.sounds ?? []}
            onChooseSound={(soundId) => setAudioSound(node.id, soundId)}
            onImport={() => void importSound(node.id)}
            onChange={(change) => setAudioPlayer(node.id, change)}
            onGestureBoundary={endEditGesture}
          />
        ) : node.kind === "AnimationPlayer" ? (
          // An animation player has no place in the scene either; its animations are edited here and in the Animation panel.
          <AnimationPlayerField key={node.id} node={node} />
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

        {node.kind === "Label" && <LabelField key={node.id} node={node} onChange={(change) => setLabel(node.id, change)} />}

        {node.kind === "TouchArea2D" && <TouchArea2DField key={node.id} node={node} onChange={(change) => setTouchArea2D(node.id, change)} />}

        {(node.kind === "Sprite2D" || node.kind === "AnimatedSprite2D") && <SpriteTransformField key={`transform-${node.id}`} node={node} onChange={(change) => setSpriteTransform(node.id, change)} />}

        {node.kind === "MeshInstance3D" && node.mesh && getMeshFrameCount(node.mesh, state.project?.meshes) > 1 && (
          <SpriteAnimationsField
            key={`animations-${node.id}`}
            node={node}
            sheet={undefined}
            poseCount={getMeshFrameCount(node.mesh, state.project?.meshes)}
            onAdd={() => addSpriteAnimation(node.id)}
            onChange={(index, change) => setSpriteAnimation(node.id, index, change)}
            onRemove={(index) => removeSpriteAnimation(node.id, index)}
            onStart={(name) => setSpriteStartAnimation(node.id, name)}
          />
        )}

        {node.kind === "AnimatedSprite2D" && (
          <>
            <SpriteSheetField
              node={node}
              sprites={state.project?.sprites ?? []}
              onChoose={(spriteId) => setSpriteImage(node.id, spriteId)}
              onImport={(frame) => void importSprite(node.id, frame)}
            />
            <SpriteAnimationsField
              key={`animations-${node.id}`}
              node={node}
              sheet={state.project?.sprites?.find((sprite) => sprite.id === node.spriteId)}
              onAdd={() => addSpriteAnimation(node.id)}
              onChange={(index, change) => setSpriteAnimation(node.id, index, change)}
              onRemove={(index) => removeSpriteAnimation(node.id, index)}
              onStart={(name) => setSpriteStartAnimation(node.id, name)}
            />
          </>
        )}

        {node.kind === "Sprite2D" && (
          <SpriteImageField
            node={node}
            sprites={state.project?.sprites ?? []}
            onChoose={(spriteId) => setSpriteImage(node.id, spriteId)}
            onImport={() => void importSprite(node.id)}
          />
        )}

        {node.instanceOf !== undefined && (
          <div className="flex flex-col gap-1.5 rounded border border-editor-border p-2 text-[11px] text-editor-text-muted" data-testid="scene-instance-field">
            {(() => {
              const source = state.project ? listScenes(withSceneTree(state.project, state.activeSceneId, state.sceneRoot)).find((scene) => scene.id === node.instanceOf) : undefined;
              return source ? (
                <>
                  <span>
                    An instance of the scene <strong className="text-editor-text">{source.name}</strong>. Everything in it comes from that scene: change the scene and every instance changes. Move, turn or scale this node to place them all.
                  </span>
                  <button type="button" className={buttonClasses} data-testid="open-instance-scene" onClick={() => switchScene(source.id)}>
                    Open scene "{source.name}"
                  </button>
                </>
              ) : (
                <span className="text-red-400">The scene this was an instance of isn't in the project any more, so nothing is shown or built for it.</span>
              );
            })()}
          </div>
        )}

        <ScriptField
          node={node}
          scripts={state.project?.scripts ?? []}
          onChoose={(scriptId) => attachScript(node.id, scriptId)}
          onNew={() => createScript(node.id)}
          onEdit={openScript}
        />

        <label className="flex items-center gap-2 text-xs text-editor-text-muted">
          <input type="checkbox" checked={node.visible} onChange={() => toggleVisible(node.id)} />
          Visible
        </label>
      </div>
    </div>
  );
}
