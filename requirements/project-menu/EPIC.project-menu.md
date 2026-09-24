---
status: in-progress
component: project-menu
related: [scene-designer/STORY.scene-menu-node-crud.md, persistence/EPIC.project-persistence.md, startup-view/EPIC.startup-view.md, project-list/EPIC.project-list.md, project-list/SPIKE.recent-projects-storage.md]
---

# Epic: Project menu

## Context
The menu bar has separate "Scene" and "Project" menus, mirroring
Godot's. For a while they weren't separate in practice: "Project" was
an inert placeholder, and the "Scene" menu had quietly absorbed every
project-file action (Open Project, Save Scene, Save Scene As, Close
Scene) because it was the only real menu at the time. The result was a
Scene menu whose "Save Scene" saved the whole *project* and whose
"Close Scene" closed the whole *project*. This Epic exists to fix that
conflation and to be the single place the ownership rule is written
down.

## Narrative

**The ownership rule.** A menu is named for the thing its actions
operate on:

- **Project menu** — actions on the *project file as a whole*: its
  lifecycle (open, save, save as, close) and, later, things that act on
  the project rather than the scene (recent projects, project settings,
  export). Implemented by `ProjectMenu`
  (`packages/ui/src/editor/layout/ProjectMenu.tsx`).
- **Scene menu** — actions on the *contents of the open scene*: adding,
  duplicating and deleting nodes. Implemented by `SceneMenu`
  (`packages/ui/src/editor/layout/SceneMenu.tsx`), owned by
  `scene-designer/STORY.scene-menu-node-crud.md`.

An action lives in exactly one menu. Nothing is duplicated across the
two for convenience; a shortcut for a frequent action (Save, for
instance) is a keyboard-shortcut concern, not a second menu entry.

**Why these words, given a project has exactly one scene today.** The
project file holds one scene tree, created with the project and never
replaced. So "Save Scene" and "Save Project" write the same bytes right
now — but the names still matter, because they'll diverge the moment a
project can hold more than one scene (which is undesigned; see the
multi-scene note in `scene-designer/EPIC.scene-designer.md`). At that
point "Save Scene" means one scene and "Save Project" means the project
file. Naming the actions for what they operate on now means nobody has to
re-learn them later.

**Decisions made here, and their reasons:**

| Action | Menu | Why |
|---|---|---|
| Open Project… | Project | Loads a project file. |
| Save Project | Project | Writes the project file. |
| Save Project As… | Project | Writes the project file to a new location. |
| Close Project | Project | Closes the project and returns to the startup view. It used to be labeled "Close Scene", which was wrong: it closed everything. |
| Add {mode} Node / Duplicate Node / Delete Node | Scene | Edits inside the scene. |
| ~~New Scene~~ | *removed* | With one scene per project, created alongside the project, "New Scene" only meant "throw away everything and start over". That's destructive, has no confirmation and no undo, and it duplicated what New Project is for. It comes back when multi-scene is designed, where it has a real meaning (add a scene to the project). |
| New Project… | *not in this menu* | Creating a project is done from the startup view, which is only shown when no project is open. Adding it here later would use the unsaved-changes guard that now exists. |

**Built since:** `STORY.unsaved-changes-guard.md` — Open Project and
Close Project (and closing the window) no longer silently discard unsaved
edits. That was a data-loss gap that predated this Epic (it was true when
those actions lived in the Scene menu); it also removes the reason "New
Project…" couldn't be added here, though it still isn't (the menu bar is
only visible with a project open, and the startup view owns creation).

**Built since:** "Export ROM..." (`compiler/STORY.export-rom-from-project-menu.md`),
placed after the Save entries and before Close Project. It acts on the project as a
whole, doesn't touch the file, and needs no unsaved-changes guard.

**Not built yet, in rough priority order:**
1. `STORY.open-recent-in-project-menu.md` — an "Open Recent" section.
   Everything it needs now exists (the store, `openProject(filePath)`, the
   unsaved-changes guard); only the menu section is left.
2. A Project Settings entry, which belongs to a component that doesn't
   exist yet.

## Acceptance Criteria (narrative)
The Project menu is done when every project-file action (open, save,
save as, close) is reachable from it and from no other menu; the Scene
menu contains nothing that acts on the project file; no action appears
in both menus; a menu's labels name what the action operates on; and
opening or closing a project can no longer silently discard unsaved
changes.

## Progress
All but Open Recent hold today, and Export ROM... is built (`STORY.project-lifecycle-actions.md` and
`STORY.unsaved-changes-guard.md`, both done, and the reworked
`scene-designer/STORY.scene-menu-node-crud.md`); the guard is verified
against the real app, including a held window close. The Epic stays
`in-progress` only for Open Recent.
