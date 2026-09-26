---
status: done
component: scene-designer
related: [STORY.animated-3d-models.md, STORY.import-obj-model.md, ../animation/EPIC.animation.md, STORY.mesh-colors.md]
---

# Story: Rigged models (glTF / GLB with a skeleton and animations)

## Context
`STORY.animated-3d-models.md` animates a model as a set of poses because only .obj could be imported. The DS does animate bones (its geometry engine draws each bone's triangles with that bone's matrix; Mario Kart DS does this), so a real
skeletal import is better: one model, small in memory, with the animation clips from the file.

## Decisions (owner chose: glTF/GLB, rigid skinning, animation clips, and the bones must be animatable in the AnimationPlayer too)
- **Format: glTF 2.0** (`.glb`, or `.gltf` with its `.bin`/embedded buffers). Blender, Mixamo (via glTF export) and most tools write it. FBX is not read (a closed, complicated format): convert it to glTF.
- **Rigid skinning** (each vertex follows one bone), like the DS's own games: every triangle goes to the one bone whose weights over its three vertices are the largest, and is drawn under that bone. Joints look a little stiff or split at bends; low-poly
  DS-style characters look right. Smooth blending of two bones is not built (it would cost CPU every frame).
- **It arrives as ordinary nodes, so nothing is special at run time.** Scene > **Import Rigged Model (.glb / .gltf)...** adds a `Node3D` named for the file containing: the file's node tree (every bone is a `Node3D` with the file's rest pose), a `MeshInstance3D`
  under each bone that has triangles (named `<Bone>_mesh`, its vertices in the bone's own space), and an **AnimationPlayer** holding the file's clips. Because bones are plain nodes, you can add your own tracks for any bone in the Animation panel,
  move a bone from a script (`$"mixamorig:Head".rotation.y = 30.0`), hide a part, or attach a script to one, all with what already exists.
- **Clips:** each glTF animation becomes an animation of the same name (looping). Translation, rotation (turned into the editor's Euler degrees, kept continuous) and scale tracks are sampled at 15 keys a second and **thinned** to the keys that matter (a straight
  move is two keys), and a track that never leaves the rest pose is dropped. Linear, step and cubic-spline interpolation are read. Start one with the AnimationPlayer as usual.
- **Colors:** a material's base color becomes the part's mesh color. **No textures** are imported yet.
- **Limits:** vertex numbers must fit the DS (a model must be under 8 units from each bone: about person-sized; the message says to scale the model down in the file), and the usual triangle budget applies (only the parts drawn count).
- Not supported (said in the log, not silently dropped): triangle strips/fans/lines, morph targets, sparse accessors, animation of anything but a node's transform. Cameras and lights in the file are ignored.

## Description
- Core: `gltf-import.ts` (`readGlb`, `readGltfFile`, `externalGltfFiles`, `importGltf` -> `RiggedModel`, `quaternionToEulerXYZ`), `gltf-test-fixture.ts` (`buildArm`, `toGlb`: a small rigged, animated model built as glTF bytes for tests).
- Desktop: `assets:pick-rigged-model` (`pickRiggedModel` in `assets-ipc.ts`) returns the file's bytes and the files a .gltf refers to; the renderer does the import (so node ids come from the editor's own counter).
- Editor: `IMPORT_RIGGED_MODEL` (one undo step, unique name), `importRiggedModel`, the menu item.

## Notes (built and verified)
- Unit tests: `core/src/gltf-import.test.ts` (bones, rest pose, per-bone triangles in bone space, color, clips, thinning, cubic spline, .glb container, refusals), `compiler/src/rigged-models.test.ts` (compiles, animated bone chain is dynamic),
  `ui/.../rigged-model-edits.test.ts`.
- Emulator: `testing/rigged-models.rom.test.ts`: an imported two-bone model stands upright, and with its imported clip playing the arm bone's bend swings the upper part out to the side (read from the picture).
- **Not verified:** any real-world file (only a small glTF built in the test: try a Mixamo or Blender export and report what breaks), the file dialog and the imported model in the real editor viewport. **Not built:** FBX, textures, smooth skinning,
  retargeting, morph targets, an importer for bone-attached props' own skins, or splitting one triangle's vertices across bones (joints can show hairline gaps).
