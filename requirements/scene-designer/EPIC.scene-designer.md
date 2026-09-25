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
menu, which acts only on the scene's contents. Everything about the
project file itself (open, save, close) is in the separate "Project"
menu, owned by `project-menu` — see `project-menu/EPIC.project-menu.md`
for the ownership rule. (Debug/Editor/Help remain inert placeholders.) A live hardware budget report (sprite/triangle/audio usage
against the DS's real limits) for whatever scene is open is shown in
the bottom panel's Hardware tab — that tab's ticket lives under the
`debugger` component (same physical dock as Output/Debugger), not
here, since it's a reporting surface rather than a scene-editing one.

Now built: real project persistence (Save/Save As/Open/Close work and
the project survives closing the app; owned by the `persistence`
component, not here, since `startup-view`, `project-list` and
`file-browser` use it too — see `persistence/EPIC.project-persistence.md`),
and the workspace lock — a project commits to 2D or 3D at creation
(`startup-view/STORY.new-project-flow-with-mode-commitment.md`) and the
Scene Designer only ever shows that mode's viewport tab and node kinds
(`TASK.lock-workspace-to-project-mode.md`).

The toolbar has **Select / Move / Rotate / Scale** tools (`STORY.transform-tools-on-toolbar.md`, done)
that put a gizmo on the selected 3D node in the viewport, so nodes can be placed by dragging as well as by
typing numbers. Custom 3D models can now be imported from `.obj` files
(`STORY.import-obj-model.md`, done): geometry only, one color, embedded in the project file.

**Textures:** a PNG can be imported and put on a 3D mesh (`STORY.mesh-textures.md`, done): converted to the DS's
16-bit format at import (a size the DS can't use is refused), drawn in the viewport, counted in the hardware
budget, and compiled into the ROM.

**Sound:** a sound (WAV, MP3 or OGG) can be imported (`audio/STORY.import-sound-and-audio-player.md`, done) and played by an
`AudioStreamPlayer`, whose Inspector is an audio player: a preview with play/stop and a position bar, autoplay on load, volume,
pitch and loop. Sounds are embedded in the project file already converted (mono, 16-bit, at most 32 kHz) and compiled into the ROM.

**Lighting** in the viewport now follows the DS's own model (`BUG.editor-lighting-differs-from-rom.md`, done): per vertex, no tone
mapping, unlit when there are no lights, with a direction arrow on each directional light; and a directional light has an
**Intensity** slider (`STORY.directional-light-intensity.md`, done). Comparing the editor with real ROMs found that the ROM
ignored lights on scaled meshes, fixed in `compiler/BUG.rom-lighting-breaks-on-scaled-meshes.md`.

**Undo/redo** for scene edits works (`TASK.undo-redo-for-scene-edits.md`, done): Ctrl+Z / Ctrl+Shift+Z and
Scene menu entries, one step per typed value or drag.

What's still missing, in rough priority order: image assets for 2D sprites (`SPIKE.sprite-image-import.md`),
per-material colors and textures for models, and the properties a 3D scene needs to say
what the game shows (camera field of view and active camera, light and
mesh colors, a view through the game camera —
`STORY.camera-light-and-material-properties.md`, found while scoping the
compiler). Also open: the FPS target isn't saved in the project
(`TASK.save-fps-target-in-project.md`). A mesh's primitive can now be chosen in
the Inspector (`STORY.choose-mesh-primitive.md`, done). Three defects the
compiler exposed are fixed: the budget's sphere and cylinder triangle counts
(`debugger/BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md`), the
viewport ignoring parent transforms (`BUG.3d-viewport-ignores-parent-transforms.md`)
and a directional light's rotation doing nothing
(`BUG.directional-light-ignores-rotation.md`). Multi-scene support (more than one scene open/switchable at a time,
matching Godot's scene tabs) hasn't been designed at all yet and isn't
committed to as a requirement — it's worth a Spike before being scoped
as a Story.

Done for this epic doesn't mean "matches Godot feature-for-feature" —
it means a user can build a real, save-able, hardware-accurate DS
scene from an empty project without leaving the Scene Designer.
