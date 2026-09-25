---
status: done
component: animation
related: [STORY.animation-player-node.md, persistence/EPIC.project-persistence.md, collision/TASK.collision-shape-model-and-persistence.md]
---

# Task: The animation data on a node, and the project file

## Description
A new node kind `AnimationPlayer` (offered in 2D and 3D projects like `AudioStreamPlayer`; it has no transform) and `SceneNode.animation?: AnimationPlayerData`
(core `animation.ts`):

| field | meaning |
|---|---|
| `autoplay` | id of the animation that starts with the game (absent: none) |
| `speed` | playback speed multiplier, 0.05 to 10, default 1 |
| `animations[]` | `{ id, name, length, loop, tracks[] }`; `length` 0.1 to 600 s |
| `tracks[]` | `{ id, nodeId, property, keys[] }`; property is `position`, `rotation`, `scale` (a vector), `visible` (a bool), `volume` or `pitch` (a number) |
| `keys[]` | `{ time, value }` sorted by time, times within `0..length`, no two at the same time; `value` is `{x, y, z}`, a bool or a number to match the property |

`sampleAnimation(animation, time)` gives the value of every track at a time: a straight-line blend between keys, the first key's value before it and the last
key's after it; a bool is stepped. This one function is what the editor preview shows and what the runtime is tested against.

The JSON schema and the validator reject: an unknown property, a value of the wrong kind for its property, keys out of order or outside the length, a length or
speed out of range, two animations (or tracks in one animation) with the same id, two animations with the same name, an `autoplay` that names no animation,
a track whose `nodeId` is not a node in the file, and a track whose property the target node kind does not have. `formatVersion` stays 1.

## Acceptance Criteria
```gherkin
Scenario: Sampling
  Given a position track with keys at 0 s (0, 0, 0) and 2 s (10, 20, 30)
  Then at 0.5 s it is (2.5, 5, 7.5), at 1 s (5, 10, 15), before 0 s (0, 0, 0) and after 2 s (10, 20, 30)
  And a track with a single key is that value at every time
  And a visible track is the value of the latest key at or before the time (the first key's before all of them)

Scenario: Saved and loaded
  Given an AnimationPlayer with two animations, several tracks and keys, and an autoplay
  When the project is saved and loaded
  Then everything is unchanged

Scenario: Bad data is rejected
  Given a file with keys out of order, a key outside the length, a position key whose value is a number, a track on a node that isn't in the file,
    a volume track on a mesh, two animations with the same name, or an autoplay naming nothing
  Then it is rejected with a message naming the animation or track
```

## Notes (built and verified)
- `packages/core/src/animation.ts` (`AnimationPlayerData`, `sampleTrack`, `sampleAnimation`, `animatableProperties`, `currentValueOf`, `isValueForProperty`, `insertKey`,
  `withoutTracksFor`; 15 tests), the schema definitions and `checkAnimations` in the validator (8 tests in `animation-schema.test.ts`: round trip, out-of-order keys, keys past
  the length, wrong-kind values, tracks for missing nodes or properties the node lacks, duplicate names/ids, autoplay naming nothing, out-of-range lengths and speeds).
  `AnimationPlayer` is a 2D-list kind offered in 3D projects too, exactly like `AudioStreamPlayer`.
- A bool value is stepped: before the first key and at every time up to the next key it is the earlier key's value.
