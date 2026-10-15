---
status: done
component: scene-designer
related: [STORY.rigged-models.md]
---

# Story: Opt-in smooth (weighted) vertex skinning

## Context
`STORY.rigged-models.md` draws a rigged model with rigid skinning: every vertex follows the one bone that pulls it
hardest, since the DS GPU has no hardware vertex skinning. This looks right at rest but visibly tears at a joint once
posed away from rest, because a smoothly-skinned source file (a Mixamo export, say) blends a joint's vertices across
two bones, and this engine's rigid path can only ever follow one. The owner hit this directly: after a real Mixamo
model was finally importable (see this story's own bug notes below), its bend animation visibly split apart at every
joint. The real Nintendo DS G3D format has a documented CPU-side technique for this (nsbmd_docs.txt's "Calculate
Skinning Equation"): blend a vertex's matrix from several bones' current world transforms and draw it with that,
instead of one bone's matrix for the whole mesh. This story adds that, as an explicit opt-in (the owner's own
request, "toggleable... like what screen 2D is on") rather than the default, since it costs real CPU time every frame
a smooth-skinned mesh moves -- a plain rigid mesh keeps costing nothing.

The first version of this made the toggle a per-mesh-instance Inspector checkbox. That was wrong: a joint is really
several separate meshes meeting at a shared edge, and the seam only actually closes when *every* mesh touching it
agrees -- miss flipping the checkbox on just one part around a joint and the crack reopens, which is exactly what the
owner hit (screenshots of a still-torn joint, asking "how does Mario Kart DS get these nice bends" -- MKDS uses this
same CPU-blended-matrix technique, it's just applied consistently across a whole character). The owner's own
correction: "it should ask if you want skin on import, it is not a toggle actually." So the real decision is made
*once*, for the whole model, at import time -- see Decisions below.

## Decisions
- **Asked once at import, for the whole model, not a per-mesh toggle you have to remember to set consistently**:
  `importRiggedModel` (`editor-store.tsx`) checks, after `importGltf` succeeds, whether any mesh in the freshly
  imported model has a vertex genuinely weighted across more than one bone (`meshesNeedingSmoothSkinningPrompt` --
  every `ImportedMesh` always has `skin` data, even a purely rigid one with exactly one bone at weight 1, so this
  checks for a *real* split, not just presence). If so, a native Yes/No dialog (`assets.confirmSmoothSkinning`, main
  process, the same `dialog.showMessageBox` pattern `askIncludeAnimation`/`askRecalculateNormals` already use
  elsewhere in this codebase) asks once; saying yes sets `smoothSkinning: true` on every one of those mesh instances
  together, before the model is even added to the scene tree, so every mesh around every joint agrees from the start.
  The per-mesh `MeshInstance3DData.smoothSkinning` field, and its Inspector checkbox, still exist underneath this --
  useful afterward if the owner wants to turn it back off on one specific part (e.g. for performance) -- but the
  Inspector is no longer the primary, and no longer the *only*, way to turn it on.
- **Real multi-bone weights are captured at import time, always** (`gltf-import.ts`), not just when the toggle
  happens to be on at that moment -- so the toggle can be flipped later, in the Inspector, without re-importing the
  file. `ImportedMesh.skin` (`ImportedMeshSkin`) carries a small per-mesh bone list, each one's inverse bind matrix
  (already re-expressed relative to the mesh's own rigidly-stored vertex space, so it composes directly with the
  existing rigid data with no extra change of space), and 4 (joint, weight) pairs per vertex -- the same shape
  glTF's own `JOINTS_0`/`WEIGHTS_0` uses, just with a local per-mesh joint list instead of a global skin.
- **A blended matrix per vertex, not true continuous per-vertex geometry**: the DS GPU still only ever has one
  "current" matrix; this loads a freshly-blended one before each vertex instead of recomputing vertex positions on
  the CPU, the same technique nsbmd_docs.txt's own "Calculate Skinning Equation" describes and real DS games with
  smooth joints use. It is real per-vertex CPU and GX FIFO cost (computing and loading a new matrix for every single
  vertex), which is exactly why it is opt-in.
- **Each bone's own world *scale* is folded into the blend and used for both the position and the normal transform**,
  unlike the rigid path's own position-only scale (which exists specifically to keep a uniformly-scaled mesh's
  lighting correct, per `draw_mesh`'s own comment). This is an explicit, documented approximation: exact whenever a
  bone's own scale is 1, which every bone in a real character rig's skeleton normally is; only a bone with a genuine
  non-1 scale (rare, and not something this project's own importer ever introduces) would show slightly off
  lighting. Getting this exactly right would mean decomposing an arbitrary blended matrix back into rotation and
  scale every vertex, every frame -- not worth it for an already-approximating feature.
- **A model-level editor preview, not three.js's own `SkinnedMesh`/`Skeleton`**: `Viewport3D.tsx`'s `SmoothSkinnedMeshView`
  recomputes each vertex's blended *world* position directly (reading the live bone `Object3D`s' own `matrixWorld`,
  already kept current by three.js every frame), mounted at the scene root rather than nested under any one bone's
  group. This was the simpler, safer choice over converting bones into real `THREE.Bone` objects for a proper
  `Skeleton` bind, which would have touched how every 3D node in the whole viewport is represented, not just skinned
  ones. Desktop-grade CPU makes the per-vertex JS cost a non-issue here, unlike the real ROM.
- **A duplicated rigged model does not get its own copy of the skin data**: `ImportedMeshSkin.jointNodeIds` bakes in
  the *original* import's own bone ids, and `duplicateSceneNode` (core's own node-duplication primitive) assigns
  fresh ids to everything but never remaps cross-references anywhere in the tree -- the exact same pre-existing gap
  `AnimationTrack.nodeId` already has (a duplicated AnimationPlayer's tracks keep pointing at the *original*'s bones
  too). Not fixed here: solving it in general (so any embedded node-id reference survives a duplicate) is a bigger,
  separate problem than this story's own scope. The compiler falls back to rigid (with a warning,
  `smooth-skinning-missing-bone`) rather than draw with the wrong bones when a referenced bone truly isn't in the
  scene at all.
- **A scene *instance* of a rigged model (not a duplicate) is fixed, not just documented as a gap**: unlike a plain
  duplicate, `expandSceneInstances` (`project-scenes.ts`) already renames every node id inside an instanced subtree
  to `<instance id>/<its own id>` so two instances of one scene don't collide -- including, via its own
  special-cased handling, an AnimationPlayer's own `track.nodeId`. A skin's `jointNodeIds` can't get that same
  treatment, because they live outside the scene tree entirely, on the shared `ImportedMesh` in `project.meshes`,
  so that renaming pass has no way to reach them -- they still name bones by their original, un-instanced ids.
  Before this was handled, a "Player" scene built around a rigged model (a very ordinary way to make a reusable
  character), with smooth skinning toggled on, silently fell back to rigid (with the same
  `smooth-skinning-missing-bone` warning above) the moment it was instanced into another scene, since none of its
  bones' renamed ids matched the original ones `jointNodeIds` still names. `translate-scene-3d.ts` now also tries
  each joint id with the mesh instance's own expanded id as a prefix (derived from its id up through its last "/",
  the same prefix every bone and mesh inside that same instance boundary shares) before giving up -- fixing every
  instanced copy of a smooth-skinned model at once, with no change needed to `expandSceneInstances` or the stored
  skin data itself. Verified with a new `smooth-vertex-skinning.test.ts` case that places the rigged model in its
  own scene, instances it into a second scene exactly as `expandSceneInstances` would, and confirms the toggled
  mesh's bones still resolve (no `smooth-skinning-missing-bone` warning); confirmed to fail with the fix disabled.

## Description
- **Core**: `ImportedMesh.skin` / `ImportedMeshSkin` (`imported-mesh.ts`); `MeshInstance3DData.smoothSkinning`
  (`scene-node.ts`); `gltf-import.ts`'s skinned-mesh loop captures the real per-vertex multi-bone weighting
  alongside its existing rigid grouping, deriving each referenced bone's inverse bind matrix relative to the rigid
  data's own space (`invertAffine`, `multiplyMat`); `PrimitiveGeometry.skin`/`skinJoints`/`skinWeights` and
  `getImportedMeshGeometry` (`primitive-geometry.ts`) expand that skin data the same way positions/normals/uvs are
  already expanded, so the compiler and the editor viewport share one expansion instead of two.
- **Persistence**: `project-snapshot.schema.ts` (`importedMesh.skin`, `meshInstanceData.smoothSkinning`),
  `json-schema-project-snapshot-validator.ts` (the array-length cross-checks JSON Schema can't express).
- **Compiler**: `DsPrimitive.skinJoints`/`skinWeights` (per-vertex, always present when the source model has skin
  data, independent of any instance's toggle), `DsMesh.skinJointStart`/`skinJointCount` (per *instance*, since the
  same shared primitive can be drawn by one smooth-skinned instance and one rigid one), `DsScene3D.skinJoints`/
  `skinInverseBindMatrices` (flat, every smooth-skinned instance's own run) -- all in `ds-scene.ts`, resolved in
  `translate-scene-3d.ts`, serialized in `scene-data-writer.ts`.
- **Runtime** (`packages/compiler/runtime`): `scene.h`'s `GsPrimitive`/`GsMesh`/`GsScene` carry the same new fields;
  `main.c`'s `draw_mesh` branches on `GsMesh.skinJointCount` -- 0 draws exactly as before (one matrix, `glPushMatrix`/
  `glMultMatrix4x4`/`glScalef32`/`glPopMatrix`), otherwise `draw_skinned_mesh` precomputes one blended-basis matrix
  per referenced bone (`gs_world_matrix`/`gs_world_scale`, already live and frame-current from `gs_runtime.c`'s own
  node composition, times that bone's own inverse bind matrix -- a new general 4x4 affine multiply, `mat4_multiply`,
  since `compose_node`'s own composition deliberately keeps rotation and scale apart) and, for each vertex, sums up
  to 4 of those by its own byte weights and `glLoadMatrix4x4`s the result before that one vertex.
- **Editor**: the import-time prompt (`meshesNeedingSmoothSkinningPrompt`, `importRiggedModel` in `editor-store.tsx`,
  `assets.confirmSmoothSkinning` IPC method -- `project-ipc-contract.ts`/`project-ipc-channels.ts`/
  `assets-ipc.ts`/`preload/index.ts`); the underlying per-mesh `MeshInstance3DData.smoothSkinning` field still has its
  own Inspector checkbox (`InspectorPanel.tsx`, `setMeshSmoothSkinning` in `editor-store.tsx`) for overriding one part
  afterward; `Viewport3D.tsx`'s `SmoothSkinnedMeshView` (see Decisions above).

## Notes (built and verified)
- **A real Mixamo file needed two unrelated fixes to this story's own prerequisite (plain rigid import) before
  smooth skinning was even relevant**, both found by actually importing a real downloaded file, not just the test's
  own small glTF:
  1. `readDictionary`'s own real-world-file bug (NSBMD Converter pipeline, not this story, but found along the way):
     out of scope for this story's own notes -- see `compiler/STORY.nitro-native-format-converter.md`.
  2. **The vertex-range check (`MAX_IMPORTED_COORDINATE`) used to just reject an oversized file.** A real Mixamo
     export's raw units put vertices well past the DS's own hardware range, and the honest fix wasn't to barely
     satisfy the hardware limit (which would have reproduced the file's original, wrong-for-this-engine size) but to
     normalize the *whole* model -- every bone's own rest position and every mesh's vertex data, uniformly, by
     whichever is bigger: the hardware-driven factor, or whatever brings the model's real world-space bounding box
     down to about 2 units (this engine's own "a person is about 2 units tall" convention). The first attempt at this
     compensated with a scale on the model's own wrapping root node instead of touching bone positions, which
     exactly canceled the shrink back out and reproduced the original (invisible, off-camera) size -- caught only by
     actually looking at the reimported model in the running editor, not by the unit tests, which were testing the
     wrong property (that *a* shrink happened, not that the *final rendered size* changed).
  3. Once import succeeded, **the real file's bend animation visibly tore apart at every joint** in the editor
     viewport -- the expected, already-documented rigid-skinning limitation (`STORY.rigged-models.md`), now visible
     for the first time because the file could finally be imported at all. This is what this story's own feature
     (smooth skinning) actually answers.
  4. **Turning smooth skinning on for that same real file exploded the whole mesh into a degenerate starburst**, a
     third bug in this story's own feature rather than in the prerequisite rigid-import path. The whole-model rescale
     from bug 2 above divides every bone's rest position, every mesh's vertex data, and every animation position
     keyframe by the same factor -- but missed one more place a real position lives: each skin's own
     `inverseBindMatrices`, which carry a genuine translation (indices 12-14 of each 16-float matrix) in the file's
     original, un-rescaled units. A small hand-built test fixture never caught this, because it never needed the
     rescale at all (small coordinates, so `rescale` stays 1 and nothing is divided either way) -- only a real,
     oversized file exercises the rescale and the skin data at the same time. With one side shrunk and the other not,
     the blend's `jointWorld_i (shrunk) * relativeInvBind_i (NOT shrunk) * storedPosition (shrunk)` no longer agreed
     on what "one unit" meant, throwing blended vertices hundreds of units from their rest position. Fixed by dividing
     only each inverse bind matrix's translation by `rescale`, leaving its rotation/scale linear part alone (not a
     distance, so a uniform rescale doesn't touch it) -- caught by inspecting the user's real `Test.glb` file directly
     (`pos range` tiny and correct, `inverseBindMatrices` translation still in the hundreds), then reproduced in
     `gltf-import.test.ts` by inflating a test fixture's position *and* inverse-bind-matrix bytes together (unlike the
     bug-2 tests, which only inflate positions) and confirming the blend formula no longer reconstructs the vertex's
     known rest-pose position; verified by disabling the fix and confirming that exact test fails with a ~50-unit
     discrepancy, then restoring it and confirming via diff the file was byte-identical to before.
  5. **Even with bug 4 fixed, the owner's real file still looked "good but not the best"**: a rendered ROM screen
     capture showed the character mostly correct but with a trail of stray points past the fingertips. The root
     cause was a THIRD gap in the same rescale machinery, this time in the bone side rather than the skin side.
     This file's bones sit under a Mixamo "Armature" wrapper node that carries its own small built-in scale (a
     cm-to-m unit conversion) -- separate from any bone's own rest position. The hardware vertex-range check
     (`hardwareScale`, bug 2) reacts to *raw*, pre-that-scale vertex-to-bone distances -- a format limit on the
     stored number itself, unaffected by any node's scale -- so on this file it came out to about 13-90x bigger than
     `normalizeScale`, the shrink the model's already-scaled true visual size actually needed. `rescale` (the bigger
     of the two) was being applied to bone rest positions as well as mesh vertex data, which kept proportions
     correct but left the model's *true rendered size* far smaller than this engine's own "about 2 units tall"
     convention intends -- confirmed directly: the real file's head ended up roughly 0.19 units from the ground
     instead of about 2. A model genuinely that much smaller than intended makes the smooth-skinning blend's
     fixed-point rounding (a fixed ~1/4096-unit step, invisible on a normal-sized model) a large fraction of the
     model's own size, showing up as real per-vertex distortion -- worst at the fingertips, the vertices furthest
     down the bone chain, and invisible on the rigid path's simpler single-matrix math. Fixed by multiplying the
     import's own root node(s) by `rescale / normalizeScale` (1, and so a no-op, whenever `rescale` was already just
     `normalizeScale` -- the ordinary case, with no such unrelated scale anywhere in the tree) -- this corrects the
     model's true rendered size back to what `normalizeScale` alone would have given, without changing a single
     stored vertex or bone position (both still safely inside the hardware limit, still divided by the full,
     bigger `rescale` as before). Verified directly against the real file (the bend simulation's worst-case
     coordinate went from ~0.19 to ~2.0, a ~10x correction matching the measured `rescale`/`normalizeScale` ratio)
     and with a new `gltf-import.test.ts` case using a `buildArm({ armatureScale })` fixture extension that wraps
     the test rig's own bones under a scaled "Armature" node, the same shape as the real file; confirmed to fail
     (landing at ~0.075 instead of ~1.0) with the fix disabled, and to match the pre-existing "auto-scales a model
     too big" tests' own expectations unchanged (their `compensatingScale` comes out to exactly 1, since nothing in
     their fixture has an unrelated wrapper scale, so this fix is a no-op for every previously-passing case).
  6. **A skin's own inverse bind matrices were never converted to the DS's f32 (20.12) fixed point before reaching
     the generated C, unlike every other matrix this compiler writes (a node's own world, the camera's view, ...).**
     `translate-scene-3d.ts` pushed `skin.inverseBindMatrices` (plain floats, e.g. `0.9996`) straight into
     `scene.skinInverseBindMatrices`, and `scene-data-writer.ts`'s own `matrix()` helper writes a `GsMatrix` literal
     with no conversion step of its own (it assumes the caller already converted, which every *other* call site does).
     The generated C compiled without error -- a float literal assigned to an `int32_t` array is legal C, just
     silently truncated toward zero -- so a rotation entry like `0.9996` became `0`, and only a translation's whole
     part (e.g. `2.9` from `5.89`) survived at all. Every unit test checking this data only checked its *shape*
     (length, that it round-trips through a simple reconstruction by hand) never its actual *magnitude*, and the
     existing ROM test's own assertion ("the smooth-skinned pixel footprint differs from the rigid one") passes just
     as well for a wrongly-blended mesh as a correctly-blended one, so nothing caught it until a real file's own
     screen capture was inspected by eye. Fixed by running `skin.inverseBindMatrices` through the same `matrixF32`
     helper (`m.map(toF32)`) every other matrix in this file already uses, right where the array is built. Verified
     with a new `smooth-vertex-skinning.test.ts` assertion that every component is a plain integer and the identity
     rotation axis comes out to exactly 4096 (not 1); confirmed to fail (reading `1` instead of `4096`) with the fix
     disabled. **Not the explanation for everything**: a real file's own "all three segments of one leg smooth-skinned
     together vanish entirely" failure (see "Not built" below) reproduces identically with this bug both present and
     fixed, so it is a separate, still-open issue, not a second symptom of this one.
- **Unit tests**: `gltf-import.test.ts` (a vertex split 50/50 between two bones round-trips its joints/weights/
  inverse-bind-matrices exactly, verified by reconstructing the vertex's real rest-pose world position from the
  stored data by hand, per the documented blend formula -- not just checking the data's shape; a further case inflates
  both the raw vertex data and the inverse bind matrices together, as a real oversized file's own data is, and
  confirms the same reconstruction still lands on the vertex's known rest position after the whole-model rescale --
  this is the regression test for bug 4 above); `imported-mesh-schema.test.ts`
  (skin data round-trips through the project file, and malformed skin data is rejected); `smooth-vertex-skinning.test.ts`
  (compiler: a toggled mesh's bones resolve to real node indices and its weights quantize correctly; a non-toggled
  mesh's shared primitive still carries the model's own skin data but its `DsMesh.skinJointCount` stays 0; a bone the
  scene doesn't have falls back to rigid with the `smooth-skinning-missing-bone` warning); `mesh-smooth-skinning-edits.test.ts`
  (the editor's own per-mesh toggle, undo included); `rigged-model-edits.test.ts`'s
  `meshesNeedingSmoothSkinningPrompt` cases (a purely rigid import has nothing to ask about; a real split-weight
  vertex is found and named correctly) -- the only piece of the new import-time prompt flow that's pure enough to
  unit test without a mocked `window.goodstuff` (no async provider callback like `importRiggedModel` itself is
  tested anywhere in this codebase today; this extracted the one pure, worth-testing decision out of it instead of
  introducing a new testing pattern just for this).
- **Emulator**: `testing/smooth-vertex-skinning.rom.test.ts` builds a real ROM both ways (the toggle on and off) for
  the same split-weight vertex and measures where its pixels land on a real screen capture: rigid left/middle/right
  225/1716/0, smooth-skinned 409/645/0 -- the split vertex visibly pulls part of the mesh toward the bent arm's side
  only when the toggle is on, which is the actual, hardware-level proof that `draw_mesh`'s new per-vertex
  blended-matrix path works, not just that it compiles and links.
- **Not verified**: the import-time prompt, the Inspector checkbox, and the editor viewport's live rendering, by hand,
  in the running desktop app (the app was launched and confirmed to start cleanly with every change in this story,
  but clicking through to the feature itself needs a proper Electron/Playwright driver this session didn't build --
  see `.claude/skills/run` if one gets built later). **Not built**: fixing a duplicated rigged model's smooth skinning
  to follow its own copy's bones instead of the original's (see this story's own Decisions on why); true continuous
  per-vertex blending (the DS's own per-vertex-matrix-load approach is already the closest practical thing to it);
  a CPU-cost budget or warning for how many smooth-skinned meshes/vertices a scene has (`hardware.ts`/`budget.ts`
  have no CPU-time concept at all today, only triangle/memory counts).
- **A real, open bug, found on a real file, not yet root-caused**: toggling smooth skinning on *all three* meshes of
  one full limb chain at once (a leg's upper segment, lower segment, and foot/toe together -- a real, ordinary rig
  shape, not a contrived one) makes that limb, and everything drawn after it that frame, vanish from a real
  ROM+melonDS capture -- not mispositioned, not torn, just never rasterized (confirmed by forcing the mesh's own
  color to solid red: no red pixels appear anywhere). Any *one* of the three alone, and any *pair* of the three, both
  render correctly; it takes the full three together, and it reproduces identically on both of melonDS's rendering
  backends (software and OpenGL) and with compiler optimization on or off, which argues against an emulator-backend
  quirk or a miscompile. Ruled out by direct measurement, not guesswork: the compiled scene data itself (bone
  indices, per-mesh joint ranges, quantized weights); the blend arithmetic, replicated in JS with the exact same
  32-bit integer semantics the C runtime uses (no overflow, no NaN-equivalent, every intermediate value sane); the
  two DS hardware error conditions GBATEK documents for this exact technique (GXSTAT.15 matrix stack overflow,
  DISP3DCNT.13 vertex/polygon RAM overflow -- polled directly after the frame, neither ever sets); and the bug 6
  fixed-point conversion above (reproduces identically whether that bug is present or already fixed, so it is not
  a second symptom of it). Reproduced in isolation with a minimal, hand-built 3-bone test fixture too, independent of
  the real file's own data -- though that minimal case diverges from the real file in exactly which combinations
  trigger it, suggesting weight *distribution* (how evenly split a vertex's blend is), not just topology, is part of
  the real trigger. Needs either a GX command-level trace or real hardware to take further; until then, smooth
  skinning on every segment of one limb at once is the one combination known not to work.
