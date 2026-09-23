---
status: proposed
component: audio
related: [STORY.audio-node-in-hardware-budget.md, scene-designer/SPIKE.custom-mesh-and-sprite-import.md, run-games-locally/SPIKE.game-runtime-approach.md]
---

# Task: Real audio asset import and playback

## Context
`AudioStreamPlayer` nodes exist in the domain model and are counted in
the hardware budget (see `STORY.audio-node-in-hardware-budget.md`),
but there is no way to attach an actual sound file to one, and nothing
plays audio anywhere in the app.

## Description
Allow an `AudioStreamPlayer` node to reference a real audio asset
(imported into the project — this depends on the broader asset
pipeline question in `scene-designer/SPIKE.custom-mesh-and-sprite-import.md`,
since audio and mesh/sprite import share the same "where do project
assets live" question), and have it actually play during a game
preview (which depends on `run-games-locally/SPIKE.game-runtime-approach.md`
deciding what "running the game" means at all).

## Acceptance Criteria
```gherkin
Scenario: An AudioStreamPlayer node can reference an audio asset
  Given an AudioStreamPlayer node and an imported audio file
  When the user assigns that file to the node via the Inspector
  Then the node stores a reference to that asset

Scenario: Assigned audio plays during a game preview
  Given an AudioStreamPlayer node with an assigned audio asset
  When the game is run (Play, or whatever the eventual runtime is)
  Then that audio asset plays as part of the running preview
```

## Notes
- Blocked on both the asset-import approach and the game-runtime
  approach being decided first — this task shouldn't be started until
  at least one of those two Spikes has a resolution.
