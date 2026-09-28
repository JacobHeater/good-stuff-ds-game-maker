---
status: done
component: scene-designer
related: [STORY.camera-light-and-material-properties.md, STORY.multiple-scenes.md]
---

# Story: Marking a scene's current camera

## Context
Owner request: "the Camera3D needs a current_camera option that is a toggle." A scene could already have several `Camera3D` nodes, but there was no way to say which one the game actually uses -- the compiler silently
picked "the first Camera3D in the tree," and adding a second camera anywhere only produced a warning naming that same first one. This carves out just that one piece of the larger, still-`proposed`
`STORY.camera-light-and-material-properties.md` (field of view, near/far planes, and a "view through the camera" viewport mode are not built here).

## Decisions (owner delegated; say if any is wrong)
- A `Camera3D` has an optional **`current`** (`node.camera?.current`, boolean, absent = false = not explicitly marked). A project where nothing is ever marked behaves exactly as before: the first `Camera3D` in
  tree order is used (`isCurrentCamera` in core's `scene-node.ts` encodes this fallback, so old projects need no migration).
- Compile-time only, not script-settable: this is an Inspector/editor-time choice of which camera the ROM is built to look through, like picking the start scene. A script switching cameras mid-game (a cutscene
  camera) is a materially different, bigger feature (the runtime would need a mutable "active camera" instead of `gs_scene.cameraNode`'s current compile-time constant) and is out of scope here.
  `STORY.camera-light-and-material-properties.md` reads the same way ("a scene has exactly one" active camera, chosen in the Inspector).
  - Inspector: a checkbox, "Current camera," next to the light intensity slider (only shown for a `Camera3D`). Checking it makes that camera current and unmarks whichever other `Camera3D` in the *same* scene had
  it (cameras in other scenes are untouched -- each scene resolves its own camera independently, same as today). Unchecking it clears its own mark and falls back to the tree-order default; it's a no-op if it was
  only ever current by that fallback (nothing to clear) -- there's no "make some other unspecified camera current instead" implied by an uncheck.

## Description
- Core: `CameraData { current?: boolean }`, `SceneNode.camera?: CameraData`, `isCurrentCamera(node, camerasInScene)` (`scene-node.ts`) -- the one place the "explicit, else first-in-tree" rule lives, reused by both
  the Inspector's checkbox state and the compiler's selection.
- Schema: `cameraData` definition + `camera` on `sceneNode` (`project-snapshot.schema.ts`).
- Compiler (`translate-scene-3d.ts`): the camera actually baked into the ROM is `cameras.find(c => c.node.camera?.current === true) ?? cameras.find(c => effectivelyVisible) ?? cameras[0]` -- an explicit mark wins
  outright; without one, today's exact fallback (first effectively-visible, else first in tree) is unchanged. The `multiple-cameras` warning now only fires when *none* is marked current (there's no real ambiguity
  once the owner has picked one).
- UI: a checkbox in `InspectorPanel.tsx` next to the `DirectionalLight3D` intensity field, gated on `node.kind === "Camera3D"`. `SET_CAMERA_CURRENT { id, current }` in `editor-store.tsx`: checking walks the whole
  scene tree to unmark any other current `Camera3D` (mirrors `SCENE_SET_START`'s "set this one, unset the rest" pattern, but over a node tree instead of a flat scene-entries array); unchecking just clears the
  target's own field. Both no-op using `isCurrentCamera` (so checking an already-effectively-current camera, explicit or by fallback, doesn't create an empty undo step).

## Notes (built and verified)
- Unit tests: `core/src/current-camera.test.ts`, `compiler/src/translate-scene-3d.test.ts` (a camera marked current is used over an earlier one in the tree, and suppresses the warning),
  `ui/.../camera-current-edits.test.ts`. Full 1134-test fast suite and typecheck (core/persistence/compiler/ui) pass.
- **Not verified:** the checkbox in the real app (no E2E), an actual ROM build with a non-default current camera (no `testing/*.rom.test.ts` case -- the existing camera-view unit test in
  `translate-scene-3d.test.ts` checks the compiled `view` matrix, not an emulator capture). **Not built:** field of view / near / far plane editing, a "view through the active camera" viewport mode (both still
  open in `STORY.camera-light-and-material-properties.md`), and any script-settable runtime camera switch.
