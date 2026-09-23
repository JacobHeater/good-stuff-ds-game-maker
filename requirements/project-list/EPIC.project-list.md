---
status: proposed
component: project-list
related: [startup-view/EPIC.startup-view.md, startup-view/STORY.new-project-flow-with-mode-commitment.md, persistence/EPIC.project-persistence.md]
---

# Epic: Project list

## Context
Nothing in this component exists yet. There is no concept of multiple
projects at all today — the app has exactly one, in-memory, throwaway
scene, created fresh every launch.

## Narrative

Once projects can actually be saved to disk
(`persistence/EPIC.project-persistence.md`), a user will
eventually have more than one, and will need a way to see and reopen
them — Godot's Project Manager shows exactly this: a list of known
projects with their name, path, and last-modified time, plus actions
to open, remove from the list (without deleting), or create a new one.
Every project also permanently commits to a 2D-or-3D mode at creation
(`startup-view/STORY.new-project-flow-with-mode-commitment.md`), so
this list should show each project's mode alongside its name — it's
useful, at-a-glance information, and reinforces that the choice is
fixed (there's no "convert" action to offer here, since none exists).

This Epic covers that list and its actions; the screen that hosts it
is `startup-view`'s concern. Both are explicitly blocked on project
persistence existing first, since there's no saved project format yet
to enumerate or reason about ("last modified," "project name," etc.
all presuppose a real file on disk).

No Stories exist under this Epic yet, for the same reason as
`startup-view`: designing this now would mean guessing at a project
file format that hasn't been decided.
