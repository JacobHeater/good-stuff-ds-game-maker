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
     together vanish entirely" failure (bug 7 below) reproduced identically with this bug both present and fixed, so
     it was a separate issue, not a second symptom of this one.
  7. **`draw_skinned_mesh` never actually applied the camera's view transform.** `draw_mesh` wraps every mesh's draw
     call in `glPushMatrix()`/`glPopMatrix(1)`, saving the camera's current view so the rigid path can safely build on
     it with `glMultMatrix4x4`. The smooth path never did: `glLoadMatrix4x4` *replaces* the current matrix outright
     (standard GL semantics, same as the DS's own hardware), so every one of its per-vertex blended-matrix loads threw
     away the pushed view and substituted a pure `world * inverseBind` matrix instead -- putting that mesh's vertices
     in raw local/world space, not view space. At or near a bone's bind pose that blend comes out close to the
     identity matrix, so a single smooth-skinned mesh near the origin could still land somewhere on screen by sheer
     coincidence (exactly what masked this in the ROM test above, and in all of this story's own earlier manual
     testing). It stopped being coincidental, and the geometry simply vanished, as soon as more than one smooth-skinned
     mesh was in the same scene with a less forgiving camera angle -- which is what finally made this reproducible on
     demand with nothing more exotic than `buildArm`'s own two-bone test fixture, both meshes toggled at once, no real
     file or large rig required. Every line of "ruled out" work this bug's investigation did (compiled scene data,
     blend arithmetic replicated bit-for-bit in JS, GXSTAT/DISP3DCNT polled directly, both melonDS renderer backends,
     both optimization levels) was correctly ruled out -- the bug was never in any of those, just in `main.c` loading
     the wrong matrix. Fixed in `draw_skinned_mesh` by premultiplying each joint's own blend term by the camera's view
     matrix (`gs_current_view`, now kept around by `load_view` instead of being loaded and discarded) before the
     per-vertex weighted sum: matrix multiplication distributes over that sum, so `view * (Σ w·joint)` equals
     `Σ w·(view * joint)`, meaning the view only needs multiplying in once per joint, not once per vertex -- no extra
     per-vertex cost. Verified with a new `smooth-vertex-skinning.rom.test.ts` case that toggles every mesh of the
     fixture's rigged model at once (not just one) and asserts the model still draws something; confirmed this fails
     (nothing but backdrop) with the fix reverted and passes restored.
  8. **Performance pass, once correctness was confirmed**: `draw_skinned_mesh`'s own correctness fix above (bug 7)
     didn't touch its cost -- still a full blend and a full matrix load for every single vertex, which doesn't scale
     to a real game's several skinned, animated characters on screen together. Four changes, all internal to
     `draw_skinned_mesh` and `enter_scene`/the main loop, no data-format or compiler changes, so nothing else could
     regress:
     - **No more per-component divide.** ARM9 has no hardware divide (`/255` was a software libgcc call, tens of
       cycles, up to 64 times a vertex); replaced with `(x * 257) >> 16`, a multiply and a shift accurate to 1 part
       in 65536 -- finer than this engine's own 20.12 fixed point already resolves.
     - **A vertex weighted entirely to one bone** (the common case away from a joint seam -- most of any real mesh)
       skips the weighted-sum math and loads that bone's own matrix directly, same as the rigid path would.
     - **Consecutive vertices sharing one joint/weight signature** skip the blend *and* the matrix reload entirely,
       reusing whatever's already loaded -- grouping by blend signature is exactly what nsbmd_docs.txt's own
       "Calculate Skinning Equation" describes, and how MKDS itself affords this at 60 fps.
     - **Packed 4x3 matrices (`glLoadMatrix4x3`), not 4x4.** Every affine matrix's own bottom row is always the
       constant `(0, 0, 0, 1)`; there's no reason to blend it or send it to the GPU. A quarter less per-vertex
       multiply-accumulate work and a quarter less GX FIFO traffic on every matrix load. **The exact element order
       `m4x3.m[]` expects is not documented anywhere findable in this session (GBATEK's relevant section couldn't be
       located; libnds's own header gives no usable example)** -- so it was determined empirically: render a known
       rotated (not just translated -- an identity rotation's transpose is still the identity, so a rest pose can't
       tell column-major from row-major apart) pose through the old, verified-correct `glLoadMatrix4x4` path and
       through each 4x3 candidate, same camera, same ROM harness, and compare by eye (the harness's own frame-to-frame
       pixel noise -- confirmed by rebuilding the *same* source twice and diffing, ~7% of pixels differ either way,
       likely renderer dither/edge jitter -- ruled out an exact byte-diff as a verification method). A row-major guess
       produced an obviously sheared, wrong silhouette; column-major (3 rows per column, same column order as the
       4x4 version, just the constant 4th row dropped) matched exactly. If `videoGL.h` or GBATEK's matrix-command
       section is ever easy to consult directly, it would be worth confirming this against the primary source rather
       than this empirical derivation.
     - **One blended (view * world * invBind) matrix per bone, cached for the rest of the current frame**, not
       recomputed from scratch by every mesh that references it. A rigged character is normally several meshes (head,
       torso, arms, legs, ...) skinned to one shared skeleton, so the same bone is very often a joint of more than one
       of them -- exactly gs_runtime.c's own `ComposeMemo` rationale ("a move cost 7ms in a 30-block tower... now it
       costs what the blocks that actually moved cost"), applied to skin blending instead of node composition. A
       cache "hit" is only trusted once the triggering mesh's own `invBindMatrix` is confirmed byte-identical to
       whatever computed the cached entry (not just assumed from the node index matching) -- the compiler currently
       writes each mesh's own copy into `skinInverseBindMatrices` rather than one shared entry per bone, so two
       meshes referencing the same bone are not guaranteed (by the data format, even though every real rig in
       practice satisfies it) to carry pointer-identical or even value-identical copies, and this check is what keeps
       the cache correct either way, never just fast.
     - **Verified**: the three skinning ROM tests still pass (`smooth-vertex-skinning`, `rigged-models`,
       `animated-meshes`), full `vitest run` (1343 tests) and `tsc --noEmit` clean, and the 4x3 matrix order was
       independently confirmed against a known-good render as described above, not just by the tests passing (the
       existing ROM tests' own pixel-bucket assertions are too coarse to catch a subtly wrong matrix layout on their
       own). **Not measured**: an actual frames-per-second number, on hardware or in a cycle-accurate profiler --
       this session had no profiler available, so the case for this pass rests on removing real, identifiable
       per-vertex costs (a software divide, redundant matrix loads, redundant per-mesh joint setup), not a
       before/after timing number.
  9. **The gap in note 8's own pass, found from a real-hardware report of ~12-15 fps with just two skinned
     characters**: every runtime optimization above that depends on "consecutive vertices sharing one signature"
     (the dedup, and the single-bone fast path riding on it) only helps if those vertices are actually adjacent in
     the compiled vertex stream -- and a source file's own triangle order has no reason to put them there. This
     codebase's own test fixtures (`buildArm`) happen to have simple, chunky weight assignments where nearby source
     triangles often do already share a signature, which is exactly why note 8's ROM tests kept passing without
     exposing this: a real character rig, smoothly weight-painted in Blender or Mixamo, has a near-unique signature
     per vertex, so two consecutive vertices sharing one by luck of the source file's own face order is rare, not
     common -- the dedup this story built to make smooth skinning affordable essentially never fired on content
     shaped like that, leaving the *original*, un-amortized per-vertex cost (note 8 was solving a problem this
     codebase's own fixtures couldn't actually exhibit). Fixed in `translate-scene-3d.ts`'s new
     `reorderSkinnedTrianglesByBlendSignature`: a compiled, smooth-skin-carrying primitive's triangles (whole
     triangles, never splitting one across the reorder -- winding and face direction untouched) are sorted by their
     own vertices' blend signature before being written out, so triangles sharing a bone cluster together in the
     stream `draw_skinned_mesh` actually walks, regardless of where they fell in the source mesh. This runs once at
     compile time in Node, not on the DS, so its own cost is irrelevant next to what it saves every single frame on
     hardware. Only applied to meshes that carry skin data at all (a plain mesh's geometry object is returned
     unchanged, not even copied); safe for a primitive's *rigid* instances too, since a rigid draw already doesn't
     care about triangle order (one matrix for the whole primitive) and main.c's own translucent-blending comment
     already established that triangles sharing one mesh's poly ID don't depth-test against each other, so order
     was never meaningful there either. Verified with new `smooth-vertex-skinning.test.ts` cases exercising the
     reorder function directly (not just end-to-end): a 4-triangle case alternating two bones' worth of triangles
     goes from 3 signature-boundary crossings to 1 after reordering, every source triangle survives exactly once,
     each triangle's own 3 vertices (and its UVs, when present) stay together in their original relative order, and
     a mesh with no skin data comes back as the exact same object. Full `vitest run` (1347 tests) and the three
     skinning ROM tests still pass. **Still not measured on real hardware** -- this is the change most likely to
     matter for a real, continuously-weight-painted character rig, since it's the one that makes note 8's dedup
     actually apply to that kind of content instead of only to this codebase's own simple test fixtures, but
     confirming that needs the on-hardware retest this story keeps not having access to.
  10. **Real hardware confirmed note 9 helped but was still not enough (~12-15 fps with two skinned, animated
      characters)**. One more lever, this time trading a little blend quality for the one remaining cost that
      genuinely can't be dedup'd or fast-pathed away: a vertex that is actually a multi-bone blend (at a joint
      seam, immediately after a differently-blended vertex) still pays `draw_skinned_mesh`'s full per-vertex cost,
      and that cost scales with how many of the 4 weight slots a vertex actually uses. Real-time skinning --
      including any real DS-era game -- blends 2 bones, not 4: a vertex is overwhelmingly dominated by the two
      segments meeting at its nearest joint, and a 3rd or 4th influence most import pipelines (Mixamo, Blender's
      auto weights) attach is a small, often barely visible refinement. `translate-scene-3d.ts`'s new
      `limitToTwoStrongestInfluences` keeps each vertex's 2 largest weights and renormalizes them to still sum to
      1, zeroing the rest, before the geometry is quantized or reordered (note 9's own reordering runs on the
      *result*, so fewer distinct signatures overall also means more vertices now match exactly where they
      previously differed only by a dropped weak 3rd/4th influence -- the two optimizations compound). This halves
      the worst-case per-vertex multiply-accumulate work for any vertex that previously used 3 or 4 slots; it is a
      pure no-op (byte-identical weights) for the overwhelming majority of real vertices, which are already single-
      or double-influenced. Verified with new `limitToTwoStrongestInfluences` unit tests (drops the correct 2 of 4
      and renormalizes exactly; leaves an already-≤2-bone vertex numerically unchanged; finds the top 2 regardless
      of which slots they start in; a mesh with no skin data is returned as the same object, untouched) and the
      three skinning ROM tests, plus the full `vitest run` (1351 tests) and `tsc --noEmit`, all still passing.
      **Still not verified on real hardware** -- same limitation as note 9: this session has no profiler or DS unit
      to confirm the magnitude, only the reasoning for why this specific, previously-irreducible cost should now
      be smaller. If a real rig's characters are still too slow after this, the next things worth checking are
      outside what more C or compiler cleverness can fix: how many triangles each character actually has against
      the DS's own ~2048-triangles-a-frame hardware ceiling (mentioned in `primitive-geometry.ts`'s own doc
      comment), and whether smooth skinning is turned on for every mesh of a character or could be limited to just
      the joints that visibly need it (an elbow or knee), leaving the rest on the already-cheap rigid path.
  11. **One more lever that *is* still inside compiler cleverness, found by reconsidering why notes 8-9's own
      clustering (the per-vertex dedup, the triangle reorder) helps this story's own simple test fixtures a lot
      more than it likely helps a real character.** A hand-built fixture's weights are a few clean, repeated
      values; a real, continuously-painted rig (Mixamo, Blender's auto weights) gives almost every vertex its own
      slightly different split -- 0.601/0.399 one vertex over, 0.599/0.401 the next -- visually identical, but at
      the byte precision this data is eventually quantized to (`Math.round(w * 255)`) those round to 153/152, not
      153/153: two different signatures, not one. Neither the runtime dedup nor the reorder's clustering can tell
      "close enough" from "different" -- they key off exact equality -- so on real content, most vertices that
      *should* collapse together under note 8/9's own mechanisms simply don't, and pay the full per-vertex cost
      regardless. `translate-scene-3d.ts`'s new `quantizeWeightLevels` runs right after `limitToTwoStrongestInfluences`
      (before the reorder, so the reorder clusters on the *quantized* signature) and snaps each vertex's weight
      split onto one of 16 fixed levels instead of leaving it continuous -- turning "close" into "identical" for far
      more vertex pairs, which directly multiplies how much of a real mesh notes 8 and 9's own mechanisms can
      actually collapse together. Same trade as note 10's bone-count limit, just made at the weight-*value* level
      instead of the bone-*count* level, and still finer than this engine's own 20.12 fixed point reliably shows
      on screen. Verified with new `quantizeWeightLevels` unit tests (two merely-close continuous splits, 0.601/0.399
      and 0.599/0.401, come out byte-identical after quantizing -- the whole point; a quantized split still sums to
      exactly 1, no gap; a single full-weight vertex is untouched; a weak-but-real second influence is never rounded
      away to nothing; a mesh with no skin data is returned as the same object), the three skinning ROM tests, and
      the full `vitest run` (1363 tests) and `tsc --noEmit`, all still passing. **Still not measured on real
      hardware or against an actual Mixamo-style character** -- the mechanism (more vertices sharing an identical
      signature) is sound and testable in isolation, but this story's own fixtures still can't demonstrate the
      clustering *improvement* on realistic continuous weight data the way a real imported rig could.
  12. **Real hardware A/B finally confirmed smooth skinning itself is the bottleneck** (a real scene, 3 characters,
      352 triangles / 20 bones each: ~10-15fps smooth-skinned, a clean 60fps with it toggled off), and GBATEK's own
      documented geometry-engine command timings (looked up directly this time, not guessed) sharpened exactly
      *why* notes 8-11's own clustering doesn't help this kind of content much: `MTX_LOAD_4x3` costs 30 cycles at
      the geometry engine's own clock, which runs at 33.51MHz -- **half** the ARM9's 67MHz -- so that's 60
      ARM9-equivalent cycles per fresh matrix load, a fixed hardware cost no CPU-side cleverness shrinks. 20 bones
      packed into only 352 triangles (~17.6 tris/bone) is far more bone-dense than any real DS game's own art
      pipeline ever produced, which means a large share of vertices likely sit near *some* joint boundary --
      exactly the shape of content note 9's clustering and note 11's weight-value quantization have the least to
      work with, since both only collapse vertices that share one (joint A, joint B) *pair*, and a bone-dense rig
      simply has many more distinct pairs in play than note 9's compile-time reordering can cluster into long
      runs.
      
      `translate-scene-3d.ts`'s new `limitBlendGroups` (runs right after `limitToTwoStrongestInfluences`, before
      the weight-level quantization, so the group count it sees is already final) attacks that directly: counts how
      many vertices use each distinct (joint A, joint B) pair across a mesh, keeps only the `DEFAULT_MAX_BLEND_GROUPS`
      (12) most-used pairs -- almost certainly a mesh's real, visually significant joints -- and collapses every
      vertex using a less-common pair down to single-bone rigid (its own strongest influence, full weight), the
      same shape `limitToTwoStrongestInfluences` already produces for a weak 3rd/4th influence, just decided
      mesh-wide by vertex-count instead of per-vertex by weight magnitude. This is the one lever in this story that
      reduces the *number of matrix loads a mesh can possibly need*, not just how cheap each one is or how well
      consecutive ones cluster -- the first two levers (notes 8, 10-11) make each remaining load/blend cheaper; this
      one means there are fewer of them to begin with. 12 is deliberately generous, not aggressive: this story's
      earlier levers already do most of the work for a normally-jointed mesh, and this exists as a backstop for the
      genuinely bone-dense case specifically, not a quality cut every mesh is expected to hit (a mesh already under
      the budget is returned completely untouched, same object).
      
      Verified with new `limitBlendGroups` unit tests (a mesh already within budget is returned as the exact same
      object; the most-used pairs survive untouched while a rarer one collapses to its own strongest influence; an
      already single-bone vertex is never touched regardless of budget; the strongest influence is found correctly
      no matter which of the 4 slots it started in; a mesh with no skin data is returned as the same object), the
      three skinning ROM tests, and the full `vitest run` (1368 tests) and `tsc --noEmit`, all still passing.
      **Still not re-measured on the real hardware scene that prompted this** -- the real A/B (confirming skinning
      is the bottleneck at all) came from the user directly; whether this specific lever moves that 3-character,
      10-15fps scene meaningfully still needs a retest on their own content, which this session has no access to.
  13. **After note 12's levers, the real scene was still only ~15fps, and the user pointed out a structural cause
      notes 8-12 never touched: every rigged model, smooth-skinned or not, still imported split into one piece per
      dominant bone** (`gltf-import.ts`'s "2. Skinned meshes" loop) -- the right shape for *rigid* skinning (the DS
      has no skinning hardware, so per-bone pieces are the only way a rigid model moves at all) but actively
      counterproductive once a model goes smooth: splitting means N separate draw calls (each paying its own
      `glPushMatrix`/material/texture-bind overhead) where one would do, and worse, notes 9/11/12's own clustering
      (triangle reorder, weight quantization, the 12-pair blend-group cap) all operate *per mesh piece* -- splitting
      a 20-bone character into 5 pieces means a 12-pair cap meant to bound the *character's* total complexity can
      add up to 60 once spread across pieces, and each piece's own reorder has far less same-bone content to cluster
      than one unified mesh would. A new `importGltf` option, `unifiedSkinning` (default off, so every existing
      caller/test is byte-for-byte unaffected), adds a second, parallel path through the same loop: for a model going
      smooth, each glTF primitive becomes exactly one `MeshInstance3D` (mirroring exactly how the *unskinned* path a
      few lines up already builds one mesh per primitive with no grouping at all), parented to the mesh's own node
      rather than to any bone, carrying the *whole* primitive's raw joints/weights/positions with no "pick one
      dominant bone" reduction and no rebasing into any bone's local space -- glTF's raw per-primitive vertex data
      and its skin's raw `inverseBindMatrices` are already defined in one consistent space by the format itself, so
      leaving both alone (unlike the split path, which must rebase position and each referenced bone's inverse bind
      matrix into the dominant bone's own frame -- investigated and deliberately ruled out as the fix's shape, since
      un-merging that rebasing after the fact would be exactly the kind of fragile coordinate-space math that caused
      bugs 4 and 7 above) just works unchanged with the runtime's existing `world[bone] * invBind[bone] * position`
      blend formula. `editor-store.tsx`'s `importRiggedModel` still detects whether to prompt by importing once with
      no options exactly as before (`meshesNeedingSmoothSkinningPrompt` on the resulting split pieces, unchanged);
      only what happens on "yes" changed, from mutating `smoothSkinning` onto the already-split pieces to re-running
      the whole import with `{ unifiedSkinning: true }` and using that second result instead -- a one-time, import-
      time re-parse of a small character file, not worth threading the dialog's answer into a single pass. The
      desktop dialog's own text (`assets-ipc.ts`) now says the rigid/smooth choice also decides one-piece-per-bone vs.
      one-piece-total, and that toggling smooth skinning back off afterward in the Inspector makes the whole
      (now-unified) model follow its own single node rigidly, not per-piece -- a real, intentional behavior change
      from today's per-piece rigid fallback, not a bug. Verified with 5 new `gltf-import.test.ts` cases (a model with
      vertices split across bones imports as one mesh per primitive, not one per bone, with `smoothSkinning: true`
      set and the full, unreduced joint/weight data intact; a purely-rigid model under the same option still comes
      back as one mesh per primitive with each vertex kept single-bone, not actually blended, since nothing in the
      source file blends it; the default, no-option path is unchanged) -- 22/22 in that file, full `vitest run`
      (1373 tests) and `tsc --noEmit` clean across core/ui/desktop, and the three skinning ROM tests
      (`smooth-vertex-skinning`, `rigged-models`, `animated-meshes`) still pass unmodified, confirming the compiler
      and runtime remain mesh-shape-agnostic as expected. **Not re-measured on the user's real 3-character scene**
      -- same limitation as notes 10-12, this session has no access to their hardware; whether removing the
      per-piece draw-call and per-piece-optimization-budget overhead moves the needle on their 10-15fps result
      still needs their own retest. **Not manually clicked through in the running desktop app** for this specific
      change (confirming the Scene Tree shows one node instead of several after answering the dialog) -- same gap
      this story's existing "Not verified" note already names for the rest of the import-time prompt flow.
  14. **A real imported character's legs rendered visibly short in melonDS, reported directly from a screenshot --
      traced to note 13's own `unifiedSkinning` path, which this story's own bbox/rescale machinery (bugs 2, 5) was
      never exercised against.** That machinery measures a model's true size from each mesh's "owner" node's world
      transform (`worldMatrix.get(meshOwner)`); for the dominant-bone-split path `meshOwner` is always a real bone
      and `mesh.positions` is rebased into that bone's own local space, so this is correct. `unifiedSkinning`'s own
      meshes are owned by the *mesh's own node* instead, with raw, un-rebased positions -- but per the glTF spec, a
      skinned mesh's raw vertex positions live in whatever space its skin's `inverseBindMatrices` and joint
      hierarchy define, completely independent of the mesh node's own transform (the spec says to ignore it for a
      skinned mesh). Using `worldMatrix.get(meshNode)` for the size measurement was therefore right only by
      coincidence -- whenever the mesh node happens to sit under the same scaled wrapper the bones do -- and wrong by
      as much as the skeleton's own unit-conversion scale otherwise. Confirmed directly with a `buildArm`-shaped
      probe (a new `meshUnderArmature` fixture option): the dominant-bone-split path measured the identical, correct
      extent regardless of where the mesh node sat; `unifiedSkinning` measured it **100x too big** when the mesh
      node was left as its own separate, unscaled scene root (`buildArm`'s own long-standing default shape, and a
      common real-export one too) instead of nested under "Armature" alongside the bones. A character's legs --
      the most visually obvious, most elongated part of a humanoid rig -- reading as short is exactly the symptom of
      the model's overall scale coming out wrong this way, not a per-limb issue. Fixed in `gltf-import.ts`: for a
      mesh that carries skin data, the bbox measurement now reconstructs each vertex's true bind-pose world position
      the same way the runtime's own blend will at render time (`Σ weight_i * jointBindWorld_i * invBind_i *
      rawPosition`, from that mesh's own already-captured skin data) instead of trusting any one node's transform --
      correct for both paths, and a no-op for the split path specifically (its own skin data was already built to
      satisfy exactly this formula with one dominant joint at weight 1, so it measures the same extent as before,
      confirmed by a new test that asserts the two paths' own true-size measurements now agree exactly). Verified
      with two new `gltf-import.test.ts` cases (the x100-inflated regression fixture from bug 5's own test, with the
      mesh additionally nested under Armature: lands at the correct true height, not 100x off; and a direct
      agreement check between `meshUnderArmature: true` and `: false` for the same source data) -- both confirmed to
      fail before the fix (100x off; the two shapes disagreeing) and pass after. Full `vitest run` (1375 tests) and
      `tsc --noEmit` clean. **Not yet confirmed against the user's own real file** -- found and fixed from a
      synthetic, hierarchy-isolated repro built to test this story's own standing hypothesis (every prior bug in
      this feature was hierarchy/coordinate-space-shaped, and this path had zero test coverage combined with the
      rescale machinery), not from the real asset itself, which wasn't available this session; worth a retest
      against their actual model to confirm this was the whole explanation.
  15. **Note 14 wasn't the explanation -- the owner's legs were still short, and this time the real file (`cat_animations.glb`) was available to diagnose directly.** Parsing its own GLB header/JSON by hand (a throwaway Node
      script, as bug-10-era NSBMD diagnosis in the converter story did) found the real shape: one `unifiedSkinning`
      mesh ("Head", despite the name -- the whole cat body) whose skin references 25 bones, 22 of them actually used.
      Importing it through the real pipeline and listing the resulting `jointNodeIds` in order showed exactly which
      6 landed past index 15: `RightLeg`, `RightToeBase`, `RightFoot`, `LeftLeg`, `LeftToeBase`, `LeftFoot` -- every
      bone below the knee on both legs. The cause: `main.c`'s `draw_skinned_mesh` has always capped how many
      distinct bones one mesh instance blends at `GS_MAX_SKIN_JOINTS_PER_MESH` (16, chosen back when every mesh was
      a small dominant-bone-split piece referencing a handful of nearby bones), silently dropping (zero weight
      applied, no error) any joint past that -- and `unifiedSkinning` (note 13) changed what a mesh's own joint
      count typically looks like without anyone revisiting this limit: its whole point is *one* mesh for an entire
      character, so a normal body rig (spine, arms, legs, no fingers) routinely needs 20+ distinct bones, comfortably
      over the old limit, where the dominant-bone-split path's own small pieces never would have been. Nothing in
      the compiler checked this either -- `DsMesh.skinJointCount` is written straight from `resolvedJoints.length`
      with no comparison against the runtime's own cap -- so this has been a silent, unlabeled failure mode since
      note 13 shipped, not something specific to this file. **Fix, two parts**: raised `GS_MAX_SKIN_JOINTS_PER_MESH`
      to 32 (main.c) -- comfortably covers this real file's 22 and a normal body rig's worst case, small, fixed
      stack-array cost (1536 bytes in `draw_skinned_mesh`, called once a mesh a frame, nothing allocated per bone);
      and added `translate-scene-3d.ts`'s own mirrored `MAX_SKIN_JOINTS_PER_MESH` constant plus a new
      `smooth-skinning-too-many-joints` compile-time warning (naming the mesh, the bone count, and the limit) for
      whenever a mesh still exceeds it (a richly-rigged mesh, e.g. with full finger bones, still can) -- so this
      failure mode can never again be silent, even though the cap itself still has to exist somewhere. **Verified
      directly against the real file**: re-running the exact same import+translate pipeline after the fix shows
      `skinJointCount=22` with no warning, every one of the 6 previously-dropped leg/foot bones now included.
      New compiler tests (`smooth-vertex-skinning.test.ts`): the warning fires with the right bone count and limit
      past 32 distinct bones, is absent at exactly 32, and the mesh still compiles and draws (this is a quality
      warning, not a build error -- the runtime's own truncation is still there as the backstop for whatever the
      limit doesn't catch). The existing `smooth-vertex-skinning.rom.test.ts` and `rigged-models.rom.test.ts` both
      still pass unmodified on the real toolchain and melonDS with the raised constant. Full `vitest run` (1378
      tests) and `tsc --noEmit` (compiler) clean. **Not yet confirmed on the owner's own hardware/melonDS with their
      actual file rebuilt** -- verified by re-running the same diagnostic pipeline that found the bug, not a fresh
      screen capture of `cat_animations.glb` itself, which this session didn't build (the file lives outside the
      repo, found via its real path once the owner named it, not attached or uploaded).
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
