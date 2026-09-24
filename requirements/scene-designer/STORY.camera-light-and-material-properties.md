---
status: proposed
component: scene-designer
related: [EPIC.scene-designer.md, STORY.3d-editing-viewport-native-resolution.md, compiler/EPIC.compile-and-export-nds-rom.md, compiler/TASK.ds-scene-intermediate-representation.md, compiler/STORY.compile-3d-scene-to-nds-rom.md, properties-panel/STORY.inspector-panel.md, persistence/TASK.define-project-snapshot-interfaces.md]
---

# Story: Cameras, lights and meshes need the properties a DS scene depends on

## Context
Found while scoping the compiler. A 3D scene in the editor today can say
*where* things are but not *what the game sees or how it looks*:

- **Cameras.** `Camera3D` has a transform and nothing else: no field of
  view, no near or far plane, and no notion of which camera is the one the
  game uses. It's drawn as a gizmo only.
- **Lights.** `DirectionalLight3D` and `OmniLight3D` have a transform and
  nothing else: no color, no intensity. (The editor's viewport hardcodes an
  intensity for both.)
- **Meshes.** `MeshInstance3D` has a primitive and a triangle count and no
  color or material; the viewport paints every mesh the same grey.
- **What the viewport shows.** The 3D viewport is an orbit camera at a fixed
  position (`[4, 3, 6]`, 50° field of view) with a fixed ambient light. It
  never shows the scene *through* a `Camera3D`, so there's no way in the
  editor to see what the game camera will see.

A compiled ROM needs answers to all of these, so the first compiler
milestone (`compiler/STORY.compile-3d-scene-to-nds-rom.md`) uses fixed
defaults. That works, but it means every mesh in the ROM is the same grey,
the field of view can't be changed, and nobody can check a camera's framing
without building a ROM.

## Description
Add the minimum properties, edited in the Inspector, saved in the project
file, and honored by both the editor viewport and the compiler:

- **`Camera3D`**: field of view, near and far planes; and a way to mark
  which camera is the active one (a scene has exactly one).
- **Lights**: color (and a simple intensity for directional lights).
- **`MeshInstance3D`**: a color.
- **A "view through the active camera" mode** in the 3D viewport, alongside
  the existing orbit view, at the DS's 256×192 with the DS aspect ratio, so
  the framing a user sees is the framing the ROM shows.

Every addition is a change to `ProjectSnapshot`'s scene shape, so it must
update the JSON Schema and bump or migrate the format version as
`persistence/EPIC.project-persistence.md` requires.

## Acceptance Criteria
```gherkin
Scenario: A camera has a field of view and clip planes
  Given a Camera3D is selected
  Then the Inspector shows and edits its field of view, near plane and far plane
  And those values are saved in the project file

Scenario: One camera is active
  Given a scene with several Camera3D nodes
  Then exactly one is marked active
  And marking another active unmarks the first

Scenario: The viewport can show the game's view
  When the viewport is switched to the active camera
  Then it shows the scene from that camera, at the DS's 4:3 aspect ratio, with that camera's field of view

Scenario: Lights and meshes have colors
  Given a light or a mesh is selected
  Then the Inspector shows and edits its color
  And the viewport draws it with that color

Scenario: Existing projects still open
  Given a project saved before these properties existed
  When it is opened
  Then it loads, with documented defaults for the missing properties
  And the project is not rejected by schema validation

Scenario: The compiler uses the same values
  Given a scene with a non-default field of view and colored meshes
  When it is compiled
  Then the ROM uses that field of view and those colors

Scenario: The schema and the types agree
  Then the JSON Schema accepts a project with these properties and rejects one with malformed values
```

## Notes
- **Update:** two of the discrepancies found alongside this are fixed and no
  longer part of the gap: a directional light's rotation now aims it in the viewport
  (`BUG.directional-light-ignores-rotation.md`), and the viewport draws the scene as a
  hierarchy (`BUG.3d-viewport-ignores-parent-transforms.md`). What remains is
  the missing properties and the view through the game camera.
- A usability trap found by exporting: every new node starts at the origin, so a
  freshly added `Camera3D` sits inside a freshly added mesh and the ROM shows a
  flat grey screen. Nothing warns about it. Decide here whether new nodes should
  spawn somewhere sensible (a camera pulled back, say) or whether the compiler
  should warn when the camera is inside a mesh.
- Not blocking the first compiler milestone (which has shipped with fixed defaults). Sequence it after the
  walking skeleton has shown which of these actually matter on hardware.
- DS constraints to design against: colors are 15-bit (5 bits per channel),
  so the editor can offer a wider palette than the DS can show, and
  lights are four at most, directional only.
- Decide during implementation how default values are represented so an old
  project and a new project with default values save identically.
