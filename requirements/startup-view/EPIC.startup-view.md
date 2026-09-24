---
status: done
component: startup-view
related: [project-list/EPIC.project-list.md, persistence/EPIC.project-persistence.md, scene-designer/TASK.lock-workspace-to-project-mode.md]
---

# Epic: Startup view

## Context
This Epic was written when launching the app skipped straight into
`EditorShell` with an in-memory sample scene (`createSampleSceneTree()`):
there was no launch screen, no concept of "no project is open," and
critically, no concept of a project having a committed 2D-or-3D identity
at all. `WorkspaceToolbar` let you freely flip between the "2D" and "3D"
tabs at any time, because a scene could hold both 2D and 3D nodes side by
side in one tree. That flexibility was convenient for a scaffold but
wrong for the real product: a real DS game is 2D or 3D as a fundamental,
upfront decision, and the editor should force that same commitment. All
of that has since been built; this section is kept as the reason the
Epic exists.

## Narrative

Godot opens to a Project Manager, not directly into an editor: a
neutral landing screen where you choose to open an existing project,
create a new one, or (eventually) manage settings that apply outside
any single project. This project now has that equivalent: with no
project open it shows the landing screen, not an editor.

This Epic covers the screen itself and its two entry points:

1. **New Project** — creating a project requires choosing its **mode:
   2D or 3D**, in addition to whatever else a project needs (name,
   location). This choice is made once, at creation, and is
   **permanent for the life of that project**. There is no in-editor
   way to convert a 2D project to 3D or vice versa — a user who wants
   the other mode creates a new project from scratch. This is a
   deliberate constraint, not a missing feature: real DS games commit
   to one rendering pipeline, and the editor should mirror that from
   the very first step rather than let a project accumulate both 2D
   and 3D content and only discover the conflict later.
2. **Open Existing Project** — opens a previously created project,
   honoring whatever mode it was created with. The list of existing
   projects to choose from is `project-list`'s concern; this Epic owns
   the entry point into that flow and what happens once one is chosen.

The consequence of the mode commitment lands in the Scene Designer,
not here: once a project is open, `scene-designer` must only expose
that project's committed mode (its `WorkspaceToolbar` should show the
"2D" tab for a 2D project, or the "3D" tab for a 3D project — never
both, and never a way to switch), and the Scene menu's "Add Node"
picker must only offer that mode's node kinds. That enforcement work
is tracked as `scene-designer/TASK.lock-workspace-to-project-mode.md`,
since `startup-view` only owns capturing the choice at creation time,
not enforcing it afterward. **A project's committed mode is stored as
part of the project itself** (a `mode: "2D" | "3D"` field alongside
whatever `persistence/EPIC.project-persistence.md`
defines for the on-disk project format) — it is not something the
editor UI decides per-session.

Both flows depend on real project persistence
(`persistence/EPIC.project-persistence.md`), which now exists, and the
Open flow on `project-list`'s recent-projects list, which is built too.

Stories for this Epic:
- `STORY.startup-landing-screen.md` — the neutral landing screen
  itself (branding, "New Project" / "Open Existing Project" entry
  points), nothing else.
- `STORY.new-project-flow-with-mode-commitment.md` — the New Project
  flow, centered on the mandatory, permanent 2D-or-3D mode choice.
- `STORY.open-existing-project-flow.md` — the Open Existing Project
  flow and its handoff to `project-list`.

## Acceptance Criteria (narrative)
The Startup view is done when: launching the app with no project open
shows a landing screen offering exactly "New Project" and "Open
Existing Project," with no in-memory sample project substituting for
a real one; creating a new project requires the user to explicitly
choose 2D or 3D before the project is created, and that choice is
saved as part of the project and can never be changed from within the
editor afterward; and opening an existing project loads it directly
into the Scene Designer already configured for its committed mode,
with no opportunity presented anywhere to switch it to the other mode.

## Progress
The narrative criteria above are met: the app boots to the landing
screen, New Project requires an explicit, permanent 2D/3D choice, and
Open Existing Project lists recent projects (plus Browse) and restores a
project locked to its stored mode. All three stories are `done`, so the
Epic is too.

This was verified end-to-end by driving the real built Electron app over
the Chrome DevTools Protocol with real files on disk (only the native OS
file dialogs were stubbed, and Electron's user-data directory was pointed
at a temp folder so the recents file was the app's own): 28 checks
covering the landing screen and the empty Open panel, name/mode
validation, 2D and 3D creation, the mode-locked tabs / node kinds /
screen filter, the Scene and Project menus' contents, save / save as /
close / reopen, recording and re-recording of recent projects, opening
from the list without a dialog, refusal of an invalid file, a missing
file shown flagged, remove and clear, and the unsaved-changes guard on
Close, Open and a real window close. Those scripts were throwaways;
there's no test framework in the repo yet, so none of it runs in CI.
Still untested by any automated means: the real native OS dialogs, which
need a person at the keyboard.
