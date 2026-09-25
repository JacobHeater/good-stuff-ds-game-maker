---
status: done
component: compiler
related: [EPIC.compile-and-export-nds-rom.md, STORY.compile-3d-scene-to-nds-rom.md, TASK.ds-runtime-c-template.md, scene-designer/BUG.editor-lighting-differs-from-rom.md, scene-designer/STORY.directional-light-intensity.md]
---

# Bug: A scaled mesh ignores the lights in the ROM, and a scene with no light is black

## What was seen
A textured plane in the editor looked reasonably lit; the same scene in the emulator was very dark, the light
having no visible effect. Reported by the product owner from a screenshot of each.

## Cause (measured, not guessed)
A probe scene (a flat grey plane facing the camera, one directional light at a chosen angle) was built into ROMs
and its center pixel read from the emulator:

| Plane | Light at 0° | 60° | 90° (edge on) | No light |
|---|---|---|---|---|
| **Scaled 3x** (before the fix) | 60 | 60 | 60 | **0 (black)** |
| **Unscaled** | 247 | 158 | 60 | (not measured) |

- **Scaled meshes lose the light entirely.** The DS's geometry engine transforms a normal by the same matrix as
  its position and never renormalizes it. The compiler baked the whole world matrix, scale included, into one
  matrix, so a mesh scaled 3x had normals 3 long; the lighting arithmetic overflows and the result is the ambient
  term alone. Any mesh with a scale other than 1 was affected (the earlier "normals under non-uniform scale are
  wrong" note understated it: even a uniform scale broke lighting).
- **A scene with no light is pure black.** The runtime turns lighting on per polygon only when the scene has
  lights, and never set a vertex color for the unlit case, so unlit polygons took the engine's default: black.

## Fix
- The compiler splits each mesh's baked world transform into a **rotation + translation** matrix and a separate
  **scale**. The runtime multiplies the first into both the position and the vector (normal) matrices, then applies
  the scale to the **position matrix only**, so normals stay unit length (and non-uniform scale no longer skews them).
- **No lights means unlit:** the runtime sets each mesh's diffuse color as the vertex color and draws it flat,
  full brightness (a textured mesh: the texture as it is). This is now the defined behavior in the editor too.

## Acceptance Criteria
```gherkin
Scenario: A scaled mesh is lit like an unscaled one
  Given a plane scaled 3x and the same plane unscaled, each lit straight on
  When both are built and run in the emulator
  Then their brightness is the same

Scenario: Brightness follows the angle of the light
  Given a flat plane lit at 0, 45, 60, 75 and 90 degrees to its normal
  Then the emulator shows the brightness the DS lighting formula gives at each angle (within a few levels)

Scenario: A non-uniformly scaled mesh is still lit
  Given a mesh scaled (3, 1, 2)
  Then its brightness is that of the unscaled mesh at the same angle

Scenario: No light means unlit, not black
  Given a scene with no light
  Then meshes are drawn at their own color, full brightness, not black

Scenario: The transform split is exact
  Given any combination of translation, rotation and scale, nested or not
  Then rotation-and-translation times scale reproduces the original transform
  And the rotation part has unit-length axes

Scenario: A mirrored mesh still splits correctly
  Given a negative scale
  Then the product still reproduces the transform, and the rotation part is a proper rotation
```

## Notes
- **Fixed and verified in real ROMs** (`packages/compiler/src/testing/lighting.rom.test.ts`, 10 tests): a plane scaled 3x, lit at
  0, 45, 60 and 90 degrees, reads what the DS formula gives (within 14 of 255; melonDS turns the DS's 5-bit result into 8 bits a
  little below full scale, so a full-brightness surface reads about 247); a scaled and an unscaled plane read the same; a plane
  scaled (3, 1, 2) reads the same; light intensity 50% reads the formula's value for a level-16 light (straight on and at 60
  degrees); 0% is black; and **a scene with no light is unlit grey, not black**.
- **The second cause took two tries.** Setting the vertex color (`glColor`) for the unlit case did nothing, because on the DS every
  *normal* command recomputes the vertex color as emission plus the enabled lights, so with no lights the color is just the
  emission (black). The fix is to make the mesh's own color the emission when the scene has no lights (`main.c`).
- Also verified: `splitScale` (`lighting.test.ts`) reproduces the transform exactly for scale/rotation/translation mixes, nested
  parents, mirrored transforms and a collapsed axis, with unit-length rotation axes and a proper rotation every time.
- The committed fallback `runtime/source/scene_data.c` was regenerated (the mesh layout gained a `scale`).
- Position matrices are unchanged, so nothing about where meshes are drawn changes; the silhouette tests still apply.
- Not fixed and not fixable cheaply: a non-uniform scale's *correct* normal (the inverse transpose) differs a little from
  the rotation-only normal used now. Both the ROM and the editor use the rotation-only one, so they agree.
