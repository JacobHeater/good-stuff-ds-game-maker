---
status: done
component: persistence
related: [EPIC.project-persistence.md, scene-designer/STORY.import-obj-model.md, scene-designer/TASK.obj-parser.md, TASK.define-project-snapshot-interfaces.md]
---

# Task: Store imported meshes inside the project file

## Context
`scene-designer/STORY.import-obj-model.md` decided imported models are embedded in
the `.gsds` rather than kept as separate asset files, so the project stays one file
and Save As / Export / Play need no asset directory.

## Description
- `ProjectSnapshot` gains an optional `meshes: ImportedMesh[]`. An `ImportedMesh` is
  `{ id, name, positions, normals, indices }`: unique vertices (three floats each for
  positions and normals) and a triangle index list.
- A mesh instance refers to a model by `mesh.importedMeshId`; a built-in one still
  uses `mesh.primitive`. Exactly one of the two is set.
- **`formatVersion` stays 1.** Both additions are optional, so every existing project
  is still valid and is written back unchanged (no `meshes` key at all when there are
  none). The cost is one-way: an older build of the app rejects a file that contains
  a model (the schema forbids unknown fields). That is acceptable while the app is
  unreleased; the first real release should bump the version for any further change.
- `withUpdatedScene` (used by every save, export and play) drops models that no mesh
  uses, so deleting the last mesh that uses a model doesn't leave its data behind.
- The JSON Schema validates the shape (arrays of numbers, lengths that agree, indices
  in range) and the validator additionally checks that every `importedMeshId` names a
  model that exists in the file, so a file with a dangling reference is rejected on
  open with a message, instead of failing later in the viewport or compiler.

## Acceptance Criteria
```gherkin
Scenario: Existing projects are unaffected
  Given a project saved before imported meshes existed
  Then it opens, and saving it again writes no "meshes" field

Scenario: A project with an imported mesh round-trips
  Given a project with a model and a mesh that uses it
  When it is saved and reopened
  Then the model's data is identical and the mesh still refers to it

Scenario: A dangling reference is rejected
  Given a file whose mesh names a model that isn't in it
  Then opening it fails with a message naming the mesh reference

Scenario: A malformed model is rejected
  Given a model whose normals are a different length from its positions, or whose indices point past its vertices
  Then validation fails

Scenario: A mesh names a primitive or a model, not both and not neither
  Then a mesh with both, or with neither, fails validation

Scenario: Unused models are not written
  Given a model that no mesh refers to
  When the project is saved
  Then the file has no such model, and no "meshes" field if none are left
```

## Notes
- **Done:** `ImportedMesh` and the `meshes` field in core; the schema (`project-snapshot.schema.ts`) plus
  the validator's cross-checks (`json-schema-project-snapshot-validator.ts`); `withUpdatedScene` pruning.
  8 tests in `imported-mesh-schema.test.ts` cover every scenario above, and `import-obj.mjs` checks the
  same against real files: one copy of a model shared by two meshes, and no `meshes` key once nothing uses it.
- Persistence still has no automated schema generation (`TASK.generate-json-schema-from-interfaces.md`), so
  the schema and the TypeScript types for this are kept in step by hand and by these tests.
- File size: a model at the full 2048-triangle limit is a few hundred KB of
  pretty-printed JSON. Fine for now; if it isn't, the format is the place to compact.
