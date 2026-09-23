---
status: proposed
component: scene-designer
related: [EPIC.scene-designer.md, file-browser, audio]
---

# Spike: Custom mesh and sprite import

## Context
3D content today is limited to four built-in primitives (cube, sphere,
plane, cylinder — see `MeshPrimitive` in `packages/core/src/scene-node.ts`),
each with a hardcoded approximate triangle count for the hardware
budget. 2D content (`Sprite2D`, `AnimatedSprite2D`) has no real image
loading at all — nodes exist in the tree but nothing is actually drawn
from an asset. There is no asset pipeline of any kind yet: no import
step, no storage format, no reference from a `SceneNode` to an actual
file.

## Description
This is a Spike, not a committed Story: investigate and propose an
approach for importing real assets (custom 3D meshes and 2D sprite
images) into a project, including:
- What file formats are worth supporting for meshes (glTF is the
  obvious modern candidate, but DS games are also often authored/
  converted from far simpler formats — worth checking what's
  actually practical to hand-author for DS-scale budgets).
- How an imported mesh's real triangle count replaces the current
  hardcoded `MESH_PRIMITIVE_TRIANGLE_COUNT` approximation in the
  hardware budget.
- How imported assets are stored relative to a project (this depends
  on `persistence/EPIC.project-persistence.md` landing first — there's
  no project directory structure to import "into" yet).
- Where imported assets show up in the `file-browser` component.

## Acceptance Criteria
```gherkin
Scenario: Spike produces a written recommendation
  Given the open questions above
  Then a short written recommendation exists covering supported formats,
    storage layout, and hardware-budget integration
  And it explicitly calls out what should become a real Story vs. what's out of scope
```

## Notes
- Do not implement asset import as part of this spike — the point is
  to de-risk the approach before it's scoped as a Story/set of Tasks.
- This is blocked on project persistence existing first
  (`persistence/EPIC.project-persistence.md`), since "import an asset"
  presupposes a project directory to import it into.
