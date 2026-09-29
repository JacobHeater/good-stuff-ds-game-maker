---
status: done
component: scene-designer
related: [STORY.scene-instances.md, debugger/BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md]
---

# Bug: the live triangle budget ignored meshes inside a scene instance

## Context
Owner report: "are engine is lacking this feature if a scene has any instatieated scenes it should add those to the triangle budget too."

Root cause: the Hardware panel's live budget (`BottomPanel.tsx`'s `HardwareBudgetTab`) called `computeSceneBudget(state.sceneRoot, ...)` directly on the scene as authored -- an instance (`SceneNode.instanceOf`) is a single reference node with no children of its own in that tree, so `computeSceneBudget`'s `flattenSceneTree` walk never saw the instanced scene's meshes (or its sprites, sounds or textures) at all. The compiler was never wrong: `translate-project.ts` already expands every instance (`expandSceneInstances`) before translating a scene, so the ROM's real triangle count, and its `triangle-budget-exceeded` diagnostic, already included them. Only the editor's own live gauge disagreed with what the compiler would actually do -- it could read comfortably under budget for a scene the compiler would refuse to build.

## Fix
`HardwareBudgetTab` now reads the same expanded tree the two viewports already draw (`useShownSceneRoot`, `shown-scene.ts`) instead of `state.sceneRoot` directly, so `computeSceneBudget` walks every instanced scene's nodes too -- matching the compiler exactly, since both now ultimately go through `expandSceneInstances`. This also makes the panel's node count (`totalNodes`) and every other per-screen figure (sprites, sounds, textures) correctly include what's inside an instance, not just the triangle count the owner asked about.

## Notes (built and verified)
- Unit tests: `core/src/budget.test.ts` (new) -- an instanced scene's mesh contributes nothing to `computeSceneBudget` on the raw tree, contributes correctly once expanded, and several instances of the same scene (plus a mesh outside any instance) are all counted, not just one. Full 1137-test fast suite and typecheck (core/persistence/compiler/ui) pass.
- **Not verified:** the Hardware panel in the real running app (no E2E). **Not built:** nothing else was in scope -- this was a read-only display fix; no schema, compiler or runtime change was needed since the compiler already counted instances correctly.
