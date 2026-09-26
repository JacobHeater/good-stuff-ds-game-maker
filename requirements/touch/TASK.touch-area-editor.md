---
status: done
component: touch
related: [STORY.touch-areas.md, collision/TASK.collision-shape-inspector-and-viewport.md, persistence/TASK.embed-imported-sprites-in-project-file.md]
---

# Task: Touch areas in the editor and the project file

## Description
- **Model** (`packages/core/src/touch-area.ts`): kinds `TouchArea2D` (a 2D kind, on the 2D screen) and `TouchArea3D` (a 3D kind, drawn by the 3D engine);
  `SceneNode.touchArea2D?: { width, height }` and `touchArea3D?: { shape: "box" | "sphere", size, radius }`, every field optional in a file with the defaults
  filled in by `getTouchArea2D` / `getTouchArea3D` (which also clamp: whole pixels 1..256 x 1..192; sizes 0.01..1000). `getTouchArea2DRect` gives the
  rectangle's corner and size as the ROM tests it.
- **Persistence:** the schema lists both kinds and both data objects (`formatVersion` stays 1, additive). Ranges are in the schema.
- **Inspector:** `TouchArea2DField` (Width, Height) and `TouchArea3DField` (Shape, then Size X/Y/Z or Radius), with a note on what the area needs. A TouchArea2D
  keeps the ordinary Position fields; a TouchArea3D the 3D transform.
- **2D viewport:** a TouchArea2D is a dashed teal rectangle of its real size (2 screen pixels per DS pixel), centered on its position, draggable like a marker,
  with its icon and name. **3D viewport:** a TouchArea3D is a teal wireframe with a faint clickable fill (`TouchAreaView`, using `collisionWireframe`); Scale
  works on it and scales it.
- **Store:** `SET_TOUCH_AREA_2D` and `SET_TOUCH_AREA_3D`; typing in a field is one undo step per pause per field, a shape change its own step; a value it already
  has is not an edit; the wrong kind of node is ignored; duplicating keeps the settings. Scene > Add 2D Node / Add 3D Node lists them through the existing
  per-mode kind lists.
- Icons: both kinds use the owner's drawn pointing-hand icon (`editor/icons/TouchArea2D.png`, `TouchArea3D.png`, listed in `NODE_KIND_ICON_IMAGE`).

## Acceptance Criteria
See `STORY.touch-areas.md` ("The nodes exist in the editor"). Covered by the unit tests named there.
