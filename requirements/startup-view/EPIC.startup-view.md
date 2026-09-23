---
status: proposed
component: startup-view
related: [project-list/EPIC.project-list.md, persistence/EPIC.project-persistence.md, scene-designer/TASK.lock-workspace-to-project-mode.md]
---

# Epic: Startup view

## Context
Nothing in this component exists yet. Today, launching the app skips
straight into `EditorShell` with an in-memory sample scene
(`createSampleSceneTree()`) — there is no launch screen, no concept of
"no project is open," and critically, no concept of a project having a
committed 2D-or-3D identity at all. The current `WorkspaceToolbar`
lets you freely flip between the "2D" and "3D" tabs at any time,
because every scene today can technically hold both 2D and 3D nodes
side by side in one tree (see `createSampleSceneTree()`, which
populates both). That flexibility is convenient for a scaffold but
wrong for the real product: a real DS game is 2D or 3D as a
fundamental, upfront decision, and the editor should force that same
commitment.

## Narrative

Godot opens to a Project Manager, not directly into an editor: a
neutral landing screen where you choose to open an existing project,
create a new one, or (eventually) manage settings that apply outside
any single project. This project has no equivalent yet — it behaves
as if exactly one project is always open, because in-memory sample
data stands in for a real project.

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
   honoring whatever mode it was created with. The actual list of
   existing projects to choose from is `project-list`'s concern; this
   Epic only owns the entry point into that flow.

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

Both flows are blocked on real project persistence
(`persistence/EPIC.project-persistence.md`) existing,
since there's no saved project format to write a new project into or
read an existing one from yet. `project-list` is blocked the same way.

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
