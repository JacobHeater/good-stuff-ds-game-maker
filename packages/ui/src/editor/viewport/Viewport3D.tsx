import {
  DS_HARDWARE_PROFILE,
  getMeshDiffuseLevels,
  getMeshOpacity,
  findSceneNode,
  getAnimationPlayer,
  getCollisionShape,
  getTouchArea3D,
  getLightIntensity,
  getTextureTexels,
  is3DNodeKind,
  lightLevelFromIntensity,
  resolveMeshGeometry,
  resolveMeshTexture,
  sampleAnimation,
  texelsToRgba,
  type ImportedMesh,
  type ImportedTexture,
  type MeshInstance3DData,
  type ScreenId,
  type SceneNode,
  type Vector3
} from "@goodstuff/core";
import { OrbitControls, TransformControls } from "@react-three/drei";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BackSide,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  NearestFilter,
  RepeatWrapping,
  RGBAFormat,
  type Group,
  type Object3D
} from "three";

import { useEditorStore, type EditorTool } from "../state/editor-store";
import { useShownSceneRoot } from "../state/shown-scene";
import { collisionWireframe } from "./collision-wireframe";
import { createDsMaterial, registerViewportLight, syncViewportLights, type ViewportLight } from "./ds-lighting-material";

const EDITOR_ACCENT = "#4fa8ff";
const EDITOR_BORDER = "#3a3d41";
/**
 * Mesh colors as the DS sees them (0..1 per channel; see core's ds-lighting.ts): a plain mesh is the DS's grey, a
 * textured one is white so the picture shows in its own colors. A selected mesh is tinted with the editor's accent.
 */
const SELECTED_DIFFUSE = [0.31, 0.66, 1] as const;
const TEXTURED_SELECTED_TINT = [0.66, 0.83, 1] as const;

const DS_WIDTH = DS_HARDWARE_PROFILE.screens.width;
const DS_HEIGHT = DS_HARDWARE_PROFILE.screens.height;
const DS_ASPECT = DS_WIDTH / DS_HEIGHT;

const DEG_TO_RAD = Math.PI / 180;

function toEuler(rotation: Vector3): [number, number, number] {
  return [rotation.x * DEG_TO_RAD, rotation.y * DEG_TO_RAD, rotation.z * DEG_TO_RAD];
}

function toTuple(v: Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

/**
 * Sizes the DS-aspect-ratio working area to fill as much of `containerRef`
 * as possible (like CSS `object-fit: contain`), by watching the container
 * with a ResizeObserver. The working area is always the full available
 * space, up to the DS's 4:3 aspect ratio — it never shrinks to a small
 * fixed box, only the internal render resolution stays fixed (see `dpr`
 * usage below).
 */
function useContainedSize(aspect: number): [React.RefObject<HTMLDivElement>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: DS_WIDTH * 2, height: DS_HEIGHT * 2 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: containerWidth, height: containerHeight } = entry.contentRect;
      let width = containerWidth;
      let height = containerWidth / aspect;
      if (height > containerHeight) {
        height = containerHeight;
        width = containerHeight * aspect;
      }
      setSize({ width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect]);

  return [ref, size];
}

/**
 * A mesh drawn from the shared geometry in `@goodstuff/core` (a built-in primitive or an imported model,
 * resolved the same way the hardware budget and the compiler resolve it), so what's drawn, counted and
 * built can't disagree. A mesh whose model is missing from the project draws nothing.
 */
function MeshView({
  mesh,
  importedMeshes,
  importedTextures,
  selected,
  onSelect
}: {
  mesh: MeshInstance3DData;
  importedMeshes: readonly ImportedMesh[] | undefined;
  importedTextures: readonly ImportedTexture[] | undefined;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element | null {
  const shared = resolveMeshGeometry(mesh, importedMeshes);
  const geometry = useMemo(() => {
    if (!shared) return null;
    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new Float32BufferAttribute(shared.positions as number[], 3));
    buffer.setAttribute("normal", new Float32BufferAttribute(shared.normals as number[], 3));
    if (shared.uvs) buffer.setAttribute("uv", new Float32BufferAttribute(shared.uvs as number[], 2));
    return buffer;
  }, [shared]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  // The picture as the DS holds it (5-bit color), drawn blocky like the DS does: nearest-neighbor, tiling past the
  // edges. Rows run top to bottom and so do the UVs, so no flip.
  const stored = shared?.uvs ? resolveMeshTexture(mesh, importedTextures) : undefined;
  const map = useMemo(() => {
    if (!stored) return null;
    const texture = new DataTexture(texelsToRgba(getTextureTexels(stored)), stored.width, stored.height, RGBAFormat);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    // No color space: the DS shows the texel values as they are, with no gamma, so the shader must read them raw.
    texture.needsUpdate = true;
    return texture;
  }, [stored]);
  useEffect(() => () => map?.dispose(), [map]);

  // The DS's lighting, not three.js's (ds-lighting-material.ts). Which side(s) are drawn follows the mesh's own cull
  // setting (scene-designer/STORY.mesh-face-culling.md), the same as the ROM: "none" (the default) draws both, matching
  // the runtime's own default of culling off (forgiving of a model whose winding wasn't checked on the way in).
  const side = mesh.cull === "back" ? FrontSide : mesh.cull === "front" ? BackSide : DoubleSide;
  // The mesh's own color as the DS holds it (5 bits a channel), or the default grey / white for a textured one.
  const levels = getMeshDiffuseLevels(mesh, map !== null);
  const ownDiffuse = useMemo(() => [levels[0] / 31, levels[1] / 31, levels[2] / 31] as const, [levels[0], levels[1], levels[2]]);
  const material = useMemo(
    () =>
      createDsMaterial({
        diffuse: selected && !map ? SELECTED_DIFFUSE : ownDiffuse,
        tint: map && selected ? TEXTURED_SELECTED_TINT : undefined,
        map,
        side,
        unlit: mesh.unlit === true,
        opacity: getMeshOpacity(mesh)
      }),
    [map, selected, side, ownDiffuse, mesh.unlit, mesh.alpha]
  );
  useEffect(() => () => material.dispose(), [material]);
  if (!geometry) return null;

  return (
    <mesh
      geometry={geometry}
      onPointerDown={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/** A collision shape's wireframe color: distinct from a mesh, and the editor's accent when the node is selected. */
const COLLISION_COLOR = "#4ecdc4";
/** A solid shape (ground, a wall) is drawn in a warm color so it can be told from the others. */
const SOLID_COLLISION_COLOR = "#f0a050";

/**
 * A CollisionShape3D, drawn as a wireframe with a faint fill you can click (requirements/collision/TASK.collision-shape-inspector-and-viewport.md).
 * It is drawn in the node's own space, so the node's position, rotation and scale (and its parents') place and size it, as they do in the ROM.
 */
function CollisionShapeView({ node, selected, onSelect }: { node: SceneNode; selected: boolean; onSelect: () => void }): JSX.Element {
  const shape = getCollisionShape(node);
  const { shape: kind, size, radius, height } = shape;
  const lines = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(collisionWireframe({ shape: kind, size, radius, height }), 3));
    return geometry;
  }, [kind, size.x, size.y, size.z, radius, height]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => lines.dispose(), [lines]);
  const color = selected ? EDITOR_ACCENT : shape.solid ? SOLID_COLLISION_COLOR : COLLISION_COLOR;
  return (
    <>
      <lineSegments geometry={lines} renderOrder={1}>
        <lineBasicMaterial color={color} />
      </lineSegments>
      <mesh
        onPointerDown={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        {kind === "box" && <boxGeometry args={[size.x, size.y, size.z]} />}
        {kind === "sphere" && <sphereGeometry args={[radius, 16, 12]} />}
        {kind === "capsule" && <capsuleGeometry args={[radius, Math.max(0, height - radius * 2), 4, 12]} />}
        {kind === "cylinder" && <cylinderGeometry args={[radius, radius, height, 16]} />}
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.22 : 0.1} depthWrite={false} side={DoubleSide} />
      </mesh>
    </>
  );
}

/** A touch area is drawn in its own color, so it can be told from the collision shapes. */
const TOUCH_AREA_COLOR = "#5fd6c4";

/**
 * A TouchArea3D, drawn as a wireframe with a faint fill you can click. It is drawn in the node's own space, so the node's position, rotation and scale (and its
 * parents') place and size it, as they do in the ROM.
 */
function TouchAreaView({ node, selected, onSelect }: { node: SceneNode; selected: boolean; onSelect: () => void }): JSX.Element {
  const area = getTouchArea3D(node);
  const { shape: kind, size, radius } = area;
  const lines = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(collisionWireframe({ shape: kind, size, radius, height: 2 }), 3));
    return geometry;
  }, [kind, size.x, size.y, size.z, radius]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => lines.dispose(), [lines]);
  const color = selected ? EDITOR_ACCENT : TOUCH_AREA_COLOR;
  return (
    <>
      <lineSegments geometry={lines} renderOrder={1}>
        <lineBasicMaterial color={color} />
      </lineSegments>
      <mesh
        onPointerDown={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        {kind === "box" ? <boxGeometry args={[size.x, size.y, size.z]} /> : <sphereGeometry args={[radius, 16, 12]} />}
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.22 : 0.1} depthWrite={false} side={DoubleSide} />
      </mesh>
    </>
  );
}

function CameraGizmo({ selected, onSelect }: { selected: boolean; onSelect: () => void }): JSX.Element {
  return (
    <mesh
      rotation={[Math.PI / 2, 0, 0]}
      onPointerDown={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <coneGeometry args={[0.2, 0.4, 8]} />
      <meshStandardMaterial color={selected ? EDITOR_ACCENT : "#c9cdd3"} wireframe={!selected} />
    </mesh>
  );
}

/** How long the direction arrow on a directional light is, in scene units. */
const LIGHT_ARROW_LENGTH = 1.6;

/**
 * A directional light shines along its node's local -Z axis, as in Godot and as the compiler does, so rotating the node
 * aims it. Its *position* doesn't matter to the lighting at all, only that direction; the arrow makes the direction
 * visible (a light "close to" a subject but aimed away lights nothing). It registers with the DS lighting, which shades
 * every mesh (`ds-lighting-material.ts`), and its intensity is the level of a white light.
 * (requirements/scene-designer/BUG.directional-light-ignores-rotation.md, BUG.editor-lighting-differs-from-rom.md)
 */
function DirectionalLightMarker({ level, selected, onSelect }: { level: number; selected: boolean; onSelect: () => void }): JSX.Element {
  const group = useRef<Group>(null);
  const entry = useRef<ViewportLight | null>(null);
  useEffect(() => {
    if (!group.current) return undefined;
    const light: ViewportLight = { object: group.current, level };
    entry.current = light;
    return registerViewportLight(light);
    // Registered once per mount (so the light order stays stable); the level is kept current below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (entry.current) entry.current.level = level;
  }, [level]);

  const color = selected ? EDITOR_ACCENT : "#f5d76e";
  const pick = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation();
    onSelect();
  };
  return (
    <group ref={group}>
      <mesh position={[0, 0, -LIGHT_ARROW_LENGTH / 2]} rotation={[Math.PI / 2, 0, 0]} onPointerDown={pick}>
        <cylinderGeometry args={[0.02, 0.02, LIGHT_ARROW_LENGTH, 6]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0, -LIGHT_ARROW_LENGTH]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={pick}>
        <coneGeometry args={[0.08, 0.22, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function LightGizmo({ node, selected, onSelect }: { node: SceneNode; selected: boolean; onSelect: () => void }): JSX.Element {
  return (
    <>
      <mesh
        onPointerDown={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <icosahedronGeometry args={[0.12, 0]} />
        <meshStandardMaterial color={selected ? EDITOR_ACCENT : "#f5d76e"} emissive="#f5d76e" emissiveIntensity={0.6} />
      </mesh>
      {node.kind === "DirectionalLight3D" && (
        <DirectionalLightMarker level={lightLevelFromIntensity(getLightIntensity(node))} selected={selected} onSelect={onSelect} />
      )}
      {/* An OmniLight3D is drawn but lights nothing: the DS has no positional lights and the compiler leaves it out. */}
    </>
  );
}

/** Once a frame, hands the drawn lights to every mesh's shader. */
function LightSync(): null {
  useFrame(() => syncViewportLights());
  return null;
}

const RAD_TO_DEG = 180 / Math.PI;
/** Values written by a gizmo drag are rounded to this many decimals, so the Inspector shows tidy numbers. */
const GIZMO_DECIMALS = 10 ** 4;
const tidy = (value: number): number => Math.round(value * GIZMO_DECIMALS) / GIZMO_DECIMALS + 0;

/**
 * When a gizmo was last pressed or released. A click on a gizmo handle hits nothing that has a pointer
 * handler, so the canvas would report it as a click on empty space and deselect the node; the canvas
 * ignores "missed" clicks that arrive right after a gizmo interaction.
 */
let lastGizmoInteractionAt = 0;
const GIZMO_CLICK_GRACE_MS = 400;

/**
 * The transform gizmo's own three.js controls instance, while one is mounted (BUG.gizmo-drag-selects-mesh-behind-it.md).
 * TransformControls does its own raycasting against its handles directly on the canvas element -- it never goes through
 * react-three-fiber's per-object events at all, so a mesh with no handler of its own (the gizmo's arrows) is invisible to
 * a click-to-select raycast, which then "sees through" it to whatever mesh is actually behind the handle (the ground
 * under a tree, say) and selects that instead. `axis` is the handle currently under the pointer, if any (kept in sync by
 * TransformControls on every pointer move, so it is already correct before a click's own event even starts, regardless
 * of which of the two separate listeners on the canvas happens to run first): a click is read as a manipulation, not a
 * selection, whenever it is non-null.
 */
let activeGizmoControls: { axis: string | null } | null = null;

/**
 * What an animation preview changes for a node: the values the animation gives it at the playhead. The viewport shows these in place of the node's own; the
 * node itself (and so the Inspector and the saved project) is not touched.
 */
interface PreviewValues {
  position?: Vector3;
  rotation?: Vector3;
  scale?: Vector3;
  visible?: boolean;
}
type PreviewOverrides = ReadonlyMap<string, PreviewValues>;

/** Every drawn node's group in the scene graph, by node id, so the gizmo can find the selected one. */
type NodeObjects = Map<string, Object3D>;

/**
 * The Move / Rotate / Scale manipulator for the selected node. It has to live at the scene root, not
 * inside the node it manipulates: the controls update the object's transform, which updates its children,
 * which would include the controls (infinite recursion), and a gizmo inside a transformed parent would be
 * transformed twice. So the nodes register their groups in `objects`, and this finds the selected one.
 * It attaches to the node's own group, so a nested node is manipulated in its parent's space, and writes
 * the matching field back to the editor state as the handle is dragged; that state is the source of truth
 * and re-applies the same numbers to the group.
 */
function SelectionGizmo({
  nodeId,
  tool,
  objects,
  onTransform,
  onGestureEnd
}: {
  nodeId: string;
  tool: Exclude<EditorTool, "select">;
  objects: NodeObjects;
  onTransform: (id: string, field: "position" | "rotation" | "scale", value: Vector3) => void;
  /** The handle was released: whatever is dragged next is a new undo step. */
  onGestureEnd: () => void;
}): JSX.Element | null {
  const [target, setTarget] = useState<Object3D | null>(null);
  // The group may be (re)created after this renders, so look for it every frame and only update on change.
  useFrame(() => {
    const found = objects.get(nodeId) ?? null;
    if (found !== target) setTarget(found);
  });
  if (!target) return null;

  const write = (): void => {
    if (tool === "move") {
      onTransform(nodeId, "position", { x: tidy(target.position.x), y: tidy(target.position.y), z: tidy(target.position.z) });
    } else if (tool === "rotate") {
      onTransform(nodeId, "rotation", {
        x: tidy(target.rotation.x * RAD_TO_DEG),
        y: tidy(target.rotation.y * RAD_TO_DEG),
        z: tidy(target.rotation.z * RAD_TO_DEG)
      });
    } else {
      onTransform(nodeId, "scale", { x: tidy(target.scale.x), y: tidy(target.scale.y), z: tidy(target.scale.z) });
    }
  };

  return (
    <TransformControls
      // React calls this with the instance on mount and with null on unmount, which is exactly when the gizmo
      // should start/stop being consulted (`instance`'s type comes from TransformControls' own ref type; `axis`
      // is private there, hence the cast through `unknown` to the one field this file actually reads).
      ref={(instance) => {
        activeGizmoControls = instance as unknown as { axis: string | null } | null;
      }}
      object={target}
      mode={tool === "move" ? "translate" : tool}
      space={tool === "move" ? "world" : "local"}
      size={1.4}
      onObjectChange={write}
      onMouseDown={() => (lastGizmoInteractionAt = performance.now())}
      onMouseUp={() => {
        lastGizmoInteractionAt = performance.now();
        onGestureEnd();
      }}
    />
  );
}

/**
 * Draws a node and, recursively, everything under it, as a hierarchy: a node's transform is relative
 * to its parent's, and a hidden node hides its whole subtree
 * (requirements/scene-designer/BUG.3d-viewport-ignores-parent-transforms.md). A node assigned to the
 * other screen isn't drawn itself, but its transform still applies to descendants that are.
 */
function SceneNodeView({
  importedMeshes,
  importedTextures,
  node,
  activeScreen,
  selectedId,
  objects,
  onSelect,
  preview
}: {
  importedMeshes: readonly ImportedMesh[] | undefined;
  importedTextures: readonly ImportedTexture[] | undefined;
  node: SceneNode;
  activeScreen: ScreenId;
  selectedId: string;
  objects: NodeObjects;
  onSelect: (id: string) => void;
  /** The animation preview, when one is showing. */
  preview: PreviewOverrides | null;
}): JSX.Element | null {
  const shown = preview?.get(node.id);
  if (!(shown?.visible ?? node.visible)) return null;

  const children = node.children.map((child) => (
    <SceneNodeView
      key={child.id}
      node={child}
      importedMeshes={importedMeshes}
      importedTextures={importedTextures}
      activeScreen={activeScreen}
      selectedId={selectedId}
      objects={objects}
      onSelect={onSelect}
      preview={preview}
    />
  ));
  if (!node.transform3D || !is3DNodeKind(node.kind)) return <>{children}</>;

  const selected = selectedId === node.id;
  const select = (): void => onSelect(node.id);
  const drawn = node.screen === activeScreen;
  // Only meshes and grouping nodes are sized by their scale; a camera or light gizmo stays gizmo-sized.
  const scaled = node.kind === "MeshInstance3D" || node.kind === "Node3D" || node.kind === "CollisionShape3D" || node.kind === "TouchArea3D";

  return (
    <group
      ref={(object: Object3D | null) => {
        if (object) objects.set(node.id, object);
        else objects.delete(node.id);
      }}
      position={toTuple(shown?.position ?? node.transform3D.position)}
      rotation={toEuler(shown?.rotation ?? node.transform3D.rotation)}
      scale={scaled ? toTuple(shown?.scale ?? node.transform3D.scale) : [1, 1, 1]}
    >
      {drawn && node.kind === "MeshInstance3D" && node.mesh && (
        <MeshView mesh={node.mesh} importedMeshes={importedMeshes} importedTextures={importedTextures} selected={selected} onSelect={select} />
      )}
      {drawn && node.kind === "CollisionShape3D" && <CollisionShapeView node={node} selected={selected} onSelect={select} />}
      {drawn && node.kind === "TouchArea3D" && <TouchAreaView node={node} selected={selected} onSelect={select} />}
      {drawn && node.kind === "Camera3D" && <CameraGizmo selected={selected} onSelect={select} />}
      {drawn && (node.kind === "DirectionalLight3D" || node.kind === "OmniLight3D") && (
        <LightGizmo node={node} selected={selected} onSelect={select} />
      )}
      {children}
    </group>
  );
}

/**
 * The 3D scene viewport: the DS-specific equivalent of Godot's 3D editor,
 * showing whichever single screen currently owns the 3D engine (the DS can
 * only drive 3D output to one screen at a time). The working area always
 * fills the available panel space (up to the DS's 4:3 aspect ratio) so it's
 * actually usable for building a scene, but the WebGL canvas renders at the
 * DS's true native 256x192 resolution internally — a fractional `dpr`
 * (native width / displayed width) keeps the drawing buffer locked to that
 * resolution no matter how large the box is on screen, so it stays
 * authentically blocky (`image-rendering: pixelated`, no antialiasing)
 * instead of looking like smooth modern 3D.
 */
export function Viewport3D(): JSX.Element {
  const shownRoot = useShownSceneRoot();
  const { state, selectNode, setTransform3D, endEditGesture } = useEditorStore();
  const activeScreen: ScreenId = state.screenFilter === "both" ? "top" : state.screenFilter;
  const nodeObjects = useRef<NodeObjects>(new Map());
  const selected = findSceneNode(state.sceneRoot, state.selectedNodeId);
  // A gizmo needs something to manipulate: a drawn, non-root 3D node; and a camera or light is never scaled.
  const gizmoTool =
    state.activeTool !== "select" &&
    selected &&
    selected.id !== state.sceneRoot.id &&
    selected.screen === activeScreen &&
    is3DNodeKind(selected.kind) &&
    (state.activeTool !== "scale" || selected.kind === "MeshInstance3D" || selected.kind === "Node3D" || selected.kind === "CollisionShape3D" || selected.kind === "TouchArea3D")
      ? state.activeTool
      : null;
  // The animation preview: what the selected AnimationPlayer's animation gives each node at the playhead (null when no preview is showing).
  const previewTime = state.animationUi.previewTime;
  const previewOverrides = useMemo((): PreviewOverrides | null => {
    const previewPlayer = state.animationUi.playerId ? findSceneNode(state.sceneRoot, state.animationUi.playerId) : undefined;
    if (previewTime === null || !previewPlayer || previewPlayer.kind !== "AnimationPlayer") return null;
    const animations = getAnimationPlayer(previewPlayer).animations;
    const animation = animations.find((a) => a.id === state.animationUi.animationId) ?? animations[0];
    if (!animation) return null;
    const values = new Map<string, PreviewValues>();
    for (const { track, value } of sampleAnimation(animation, previewTime)) {
      const entry = values.get(track.nodeId) ?? {};
      if (track.property === "visible") entry.visible = value as boolean;
      else if (track.property === "position" || track.property === "rotation" || track.property === "scale") entry[track.property] = value as Vector3;
      values.set(track.nodeId, entry);
    }
    return values;
  }, [previewTime, state.sceneRoot, state.animationUi.playerId, state.animationUi.animationId]);
  const [containerRef, displaySize] = useContainedSize(DS_ASPECT);
  const dpr = DS_WIDTH / displaySize.width;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 bg-editor-bg p-4">
      <span className="text-center text-[10px] uppercase tracking-wide text-editor-text-muted">
        {activeScreen} screen · 3D engine · native {DS_WIDTH}×{DS_HEIGHT}
      </span>
      <div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div
          style={{ width: displaySize.width, height: displaySize.height }}
          className="relative overflow-hidden rounded border border-editor-border bg-black/80"
        >
          <Canvas
            dpr={dpr}
            gl={{ antialias: false }}
            camera={{ position: [4, 3, 6], fov: 50 }}
            onPointerMissed={() => {
              if (performance.now() - lastGizmoInteractionAt < GIZMO_CLICK_GRACE_MS) return;
              selectNode(state.sceneRoot.id);
            }}
            style={{ imageRendering: "pixelated" }}
          >
            <color attach="background" args={["#0a0a0b"]} />
            <ambientLight intensity={0.35} /> {/* for the gizmos only: meshes use the DS lighting */}
            <LightSync />
            <gridHelper args={[20, 20, EDITOR_ACCENT, EDITOR_BORDER]} />
            <axesHelper args={[2]} />
            <SceneNodeView
              importedMeshes={state.project?.meshes}
              importedTextures={state.project?.textures}
              node={shownRoot}
              activeScreen={activeScreen}
              selectedId={state.selectedNodeId}
              objects={nodeObjects.current}
              onSelect={(id) => {
                // A gizmo handle is under the pointer: this click manipulates it, not a reselection of whatever
                // mesh happens to be behind the handle (see activeGizmoControls above).
                if (activeGizmoControls?.axis != null) return;
                selectNode(id);
              }}
              preview={previewOverrides}
            />
            {gizmoTool && (
              <SelectionGizmo
                key={`${state.selectedNodeId}:${gizmoTool}`}
                nodeId={state.selectedNodeId}
                tool={gizmoTool}
                objects={nodeObjects.current}
                onTransform={setTransform3D}
                onGestureEnd={endEditGesture}
              />
            )}
            <OrbitControls makeDefault />
          </Canvas>
        </div>
      </div>
    </div>
  );
}
