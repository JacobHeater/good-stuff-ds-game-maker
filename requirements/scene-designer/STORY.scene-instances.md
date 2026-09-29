---
status: done
component: scene-designer
related: [STORY.multiple-scenes.md, compiler/STORY.compile-3d-scene-to-nds-rom.md]
---

# Story: Instance a scene inside another scene

## Context
With several scenes (`STORY.multiple-scenes.md`) you can make a Player scene, but not put it in a Level scene like Godot's "instanced scene". This adds that: a scene used as a node in another scene.

## Decisions (owner asked for "make a player scene then drag into the level scene like Godot"; the rest I chose, say if any is wrong)
- **A live link.** A node with `instanceOf: <scene id>` stands for that whole scene: change the Player scene and every instance in every scene changes. The instance is one node in the Scene tree (it holds no
  children of its own) that can be moved, turned, scaled, hidden, renamed and given a script; everything inside comes from the scene. No per-instance overrides of nodes inside it (Godot's "editable children") yet.
- **Ways to add one:** drag a scene's tab onto the Scene tree (onto a node to put it under that node, or onto empty space for the root), or Scene menu > "Instantiate Scene" > the scene's name.
- **Cycles are refused** (a scene can't contain itself, directly or through others). An instance whose scene has been deleted shows nothing and the compiler warns (`scene-instance-missing`).
- **Positions:** 2D positions in this engine are absolute pixels (a parent's is never added to its children's), so an instance adds its own position **minus the scene root's position** to every 2D node inside it. An instance
  arrives at the scene root's own position, so the scene looks as it was authored until you move the instance. 3D nodes compose through the instance's transform as they always do.
- **Ids:** the nodes inside an instance are called `<instance id>/<node id>` (so two instances of one scene don't share ids; animation tracks follow). Selecting anything inside an instance in a viewport selects the instance.
- **Scenes without a camera:** a scene made only to be instanced (an enemy) has no Camera3D. The starting scene still needs one; any other scene without one gets a default camera when built, so it is a scene the game could still switch to.

## Description
- Core (`project-scenes.ts`): `SceneNode.instanceOf`, `expandSceneInstances`, `outerNodeId`, `instanceWouldCycle`, `danglingInstances`. The schema allows `instanceOf`.
- Compiler: `translateProject3D` and `translateScene2D` expand instances before translating (so the meshes, sprites, colliders and scripts of the instanced scene are built into the scene that holds it).
- Editor: action `SCENE_INSTANTIATE` (undoable), `instantiateScene`, tabs are draggable, the Scene tree accepts the drop, both viewports draw the expanded scene (`useShownSceneRoot`), the Inspector shows "An instance of the scene X"
  with an **Open scene** button.

## Notes (built and verified)
- Unit tests: `core/src/scene-instances.test.ts` (expansion, ids, nesting, missing and cyclic scenes, live change), `compiler/src/scene-instances.test.ts` (2D sprites drawn once per instance at the shifted place, a 3D scene's mesh and script built in),
  `ui/.../scene-instance-edits.test.ts` (adding, naming, refusing cycles, undo, saving). 974 fast tests pass.
- The editor's live Hardware budget panel initially read the un-expanded tree, so it didn't count an instance's own meshes/sprites/sounds/textures at all (the compiler always did, since it expands instances before
  building): see `BUG.triangle-budget-ignores-scene-instances.md`.
- **Not verified:** the drag and drop and the viewport drawing in the real app (no E2E run), and an instance on the DS (it compiles to ordinary nodes, so the runtime is unchanged). Not built: overrides inside an instance, dragging an instance's
  contents in the viewport (only the instance moves, from the Inspector), a scene tab drop onto the viewport itself, a "make this node into a scene" command.
