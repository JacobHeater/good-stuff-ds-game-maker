---
status: done
component: scene-designer
related: [STORY.scene-instances.md]
---

# Bug: A node's id could collide with one already in the project, once enough nodes had been made

## Context
Owner report: instanced a "Map" scene into a "World" scene on purpose, then, "while duplicating something," Map's contents showed up as if merged into a different node in the Scene tree. A recurring bug, not a one-off.

Every node's id (`scene-node.ts`'s `nextNodeId`) comes from one counter shared by every node kind, that only ever counts up **for as long as the app keeps running**. Opening a project never told that counter about the ids already saved in the file — ids an *earlier* session minted with its own count, which could be anything. So a session that had, say, just started (its own count still low) could duplicate or add nodes until its count reached a number the file already had saved on some other node, entirely unrelated to it — two different nodes then shared one id.

Nearly everything that looks up a node does it by id (`findSceneNode`, `updateSceneNode`, scene-instance expansion, the checker's `$Name` resolution and more): once two nodes share an id, an action meant for one can find the other instead — which is exactly what "Map's contents merged into a different node" looks like from the Scene tree.

## Description
Opening a project must raise the node id counter above every id already in it (every scene, not just the one being looked at — scenes share the same id counter), so nothing minted afterward, in this session, can ever repeat one already on disk.

## Acceptance Criteria
```gherkin
Scenario: A project's own ids are never reused, however this session's count happens to start
  Given a project saved by a different (or a much longer) earlier session, so its own ids are numbered arbitrarily high
  When it is opened, and a node is then added or duplicated
  Then the new node's id is higher than every id already in the project, and doesn't collide with any of them

Scenario: This holds across every scene, not just the one open
  Given a project with an instanced scene (e.g. "Map" instanced into "World")
  When a node in the currently open scene is duplicated
  Then the new id doesn't collide with an id belonging to the instanced scene either
```

## Notes
**Fixed**: `ensureNodeIdsAbove` (`core/scene-node.ts`) scans a project's ids for a `-<n>` suffix and raises the shared counter above the highest found; `editor-store.tsx`'s `loadProject` (used by both opening and creating a project) calls it with every id in every scene (`flattenAllScenes`) before anything can be added to or duplicated in it.
Verified: `core/src/node-id-collisions.test.ts` (the counter's own behavior: never moves backward, ignores ids with no numeric suffix, a duplicate right after seeding can't collide) and `ui/.../node-id-collision.test.ts` (an end-to-end reproduction: a "Map" scene with a high-numbered id, instanced into "World", opened, then a node in World duplicated — the new id is proven higher than the seeded one and nothing anywhere collides). Confirmed the regression test actually catches the bug by re-running it with the fix temporarily reverted (it failed, as expected) before restoring the fix.
**Not fixed by this**: ids from a completely different mechanism (imported asset ids, which already use `crypto.randomUUID()`, are unaffected); this only concerns the counter-based scene node ids.
