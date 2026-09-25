---
status: done
component: collision
related: [STORY.collision-shapes-and-overlap-checks.md, persistence/TASK.embed-scripts-in-project-file.md, persistence/EPIC.project-persistence.md]
---

# Task: The collision shape on a node, and the project file

## Context
`STORY.collision-shapes-and-overlap-checks.md`. A `CollisionShape3D` has no data of its own yet.

## Description
`SceneNode.collision?: CollisionShapeData` (core `collision-shape.ts`), meaningful only on a `CollisionShape3D`:

| field | meaning | default |
|---|---|---|
| `shape` | `"box"`, `"sphere"`, `"capsule"` or `"cylinder"` | box |
| `size` | `{x, y, z}`: a box's full width, height and depth | 1, 1, 1 |
| `radius` | sphere, capsule and cylinder | 0.5 |
| `height` | capsule (total, with its ends) and cylinder | 2 |

Every field is optional in a saved file, and a node without `collision` has the defaults (`getCollisionShape(node)` fills them in). Each
size is a number from 0.01 to 1000 (`COLLISION_SIZE_MIN`, `COLLISION_SIZE_MAX`); a capsule's `height` is never less than twice its
`radius` (`normalizeCollisionShape`). The JSON schema and the validator reject an unknown shape name, an unknown key, and a size outside
the range; `formatVersion` stays 1 (an older build rejects a file that has the new key, as with sounds and scripts).

## Acceptance Criteria
```gherkin
Scenario: Defaults
  Given a node with no collision data
  Then getCollisionShape gives a box of 1 x 1 x 1, radius 0.5 and height 2

Scenario: A capsule is never squashed
  Given a capsule whose height is less than twice its radius
  Then normalizing raises the height to twice the radius

Scenario: Saved and loaded
  Given a CollisionShape3D with a sphere of radius 2
  When the project is saved and loaded
  Then the node still has that shape and radius

Scenario: Bad data is rejected
  Given a file whose collision shape is "cone", or whose radius is 0 or negative, or that has an unknown key
  Then it is rejected and the message names the node
```

## Notes (built and verified)
- `packages/core/src/collision-shape.ts` (`CollisionShapeData`, `getCollisionShape`, `normalizeCollisionShape`; 5 tests), the `collisionShapeData`
  definition in the JSON schema and `collision` on `SceneNode` (5 tests in `collision-shape-schema.test.ts`: round trips, an unknown shape, an unknown key,
  a size of 0, negative or over 1000, and the message names `/collision/shape`). A capsule shorter than it is wide is accepted from a file and read as twice
  its radius tall (rather than rejected), so an older or hand-edited file still opens.
- A saved shape stores every field once the shape has been edited in the editor (so switching between shapes keeps each one's sizes); a node that was never
  edited has no `collision` key at all.
