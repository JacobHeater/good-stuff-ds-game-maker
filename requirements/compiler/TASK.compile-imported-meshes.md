---
status: done
component: compiler
related: [EPIC.compile-and-export-nds-rom.md, STORY.compile-3d-scene-to-nds-rom.md, TASK.ds-scene-intermediate-representation.md, scene-designer/STORY.import-obj-model.md, persistence/TASK.embed-imported-meshes-in-project-file.md]
---

# Task: Compile imported meshes

## Context
The compiler turns each distinct mesh into one shared vertex table that every
instance references (`DsPrimitive` in `ds-scene.ts`). Built-in primitives were the
only source. An imported model (`scene-designer/STORY.import-obj-model.md`) is
just another source of the same triangle list, so the runtime doesn't change; the
translation, the triangle budget check and the emulator reference render have to
find the geometry in the right place.

## Description
- One function in `@goodstuff/core` resolves a mesh instance's geometry, from its
  primitive or from the project's imported models, and everything (viewport, budget,
  translator, diagnostics, reference render) uses it, so what is drawn, counted and
  built can't disagree.
- Translation keys shared vertex tables by source (a built-in primitive, or a model
  id), so 20 instances of one model emit one table.
- A mesh that names a model the project doesn't contain is an error naming the node
  (`mesh-without-geometry`), never a crash or a silent omission.
- The generated C names each table by its source; a model's name is sanitized in the
  comment, since a name can contain `*/`.
- Values are still range-checked by the fixed-point converters, as a backstop; the
  importer already refuses models that would fail.

## Acceptance Criteria
```gherkin
Scenario: An imported model compiles
  Given a project with a mesh that uses an imported model
  When it is translated
  Then the scene has a vertex table for that model with its real triangle count

Scenario: Instances share one table
  Given three meshes that use the same model and one that uses a cube
  Then the scene has two vertex tables and four meshes

Scenario: The budget check uses the model's triangles
  Given models whose triangles together exceed the frame limit
  Then compilation is refused with the count and the limit

Scenario: A missing model is an error naming the node
  Given a mesh whose importedMeshId isn't in the project
  Then compilation is refused and the message names the node

Scenario: A hostile name can't break the generated C
  Given a model named "evil */ int x; /*"
  Then the generated C still compiles and the name doesn't appear unescaped

Scenario: The ROM draws the model
  Given a project with an imported model
  When it is built and run in the emulator
  Then the top screen's silhouette matches the reference render of the same project
```

## Notes
- **Done.** `resolveMeshGeometry` / `meshSourceKey` / `describeMeshSource` in `packages/core/src/mesh-geometry.ts`
  are used by the viewport, the budget, the translator, and the emulator test's reference render. `DsPrimitive`
  now has a `key` and a `label` instead of a primitive name. A missing model is the new error code
  `missing-model`. Covered by 7 translation tests and by the `imported` fixture in the emulator suite (passes; and
  the UI-authored project with the house passes at IoU 0.941). The C runtime needed no change.
- The CLI takes the fixture too: `cli compile fixture:imported out.nds`.
- The DS draws with one diffuse color per mesh; imported models use the same
  default as primitives.
