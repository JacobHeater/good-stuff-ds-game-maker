---
status: in-progress
component: persistence
related: [TASK.define-project-snapshot-interfaces.md, TASK.generate-json-schema-from-interfaces.md, TASK.persist-scene-to-project-file.md, scene-designer/EPIC.scene-designer.md, startup-view/EPIC.startup-view.md, project-list/EPIC.project-list.md]
---

# Epic: Project persistence

## Context
This Epic replaces what used to be a single, under-specified Task
(`TASK.persist-scene-to-project-file.md`). That task tried to cover
"define the file format" and "wire Save/Open to disk" in one ticket
with acceptance criteria that only asserted outcomes ("a file is
written," "reopening restores the tree") without ever pinning down
*what shape that file actually is*. That was called out directly: no
on-disk data format had been defined, and jumping straight to a
generic "Task" undersold how much design work sits underneath it.

It's also not a small gap. Today, `GameProject` (`packages/core/src/index.ts`)
and `SceneNode` (`packages/core/src/scene-node.ts`) are disconnected:
`GameProject.scenes` is only lightweight `GameScene` metadata (id,
name, screen, width, height) — it holds no reference to an actual
`SceneNode` tree at all. The live editor state's `sceneRoot: SceneNode`
exists independently of any `GameProject`. There is currently no
single interface representing "everything needed to reconstitute an
open project," and no `mode: "2D" | "3D"` field anywhere (see
`startup-view/STORY.new-project-flow-with-mode-commitment.md`, which
depends on one existing).

## Narrative

Persistence has to happen in a specific order, because each step
depends on the shape the previous one commits to:

1. **Define the data.** `TASK.define-project-snapshot-interfaces.md` —
   design the actual TypeScript interface(s) representing a full,
   serializable project (metadata, permanent mode, and the real scene
   tree(s)), in `packages/core`, resolving the `GameProject`/`SceneNode`
   disconnect described above. This is the actual starting point, not
   the file-I/O task.
2. **Define the schema.** `TASK.generate-json-schema-from-interfaces.md` —
   produce a JSON Schema for that interface, generated from it
   wherever practical rather than hand-authored independently, so the
   schema can never quietly drift from the TypeScript types it's
   supposed to describe.
3. **Wire it up.** `TASK.persist-scene-to-project-file.md` — given a
   settled format and schema, implement the actual Save/Save As/Open
   flows through the Electron main process, and make `FileSystemPanel`
   reflect real files. This task is now much narrower than it used to
   be: it assumes the format already exists rather than inventing it.

**Format decision, made explicit:** the on-disk format is **JSON**,
described by a **JSON Schema derived from the TypeScript interfaces**
(interfaces are the source of truth; the schema is generated from
them, not the other way around). A schema-first approach where types
are derived from a validation library's schema (e.g. Zod's
`z.infer`) was considered and is explicitly rejected here — it
inverts the direction that was asked for. Whether schema generation
ends up fully automated (e.g. via `typescript-json-schema` or
`ts-json-schema-generator`) or requires some manual authoring is an
implementation detail for that task to resolve, not a blocker to
committing to this direction now.

## Acceptance Criteria (narrative)
This Epic is done when: a `ProjectSnapshot`-shaped interface exists in
`packages/core` as the single source of truth for what a saved project
contains (including its permanent mode); a JSON Schema exists that
validates that shape and is demonstrably derived from the interface
rather than maintained by hand in parallel; and Save/Save As/Open and
the FileSystem dock all operate against that same, validated format —
with no remaining Output-log stub messages standing in for real file
I/O.

## Progress
`TASK.define-project-snapshot-interfaces.md` is done. A new
`@goodstuff/persistence` package now provides the mechanism side of
this Epic — reading, writing, serializing, and validating — designed
explicitly around SOLID, with particular attention to Interface
Segregation and Liskov Substitution (per the user's stated priorities):
- Narrow, single-purpose ports (`ProjectFileReader`, `ProjectFileWriter`,
  `ProjectFileLister`, `ProjectSerializer`, `ProjectSnapshotValidator`)
  rather than one broad "file system" interface, so a consumer that
  only reads never has to depend on write/list capability.
- Two independent implementations of the file-access ports
  (`Node*` classes backed by `node:fs/promises`, and
  `InMemoryProjectFileStore`), verified by a manual smoke test to
  behave identically — same successful round-trip, same thrown error
  types for the same failures — proving genuine Liskov substitutability,
  not just structural interface conformance.
- `FileSystemProjectRepository` composes the ports via constructor
  injection (Dependency Inversion) into the `ProjectRepository` façade
  that `TASK.persist-scene-to-project-file.md` consumes.
- `TASK.generate-json-schema-from-interfaces.md` is partially done: a
  working, ajv-backed validator is wired into the repository and does
  gate loading, but the schema it validates against is still
  hand-authored rather than generated from the TypeScript interfaces —
  see that ticket for what remains.

`TASK.persist-scene-to-project-file.md` is also now done: Save/Save
As/Open/Close are wired end-to-end through `apps/desktop`'s main
process (`project-ipc.ts`) and preload bridge
(`window.goodstuff.project.*`, typed against a shared
`GoodStuffWindowApi` contract in `@goodstuff/core`), consumed by the
editor store and `SceneMenu`/`FileSystemPanel` in `packages/ui`. See
that ticket for what was and wasn't manually verified (native OS
dialog interaction wasn't click-tested by the agent).

**Only remaining open item in this Epic**: the automated JSON Schema
generation in `TASK.generate-json-schema-from-interfaces.md` — the
schema is currently hand-authored, not generated from the TypeScript
interfaces. Everything else in this Epic's narrative acceptance
criteria is satisfied.
