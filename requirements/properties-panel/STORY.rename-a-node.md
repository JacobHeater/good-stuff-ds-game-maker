---
status: done
component: properties-panel
related: [STORY.inspector-panel.md, scripting/TASK.script-language-front-end.md, collision/STORY.collision-shapes-and-overlap-checks.md, scene-designer/TASK.undo-redo-for-scene-edits.md]
---

# Story: Rename a node in the Inspector

## Context
A node's name was fixed when it was added: `MeshInstance3D`, `CollisionShape3D`, and a number after it if a sibling already had that name.
Scripts find other nodes by name (`$Coin`, `scripting/TASK.script-language-front-end.md`) and a name that two nodes share is an error, so with
several meshes or shapes a script could not name the one it means, and there was no way to change a name in the editor.

## Description
The Inspector starts with a **Name** field for every node (2D and 3D). Typing changes the node's name at once, everywhere it is shown (the
Scene tree, the Output log, the diagnostics of scripts that name it). The name is trimmed; an empty name is not accepted (the field keeps
the old one when it is left). Names need not be unique, but when another node already has the name the field says so, because a script's
`$Name` then cannot tell them apart. Renaming is one undo step per pause in typing.

A script that names the old name is not rewritten: its live diagnostics show the error ("There is no node named ...") straight away, and
Export ROM refuses it.

## Acceptance Criteria
```gherkin
Scenario: Renaming
  Given a node named CollisionShape3D is selected
  When its name is changed to CoinShape in the Inspector
  Then the Scene tree shows CoinShape and the project has unsaved changes
  And one Ctrl+Z restores CollisionShape3D

Scenario: Names are trimmed and can't be empty
  When the name is set to "  Coin  "
  Then the node is named Coin
  And clearing the field does not rename the node, and leaving it restores the name

Scenario: Typing is one step
  When a name is typed over several keystrokes without a pause
  Then one undo undoes all of it

Scenario: A shared name is pointed out
  Given two nodes with the same name
  When one is selected
  Then the Inspector says another node has this name and scripts can't tell them apart

Scenario: Scripts see the new name
  Given a script that uses $Coin
  When the node named Coin is renamed
  Then the script's diagnostics show that there is no node named Coin
```

## Notes (built and verified)
- `panels/NameField.tsx` and the `RENAME_NODE` action (5 tests in `node-rename.test.ts`); the Inspector's old plain-text heading is now this field, so an E2E that
  read the heading (`undo-redo.mjs`) reads the field's value instead. Renaming is checked in the real app in `tests/prototypes/e2e/collision-shapes.mjs` (Scene
  tree, undo, empty and padded names).
- The undo label is "Rename <old name>" (not "... to <new name>"): typing merges into one step, so the label would otherwise show whatever the first keystroke was.
- Not done: renaming in the Scene tree itself (double-click or F2), and rewriting `$Name` in scripts when a node is renamed (the script's live diagnostics show
  the error instead).
