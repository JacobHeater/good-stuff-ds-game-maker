---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, TASK.lock-workspace-to-project-mode.md, STORY.workspace-tabs-and-screen-filter.md, STORY.3d-editing-viewport-native-resolution.md, STORY.dual-screen-2d-viewport.md, startup-view/STORY.new-project-flow-with-mode-commitment.md, compiler/STORY.compile-diagnostics-for-unsupported-content.md, compiler/TASK.ds-runtime-c-template.md]
---

# Story: Choose which screen is 2D when making a 3D project

## Context
The DS's 3D engine drives one screen; the other screen has its own 2D engine (sprites, tile maps, text). Until now a 3D project had a second screen that was
simply blank and could hold nothing. A 3D game usually wants that second screen for a HUD, a menu or a map, and which screen is which matters (the bottom one is the
touch screen).

## Decisions (made with the product owner)
- **First slice = the choice, plus an editable 2D screen.** New Project asks which screen is 2D; the 3D goes on the other one in the editor and in the ROM. 2D nodes
  (Label, Sprite2D, ...) can be added to the 2D screen of a 3D project and arranged in a 256x192 view, and are saved with the project. The ROM does **not** draw them yet
  (there is no 2D compilation, and no sprite images): Export ROM warns per node and the 2D screen stays blank. Drawing 2D on the DS is a later story.
- **Changeable later.** Unlike 2D/3D, this only says which physical screen is which, so a toolbar control swaps them, as one undoable step.
- **Choices and default:** "2D on top" or "2D on bottom", **bottom by default** (the touch screen). Projects saved before this open as 3D on top, 2D on the bottom, which is
  how they always ran. There is no "no 2D screen" choice.

Choices I made without asking (say if any is wrong):
- **Where the choice is kept:** in the `screen` of the scene root (a Node3D, which the 3D engine draws), so it is saved with the scene, undone with the scene, and needs no new
  file field or schema change; the other screen is the 2D one (`getThreeDScreen` and `getTwoDScreen` in core's `screen-layout.ts`). Every node's `screen` follows from what
  draws it: 2D-drawn kinds (Sprite2D, AnimatedSprite2D, Camera2D, TileMap, Label, CollisionShape2D, Area2D, Node2D) on the 2D screen, everything else (3D nodes and the sound and
  animation players) with the 3D engine. A swap rewrites all of them.
- **What can be added:** a 3D project offers the 2D kinds too, under their own heading in Scene > Add Node. A 2D node is put under the scene root (not under a selected 3D node),
  and a 3D node not under a 2D one; a sound or animation player goes under whatever is selected.
- **The view:** the toolbar's screen filter (Top / Bottom, no Both) picks which screen is being edited: the 3D screen shows the 3D editor, the 2D screen a 2D editor with the nodes
  as draggable markers. Opening a project, creating one, or swapping the screens puts the view on the 3D screen.
- **The old `mixed-screens` error is gone:** the project decides where 3D is drawn, so a node's own screen can't put 3D on both.

## Description
- **New Project:** after 3D is chosen, a "2D screen" choice (2D on top / 2D on bottom, bottom selected). Not shown for 2D.
- **Toolbar (3D project):** a "2D screen" select (Top / Bottom) next to the screen filter. Changing it swaps the screens: every node's `screen`, the scene root's, and the view. One
  undo step named "Put the 2D screen on the top/bottom".
- **Viewport:** the 3D editor when the screen being viewed is the 3D one; otherwise the dual-screen view narrowed to that one screen, labelled "2D engine", with a hint while it
  is empty.
- **Scene > Add Node (3D project):** the 3D kinds (and sound and animation players), then "Add 2D Node (the 2D screen)" with the 2D kinds.
- **Compiler:** the ROM's 3D screen is the project's 3D screen. A visible 2D node other than a plain Node2D group gives the warning `two-d-node-not-built`, naming it and its screen.

## Acceptance Criteria
```gherkin
Scenario: New Project asks for the 2D screen of a 3D project
  Given the New Project form
  When 3D is chosen
  Then a "2D screen" choice appears with "2D on bottom" selected
  And it is not shown when 2D is chosen

Scenario: Creating a project with 2D on top
  When a 3D project is created with "2D on top"
  Then the scene root is on the bottom screen, which is the 3D screen
  And the editor opens looking at the bottom screen in the 3D editor, with the toolbar's 2D screen showing Top

Scenario: Nodes go where their engine draws them
  Given a 3D project with 2D on top
  When a MeshInstance3D and a Label are added
  Then the mesh is on the bottom screen and the Label on the top screen
  And the Label is under the scene root even though the mesh was selected

Scenario: The 2D screen has its own editor
  When the screen filter is set to the 2D screen
  Then the 3D editor is replaced by a 256x192 view of that screen labelled "2D engine", showing the Label as a marker
  And when the filter is set to the 3D screen the 3D editor is back

Scenario: Swapping the screens
  When the toolbar's 2D screen is changed
  Then every node's screen is swapped, the view moves to the new 3D screen, and the project has unsaved changes
  And Undo puts everything back as one step, and Redo does it again

Scenario: The choice is saved
  When the project is saved, closed and opened again
  Then the 2D screen is where it was, and the editor looks at the 3D screen

Scenario: An old project
  Given a 3D project saved before this choice existed (scene root on the top screen)
  Then it opens as 3D on top with the 2D screen on the bottom

Scenario: The ROM draws 3D on the chosen screen
  Given a 3D project with 2D on top
  When it is built and run on the emulator
  Then the cube is drawn on the bottom screen (and on the top screen when the screens are swapped)

Scenario: 2D nodes are not built yet
  Given a Label on the 2D screen
  When the project is exported
  Then the ROM builds and a warning names the Label and says the ROM doesn't draw 2D nodes yet

Scenario: 2D projects are unchanged
  Given a 2D project
  Then it has no 2D screen choice, and its screen filter still offers Both, Top and Bottom
```

## Notes (built and verified)
- **Core:** `packages/core/src/screen-layout.ts` (`getThreeDScreen`, `getTwoDScreen`, `screenForKind`, `withThreeDScreen`, `isTwoDVisualKind`, `otherScreen`, `DEFAULT_TWO_D_SCREEN`;
  8 tests), `createBlankSceneTree(mode, twoDScreen)`, `getNodeKindsForMode("3D")` now includes the 2D kinds.
- **Editor:** `SET_TWO_D_SCREEN` and `screenRolesOf` in `editor-store.tsx` (8 tests in `two-d-screen.test.ts`), `NewProjectPanel.tsx`, the toolbar select in `WorkspaceToolbar.tsx`,
  the viewport choice in `EditorShell.tsx`, the 2D screen's label and hint in `DualScreenViewport.tsx`, the two sections of `SceneMenu.tsx`.
- **Compiler:** the scene's screen is `getThreeDScreen(project)`; `mixed-screens` removed; `two-d-node-not-built` added (2 tests updated or added in `translate-scene-3d.test.ts`). No
  runtime change: `main.c` already put 3D on the screen the scene names and left the other one a black backdrop.
- **Through the real app:** `tests/prototypes/e2e/two-d-screen.mjs` (8 checks): the New Project choice appears only for 3D, defaulting to the bottom; a project with 2D on top opens on the
  bottom screen in the 3D editor; the Add Node menu; nodes' screens in the Scene tree; the 2D screen's editor and its Label marker; swap, undo and redo; save, close and reopen;
  Export ROM and its warning. `GSDS_TWO_D_ROM_PROJECT=<the path it prints> pnpm test:rom` then runs that project in melonDS: the cube is on the bottom screen (silhouette overlap
  0.958 with the reference render; 0.974 for the same project swapped, on the top screen). The existing bottom-screen ROM test (`rom-output.rom.test.ts`) uses the new model and passes.
  `e2e.mjs` (28), `undo-redo.mjs` (13), `transform-tools.mjs` (10) and `collision-shapes.mjs` (9) still pass with the toolbar change.
- **Known limits:** the ROM does not draw 2D nodes; nested 2D nodes are shown at their own `position` (not relative to a 2D parent), as in the 2D editor already; the 2D screen's
  nodes can't use scripts, animations or collision on the DS; the swap doesn't ask whether nodes you put on the "wrong" screen by hand should move (they always follow their kind).
