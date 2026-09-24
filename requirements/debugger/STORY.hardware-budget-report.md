---
status: done
component: debugger
related: [scene-designer/EPIC.scene-designer.md]
---

# Story: Hardware budget report

## Context
The whole point of building against a fixed, real target (the DS)
instead of an abstract modern platform is that hardware limits should
be visible while you work, the same way Godot can surface
target-platform limits. `computeSceneBudget`
(`packages/core/src/budget.ts`) computes live usage against
`DS_HARDWARE_PROFILE`, and the "Hardware" tab of `BottomPanel`
(`packages/ui/src/editor/panels/BottomPanel.tsx`) displays it.

## Description
Show, for the currently open scene:
- Sprite (OAM) budget per screen (top/bottom independently), as a
  used/limit count and a progress bar that turns red past 100%.
- Audio channel budget (players in scene vs. 16 channels), same
  used/limit + bar treatment.
- 3D triangle budget (total `MeshInstance3D` triangle cost in the
  scene vs. ~2048/frame), same treatment.
- A static list of fixed hardware facts (CPU, RAM, VRAM, 3D polygon
  budget, max texture size, total scene node count) for reference.

## Acceptance Criteria
```gherkin
Scenario: Sprite budget is tracked per screen independently
  Given 5 Sprite2D/AnimatedSprite2D nodes on the top screen and 2 on the bottom
  Then the top screen shows "5 / 128" sprites used
  And the bottom screen shows "2 / 128" sprites used

Scenario: A budget bar turns red when usage exceeds the limit
  Given a budget's used count exceeds its limit
  Then that budget's progress bar renders in red instead of the normal accent color

Scenario: Triangle budget reflects total MeshInstance3D cost in the scene
  Given MeshInstance3D nodes with combined triangle count of 24
  Then the Hardware tab shows "24 / 2048" for the triangle budget

Scenario: Audio channel budget counts AudioStreamPlayer nodes
  Given 3 AudioStreamPlayer nodes anywhere in the scene
  Then the Hardware tab shows "3 / 16" for audio channels

Scenario: Static hardware facts are always shown
  Given the Hardware tab is active
  Then it lists the DS's fixed CPU, RAM, VRAM, 3D polygon budget, and
    max texture size, regardless of the current scene's content
```

## Notes
- Triangle counts are approximate — they come from
  `MESH_PRIMITIVE_TRIANGLE_COUNT`, a hardcoded per-primitive estimate,
  not real geometry analysis. **This was not accurate, and is now fixed**:
  the sphere and cylinder counts were lower than what the 3D viewport drew
  (480 vs 720, 40 vs 64). The budget now counts from the same geometry the
  viewport draws and the compiler emits (`packages/core/src/primitive-geometry.ts`),
  with a sphere of 168 triangles and a cylinder of 48; see
  `BUG.mesh-triangle-budget-disagrees-with-rendered-geometry.md`. It will
  also need to be revisited once custom
  mesh import lands (`scene-designer/SPIKE.custom-mesh-and-sprite-import.md`),
  since a real imported mesh's actual triangle count should replace
  the estimate.
