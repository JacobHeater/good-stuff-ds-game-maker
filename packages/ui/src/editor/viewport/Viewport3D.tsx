import { DS_HARDWARE_PROFILE, flattenSceneTree, is3DNodeKind, type ScreenId, type SceneNode, type Vector3 } from "@goodstuff/core";
import { OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { DoubleSide } from "three";

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

function MeshInstanceNode({ node, selected, onSelect }: { node: SceneNode; selected: boolean; onSelect: () => void }): JSX.Element | null {
  if (!node.transform3D || !node.mesh || !node.visible) return null;
  const { position, scale } = node.transform3D;
  const rotation = toEuler(node.transform3D.rotation);
  const color = selected ? MESH_COLOR_SELECTED : MESH_COLOR;

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation();
    onSelect();
  };

  return (
    <group position={toTuple(position)} rotation={rotation} scale={toTuple(scale)}>
      {node.mesh.primitive === "cube" && (
        <mesh onPointerDown={handleClick}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      {node.mesh.primitive === "sphere" && (
        <mesh onPointerDown={handleClick}>
          <sphereGeometry args={[0.5, 24, 16]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      {node.mesh.primitive === "cylinder" && (
        <mesh onPointerDown={handleClick}>
          <cylinderGeometry args={[0.5, 0.5, 1, 16]} />
          <meshStandardMaterial color={color} />
        </mesh>
      )}
      {node.mesh.primitive === "plane" && (
        <mesh onPointerDown={handleClick} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1, 1]} />
          <meshStandardMaterial color={color} side={DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function CameraGizmo({ node, selected, onSelect }: { node: SceneNode; selected: boolean; onSelect: () => void }): JSX.Element | null {
  if (!node.transform3D || !node.visible) return null;
  const rotation = toEuler(node.transform3D.rotation);

  return (
    <group position={toTuple(node.transform3D.position)} rotation={rotation}>
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
    </group>
  );
}

function LightGizmo({ node, selected, onSelect }: { node: SceneNode; selected: boolean; onSelect: () => void }): JSX.Element | null {
  if (!node.transform3D || !node.visible) return null;
  const position = toTuple(node.transform3D.position);

  const handleSelect = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation();
    onSelect();
  };

  return (
    <group position={position}>
      <mesh onPointerDown={handleSelect}>
        <icosahedronGeometry args={[0.12, 0]} />
        <meshStandardMaterial color={selected ? EDITOR_ACCENT : "#f5d76e"} emissive="#f5d76e" emissiveIntensity={0.6} />
      </mesh>
      {node.kind === "DirectionalLight3D" && <directionalLight intensity={0.8} />}
      {node.kind === "OmniLight3D" && <pointLight intensity={1} distance={12} />}
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

  const nodes3D = useMemo(
    () =>
      flattenSceneTree(state.sceneRoot).filter(
        (node) => is3DNodeKind(node.kind) && node.screen === activeScreen && node.kind !== "Node3D"
      ),
    [state.sceneRoot, activeScreen]
  );

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
            {nodes3D.map((node) => {
              const selected = state.selectedNodeId === node.id;
              const onSelect = (): void => selectNode(node.id);
              if (node.kind === "MeshInstance3D") {
                return <MeshInstanceNode key={node.id} node={node} selected={selected} onSelect={onSelect} />;
              }
              if (node.kind === "Camera3D") {
                return <CameraGizmo key={node.id} node={node} selected={selected} onSelect={onSelect} />;
              }
              if (node.kind === "DirectionalLight3D" || node.kind === "OmniLight3D") {
                return <LightGizmo key={node.id} node={node} selected={selected} onSelect={onSelect} />;
              }
              return null;
            })}
            <OrbitControls makeDefault />
          </Canvas>
        </div>
      </div>
    </div>
  );
}
