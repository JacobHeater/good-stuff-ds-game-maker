---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, SPIKE.custom-mesh-and-sprite-import.md, STORY.choose-mesh-primitive.md, TASK.obj-parser.md, persistence/TASK.embed-imported-meshes-in-project-file.md, compiler/TASK.compile-imported-meshes.md, debugger/STORY.hardware-budget-report.md, properties-panel/STORY.inspector-panel.md]
---

# Story: Import a 3D model from an .obj file

## Context
Until now every 3D mesh in a project is one of four built-in primitives
(`STORY.choose-mesh-primitive.md`). The compiler, the viewport and the hardware
budget all take their geometry from one shared definition, so a model a user
brings in can take the same path: a table of triangles, converted to DS number
formats at compile time and drawn by the same C runtime.

`SPIKE.custom-mesh-and-sprite-import.md` was written before any of that existed;
its mesh half is now answered by the decisions below, and the sprite half moved to
`SPIKE.sprite-image-import.md`.

## Decisions (made with the product owner)
- **Format: Wavefront `.obj`.** Plain text, every modelling tool exports it, and
  it needs no binary parsing. glTF is a later, separate story if it's wanted.
- **Storage: embedded in the project file.** The parsed model is stored inside the
  `.gsds` (see `persistence/TASK.embed-imported-meshes-in-project-file.md`), not
  copied to an `assets/` folder and not referenced by its original path. That keeps
  the project one shareable file and makes Save As, Export ROM and Play work with no
  project directory (Play works before the first save). Cost: the file browser doesn't
  list models as separate files, and the JSON grows with the model.
- **Doesn't fit: reject at import.** A model whose coordinates fall outside the DS's
  vertex range (about ±8 units) or that has more triangles than one frame can draw
  (about 2048) is refused with a message saying which limit and by how much. There is
  **no automatic rescaling**, so a model authored in larger units has to be scaled
  down in the modelling tool before importing. (Chosen over "scale to fit and warn";
  revisit if refusing turns out to be a common frustration.)
- **Scope: geometry only, one color per mesh.** Positions, normals and faces.
  `.mtl` materials and vertex colors are ignored (with a warning naming
  what was ignored); an imported mesh is drawn in the same single diffuse color as
  the primitives. **Update:** texture coordinates (`vt`) are now read, and a model that has them can be given a
  PNG texture (`STORY.mesh-textures.md`); `.mtl` materials still aren't.

## Description
- **Scene > "Import Model (.obj)..."** (3D projects only) asks for an `.obj`,
  parses it, and, if it's acceptable, adds a `MeshInstance3D` named after the file
  under the selected node, using that model. Failures and warnings go to the
  Output log; a refused file adds nothing and doesn't change the project. It is in
  the Scene menu because it adds a node; the Project menu's rule (acts on the file
  as a whole) doesn't cover it.
- The Inspector's **Mesh** selector lists the project's imported models (by name,
  with triangle count) after the four primitives, so a model can be reused by
  other meshes, or a mesh switched back to a primitive.
- The viewport draws the model, the Hardware tab counts its real triangles, and
  Export ROM / Play compile it.
- A model no mesh uses any more isn't written to the file the next time it's saved.

## Acceptance Criteria
```gherkin
Scenario: Importing adds a mesh that uses the model
  Given a 3D project is open
  When "Import Model (.obj)..." is chosen and a valid .obj is picked
  Then a MeshInstance3D named after the file is added under the selected node and selected
  And the viewport draws the model
  And the Output log says the model was imported and how many triangles it has

Scenario: Import is a Scene menu action for 3D projects only
  Then "Import Model (.obj)..." is in the Scene menu of a 3D project
  And it is not in the Project menu
  And it is not offered in a 2D project

Scenario: Cancelling the file dialog does nothing
  When the file dialog is cancelled
  Then the project is unchanged and shows no unsaved changes

Scenario: The hardware budget counts the model's real triangles
  Given a model with 20 triangles
  When it is imported
  Then the Hardware tab's triangle count rises by 20

Scenario: Quads and larger faces are triangulated
  Given an .obj with quad faces
  Then the imported model has two triangles per quad

Scenario: A model without normals still shades
  Given an .obj with no vn lines
  Then the model is imported with flat per-face normals

Scenario: A model that is too large in space is refused
  Given an .obj with a vertex outside the DS's vertex range
  When it is imported
  Then nothing is added
  And the Output log says which limit it exceeds

Scenario: A model with too many triangles is refused
  Given an .obj with more triangles than the DS can draw in a frame
  When it is imported
  Then nothing is added
  And the Output log gives the model's count and the limit

Scenario: A malformed file is refused with a reason
  Given a file that isn't a usable .obj (no faces, a face naming a vertex that doesn't exist, non-numeric coordinates)
  When it is imported
  Then nothing is added
  And the Output log says what is wrong, with the line number where there is one

Scenario: Ignored content is reported, not silent
  Given an .obj that names a material library
  When it is imported
  Then the model imports
  And the Output log says materials were ignored

Scenario: An imported model can be reused and switched
  Given a model has been imported
  Then another MeshInstance3D's Mesh selector lists it by name
  And choosing it draws it; choosing a primitive draws that instead

Scenario: The model is saved with the project and reopens
  Given a project with an imported model
  When it is saved, closed and reopened
  Then the mesh still uses the model and draws it

Scenario: Unused models are not saved
  Given a model that no mesh uses (its mesh was deleted)
  When the project is saved
  Then the file does not contain that model

Scenario: The compiled ROM draws the model
  Given a scene with an imported model
  When it is compiled and run in the emulator
  Then the ROM draws the model's shape
```

## Notes
- **Built and verified.** `pnpm test` (167 tests, 48 of them new: the parser, geometry, budget,
  translation, schema, name escaping); `tests/prototypes/e2e/import-obj.mjs` (10 checks against the
  real app, including a real Export ROM); and `pnpm test:rom` (10 emulator tests). What the UI script
  covers: a 2D project has no Import entry; the entry is in the Scene menu and not the Project menu;
  cancelling changes nothing (and the dialog is filtered to .obj); five bad files (no faces, a missing
  vertex, a coordinate out of range, 2100 triangles, a text file that isn't a model) are each refused with
  a reason and add nothing; the house imports as a selected node, is drawn, is counted at exactly 14
  triangles, and the ignored materials and missing normals are reported; a second mesh reuses the model and
  can switch to a sphere and back with the budget following (14 to 168 to 14); saving embeds the model once
  for both houses; closing and reopening keeps it; Export ROM builds a valid `.nds`; and deleting both
  users drops the model from the file on the next save.
- **In the emulator:** the project that script authored (two houses, one turned and smaller, beside a cube)
  was compiled and run in melonDS. The picture shows both houses with gables and pitched roofs and the cube;
  its silhouette matches the reference render at an IoU of 0.941. A separate fixture with the same model
  (`importedModelProject`) is in the emulator suite permanently.
- **Not verified / known limits:**
  - Shading is by eye only (the emulator comparison is silhouettes): the faces in the picture are clearly
    lit differently, but no test would notice a wrong normal.
  - Winding isn't checked or repaired. The DS runtime draws with culling off, so a clockwise-wound model is
    still solid in the ROM; the editor draws imported models double-sided for the same reason, so the two
    agree. A model with reversed normals would still shade wrongly in both.
  - Only "unit-ish" models import: nothing is rescaled, so a model exported in larger units is refused
    (with the offending line and value) and has to be scaled in the modelling tool. That was the
    product owner's choice; if it turns out to be a common stumble, "scale to fit" is the obvious follow-up.
  - Normals under a node scale were wrong on the DS; fixed (`compiler/BUG.rom-lighting-breaks-on-scaled-meshes.md`). A non-uniform scale still uses the rotation-only normal, not the inverse transpose.
  - A project containing a model can't be opened by a build of the app from before this change (the
    old schema forbids the new field). Old projects open fine in the new one.
  - Concave polygons are fan-triangulated without repair. Files from tools that triangulate on export
    (most of them) are unaffected.
  - The file dialog and the file read are real code, but the native dialog itself is stubbed in the test,
    as in every E2E script here.
- Verification this ticket depends on: `pnpm test` (parser, geometry, budget,
  translation, schema), `tests/prototypes/e2e/import-obj.mjs` (drives the real UI
  and prints the saved project's path) and `pnpm test:rom` (compiles and runs
  that project in melonDS and compares it with a reference render).
- Per-mesh color, materials and textures, glTF, and rescaling on import are
  deliberately not in this story.
