---
status: in-progress
component: persistence
related: [EPIC.project-persistence.md, TASK.define-project-snapshot-interfaces.md, TASK.persist-scene-to-project-file.md]
---

# Task: Generate JSON Schema from the project snapshot interfaces

## Context
The chosen serialization format is JSON, described by a JSON Schema —
and that schema must be **derived from** the TypeScript interfaces
defined in `TASK.define-project-snapshot-interfaces.md`, not authored
independently alongside them. The explicit direction is: interfaces
are the source of truth, schema follows from them. Whether that
derivation is fully automated or requires some manual work is an open
implementation question this task resolves; it is not a reason to
delay committing to the direction.

A schema-first alternative — using a library like Zod to define the
schema and derive TypeScript types from it (`z.infer`) — was
considered and is explicitly not the direction chosen here, since it
inverts the source of truth. Do not switch to that approach without
revisiting this decision explicitly.

## Description
Produce a JSON Schema document (or set of documents, if the snapshot
interface is large enough to warrant splitting) that validates the
`ProjectSnapshot` shape (and anything it references, e.g. `SceneNode`)
from `TASK.define-project-snapshot-interfaces.md`. Prefer generating it
directly from the TypeScript source — candidates to evaluate include
`typescript-json-schema` and `ts-json-schema-generator` — over
hand-authoring it. If generation proves impractical for some part of
the shape, hand-author that part, but make the dependency on the
source interface explicit (e.g. a comment pointing at the exact type,
and/or a test that fails if they drift) rather than leaving it an
unstated assumption.

The schema must actually be used, not just produced: loading a project
file validates its contents against this schema before the app trusts
it as a `ProjectSnapshot`.

## Acceptance Criteria
```gherkin
Scenario: A JSON Schema exists for the project snapshot shape
  Given `TASK.define-project-snapshot-interfaces.md` has landed
  Then a JSON Schema document exists describing the `ProjectSnapshot` shape

Scenario: The schema is derived from the interface, not independently authored
  Given the `ProjectSnapshot` TypeScript interface changes
  Then the JSON Schema can be regenerated (automated case) or the
    drift is caught by an explicit check (manual case) — it cannot
    silently continue describing the old shape

Scenario: Loading a project file validates it against the schema
  Given a project file on disk
  When it is opened
  Then its contents are validated against the JSON Schema before being
    treated as a valid `ProjectSnapshot`

Scenario: An invalid project file is rejected clearly
  Given a project file that does not conform to the schema (corrupted,
    hand-edited incorrectly, or from an incompatible future version)
  When it is opened
  Then it is rejected with a clear error identifying that validation failed
  And it is not silently accepted or partially loaded
```

## Notes
- Evaluate `typescript-json-schema` and `ts-json-schema-generator`
  specifically (both generate JSON Schema from `.d.ts`/TS source); pick
  whichever handles the actual interface shapes from
  `TASK.define-project-snapshot-interfaces.md` most cleanly (discriminated
  unions like `mode: "2D" | "3D"` and the recursive `SceneNode.children`
  shape are worth checking early, since generators vary in how well
  they handle those).
- Runtime validation library (e.g. `ajv`) to actually check a loaded
  JSON payload against the generated schema is in scope here — schema
  generation without anything enforcing it at load time doesn't satisfy
  this task.

**Partially implemented, marked `in-progress` not `done`.** A working
schema and validator exist and are wired in:
`packages/persistence/src/json/project-snapshot.schema.ts`
(`PROJECT_SNAPSHOT_JSON_SCHEMA`) and
`json-schema-project-snapshot-validator.ts`
(`JsonSchemaProjectSnapshotValidator`, using `ajv`). `FileSystemProjectRepository`
calls it on every `save` and `load`, so the "schema must actually gate
loading" and "invalid file rejected clearly" scenarios above are both
satisfied and verified (a manual smoke test confirmed
`ProjectValidationError` is thrown for a schema-invalid file, both
against real disk and an in-memory substitute).

**What's still open:** the schema itself is hand-authored, not
generated from the TypeScript interfaces — the "derived from the
interface, not independently authored" scenario is not yet satisfied
in the automated sense. It's explicitly documented as interim in the
schema file's own comment, and `JsonSchemaProjectSnapshotValidator`
was written so that swapping in a generated schema later is a drop-in
change (nothing else depends on how the schema was produced). Picking
and integrating `typescript-json-schema` or `ts-json-schema-generator`
is the remaining work before this can move to `done`.
