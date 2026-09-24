---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, STORY.workspace-tabs-and-screen-filter.md, STORY.scene-menu-node-crud.md, startup-view/STORY.new-project-flow-with-mode-commitment.md, startup-view/STORY.open-existing-project-flow.md]
---

# Task: Lock the workspace to the open project's committed mode

## Context
`startup-view/STORY.new-project-flow-with-mode-commitment.md`
establishes that every project permanently commits to 2D or 3D at
creation. This task is the other half of that rule: the Scene Designer
must actually enforce it once a project is open. Today,
`WorkspaceToolbar` always offers both the "2D" and "3D" tabs and
freely switches between them (documented as current, intended
behavior in `STORY.workspace-tabs-and-screen-filter.md`), and
`SceneMenu` always offers both "Add 2D Node" and "Add 3D Node" node
lists (documented in `STORY.scene-menu-node-crud.md`). Both of those
need to change once a project has a committed mode to enforce.

## Description
Once a project is open, the Scene Designer must only expose the
node/viewport surface for that project's committed mode:
- `WorkspaceToolbar` shows only the "2D" tab for a 2D project, or only
  the "3D" tab for a 3D project (alongside the mode-independent
  `Script`/`Game` tabs) — never both, and there is no control anywhere
  to switch a project's mode.
- The screen filter's existing "no Both while in 3D" behavior is
  unaffected, but is now simply the permanent behavior for a 3D
  project rather than something that only applies "while on the 3D
  tab" (there is no other tab to leave it for).
- `SceneMenu`'s "Add Node" picker shows only the node-kind list
  matching the project's mode (`SCENE_NODE_KINDS_2D` for a 2D project,
  `SCENE_NODE_KINDS_3D` for a 3D project) — the other kind list is not
  offered at all, since there's no viewport that could ever show that
  kind of node in this project.

## Acceptance Criteria
```gherkin
Scenario: A 2D project's workspace never offers a 3D tab
  Given the open project's committed mode is "2D"
  Then the workspace toolbar shows a "2D" tab
  And it does not show a "3D" tab anywhere, under any state

Scenario: A 3D project's workspace never offers a 2D tab
  Given the open project's committed mode is "3D"
  Then the workspace toolbar shows a "3D" tab
  And it does not show a "2D" tab anywhere, under any state

Scenario: The Scene menu only offers node kinds matching the project's mode
  Given the open project's committed mode is "2D"
  Then the Scene menu's "Add Node" picker offers only 2D node kinds
  And it does not offer an "Add 3D Node" section at all

Scenario: Script and Game tabs remain available regardless of mode
  Given a project of either mode is open
  Then the "Script" and "Game" workspace tabs are still both available

Scenario: A 3D project never offers Both Screens
  Given the open project's committed mode is "3D"
  Then the screen filter only offers "Top Screen" and "Bottom Screen"
  And opening or creating a 3D project moves a "Both Screens" filter to "Top Screen"

Scenario: Non-viewport tabs never show the other mode's viewport
  Given a 3D project is open
  When the user selects the "Script" or "Game" tab
  Then a placeholder is shown, not the 2D viewport
```

## Notes
- This task directly changes behavior currently documented as `done`
  in `STORY.workspace-tabs-and-screen-filter.md` (free 2D/3D tab
  switching) and `STORY.scene-menu-node-crud.md` (both node-kind lists
  always offered). When this task ships, revisit both of those
  tickets' acceptance criteria to reflect the new, mode-locked
  behavior instead of leaving them describing since-removed behavior.
- Blocked on the project actually carrying a `mode` field to read in
  the first place — depends on
  `startup-view/STORY.new-project-flow-with-mode-commitment.md` and
  `persistence/EPIC.project-persistence.md` defining where that field
  lives in the persisted project format. Both have landed.

**Implemented.** The mode is read from `state.project.mode` in
`editor-store.tsx`; nothing in the store ever writes it. Enforcement is
in the reducer as well as the UI, so it isn't just hidden controls:
`SET_WORKSPACE` ignores a viewport tab that isn't the project's own,
`SET_SCREEN_FILTER` refuses "both" for 3D, and `ADD_NODE` ignores a
kind the mode doesn't allow. The helpers live in `@goodstuff/core`
(`project-mode.ts`: `getNodeKindsForMode`, `isNodeKindAllowedInMode`,
`createBlankSceneTree(mode)`, `PROJECT_MODES`) and
`workspacesForMode` in `editor-store.tsx`.

Judgment calls worth knowing about:
- **`AudioStreamPlayer` is offered in both modes.** It's declared with
  the 2D kinds but isn't drawn by either pipeline; strictly following
  "only that mode's kinds" would have made audio impossible to add in
  any 3D project. `getNodeKindsForMode("3D")` is the 3D kinds plus it.
- Script/Game tabs used to render the 2D viewport (they fell through
  `state.activeWorkspace === "3D" ? ... : <DualScreenViewport />`). That
  would have leaked the 2D viewport into 3D projects, so they now show
  a "workspace isn't built yet" placeholder.
- The Scene menu shows a single "Add {mode} Node" section.
- `New Scene` used to create a blank tree rooted in the project's mode;
  it has since been removed from the menu
  (`STORY.scene-menu-node-crud.md`, `project-menu/EPIC.project-menu.md`).
  New Project still creates that blank root via `createBlankSceneTree`.

Verified end-to-end against the real app (see
`startup-view/EPIC.startup-view.md`).
