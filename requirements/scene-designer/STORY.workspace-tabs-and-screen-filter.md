---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, TASK.lock-workspace-to-project-mode.md, debugger, run-games-locally, scripting]
---

# Story: Workspace tabs and screen filter

## Context
Godot's editor switches between 2D, 3D, Script, Game, and AssetLib
tabs. The DS game maker mirrors this with `WorkspaceToolbar`
(`packages/ui/src/editor/layout/WorkspaceToolbar.tsx`), with one
deliberate difference: a project commits to 2D *or* 3D at creation and
can never change (see `TASK.lock-workspace-to-project-mode.md`), so a
project only ever shows its own viewport tab. This story originally
documented free 2D/3D switching, which existed only because the
scaffold had no concept of a project mode; it was revised when the lock
shipped.

## Description
The workspace toolbar offers three tabs: the project's own viewport
(`2D` for a 2D project, `3D` for a 3D project — never both) plus
`Script` and `Game`. The `2D` tab shows `DualScreenViewport`; the `3D`
tab shows `Viewport3D` (see
`STORY.3d-editing-viewport-native-resolution.md`). `Script` and `Game`
are visible tabs with only a "not built yet" placeholder behind them.
Opening or creating a project selects its viewport tab.

The toolbar also holds the screen filter and the FPS target selector
(30/60, from `DS_HARDWARE_PROFILE.frameRate.supportedFpsTargets`). The
screen filter is Both/Top/Bottom for a 2D project; a 3D project only
gets Top/Bottom, since the DS's 3D engine can't drive both screens at
once.

The toolbar also renders a "▶ Play" button, but its behavior belongs
to the `run-games-locally` component, not this one — see
`run-games-locally/STORY.play-button-stub.md`.

## Acceptance Criteria
```gherkin
Scenario: A project shows only its own viewport tab
  Given a 2D project is open
  Then the toolbar offers "2D", "Script" and "Game" and no "3D" tab
  And the dual-screen 2D viewport is shown
  Given a 3D project is open
  Then the toolbar offers "3D", "Script" and "Game" and no "2D" tab
  And the 3D editing viewport is shown

Scenario: A 3D project never offers Both Screens
  Given a 3D project is open
  Then the screen filter offers only "Top Screen" and "Bottom Screen"
  And if the filter was "Both Screens" it moves to "Top Screen"

Scenario: A 2D project offers all three screen filters
  Given a 2D project is open
  Then the screen filter offers "Both Screens", "Top Screen" and "Bottom Screen"

Scenario: FPS target selection updates the status bar
  Given the FPS target is "60"
  When the user selects "30"
  Then the status bar reflects "Target 30 FPS"

Scenario: Script and Game tabs show a placeholder
  Given the "Script" or "Game" tab is selected
  Then the tab becomes active (visually selected)
  And a "workspace isn't built yet" placeholder is shown
  And neither mode's viewport is shown
```

## Notes
- Real content for `Script` belongs to the `scripting` component; real
  content for `Game` (an actual runnable preview) and the Play button's
  behavior belong to the `run-games-locally` component. This story only
  covers the tab scaffolding and screen-filter/FPS-target behavior that
  lives directly in `WorkspaceToolbar`.
