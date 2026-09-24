---
status: in-progress
component: project-list
related: [startup-view/EPIC.startup-view.md, startup-view/STORY.new-project-flow-with-mode-commitment.md, persistence/EPIC.project-persistence.md, project-menu/EPIC.project-menu.md]
---

# Epic: Project list

## Context
The recent-projects store and the startup view's list are built. Where
the list of known projects lives was answered by
`SPIKE.recent-projects-storage.md`; `TASK.recent-projects-store.md` built
it and `STORY.recent-projects-list-on-startup-view.md` shows it. What's
left for this Epic is the second place it appears, the Project menu's
"Open Recent" (`project-menu/STORY.open-recent-in-project-menu.md`, not
built), so the Epic stays `in-progress`.

## Narrative

A user eventually has more than one project and needs a way to see and
reopen them — Godot's Project Manager shows exactly this: a list of known
projects with their name, path, and last-modified time, plus actions to
open, remove from the list (without deleting), or create a new one. Every
project also permanently commits to a 2D-or-3D mode at creation
(`startup-view/STORY.new-project-flow-with-mode-commitment.md`), so the
list shows each project's mode alongside its name — useful at-a-glance
information that also reinforces the choice is fixed (there's no "convert"
action to offer).

This project's version is a **recent projects** list rather than a
registry of every project on disk: the app remembers the projects it has
opened or saved (up to 10, most recent first), in a JSON file in the
per-user app-data directory that only the Electron main process touches.
The reasoning, the alternatives rejected, and the details (what's
recorded, ordering, missing files) are all in
`SPIKE.recent-projects-storage.md`; don't re-derive them here.

The same list is shown in two places: the startup view's "Open Existing
Project" panel, and the Project menu's "Open Recent" section
(`project-menu/STORY.open-recent-in-project-menu.md`). Neither keeps its
own copy.

Tickets for this Epic:
- `SPIKE.recent-projects-storage.md` — done; the decisions.
- `TASK.recent-projects-store.md` — done; the store, the IPC surface, and
  recording on open and save-as.
- `STORY.recent-projects-list-on-startup-view.md` — done; the list on the
  startup view.
- `project-menu/STORY.open-recent-in-project-menu.md` — proposed; the
  list in the Project menu.

## Acceptance Criteria (narrative)
The project list is done when the app remembers the projects a user has
opened or saved, shows them (name, mode, path, last opened) most recent
first from both the startup view and the Project menu, lets the user
reopen one in a single click without being asked for its mode, lets the
user remove an entry without deleting the file, shows a project whose
file has gone missing as unavailable rather than hiding it or failing,
and never lets a broken or absent list file interfere with starting the
app.
