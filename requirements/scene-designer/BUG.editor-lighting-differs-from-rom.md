---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, BUG.directional-light-ignores-rotation.md, STORY.directional-light-intensity.md, STORY.3d-editing-viewport-native-resolution.md, compiler/BUG.rom-lighting-breaks-on-scaled-meshes.md]
---

# Bug: The editor's lighting doesn't look like the ROM's

## What was seen
A light placed right next to a subject still left it looking very dark in the editor, and the editor and the
ROM disagreed about how bright things were.

## Causes
The viewport lit meshes with three.js's physically based lighting, which is a different model from the DS's:
- **Three.js divides light by π** in its current lighting mode, and applies **filmic tone mapping** (react-three-fiber's
  default), so a light of 0.8 lit a surface to roughly a quarter of its color, dimmer and desaturated. The DS has neither.
- **The DS light is a color, not a strength**: each directional light adds `(ambient + diffuse * cos) * light color` to a
  vertex's color, with a fixed ambient (8 of 31) and the mesh's diffuse color (24 of 31 for a plain grey mesh, white for
  a textured one), clamped at full brightness. A surface facing a white light reaches full brightness.
- **Lighting is per vertex** on the DS (colors are computed at the corners and blended across the face); the viewport
  computed it per pixel.
- **Omni lights lit the viewport but are skipped by the compiler**; the viewport also drew every light in a single
  physically based way, while the DS draws at most four directional ones.
- **A directional light has no position in its effect, only a direction.** Moving it "close to" a subject changes
  nothing; what matters is which way it points (its local -Z). But the editor drew the light as a small glowing
  shape with nothing showing where it pointed, so a light aimed away from the subject looked like a light that was
  "close and not working". A newly added light also started pointing along -Z, which lights very little.

## Fix
- The viewport shades meshes with the **DS's model**: the same formula, per vertex, no tone mapping and no gamma,
  the same ambient and diffuse values (shared with the compiler from `@goodstuff/core`), up to four directional
  lights (an omni light is drawn as a gizmo but lights nothing, as in the ROM), and **no lights means unlit**.
  Normals are rotated without scale, as in the ROM (`compiler/BUG.rom-lighting-breaks-on-scaled-meshes.md`).
- A directional light's gizmo now **shows its direction**: a line and arrowhead along its -Z.
- A **newly added DirectionalLight3D** starts angled down and to the side (rotation -45, -30, 0) rather than along -Z.

## Acceptance Criteria
```gherkin
Scenario: The editor shows the brightness the DS lighting formula gives
  Given a flat plane and a light at 0, 45, 60 and 90 degrees to its normal
  Then the brightness in the viewport matches the formula, within a few levels

Scenario: The editor and the ROM agree
  Given the same scene
  Then the plane's brightness in the viewport and in the emulator differ by no more than a few levels

Scenario: A scaled mesh is lit like an unscaled one in the editor
  Given a plane scaled 3x
  Then its brightness equals the unscaled plane's

Scenario: No lights means unlit
  Given a scene with no light
  Then meshes show their own color at full brightness

Scenario: Omni lights don't light the viewport
  Given a scene with only an OmniLight3D
  Then it behaves as a scene with no light (as in the ROM)

Scenario: At most four lights shade
  Given five directional lights
  Then the first four shade the scene

Scenario: A light shows where it points
  Given a DirectionalLight3D
  Then its gizmo has a line and arrowhead along its -Z, and it turns when the light is rotated

Scenario: A new light points somewhere useful
  When a DirectionalLight3D is added
  Then its rotation is (-45, -30, 0), so it lights surfaces facing up and toward the camera side

Scenario: Textures and selection are not distorted
  Given a textured mesh
  Then its colors are the texture's own colors times the lighting, with no tone mapping
  And selecting it tints it, without changing what lighting does
```

## Notes
- **Fixed and verified** (`tests/prototypes/e2e/lighting-parity.mjs`, 9 checks, against the real app, reading the viewport's actual
  pixels). At 0, 45, 60 and 90 degrees the viewport reads **255, 205, 164, 66**; the DS formula says 255, 205, 165, 66 (the ROM test
  holds the emulator to the same formula). A plane scaled 3x, 2x and (3, 1, 2) is lit the same; a scene with no light shows the
  plane's own grey (197) rather than black; the plane has no color cast (no tone mapping or gamma). Also checked: a new directional
  light starts at rotation (-45, -30, 0), and a light's arrow turns when the light is rotated.
- **Answer to "the light is very close to the subject but it looks dark":** a directional light's position has no effect on the
  lighting; only the way it points does. Before this, a new light pointed along -Z and nothing in the editor showed that, and three.js's
  lighting was additionally dimmer than the DS's. Both are fixed, and the arrow makes the direction visible.
- The lighting is in `ds-lighting-material.ts` (a small shader; per-vertex, like the DS); `DirectionalLightMarker` registers each
  drawn light with it; an omni light is drawn but lights nothing (as in the ROM); at most four lights shade.
- **Not verified:** the editor's per-vertex shading of a sphere or imported model against the ROM's, pixel by pixel (checked on flat
  surfaces, where per-vertex and per-pixel agree and the numbers are exact); a scene with five or more directional lights (the compiler
  refuses it; the viewport uses the first four in mount order, which is not necessarily tree order); and lights inside a rotated,
  scaled parent (their direction is read from the world matrix and normalized, but not exercised).
- The lighting is done in a custom shader in `Viewport3D.tsx`; picking, double-sided drawing and textures work as before.
- Per-vertex shading means a sphere's terminator (where light falls off) looks faceted, as on the DS. That is the point.
