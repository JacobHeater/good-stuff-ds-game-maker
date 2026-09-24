import {
  DS_HARDWARE_PROFILE,
  getPrimitiveGeometry,
  type FpsTarget,
  type MeshPrimitive,
  type ProjectSnapshot,
  type SceneNode,
  type ScreenId
} from "@goodstuff/core";

import type { Diagnostic } from "./diagnostics";
import { hasErrors } from "./diagnostics";
import type { DsCamera, DsLight, DsMesh, DsPrimitive, DsScene3D } from "./ds-scene";
import { FixedPointRangeError, packNormal, rgb15, toF32, toV10, toV16 } from "./fixed-point";
import { axisDirection, composeTransform, IDENTITY, invertAffine, multiply, withoutScale, type Mat4 } from "./matrix";

/** The DS's geometry engine has four hardware lights. */
export const MAX_DS_LIGHTS = 4;

/**
 * Values used where the scene model doesn't say. Until cameras, lights and meshes have properties
 * (requirements/scene-designer/STORY.camera-light-and-material-properties.md) every scene gets these.
 * The field of view matches the editor viewport's orbit camera.
 */
export const DEFAULTS = {
  fovDegrees: 50,
  nearPlane: 0.1,
  farPlane: 100,
  meshDiffuse: rgb15(24, 24, 24),
  lightColor: rgb15(31, 31, 31)
} as const;

export interface TranslateOptions {
  /**
   * The presentation rate. Not part of a saved project today (the FPS target is editor state), so the
   * caller supplies it; defaults to the DS profile's default.
   */
  fpsTarget?: FpsTarget;
}

export interface TranslateResult {
  /** Null exactly when `diagnostics` contains an error. */
  scene: DsScene3D | null;
  diagnostics: Diagnostic[];
}

interface Collected {
  node: SceneNode;
  world: Mat4;
}

/**
 * Translates a saved 3D project into the description the DS runtime draws. Pure: no files, no
 * toolchain. Walks the tree as a hierarchy (a node's transform is relative to its parent's, and a
 * hidden node hides its whole subtree), bakes each drawn node's world transform, and reports
 * anything that can't be represented instead of dropping it silently.
 */
export function translateScene3D(project: ProjectSnapshot, options: TranslateOptions = {}): TranslateResult {
  const diagnostics: Diagnostic[] = [];

  if (project.mode !== "3D") {
    diagnostics.push({
      severity: "error",
      code: "not-a-3d-project",
      message: "Only 3D projects can be compiled so far; 2D compilation isn't supported yet."
    });
    return { scene: null, diagnostics };
  }

  const meshes: Collected[] = [];
  const cameras: Collected[] = [];
  const directionalLights: Collected[] = [];

  const visit = (node: SceneNode, parentWorld: Mat4): void => {
    if (!node.visible) return;
    const local = node.transform3D
      ? composeTransform(node.transform3D.position, node.transform3D.rotation, node.transform3D.scale)
      : IDENTITY;
    const world = multiply(parentWorld, local);

    switch (node.kind) {
      case "MeshInstance3D":
        meshes.push({ node, world });
        break;
      case "Camera3D":
        cameras.push({ node, world });
        break;
      case "DirectionalLight3D":
        directionalLights.push({ node, world });
        break;
      case "OmniLight3D":
        diagnostics.push({
          severity: "warning",
          code: "omni-light-skipped",
          nodeName: node.name,
          message: "The DS has no positional lights, so this light was left out."
        });
        break;
      default:
        break; // Node3D groups; CollisionShape3D and AudioStreamPlayer draw nothing and are ignored by design.
    }
    for (const child of node.children) visit(child, world);
  };
  visit(project.scene, IDENTITY);

  // Meshes that can't be drawn.
  const drawableMeshes = meshes.filter(({ node }) => {
    if (node.mesh) return true;
    diagnostics.push({
      severity: "warning",
      code: "mesh-without-geometry",
      nodeName: node.name,
      message: "This mesh has no geometry, so it was left out."
    });
    return false;
  });

  // Camera.
  if (cameras.length === 0) {
    diagnostics.push({ severity: "error", code: "no-camera", message: "The scene needs a Camera3D." });
  } else if (cameras.length > 1) {
    diagnostics.push({
      severity: "warning",
      code: "multiple-cameras",
      nodeName: cameras[0].node.name,
      message: `The scene has ${cameras.length} cameras; the first one in the tree is used.`
    });
  }

  // Lights.
  if (directionalLights.length > MAX_DS_LIGHTS) {
    diagnostics.push({
      severity: "error",
      code: "too-many-lights",
      message: `The DS supports ${MAX_DS_LIGHTS} lights and the scene has ${directionalLights.length}.`
    });
  }

  // Triangle budget, from the same geometry that is emitted.
  const triangles = drawableMeshes.reduce((sum, { node }) => sum + getPrimitiveGeometry(node.mesh!.primitive).triangleCount, 0);
  const limit = DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame;
  if (triangles > limit) {
    diagnostics.push({
      severity: "error",
      code: "over-triangle-budget",
      message: `The scene has ${triangles} triangles and the DS can draw about ${limit} per frame.`
    });
  }

  // The DS drives 3D output to one screen only.
  const drawn = [...drawableMeshes, ...cameras.slice(0, 1), ...directionalLights];
  const screens = new Set<ScreenId>(drawn.map(({ node }) => node.screen));
  if (screens.size > 1) {
    diagnostics.push({
      severity: "error",
      code: "mixed-screens",
      message: "3D nodes are assigned to both screens, but the DS can only draw 3D on one."
    });
  }

  if (hasErrors(diagnostics)) return { scene: null, diagnostics };

  // Build the DS-format description. Any value that doesn't fit becomes a diagnostic naming its node.
  const guard = <T>(node: SceneNode, build: () => T): T | null => {
    try {
      return build();
    } catch (error) {
      if (!(error instanceof FixedPointRangeError)) throw error;
      diagnostics.push({
        severity: "error",
        code: "out-of-range",
        nodeName: node.name,
        message: `A value (${error.value}) doesn't fit the DS's ${error.format} number format; move or scale it closer to the origin.`
      });
      return null;
    }
  };
  const matrixF32 = (m: Mat4): number[] => m.map(toF32);

  const primitives: DsPrimitive[] = [];
  const primitiveIndex = new Map<MeshPrimitive, number>();
  const indexOfPrimitive = (primitive: MeshPrimitive): number => {
    const existing = primitiveIndex.get(primitive);
    if (existing !== undefined) return existing;
    const geometry = getPrimitiveGeometry(primitive);
    const normals: number[] = [];
    for (let i = 0; i < geometry.normals.length; i += 3) {
      normals.push(packNormal(geometry.normals[i], geometry.normals[i + 1], geometry.normals[i + 2]));
    }
    primitives.push({
      primitive,
      triangleCount: geometry.triangleCount,
      positions: geometry.positions.map(toV16),
      normals
    });
    primitiveIndex.set(primitive, primitives.length - 1);
    return primitives.length - 1;
  };

  const dsMeshes: DsMesh[] = [];
  for (const { node, world } of drawableMeshes) {
    const built = guard(node, () => ({
      primitive: indexOfPrimitive(node.mesh!.primitive),
      diffuse: DEFAULTS.meshDiffuse,
      world: matrixF32(world)
    }));
    if (built) dsMeshes.push(built);
  }

  const dsLights: DsLight[] = [];
  for (const { world } of directionalLights) {
    // A directional light shines along its local -Z axis, as in Godot.
    const [x, y, z] = axisDirection(world, "z");
    dsLights.push({ color: DEFAULTS.lightColor, direction: [toV10(-x), toV10(-y), toV10(-z)] });
  }

  let dsCamera: DsCamera | null = null;
  const cameraEntry = cameras[0];
  dsCamera = guard(cameraEntry.node, () => ({
    fovDegrees: DEFAULTS.fovDegrees,
    nearPlane: DEFAULTS.nearPlane,
    farPlane: DEFAULTS.farPlane,
    view: matrixF32(invertAffine(withoutScale(cameraEntry.world)))
  }));

  if (hasErrors(diagnostics) || !dsCamera) return { scene: null, diagnostics };

  return {
    scene: {
      screen: cameraEntry.node.screen,
      fps: options.fpsTarget ?? DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget,
      camera: dsCamera,
      lights: dsLights,
      meshes: dsMeshes,
      primitives
    },
    diagnostics
  };
}
