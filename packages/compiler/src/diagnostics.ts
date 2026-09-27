/**
 * What the compiler has to say about a project, before any build starts. An **error** means no ROM
 * can be built; a **warning** means one can, with something left out. Each names the node it's about
 * so the user can find it. See requirements/compiler/STORY.compile-diagnostics-for-unsupported-content.md.
 */
export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticCode =
  | "not-a-3d-project"
  | "not-a-2d-project"
  | "missing-sprite"
  | "sprite-without-image"
  | "extra-scenes-not-built"
  | "scene-instance-missing"
  | "animation-frame-out-of-range"
  | "animated-sprite-without-animations"
  | "animated-mesh-without-frames"
  | "sprite-off-screen"
  | "label-off-screen"
  | "too-many-labels"
  | "too-many-sprites"
  | "too-many-sprite-palettes"
  | "too-many-rotating-sprites"
  | "sprite-memory"
  | "two-d-scripts-not-built"
  | "no-camera"
  | "multiple-cameras"
  | "too-many-lights"
  | "omni-light-skipped"
  | "over-triangle-budget"
  | "two-d-node-not-built"
  | "out-of-range"
  | "mesh-without-geometry"
  | "missing-model"
  | "missing-texture"
  | "texture-needs-uvs"
  | "texture-memory"
  | "missing-sound"
  | "player-without-sound"
  | "sound-not-started"
  | "sound-pitch-clamped"
  | "too-many-sounds"
  | "sound-memory"
  | "script-error"
  | "script-warning"
  | "missing-script"
  | "collision-shape-unused"
  | "collision-hull-needs-mesh"
  | "touch-area-unused"
  | "touch-area-not-touchable"
  | "player-without-animations"
  | "animation-not-started"
  | "animation-target-missing";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  /** The node it's about, when there is one. */
  nodeName?: string;
  /** In a project with several scenes, the scene the problem is in. */
  sceneName?: string;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/** One line per diagnostic, for the Output log and the command line. */
export function formatDiagnostic(d: Diagnostic): string {
  const where = `${d.sceneName ? ` [scene ${d.sceneName}]` : ""}${d.nodeName ? ` [${d.nodeName}]` : ""}`;
  return `${d.severity === "error" ? "Error" : "Warning"}${where}: ${d.message}`;
}
