---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, node-list, TASK.lock-workspace-to-project-mode.md, project-menu/EPIC.project-menu.md, project-menu/STORY.project-lifecycle-actions.md]
---

# Story: Scene menu — node creation, duplication and deletion

## Context
Godot's "Scene" menu is where you work on the scene that's open. The
Good Stuff DS Game Maker's menu bar originally had a "Scene" button that
did nothing (all top menu items were inert placeholders); this story
replaced it with a real dropdown wired to the editor's scene state. It
has been revised twice since:

1. The node lists became mode-specific when projects committed to 2D or
   3D (`TASK.lock-workspace-to-project-mode.md`).
2. **The Scene menu was narrowed to scene contents only.** When project
   persistence landed, Open/Save/Save As/Close went into this menu because
   it was the only real one, under scene-flavored names ("Save Scene",
   "Close Scene") even though they act on the whole project file. That
   conflated scene management with project management. Those actions now
   live in the Project menu (`project-menu/EPIC.project-menu.md` states
   the ownership rule and the reasons), and "New Scene" was removed
   outright: with exactly one scene per project, created alongside the
   project, it only meant "discard everything and start over" — a
   destructive action with no confirmation and no undo. It returns, with
   a real meaning, if multi-scene support is ever designed.

## Description
`SceneMenu` (`packages/ui/src/editor/layout/SceneMenu.tsx`) is a
dropdown (click to open, click-outside to close) offering only actions
on the open scene's contents:
- **Add {mode} Node** — one list of the node kinds the open project's
  mode allows (2D kinds for a 2D project; 3D kinds plus
  `AudioStreamPlayer` for a 3D project, since audio isn't drawn by
  either pipeline), with icons. Adding a node inserts it as a child of
  whichever node is currently selected (or the scene root if nothing
  meaningful is selected), auto-names it to avoid sibling name
  collisions, and selects the new node. The other mode's kinds are not
  offered.
- **Import Sound...** — asks for a .wav, .mp3 or .ogg file and adds an `AudioStreamPlayer`
  that plays it under the selected node, in 2D and 3D projects
  (`audio/STORY.import-sound-and-audio-player.md`).
- **Duplicate Node** / **Delete Node** — disabled when the scene root
  itself is selected (the root can't be duplicated or deleted).
  Duplicating deep-clones the node and its children with fresh ids and
  inserts the clone as the next sibling.

It offers nothing that acts on the project file — no Open, Save, Save
As, Close or New. Those are in the Project menu
(`project-menu/STORY.project-lifecycle-actions.md`). The remaining menu
bar items (Debug, Editor, Help) are inert placeholders and out of scope.

## Acceptance Criteria
```gherkin
Scenario: The Scene menu contains only scene-editing actions
  When the Scene menu is opened
  Then it offers the Add Node list, "Duplicate Node" and "Delete Node"
  And it offers no New, Open, Save, Save As or Close entry

Scenario: There is no "New Scene" action
  When the Scene menu is opened
  Then no entry replaces or resets the scene tree

Scenario: Adding a node inserts it under the current selection
  Given a 2D project and a node "Player" is selected in the scene tree
  When "Add 2D Node" > "Sprite2D" is chosen
  Then a new Sprite2D node is added as a child of "Player"
  And the new node becomes selected
  And its name does not collide with an existing sibling's name

Scenario: Only the project's own node kinds are offered
  Given a 2D project is open
  Then the Add Node list offers 2D kinds and no 3D kinds
  Given a 3D project is open
  Then the Add Node list offers 3D kinds plus AudioStreamPlayer and no 2D kinds

Scenario: Adding a node falls back to the scene root when nothing suitable is selected
  Given no node is meaningfully selected (or the scene root is selected)
  When a node kind is added from the Scene menu
  Then the new node is added as a child of the scene root

Scenario: Duplicate and Delete are disabled on the scene root
  Given the scene root is the selected node
  Then "Duplicate Node" and "Delete Node" are disabled in the Scene menu

Scenario: Duplicating a node clones its subtree
  Given a node with children is selected
  When "Duplicate Node" is chosen
  Then a full copy of that node and all its children is inserted as the next sibling
  And every node in the copy has a new, unique id
  And the top-level duplicate becomes selected

Scenario: Deleting a node removes it and its subtree
  Given a non-root node is selected
  When "Delete Node" is chosen
  Then that node and all its children are removed from the scene tree
  And if it was selected, the scene root becomes selected instead
```

## Notes
- Node kind lists come from `getNodeKindsForMode` in
  `packages/core/src/project-mode.ts` (built on `SCENE_NODE_KINDS_2D` /
  `SCENE_NODE_KINDS_3D`), so a new node kind added to those arrays
  surfaces in the right mode's menu automatically.
- The store's `NEW_SCENE` action and `newScene` were deleted along with
  the menu entry rather than left as dead code; `createBlankSceneTree`
  stays, since New Project uses it.
- The Project-file scenarios that used to be here (Save writes to disk,
  Close returns to the startup view) moved to
  `project-menu/STORY.project-lifecycle-actions.md`.
