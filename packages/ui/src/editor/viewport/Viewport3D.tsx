import {
  DS_HARDWARE_PROFILE,
  getPrimitiveGeometry,
  is3DNodeKind,
  type MeshPrimitive,
  type ScreenId,
  type SceneNode,
  type Vector3
} from "@goodstuff/core";
import { OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BufferGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, FrontSide } from "three";

import { useEditorStore } from "../state/editor-store";

const EDITOR_ACCENT = "#4fa8ff";
const EDITOR_BORDER = "#3a3d41";
const MESH_COLOR = "#8a8f96";
const MESH_COLOR_SELECTED = "#4fa8ff";

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
 * A mesh drawn from the shared primitive definition in `@goodstuff/core` — the same geometry the
 * hardware budget counts and the compiler emits, so what's drawn, counted and built can't disagree.
 */
function PrimitiveMesh({
  primitive,
  selected,
  onSelect
}: {
  primitive: MeshPrimitive;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const geometry = useMemo(() => {
    const shared = getPrimitiveGeometry(primitive);
    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new Float32BufferAttribute(shared.positions as number[], 3));
    buffer.setAttribute("normal", new Float32BufferAttribute(shared.normals as number[], 3));
    return buffer;
  }, [primitive]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh
      geometry={geometry}
      onPointerDown={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <meshStandardMaterial
        color={selected ? MESH_COLOR_SELECTED : MESH_COLOR}
        side={primitive === "plane" ? DoubleSide : FrontSide}
      />
    </mesh>
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

/**
 * A directional light that shines along its node's local -Z axis, as in Godot (and as the compiler
 * does), so rotating the node aims the light. three.js aims a directional light from its position toward
 * a `target` object, so the target sits one unit along the node's -Z, inside the same transformed group.
 * (requirements/scene-designer/BUG.directional-light-ignores-rotation.md)
 */
function DirectionalLightObject(): JSX.Element {
  const light = useMemo(() => new DirectionalLight(undefined, 0.8), []);
  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} position={[0, 0, -1]} />
    </>
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
      {node.kind === "DirectionalLight3D" && <DirectionalLightObject />}
      {node.kind === "OmniLight3D" && <pointLight intensity={1} distance={12} />}
    </>
  );
}

/**
 * Draws a node and, recursively, everything under it, as a hierarchy: a node's transform is relative
 * to its parent's, and a hidden node hides its whole subtree
 * (requirements/scene-designer/BUG.3d-viewport-ignores-parent-transforms.md). A node assigned to the
 * other screen isn't drawn itself, but its transform still applies to descendants that are.
 */
function SceneNodeView({
  node,
  activeScreen,
  selectedId,
  onSelect
}: {
  node: SceneNode;
  activeScreen: ScreenId;
  selectedId: string;
  onSelect: (id: string) => void;
}): JSX.Element | null {
  if (!node.visible) return null;

  const children = node.children.map((child) => (
    <SceneNodeView key={child.id} node={child} activeScreen={activeScreen} selectedId={selectedId} onSelect={onSelect} />
  ));
  if (!node.transform3D || !is3DNodeKind(node.kind)) return <>{children}</>;

  const selected = selectedId === node.id;
  const select = (): void => onSelect(node.id);
  const drawn = node.screen === activeScreen;
  // Only meshes and grouping nodes are sized by their scale; a camera or light gizmo stays gizmo-sized.
  const scaled = node.kind === "MeshInstance3D" || node.kind === "Node3D";

  return (
    <group
      position={toTuple(node.transform3D.position)}
      rotation={toEuler(node.transform3D.rotation)}
      scale={scaled ? toTuple(node.transform3D.scale) : [1, 1, 1]}
    >
      {drawn && node.kind === "MeshInstance3D" && node.mesh && (
        <PrimitiveMesh primitive={node.mesh.primitive} selected={selected} onSelect={select} />
      )}
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
  const { state, selectNode } = useEditorStore();
  const activeScreen: ScreenId = state.screenFilter === "both" ? "top" : state.screenFilter;
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
            onPointerMissed={() => selectNode(state.sceneRoot.id)}
            style={{ imageRendering: "pixelated" }}
          >
            <color attach="background" args={["#0a0a0b"]} />
            <ambientLight intensity={0.35} />
            <gridHelper args={[20, 20, EDITOR_ACCENT, EDITOR_BORDER]} />
            <axesHelper args={[2]} />
            <SceneNodeView
              node={state.sceneRoot}
              activeScreen={activeScreen}
              selectedId={state.selectedNodeId}
              onSelect={selectNode}
            />
            <OrbitControls makeDefault />
          </Canvas>
        </div>
      </div>
    </div>
  );
}
