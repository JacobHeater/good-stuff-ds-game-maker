---
status: done
component: scene-designer
related: [STORY.animated-sprites.md, STORY.import-obj-model.md, ../animation/EPIC.animation.md]
---

# Story: Animated 3D models (poses)

## Context
The engine had two ways to move things in 3D: an AnimationPlayer (moves, turns and scales whole nodes, so a character built from separate part-meshes, arms and legs as child nodes, can already walk), and scripts. A single
soft model (a blob that squashes, a character that flexes) couldn't change shape. Fourth step of making the engine good enough for a full 3D game.

## Decisions (owner delegated; say if any is wrong)
- **Poses, not bones.** The DS has no skinning hardware and only .obj import exists, so an animated model is **several .obj files, one for each pose**, with exactly the same triangles (same vertex count and indices; only the vertices
  move). Export each pose from Blender (or any tool) as `walk1.obj`, `walk2.obj`, ... A skeleton could be baked to poses the same way. Part-based characters (nodes under a parent, an AnimationPlayer) remain the way to move rigid parts.
- **Import:** Scene > **Import Animated Model (several .obj)...** picks several files; they are put together in the order of their names (natural order: `walk2` before `walk10`) as one model named for what they share. Files with different
  triangles are refused with a message naming the file. The first file is pose 0 (it is also what the model looks like with no animation, and its texture coordinates are used).
- **Animations are the sprite ones.** A MeshInstance3D whose model has poses gets the same **Animations** list as an AnimatedSprite2D (name, poses to show in order such as `0-3, 1`, poses a second, loop, which one plays at the start),
  stored in the same `spriteAnimations` field. Scripts: `$Hero.play("walk")`, `stop()`, `is_playing()` (or bare `play("walk")` on the node the script is on). `play()` on a mesh with no animations is an error saying so.
- **Cost:** each pose is its own vertex table in the ROM (about 10 bytes per vertex; a 100-triangle model with 8 poses is about 24 KB), and only pose 0 counts toward the per-frame triangle budget (only one pose is drawn). Poses' texture
  coordinates are stored again for each pose.
- **Editor:** the viewport shows pose 0 (no animated preview yet). Poses can't be edited or seen in the editor beyond the first.

## Description
- Core: `ImportedMesh.frames` (`ImportedMeshFrame`), `getImportedFrameCount`, `getImportedMeshFrameGeometry`, `mergeMeshFrames` (`imported-mesh.ts`), `getMeshFrameCount`, `resolveMeshFrameGeometry` (`mesh-geometry.ts`); the schema and validator accept and check `frames`.
  Script checker: `animCall` with `mesh: true` for a MeshInstance3D that has animations; completion offers play/stop/is_playing then.
- Compiler: one primitive for each pose (`#frameN` keys, shared between meshes of the same model), `DsMesh.frameStart/frameCount/animation/animationFirst/animationCount`, `DsScene3D.meshFrames` and `meshAnimations`, C `GsMesh` fields and
  `mesh_frames`/`mesh_animations`. Errors: `animation-frame-out-of-range`; warning `animated-mesh-without-frames`.
- Runtime: `runtime/source/gs_mesh_anim.c` (the stepper is the animated sprites' `gs_sprite_anim.h`), `gs_mesh_primitive(i)` in the draw loop, `gs_mesh_play/stop/is_playing`.
- Editor: `mergeMeshFrames` in the main process import (`importPoses`), the Animations field for meshes (`SpriteAnimationsField` with `poseCount`), the same `SPRITE_ANIM_*` actions.

## Notes (built and verified)
- Unit tests: `core/src/imported-mesh-frames.test.ts`, `compiler/src/animated-meshes.test.ts`, `ui/.../mesh-animation-edits.test.ts`, `persistence/.../mesh-frames-schema.test.ts`.
- Emulator: `compiler/src/testing/animated-meshes.rom.test.ts`: a three-pose model shows its first pose when it starts holding, its last after an animation ran to its end, and the last after a script called `play("go")` (read from where the picture's pixels are).
- **Not verified:** the multi-file import dialog in the real app (no E2E), the Inspector list for meshes. **Not built:** blending between poses (poses change in steps), a viewport preview, importing glTF or baking skeletons, poses of a primitive.
