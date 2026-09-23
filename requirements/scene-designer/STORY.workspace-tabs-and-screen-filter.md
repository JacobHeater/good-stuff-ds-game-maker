---
status: in-progress
component: scene-designer
related: [EPIC.scene-designer.md, debugger, run-games-locally, scripting, TASK.lock-workspace-to-project-mode.md]
---

# Story: Workspace tabs and screen filter

## Context
Godot's editor switches between 2D, 3D, Script, Game, and AssetLib
tabs. The DS game maker mirrors this with `WorkspaceToolbar`
(`packages/ui/src/editor/layout/WorkspaceToolbar.tsx`), adapted for
the DS's constraint that 3D output can only target one screen at a
time.

## Description
The workspace toolbar offers four tabs: `2D`, `3D`, `Script`, `Game`.
Switching to `2D` shows `DualScreenViewport`; switching to `3D` shows
`Viewport3D` (see `STORY.3d-editing-viewport-native-resolution.md`).
`Script` and `Game` are visible tabs with no content behind them yet.
The toolbar also holds the screen filter (Both/Top/Bottom — narrowed
to Top/Bottom only while on the 3D tab, since the DS's 3D engine can't
drive both screens at once) and the FPS target selector (30/60, from
`DS_HARDWARE_PROFILE.frameRate.supportedFpsTargets`).

The toolbar also renders a "▶ Play" button, but its behavior belongs
to the `run-games-locally` component, not this one — see
`run-games-locally/STORY.play-button-stub.md` for that.

## Acceptance Criteria
```gherkin
Scenario: Switching workspace tabs changes the visible viewport
  Given the "2D" tab is active
  Then the dual-screen 2D viewport is shown
  When the user selects the "3D" tab
  Then the 3D editing viewport is shown instead

Scenario: Switching to 3D forces a single-screen filter
  Given the screen filter is "Both Screens" while on the "2D" tab
  When the user switches to the "3D" tab
  Then the screen filter changes to "Top Screen" (or stays on whichever
    single screen was already selected)
  And "Both Screens" is not offered as an option while on the "3D" tab

Scenario: FPS target selection updates the status bar
  Given the FPS target is "60"
  When the user selects "30"
  Then the status bar reflects "Target 30 FPS"

Scenario: Script and Game tabs are visible but non-functional
  Given the "Script" or "Game" tab is selected
  Then the tab becomes active (visually selected)
  But no functional content is rendered for it yet
```

## Notes
- Real content for `Script` belongs to the `scripting` component; real
  content for `Game` (an actual runnable preview) and the Play button's
  behavior belong to the `run-games-locally` component. This story only
  covers the tab scaffolding and screen-filter/FPS-target behavior that
  lives directly in `WorkspaceToolbar`.
- **This story's free 2D/3D tab-switching is scheduled to change.**
  `TASK.lock-workspace-to-project-mode.md` will restrict a project to
  only the "2D" or only the "3D" tab, permanently, based on a mode
  committed at project creation (`startup-view/STORY.new-project-flow-with-mode-commitment.md`).
  This story's ACs above are accurate for what's built today — there's
  no project-mode concept yet — but once that task ships, the two
  "Switching..." scenarios above become outdated and should be revised
  to reflect that only one of 2D/3D is ever available per project.
