---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, node-list, TASK.lock-workspace-to-project-mode.md]
---

# Story: Scene menu — node creation, duplication, and deletion

## Context
Godot's "Scene" menu is where you create a new scene and add/duplicate/
delete nodes in the currently open one. The Good Stuff DS Game Maker's
menu bar originally had a "Scene" button that did nothing (all top
menu items were inert placeholders); this story replaced it with a
real dropdown wired to the editor's scene state.

## Description
`SceneMenu` (`packages/ui/src/editor/layout/SceneMenu.tsx`) is a
dropdown (click to open, click-outside to close) offering:
- **New Scene** — replaces the current scene tree with a blank single
  root node.
- **Add 2D Node** / **Add 3D Node** — full lists of every 2D and 3D
  node kind (with icons); adding a node inserts it as a child of
  whichever node is currently selected (or the scene root if nothing
  meaningful is selected), auto-names it to avoid sibling name
  collisions, and selects the new node.
- **Duplicate Node** / **Delete Node** — disabled when the scene root
  itself is selected (the root can't be duplicated or deleted).
  Duplicating deep-clones the node and its children with fresh ids and
  inserts the clone as the next sibling.
- **Save Scene** / **Save Scene As...** / **Close Scene** — currently
  stubbed: they only write a message to the Output log. There is no
  project file backend yet (see
  `persistence/EPIC.project-persistence.md`).

The other menu bar items (Project, Debug, Editor, Help) remain inert
placeholders and are out of scope for this story.

## Acceptance Criteria
```gherkin
Scenario: New Scene resets the tree
  Given a scene with multiple nodes
  When "New Scene" is chosen from the Scene menu
  Then the scene tree is replaced with a single blank root node
  And that root node becomes selected

Scenario: Adding a node inserts it under the current selection
  Given a node "Player" is selected in the scene tree
  When "Add 2D Node" > "Sprite2D" is chosen
  Then a new Sprite2D node is added as a child of "Player"
  And the new node becomes selected
  And its name does not collide with an existing sibling's name

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

Scenario: Save/Save As/Close are stubbed
  Given no project file backend exists yet
  When "Save Scene", "Save Scene As...", or "Close Scene" is chosen
  Then a message is written to the Output log
  And no file is written to disk
```

## Notes
- Node kind lists come from `SCENE_NODE_KINDS_2D` / `SCENE_NODE_KINDS_3D`
  in `packages/core/src/scene-node.ts` — adding a new node kind to
  those arrays automatically surfaces it in this menu.
- **Both "Add 2D Node" and "Add 3D Node" being offered together is
  scheduled to change.** `TASK.lock-workspace-to-project-mode.md` will
  restrict this menu to only the node-kind list matching the open
  project's permanently committed mode. This story's ACs are accurate
  for what's built today — there's no project-mode concept yet — but
  once that task ships, revisit the "Adding a node..." scenarios above
  to reflect that only one kind list is ever offered per project.
