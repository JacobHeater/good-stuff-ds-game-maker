import {
  DS_HARDWARE_PROFILE,
  getMeshDiffuseLevels,
  getMeshOpacity,
  findSceneNode,
  flattenSceneTree,
  getAnimationPlayer,
  getCollisionShape,
  getImportedMeshGeometry,
  getTouchArea3D,
  getLightIntensity,
  getTextureTexels,
  getTileMap3D,
  is3DNodeKind,
  lightLevelFromIntensity,
  listCells3D,
  resolveMeshGeometry,
  resolveMeshTexture,
  sampleAnimation,
  texelsToRgba,
  type ImportedMesh,
  type ImportedMeshSkin,
  type ImportedTexture,
  type MeshInstance3DData,
  type ScreenId,
  type SceneNode,
  type Vector3
} from "@goodstuff/core";
import { OrbitControls, TransformControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BackSide,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  NearestFilter,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  RGBAFormat,
  Vector2,
  type Group,
  type Intersection,
  type Object3D
} from "three";
import { SelectionBox } from "three-stdlib";

import { useEditorStore, type EditorTool, type TileMap3DBrush } from "../state/editor-store";
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

// ---- Small matrix math for `SmoothSkinnedMeshView`'s own per-frame skinning blend. Column-major 4x4 (element
// [column * 4 + row]), the same convention as `gltf-import.ts`'s own (and three.js's `Matrix4.elements`), so a bone
// `Object3D`'s live `matrixWorld.elements` can be used directly with no conversion.

function multiplyMat4(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function transformPoint4(m: readonly number[], p: readonly [number, number, number]): [number, number, number] {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

/** `m`'s own linear 3x3 part applied to `v`, with no translation added -- for a normal, which has no position. */
function transformDirection4(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
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
 * The DS-accurate material for a mesh instance, shared by every way of drawing one (the ordinary rigid `MeshView`
 * and the blended `SmoothSkinnedMeshView`): its texture (the DS's own blocky, tiling, ungamma'd picture), its cull
 * side, and its DS lighting (`ds-lighting-material.ts`, not three.js's own).
 */
function useDsMeshMaterial(mesh: MeshInstance3DData, importedTextures: readonly ImportedTexture[] | undefined, hasUvs: boolean, selected: boolean) {
  const stored = hasUvs ? resolveMeshTexture(mesh, importedTextures) : undefined;
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

  // Which side(s) are drawn follows the mesh's own cull setting (scene-designer/STORY.mesh-face-culling.md), the
  // same as the ROM: "none" (the default) draws both, matching the runtime's own default of culling off (forgiving
  // of a model whose winding wasn't checked on the way in).
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
  return material;
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
  const material = useDsMeshMaterial(mesh, importedTextures, shared?.uvs !== undefined, selected);
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

/**
 * The blended alternative to `MeshView`, for a `MeshInstance3DData.smoothSkinning` mesh whose underlying
 * `ImportedMesh.skin` has real multi-bone weight data (see `ImportedMeshSkin`'s own doc comment in
 * `imported-mesh.ts`, and `gltf-import.ts`'s matching comment on why rigid skinning alone can tear at a joint).
 *
 * Unlike `MeshView`, this is mounted at the *scene root*, not nested under the mesh's own bone's `<group>`: every
 * vertex's final position is recomputed in world space each frame (`useFrame`), blending the bones it's weighted to
 * by their own *live* `matrixWorld` (already kept current by three.js/R3F every frame, dynamic or not) -- the exact
 * same `Σ weight_i · jointWorld_i · inverseBindMatrices_i · storedPosition` formula `gltf-import.ts` derives and
 * tests, just evaluated continuously instead of once at import. This is an editor-preview convenience only: the
 * real DS ROM has its own, much cheaper runtime path, since a 67MHz ARM9 can't afford three.js's per-vertex JS math.
 */
function SmoothSkinnedMeshView({
  nodeId,
  meshData,
  importedMesh,
  importedTextures,
  objects,
  selected,
  onSelect
}: {
  nodeId: string;
  meshData: MeshInstance3DData;
  importedMesh: ImportedMesh & { skin: ImportedMeshSkin };
  importedTextures: readonly ImportedTexture[] | undefined;
  objects: NodeObjects;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  // Expanded once per triangle-vertex reference (not deduplicated), the same shared geometry `MeshView`'s rigid path
  // and the compiler both draw from, so the joint/weight data lines up 1:1 with the position/normal/uv attributes
  // the GPU actually draws and there's exactly one place that knows how to expand an `ImportedMesh`'s skin data.
  const expanded = useMemo(() => {
    const geometry = getImportedMeshGeometry(importedMesh);
    return {
      positions: geometry.positions,
      normals: geometry.normals,
      uvs: geometry.uvs,
      joints: geometry.skinJoints!,
      weights: geometry.skinWeights!,
      vertexCount: geometry.positions.length / 3
    };
  }, [importedMesh]);

  const geometry = useMemo(() => {
    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new Float32BufferAttribute(new Float32Array(expanded.positions), 3));
    buffer.setAttribute("normal", new Float32BufferAttribute(new Float32Array(expanded.normals), 3));
    if (expanded.uvs) buffer.setAttribute("uv", new Float32BufferAttribute(expanded.uvs, 2));
    return buffer;
  }, [expanded]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    // A skin's own jointNodeIds name bones by their original, un-instanced ids (they live on the shared
    // ImportedMesh, not the scene tree, so expandSceneInstances's own id-renaming pass -- which this mesh's own
    // `nodeId` already went through, same as every node inside a scene instance -- can't reach them). Falling back
    // to the instance's own prefix (this mesh's id up through its last "/", the same prefix every bone and mesh
    // inside that same instance boundary shares) finds the renamed bone instead of silently freezing the mesh at
    // its raw, un-posed local coordinates -- the same fix translate-scene-3d.ts's compiled path needed.
    const instancePrefix = nodeId.includes("/") ? nodeId.slice(0, nodeId.lastIndexOf("/") + 1) : "";
    const jointWorlds = importedMesh.skin.jointNodeIds.map((id) => (objects.get(id) ?? (instancePrefix ? objects.get(instancePrefix + id) : undefined))?.matrixWorld.elements);
    if (jointWorlds.some((m) => !m)) return; // a joint hasn't mounted yet (e.g. this frame of a just-opened scene)
    const position = geometry.attributes.position as Float32BufferAttribute;
    const normal = geometry.attributes.normal as Float32BufferAttribute;
    for (let v = 0; v < expanded.vertexCount; v++) {
      const p: [number, number, number] = [expanded.positions[v * 3], expanded.positions[v * 3 + 1], expanded.positions[v * 3 + 2]];
      const n: [number, number, number] = [expanded.normals[v * 3], expanded.normals[v * 3 + 1], expanded.normals[v * 3 + 2]];
      let [px, py, pz] = [0, 0, 0];
      let [nx, ny, nz] = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const w = expanded.weights[v * 4 + k];
        if (w <= 0) continue;
        const j = expanded.joints[v * 4 + k];
        const skinMatrix = multiplyMat4(jointWorlds[j]!, importedMesh.skin.inverseBindMatrices.slice(j * 16, j * 16 + 16));
        const [wx, wy, wz] = transformPoint4(skinMatrix, p);
        const [dx, dy, dz] = transformDirection4(skinMatrix, n);
        px += wx * w;
        py += wy * w;
        pz += wz * w;
        nx += dx * w;
        ny += dy * w;
        nz += dz * w;
      }
      position.setXYZ(v, px, py, pz);
      const len = Math.hypot(nx, ny, nz) || 1;
      normal.setXYZ(v, nx / len, ny / len, nz / len);
    }
    position.needsUpdate = true;
    normal.needsUpdate = true;
  });

  const material = useDsMeshMaterial(meshData, importedTextures, expanded.uvs !== undefined, selected);

  return (
    <mesh
      ref={(object: Object3D | null) => {
        // Unlike SceneNodeView's own group, this mesh isn't kept in `objects` by its own identity (it only reads
        // `objects` above, to look up its influencing bones) -- tagged directly so a box-select drag can still
        // resolve a hit on it back to this node; see BoxSelectController.
        if (object) object.userData.nodeId = nodeId;
      }}
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

/** How far the Paint tool's own ground-plane fallback reaches from a TileMap3D's own origin, in grid-local units
 * (STORY.tile-map-3d.md's Phase 4): generous enough to paint a good first stretch of a world without moving the
 * node, not an attempt at an unbounded plane. */
const TILE_MAP_3D_GROUND_SIZE = 64;
/** A picking proxy's own minimum size on any axis, in grid-local units: a vanishingly thin or flat palette mesh
 * (a single flat quad, say) still gets something clickable, rather than a sliver a ray almost never actually hits. */
const TILE_MAP_3D_PICKER_MIN_SIZE = 0.2;

/** The center and size of `positions`' own axis-aligned bounding box (flat x, y, z, x, y, z, ... triples, the shape
 * `resolveMeshGeometry` returns) -- a 1x1x1 box centered at the origin for an empty or missing mesh, so a dangling
 * palette entry still gets a sane, clickable picker instead of a degenerate one. */
function boundsOf(positions: readonly number[] | undefined): { center: [number, number, number]; size: [number, number, number] } {
  if (!positions || positions.length === 0) return { center: [0, 0, 0], size: [1, 1, 1] };
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    size: [Math.max(maxX - minX, TILE_MAP_3D_PICKER_MIN_SIZE), Math.max(maxY - minY, TILE_MAP_3D_PICKER_MIN_SIZE), Math.max(maxZ - minZ, TILE_MAP_3D_PICKER_MIN_SIZE)]
  };
}

/**
 * A TileMap3D's painted cells (STORY.tile-map-3d.md), drawn the same way the compiler and the runtime do: each
 * cell's own palette entry resolves through exactly the same mesh/texture pipeline a plain MeshInstance3D already
 * goes through (`MeshView`, reused directly via a synthetic `MeshInstance3DData` -- the same trick
 * `translate-tile-map-3d.ts` plays on the compiler side), translated to the cell's own integer grid position and
 * turned by its yaw -- a cell's mesh-local origin sits exactly at its own (x, y, z), matching `main.c`'s own
 * `tm3d_draw_node`, so an editor preview and the ROM place a tile identically.
 *
 * While the Paint tool has this node selected (`paintActive`), it also carries two kinds of invisible-but-
 * raycastable pickers `TileMap3DPaintController` reads by `userData`, mounted as real scene-graph children of this
 * node's own already-transformed group (so no manual world/local conversion is needed beyond `Object3D.worldToLocal`
 * on a hit point): one box per painted cell, sized and centered to the palette entry's own actual geometry (`boundsOf`)
 * rather than a fixed unit cube -- a palette tile is rarely modeled as an exact 1x1x1 box, and a picker smaller than
 * what's actually drawn there would miss most clicks on the mesh's own visible surface, always falling through to
 * whatever is behind it (click a face to place the brush beside it; Shift+click to erase that cell) -- and one
 * large, faint plane at the grid's own y = 0, the fallback for painting into empty space, the same convention
 * Godot's GridMap editor uses.
 */
function TileMap3DView({
  node,
  importedMeshes,
  importedTextures,
  paintActive
}: {
  node: SceneNode;
  importedMeshes: readonly ImportedMesh[] | undefined;
  importedTextures: readonly ImportedTexture[] | undefined;
  paintActive: boolean;
}): JSX.Element {
  const data = getTileMap3D(node);
  const cells = useMemo(() => listCells3D(data), [data]);
  const paletteById = useMemo(() => new Map(data.palette.map((entry) => [entry.id, entry])), [data.palette]);

  return (
    <>
      {cells.map(({ x, y, z, cell }) => {
        const entry = paletteById.get(cell.paletteId);
        if (!entry) return null; // a dangling reference (the schema validator normally catches this) -- draw nothing rather than crash
        const mesh: MeshInstance3DData = { importedMeshId: entry.importedMeshId, textureId: entry.textureId, color: entry.color, triangleCount: 0 };
        const picker = paintActive ? boundsOf(resolveMeshGeometry(mesh, importedMeshes)?.positions as number[] | undefined) : null;
        return (
          <group key={`${x},${y},${z}`} position={[x, y, z]} rotation={[0, cell.rotationY * 90 * DEG_TO_RAD, 0]}>
            <MeshView mesh={mesh} importedMeshes={importedMeshes} importedTextures={importedTextures} selected={false} onSelect={() => {}} />
            {picker && (
              // onPointerDown here does nothing of its own -- TileMap3DPaintController reads this click from its
              // own native listener, not R3F's synthetic one -- except stop it reaching Canvas's own onPointerMissed:
              // without this, R3F sees no registered handler fire for the click (this mesh has none otherwise) and
              // treats it as a miss, deselecting the TileMap3D right after the very first paint and leaving no
              // selected node for the *next* click's own paintNode lookup to find.
              <mesh
                userData={{ tileMap3DNodeId: node.id, cell: { x, y, z } }}
                position={picker.center}
                onPointerDown={(event: ThreeEvent<MouseEvent>) => event.stopPropagation()}
              >
                <boxGeometry args={picker.size} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            )}
          </group>
        );
      })}
      {paintActive && (
        <mesh
          userData={{ tileMap3DNodeId: node.id, groundPlane: true }}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerDown={(event: ThreeEvent<MouseEvent>) => event.stopPropagation()}
        >
          <planeGeometry args={[TILE_MAP_3D_GROUND_SIZE, TILE_MAP_3D_GROUND_SIZE]} />
          <meshBasicMaterial color={EDITOR_ACCENT} transparent opacity={0.05} depthWrite={false} side={DoubleSide} />
        </mesh>
      )}
    </>
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

/** Grid-aligned (Ctrl/Cmd held) and fine (Shift held) snap increments for the gizmo -- see `useGizmoSnapModifiers`. */
const POSITION_SNAP_COARSE = 1; // one grid cell (`gridHelper` below is 20 units across 20 divisions)
const POSITION_SNAP_FINE = 0.1;
const ROTATION_SNAP_COARSE = 15 * DEG_TO_RAD;
const ROTATION_SNAP_FINE = 5 * DEG_TO_RAD;
const SCALE_SNAP_COARSE = 0.25;
const SCALE_SNAP_FINE = 0.05;

/**
 * Whether Ctrl/Cmd or Shift is currently held, for the gizmo's snap-to-grid modifiers: Ctrl/Cmd snaps to a coarse
 * grid, Shift to a finer one (holding both snaps to the finer one, since that's the more precise result). Tracked
 * at the window level, rather than read off a pointer event, because `TransformControls`' own `onObjectChange`
 * callback (`write`, below) fires with no event to read modifier keys from.
 */
function useGizmoSnapModifiers(): { coarse: boolean; fine: boolean } {
  const [modifiers, setModifiers] = useState({ coarse: false, fine: false });
  useEffect(() => {
    const update = (event: KeyboardEvent): void => setModifiers({ coarse: event.ctrlKey || event.metaKey, fine: event.shiftKey });
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
    };
  }, []);
  return modifiers;
}

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
  tool: Exclude<EditorTool, "select" | "paint3d">;
  objects: NodeObjects;
  onTransform: (id: string, field: "position" | "rotation" | "scale", value: Vector3) => void;
  /** The handle was released: whatever is dragged next is a new undo step. */
  onGestureEnd: () => void;
}): JSX.Element | null {
  const [target, setTarget] = useState<Object3D | null>(null);
  const { coarse, fine } = useGizmoSnapModifiers();
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
      translationSnap={fine ? POSITION_SNAP_FINE : coarse ? POSITION_SNAP_COARSE : null}
      rotationSnap={fine ? ROTATION_SNAP_FINE : coarse ? ROTATION_SNAP_COARSE : null}
      scaleSnap={fine ? SCALE_SNAP_FINE : coarse ? SCALE_SNAP_COARSE : null}
      onObjectChange={write}
      onMouseDown={() => (lastGizmoInteractionAt = performance.now())}
      onMouseUp={() => {
        lastGizmoInteractionAt = performance.now();
        onGestureEnd();
      }}
    />
  );
}

/** A mesh instance that should be drawn by `SmoothSkinnedMeshView` (at the scene root) instead of `MeshView` (nested rigidly under its bone). */
function isSmoothSkinned(mesh: MeshInstance3DData, importedMeshes: readonly ImportedMesh[] | undefined): boolean {
  return mesh.smoothSkinning === true && importedMeshes?.find((m) => m.id === mesh.importedMeshId)?.skin !== undefined;
}

/**
 * Walks the tree for every `isSmoothSkinned` mesh that would actually be drawn (same visibility/screen rules
 * `SceneNodeView` applies, since a hidden ancestor hides this too), for the top-level `SmoothSkinnedMeshView`s --
 * see that component's own doc comment for why it can't just be nested where `SceneNodeView` found it.
 */
function collectSmoothSkinnedMeshes(
  node: SceneNode,
  activeScreen: ScreenId,
  importedMeshes: readonly ImportedMesh[] | undefined,
  preview: PreviewOverrides | null,
  visible: boolean,
  out: Array<{ node: SceneNode; importedMesh: ImportedMesh & { skin: ImportedMeshSkin } }>
): void {
  const shown = preview?.get(node.id);
  const nodeVisible = visible && (shown?.visible ?? node.visible);
  if (!nodeVisible) return;
  if (node.kind === "MeshInstance3D" && node.mesh && node.screen === activeScreen && isSmoothSkinned(node.mesh, importedMeshes)) {
    out.push({ node, importedMesh: importedMeshes!.find((m) => m.id === node.mesh!.importedMeshId)! as ImportedMesh & { skin: ImportedMeshSkin } });
  }
  for (const child of node.children) collectSmoothSkinnedMeshes(child, activeScreen, importedMeshes, preview, nodeVisible, out);
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
  activeTool,
  objects,
  onSelect,
  preview
}: {
  importedMeshes: readonly ImportedMesh[] | undefined;
  importedTextures: readonly ImportedTexture[] | undefined;
  node: SceneNode;
  activeScreen: ScreenId;
  selectedId: string;
  /** Just enough to know whether the Paint tool's own ground plane / cell pickers should be in the scene for a
   * selected TileMap3D (TileMap3DView) -- not threaded further than that, everything else about the gizmo tools
   * is handled above this tree, in Viewport3D itself. */
  activeTool: EditorTool;
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
      activeTool={activeTool}
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
  const scaled = node.kind === "MeshInstance3D" || node.kind === "Node3D" || node.kind === "CollisionShape3D" || node.kind === "TouchArea3D" || node.kind === "TileMap3D";

  return (
    <group
      ref={(object: Object3D | null) => {
        // Tagged with its own node id (not just kept in `objects`, which is keyed the other way round) so a
        // box-select drag can resolve a raw hit three.js object back to the node it belongs to; see BoxSelectController.
        if (object) {
          objects.set(node.id, object);
          object.userData.nodeId = node.id;
        } else objects.delete(node.id);
      }}
      position={toTuple(shown?.position ?? node.transform3D.position)}
      rotation={toEuler(shown?.rotation ?? node.transform3D.rotation)}
      scale={scaled ? toTuple(shown?.scale ?? node.transform3D.scale) : [1, 1, 1]}
    >
      {drawn && node.kind === "MeshInstance3D" && node.mesh && !isSmoothSkinned(node.mesh, importedMeshes) && (
        <MeshView mesh={node.mesh} importedMeshes={importedMeshes} importedTextures={importedTextures} selected={selected} onSelect={select} />
      )}
      {drawn && node.kind === "TileMap3D" && (
        <TileMap3DView
          node={node}
          importedMeshes={importedMeshes}
          importedTextures={importedTextures}
          paintActive={selected && activeTool === "paint3d"}
        />
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

/** Screen pixels a pointer must travel before a press-and-release counts as a drag rather than a click. */
const BOX_SELECT_DRAG_THRESHOLD = 6;

/**
 * Click-drag a rectangle over the viewport, the Select tool only, and only while the B-toggled box-select mode
 * (`EditorState.boxSelectActive`) is on -- Blender's Select Box tool / Godot's editor: selects every node the box
 * swept over. `OrbitControls` owns plain left-drag everywhere else (camera rotate), so this only engages while
 * `activeTool === "select"` AND `boxSelectActive`, disabling orbit for exactly the drag's own duration and
 * restoring it on release; every other tool is untouched, and orbit still works there exactly as it does today --
 * including on the Select tool itself when box-select mode is off, which is the whole point of gating this on the
 * toggle rather than on the tool alone.
 *
 * Listens on the canvas's own native pointer events, not R3F's per-object synthetic ones: this must fire starting
 * from empty space too, where no object's own `onPointerDown` runs, the same reason `onPointerMissed` exists for
 * the plain-click case below. Reuses `three-stdlib`'s `SelectionBox` (the same primitive `@react-three/drei`'s own
 * `<Select box multiple>` is built on; its own source is what this technique -- toggling `controls.enabled`,
 * NDC-space start/end points, a `position: fixed` DOM overlay instead of a React-rendered one -- is drawn from) for
 * the actual frustum-intersection test, rather than hand-rolling per-object screen-space projection.
 */
function BoxSelectController({
  activeTool,
  boxSelectActive,
  selectableIds,
  selectNodes
}: {
  activeTool: EditorTool;
  boxSelectActive: boolean;
  /** Every node id a box-select may legally land on: the active screen's own drawn, selectable nodes. Everything
   * else (the other screen's nodes, `gridHelper`/`axesHelper`, gizmo handles) never carries `userData.nodeId` at
   * all, so it's filtered out by the hit-resolution walk below regardless, but checking against this set too keeps
   * that walk from trusting a stale tag left on an object that `SceneNodeView` has since stopped drawing. */
  selectableIds: ReadonlySet<string>;
  selectNodes: (ids: string[]) => void;
}): null {
  const { camera, scene, gl, controls } = useThree();

  useEffect(() => {
    if (activeTool !== "select" || !boxSelectActive) return;
    const element = gl.domElement;
    const orbit = controls as { enabled: boolean } | null;
    let overlay: HTMLDivElement | null = null;
    let start: { x: number; y: number } | null = null;
    let dragging = false;

    const ndc = (clientX: number, clientY: number): [number, number] => {
      const rect = element.getBoundingClientRect();
      return [((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1];
    };

    const cleanupOverlay = (): void => {
      overlay?.remove();
      overlay = null;
    };

    function onPointerDown(event: PointerEvent): void {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      dragging = false;
      if (orbit) orbit.enabled = false;
    }

    function onPointerMove(event: PointerEvent): void {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < BOX_SELECT_DRAG_THRESHOLD) return;
        dragging = true;
        overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.border = `1px solid ${EDITOR_ACCENT}`;
        overlay.style.backgroundColor = "rgba(79, 168, 255, 0.15)";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "9999";
        document.body.appendChild(overlay);
      }
      const o = overlay!;
      o.style.left = `${Math.min(start.x, event.clientX)}px`;
      o.style.top = `${Math.min(start.y, event.clientY)}px`;
      o.style.width = `${Math.abs(dx)}px`;
      o.style.height = `${Math.abs(dy)}px`;
    }

    function onPointerUp(event: PointerEvent): void {
      if (!start) return;
      const wasDragging = dragging;
      const dragStart = start;
      start = null;
      dragging = false;
      cleanupOverlay();
      if (orbit) orbit.enabled = true;
      if (!wasDragging) return; // a plain click: today's existing onSelect/onPointerMissed handling is untouched

      const selBox = new SelectionBox(camera, scene);
      const [sx, sy] = ndc(dragStart.x, dragStart.y);
      const [ex, ey] = ndc(event.clientX, event.clientY);
      selBox.startPoint.set(sx, sy, 0);
      selBox.endPoint.set(ex, ey, 0);
      const ids = new Set<string>();
      for (const hit of selBox.select()) {
        let current: Object3D | null = hit;
        while (current) {
          const id = current.userData.nodeId as string | undefined;
          if (id !== undefined) {
            if (selectableIds.has(id)) ids.add(id);
            break;
          }
          current = current.parent;
        }
      }
      // Deferred a tick: guarantees this box-select result is what's left standing even if the native pointerup
      // above also satisfies R3F's own click/onPointerMissed handling and briefly reselects the scene root.
      const result = [...ids];
      setTimeout(() => selectNodes(result), 0);
    }

    element.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      cleanupOverlay();
      if (orbit) orbit.enabled = true;
    };
  }, [activeTool, boxSelectActive, camera, scene, gl, controls, selectableIds, selectNodes]);

  return null;
}

/**
 * Click-to-paint/erase in the 3D viewport, the Paint tool only, and only while a TileMap3D is selected
 * (STORY.tile-map-3d.md's Phase 4). Listens on the canvas's own native pointer events rather than R3F's per-object
 * synthetic ones, for the exact reason `BoxSelectController` does (its own doc comment): the pickers a click may
 * land on (`TileMap3DView`'s own invisible cell cubes and ground plane) are plain `userData`-tagged meshes with no
 * `onPointerDown` of their own, and `OrbitControls` still needs to own every other drag everywhere else. The same
 * drag-vs-click threshold applies: only a press-and-release that never moved far enough to count as orbiting paints
 * or erases anything.
 *
 * Clicking an existing cell's own face places the brush *beside* it (nudging the hit point half a grid-local unit
 * along the face's own world normal, converted back to this node's local space, then rounding to the nearest
 * integer cell -- robust to the node's own rotation and scale, since the nudge happens in local space before either
 * applies); Shift+click erases that exact cell instead. Clicking the ground-plane fallback (nothing painted there
 * yet) places the brush at that local (x, z), always at y = 0, the same convention Godot's GridMap editor uses.
 */
function TileMap3DPaintController({
  activeTool,
  node,
  objects,
  brush,
  onPaint,
  onErase
}: {
  activeTool: EditorTool;
  /** The selected TileMap3D, when one is (null: the Paint tool has nothing to do). */
  node: SceneNode | null;
  objects: NodeObjects;
  brush: TileMap3DBrush;
  onPaint: (id: string, x: number, y: number, z: number, paletteId: string, rotationY: 0 | 1 | 2 | 3) => void;
  onErase: (id: string, x: number, y: number, z: number) => void;
}): null {
  const { camera, scene, gl, controls } = useThree();

  useEffect(() => {
    if (activeTool !== "paint3d" || !node) return undefined;
    const nodeId = node.id;
    const element = gl.domElement;
    const orbit = controls as { enabled: boolean } | null;
    let start: { x: number; y: number; shiftKey: boolean } | null = null;
    let dragging = false;

    function pick(clientX: number, clientY: number): Intersection | null {
      const pickable: Object3D[] = [];
      scene.traverse((object) => {
        if ((object.userData as { tileMap3DNodeId?: string }).tileMap3DNodeId === nodeId) pickable.push(object);
      });
      if (pickable.length === 0) return null;
      const rect = element.getBoundingClientRect();
      const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new Raycaster();
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObjects(pickable, false)[0] ?? null;
    }

    function onPointerDown(event: PointerEvent): void {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey };
      dragging = false;
      if (orbit) orbit.enabled = false;
    }

    function onPointerMove(event: PointerEvent): void {
      if (!start || dragging) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= BOX_SELECT_DRAG_THRESHOLD) dragging = true;
    }

    function onPointerUp(event: PointerEvent): void {
      if (!start) return;
      const wasDragging = dragging;
      const press = start;
      start = null;
      dragging = false;
      if (orbit) orbit.enabled = true;
      if (wasDragging) return; // an orbit drag, not a click: BoxSelectController's own onSelect/onPointerMissed handling (and nothing here) applies

      const hit = pick(event.clientX, event.clientY);
      const gridObject = hit && objects.get(nodeId);
      if (!hit || !gridObject) return;
      const tag = hit.object.userData as { cell?: { x: number; y: number; z: number }; groundPlane?: boolean };

      if (tag.cell) {
        if (press.shiftKey) {
          onErase(nodeId, tag.cell.x, tag.cell.y, tag.cell.z);
          return;
        }
        if (!brush.paletteId || !hit.face) return;
        const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        const localNormal = worldNormal.applyQuaternion(gridObject.getWorldQuaternion(new Quaternion()).invert());
        const localPoint = gridObject.worldToLocal(hit.point.clone()).addScaledVector(localNormal, 0.5);
        onPaint(nodeId, Math.round(localPoint.x), Math.round(localPoint.y), Math.round(localPoint.z), brush.paletteId, brush.rotationY);
        return;
      }

      if (tag.groundPlane && brush.paletteId) {
        const localPoint = gridObject.worldToLocal(hit.point.clone());
        onPaint(nodeId, Math.round(localPoint.x), 0, Math.round(localPoint.z), brush.paletteId, brush.rotationY);
      }
    }

    element.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (orbit) orbit.enabled = true;
    };
  }, [activeTool, node, objects, brush, onPaint, onErase, camera, scene, gl, controls]);

  return null;
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
  const { state, selectNode, selectNodes, setTransform3D, endEditGesture, paintTile3D, eraseTile3D } = useEditorStore();
  const activeScreen: ScreenId = state.screenFilter === "both" ? "top" : state.screenFilter;
  const nodeObjects = useRef<NodeObjects>(new Map());
  // Every id a box-select drag may land on: the active screen's own drawn 3D nodes (what SceneNodeView actually
  // tags with `userData.nodeId`; see BoxSelectController).
  const boxSelectableIds = useMemo(
    () => new Set(flattenSceneTree(shownRoot).filter((n) => n.screen === activeScreen && is3DNodeKind(n.kind) && n.transform3D).map((n) => n.id)),
    [shownRoot, activeScreen]
  );
  const selected = findSceneNode(state.sceneRoot, state.selectedNodeId);
  // A gizmo needs something to manipulate: a drawn, non-root 3D node; and a camera or light is never scaled. Paint
  // isn't a gizmo tool at all (TileMap3DPaintController, not TransformControls, owns the viewport while it's active).
  const gizmoTool =
    state.activeTool !== "select" &&
    state.activeTool !== "paint3d" &&
    selected &&
    selected.id !== state.sceneRoot.id &&
    selected.screen === activeScreen &&
    is3DNodeKind(selected.kind) &&
    (state.activeTool !== "scale" || selected.kind === "MeshInstance3D" || selected.kind === "Node3D" || selected.kind === "CollisionShape3D" || selected.kind === "TouchArea3D")
      ? state.activeTool
      : null;
  // The Paint tool's own target: the selected node, only when it's actually a drawn TileMap3D.
  const paintNode = state.activeTool === "paint3d" && selected?.kind === "TileMap3D" && selected.screen === activeScreen ? selected : null;
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
  const smoothSkinnedMeshes = useMemo(() => {
    const out: Array<{ node: SceneNode; importedMesh: ImportedMesh & { skin: ImportedMeshSkin } }> = [];
    collectSmoothSkinnedMeshes(shownRoot, activeScreen, state.project?.meshes, previewOverrides, true, out);
    return out;
  }, [shownRoot, activeScreen, state.project?.meshes, previewOverrides]);
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
              activeTool={state.activeTool}
              objects={nodeObjects.current}
              onSelect={(id) => {
                // A gizmo handle is under the pointer: this click manipulates it, not a reselection of whatever
                // mesh happens to be behind the handle (see activeGizmoControls above).
                if (activeGizmoControls?.axis != null) return;
                selectNode(id);
              }}
              preview={previewOverrides}
            />
            {smoothSkinnedMeshes.map(({ node, importedMesh }) => (
              <SmoothSkinnedMeshView
                key={node.id}
                nodeId={node.id}
                meshData={node.mesh!}
                importedMesh={importedMesh}
                importedTextures={state.project?.textures}
                objects={nodeObjects.current}
                selected={state.selectedNodeId === node.id}
                onSelect={() => {
                  if (activeGizmoControls?.axis != null) return;
                  selectNode(node.id);
                }}
              />
            ))}
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
            <BoxSelectController
              activeTool={state.activeTool}
              boxSelectActive={state.boxSelectActive}
              selectableIds={boxSelectableIds}
              selectNodes={selectNodes}
            />
            <TileMap3DPaintController
              activeTool={state.activeTool}
              node={paintNode}
              objects={nodeObjects.current}
              brush={state.tileMap3DBrush}
              onPaint={paintTile3D}
              onErase={eraseTile3D}
            />
          </Canvas>
        </div>
      </div>
    </div>
  );
}
