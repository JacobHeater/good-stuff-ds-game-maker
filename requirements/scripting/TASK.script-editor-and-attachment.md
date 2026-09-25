---
status: done
component: scripting
related: [STORY.write-and-run-scripts.md, TASK.script-language-front-end.md, persistence/TASK.embed-scripts-in-project-file.md, properties-panel/STORY.inspector-panel.md, scene-designer/STORY.workspace-tabs-and-screen-filter.md, scene-designer/TASK.undo-redo-for-scene-edits.md, TASK.script-autocomplete.md]
---

# Task: The Script tab, and attaching scripts to nodes

## Context
The `Script` workspace tab has been reserved since the start and shows a "not built yet" placeholder. Scripts are stored inside the
project (`persistence/TASK.embed-scripts-in-project-file.md`) and checked by `TASK.script-language-front-end.md`.

## Description
**Script tab** (both project modes): on the left a list of the project's scripts (name, and how many nodes use it) with **New Script**,
**Rename** and **Delete**; in the middle a code editor (CodeMirror) for the selected script with line numbers, syntax colors for the
language's keywords, built-ins, numbers, strings and comments, automatic indentation after a `:`, and errors and warnings underlined
with their message on hover; below it a Problems list (line:column and message; clicking one moves the cursor there). Diagnostics are
recomputed a moment after typing stops and use the current scene tree and the kinds of node the script is attached to. With no
scripts, an empty state explains and offers New Script. A new script contains `_ready` and `_process` stubs and is named
`Script`, `Script2`, ... Deleting a script asks first when nodes use it, and detaches it from them.

**Inspector:** every node has a **Script** field: None, or one of the project's scripts, with **New Script** (creates one and attaches it) and
**Edit** (opens the Script tab on it). An `AudioStreamPlayer`'s Inspector shows it below the audio player.

**Edits:** creating, renaming, deleting, attaching and detaching are undoable steps; typing in the editor is undoable as one step
per pause of a second (typing merges), and the editor's own text undo is separate from the scene's (Ctrl+Z inside the code editor is the
editor's; the scene's undo works outside it).

## Acceptance Criteria
```gherkin
Scenario: The Script tab lists scripts and edits one
  Given a project with two scripts
  Then the Script tab lists both with their names and how many nodes use them
  And selecting one shows its source in the editor

Scenario: A new script starts with stubs
  When New Script is used
  Then a script named Script with _ready and _process is created, selected, and is part of the unsaved project

Scenario: Errors are underlined and listed
  Given a script with a mistake
  Then the editor underlines it, hovering shows the message, and the Problems list shows its line and column
  And clicking the problem moves the cursor to it

Scenario: Diagnostics follow the scene
  Given a script that uses $Music
  When a node named Music is added, then renamed
  Then the error for $Music goes away and comes back

Scenario: Attaching from the Inspector
  Given a node is selected
  Then the Inspector's Script field lists the project's scripts
  And choosing one attaches it, None detaches it, and New Script creates and attaches a new one

Scenario: Edit opens the script
  Given a node with a script
  When Edit is used in the Inspector
  Then the Script tab is shown with that script selected

Scenario: Rename and delete
  Given a script attached to two nodes
  Then renaming it changes its name everywhere it is shown
  And deleting it asks first, and afterwards both nodes have no script

Scenario: Script edits are undoable
  When a script is created, renamed, deleted, attached or detached
  Then Ctrl+Z (outside the code editor) reverses it, and Ctrl+Shift+Z redoes it

Scenario: Scripts are saved with the project
  Given a project with scripts
  When it is saved, closed and reopened
  Then the scripts, their source and which nodes use them are unchanged

Scenario: Unattached scripts are kept
  Given a script no node uses
  When the project is saved
  Then it is still in the file
```

## Notes
- The editor does not run scripts; Play builds a ROM (`STORY.write-and-run-scripts.md`).
- A duplicated node keeps its script attachment (its own copy of the variables at run time).
- **Built and verified.** `packages/ui/src/editor/script/{CodeEditor,ScriptWorkspace}.tsx`, `panels/ScriptField.tsx`, the script actions in
  the editor store (17 tests in `script-edits.test.ts`), and `tests/prototypes/e2e/script-editor.mjs` (14 checks against the real built
  app with real typing, pasting, clicks and shortcuts: the empty state and New Script, Enter/Tab indentation, three errors and two
  warnings underlined and listed with line:column, clicking a problem, diagnostics following the scene, attaching and detaching from the
  Inspector, per-node member checks, rename, the Inspector's New Script and Edit, undo inside and outside the code editor, delete with
  its confirmation and one-step undo, save/reopen with an unattached script kept, and Export ROM refused for a script error with the
  script, line and column, then built once fixed). That project was then compiled and run in melonDS (`GSDS_SCRIPT_ROM_PROJECT`, see
  `tests/prototypes/README.md`): the script moved the cube to where the equivalent static scene has it (silhouette IoU 0.996, and 0.000
  against the scene without the script).
- Rename is a name field above the editor (each keystroke is merged into one undo step per pause) rather than a separate button.
- Inspector "New Script" attaches and selects the new script but stays on the current tab; **Edit** is what opens the Script tab.
- Undoing a delete restores the selection that was current when the step was taken, so the Inspector may then show another node.
- Not done: a marker in the Scene tree for nodes that have a script.
