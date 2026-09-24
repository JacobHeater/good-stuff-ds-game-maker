---
status: done
component: run-games-locally
related: [scene-designer/STORY.workspace-tabs-and-screen-filter.md, SPIKE.game-runtime-approach.md]
---

# Story: Play button stub

## Context
The workspace toolbar (`packages/ui/src/editor/layout/WorkspaceToolbar.tsx`)
renders a "▶ Play" button, matching Godot's run-current-scene button.
No game runtime exists yet, so today it's intentionally a no-op stub
rather than a broken/half-working feature.

## Description
Clicking "▶ Play" writes a message to the Output log
("Play pressed (no backend wired up yet).") and does nothing else — no
game window opens, no runtime starts.

## Acceptance Criteria
```gherkin
Scenario: Play button logs a stub message and runs nothing
  When the user clicks the "▶ Play" button
  Then the Output log receives the message "Play pressed (no backend
    wired up yet)."
  And no game window, process, or preview is started
```

## Notes
- **Superseded:** `STORY.play-runs-rom-in-emulator.md` shipped, so Play now builds and runs the
  project and no longer logs this message. The scenario above is history, not current behavior.
- Real behavior was blocked on `SPIKE.game-runtime-approach.md`, which has
  now decided the first milestone is a compiled ROM run in an emulator; the
  replacement is `STORY.play-runs-rom-in-emulator.md`. This stub's behavior
  is still what the app does until that story ships, after which this ticket
  becomes historical and gets a superseded note.
