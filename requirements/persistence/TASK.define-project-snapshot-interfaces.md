---
status: done
component: persistence
related: [EPIC.project-persistence.md, TASK.generate-json-schema-from-interfaces.md, TASK.persist-scene-to-project-file.md, startup-view/STORY.new-project-flow-with-mode-commitment.md]
---

# Task: Define project snapshot interfaces

## Context
There is no interface today representing "everything needed to save
and reconstitute one open project." What exists instead:
- `GameProject` (`packages/core/src/index.ts`): `id`, `name`,
  `version`, `scenes: GameScene[]` — and `GameScene` is just `id`,
  `name`, `screen`, `width`, `height`. No actual scene content.
- `SceneNode` (`packages/core/src/scene-node.ts`): the real, editable
  tree of nodes — but it's held only in live editor state
  (`EditorState.sceneRoot`), never attached to a `GameProject`.
- No `mode: "2D" | "3D"` field anywhere, despite
  `startup-view/STORY.new-project-flow-with-mode-commitment.md`
  requiring every project to carry one permanently.

This task defines the actual shape that gets written to and read from
disk — call it a **project snapshot** — before anything downstream
(schema generation, file I/O wiring) can be built on top of it.

## Description
Design and add TypeScript interface(s) to `packages/core` (alongside
the existing `GameProject`/`SceneNode` types, extending or replacing
them as the design calls for) that together fully represent a
project's persisted state:
- A schema/format version field, so future changes to this shape can
  be migrated rather than silently breaking old saved projects.
- Project-level metadata (id, name, and whatever else a project needs
  — reuse/extend `GameProject`'s existing fields rather than
  duplicating them).
- The project's permanent `mode: "2D" | "3D"`.
- The actual scene content — resolve whether this embeds `SceneNode`
  tree(s) directly (its current shape is already plain, JSON-safe
  data: strings, numbers, booleans, and plain nested objects/arrays —
  no classes, `Map`/`Set`, or functions) or wraps them under
  `GameProject.scenes` in place of the current metadata-only
  `GameScene` shape.

Every field in the resulting interface(s) must be representable as
plain JSON. If a future field would need something JSON can't
represent natively (e.g. a `Date`), define an explicit, documented
string/number encoding for it as part of this task rather than leaving
it ambiguous.

## Acceptance Criteria
```gherkin
Scenario: A single interface represents a full project snapshot
  Given the persistence design work is complete
  Then a TypeScript interface (e.g. `ProjectSnapshot`) exists in
    `packages/core` that includes project metadata, the permanent mode,
    and the actual scene tree content needed to fully reconstitute the project

Scenario: The snapshot interface carries a format version
  Given the `ProjectSnapshot` interface
  Then it includes an explicit schema/format version field

Scenario: The snapshot interface carries the permanent project mode
  Given the `ProjectSnapshot` interface
  Then it includes a `mode` field typed as exactly "2D" or "3D"

Scenario: Every field in the interface is plain-JSON-representable
  Given the `ProjectSnapshot` interface and any types it references
  Then none of its fields are functions, class instances, `Map`, `Set`,
    or other non-JSON-native types
  And any value that isn't natively JSON-safe (e.g. a date) has an
    explicit, documented string/number encoding defined for it

Scenario: The GameProject/SceneNode disconnect is resolved
  Given the current `GameProject.scenes` only holds lightweight
    `GameScene` metadata with no node tree reference
  Then the new snapshot interface(s) close that gap — a project
    snapshot can be traced through to the actual `SceneNode` content
    it contains, not just scene metadata
```

## Notes
- This is intentionally scoped as design/types-only — no
  serialization, no file I/O, no UI. `TASK.generate-json-schema-from-interfaces.md`
  and `TASK.persist-scene-to-project-file.md` both depend on this
  landing first.
- This task decides interface shape; it does not need to decide
  whether schema generation from these interfaces is automated —
  that's `TASK.generate-json-schema-from-interfaces.md`'s call to
  make, but writing plain, tool-friendly interfaces here (avoiding
  overly clever generic/conditional types) will make that task easier
  regardless of which generator it ends up using.

**Implemented.** `ProjectSnapshot`, `ProjectMode`, `PROJECT_SNAPSHOT_FORMAT_VERSION`,
`createProjectSnapshot`, and `withUpdatedScene` now live in
`packages/core/src/project-snapshot.ts`, exported from `@goodstuff/core`.
The snapshot embeds a real `SceneNode` tree directly under `scene`,
closing the `GameProject`/`SceneNode` disconnect. The old, unused
`GameProject`/`GameScene`/`createEmptyProject`/`DS_SCREEN_RESOLUTION`
scaffold was removed outright rather than kept alongside the new type —
a repo-wide search confirmed nothing outside `packages/core/src/index.ts`
itself consumed any of them, so there was no reason to leave two
competing "project" concepts in place.
