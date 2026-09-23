---
status: in-progress
component: scene-designer
related: [node-list, properties-panel, file-browser, debugger, run-games-locally, persistence]
---

# Epic: Scene Designer

## Context
The Scene Designer is the flagship experience of the Good Stuff DS
Game Maker: the Godot-inspired editor workspace where a DS game's
scenes are actually built. It's the area bounded by `EditorShell`
(`packages/ui/src/editor/EditorShell.tsx`) — the menu bar, workspace
toolbar, the 2D and 3D viewports, and scene-tree editing operations
(the Scene Tree list itself and the Inspector are close neighbors
with their own component folders, `node-list` and `properties-panel`,
since they're independently useful docks even outside scene editing).

This epic exists to give the Scene Designer's already-substantial,
previously-undocumented behavior a durable home, and to track what's
still missing before it's a genuinely usable game-building tool rather
than a working prototype.

## Narrative

A user building a DS game needs to arrange a hierarchy of nodes (2D
sprites, cameras, tilemaps, and now 3D meshes, lights, and cameras)
into a scene, see that arrangement rendered accurately, and get real
feedback on whether it fits inside the DS's actual hardware limits —
the same way Godot lets you build against a target platform's
constraints instead of discovering them at ship time.

Two rendering models coexist because the DS itself has two rendering
engines: a 2D engine with two independent screens (`DualScreenViewport`
renders both physical 256×192 screens side by side, with draggable
sprite markers), and a 3D engine that can only drive one screen at a
time (`Viewport3D`). The 3D viewport went through three iterations
before landing on its current approach — see
`STORY.3d-editing-viewport-native-resolution.md` for why a full-size,
smooth-looking canvas and a tiny authentic-resolution canvas were both
tried and rejected in favor of a single canvas that's large on screen
but renders at the DS's true internal 256×192 resolution. That
decision should not be revisited without reading that ticket first.

Node creation, deletion, and duplication happen through a real "Scene"
menu (not the inert Project/Debug/Editor/Help placeholders next to
it). A live hardware budget report (sprite/triangle/audio usage
against the DS's real limits) for whatever scene is open is shown in
the bottom panel's Hardware tab — that tab's ticket lives under the
`debugger` component (same physical dock as Output/Debugger), not
here, since it's a reporting surface rather than a scene-editing one.

What's still missing, in rough priority order: real project file
persistence (Save/Save As/Open are currently just Output-log stub
messages — nothing survives closing the app; this is tracked as its
own `persistence` component now, not owned here, since it's used by
`startup-view`, `project-list`, and `file-browser` too — see
`persistence/EPIC.project-persistence.md`), undo/redo for
scene edits, a real asset pipeline (custom meshes/sprites instead of
only built-in primitives), and locking a project's workspace to
whichever 2D-or-3D mode it committed to at creation
(`TASK.lock-workspace-to-project-mode.md`, driven by
`startup-view/STORY.new-project-flow-with-mode-commitment.md`).
Multi-scene support (more than one scene open/switchable at a time,
matching Godot's scene tabs) hasn't been designed at all yet and isn't
committed to as a requirement — it's worth a Spike before being scoped
as a Story.

Done for this epic doesn't mean "matches Godot feature-for-feature" —
it means a user can build a real, save-able, hardware-accurate DS
scene from an empty project without leaving the Scene Designer.
