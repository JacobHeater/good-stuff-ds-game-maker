---
status: done
component: audio
related: [debugger/STORY.hardware-budget-report.md, TASK.audio-asset-playback.md]
---

# Story: Audio node modeled in the hardware budget

## Context
The DS has 16 hardware audio channels (`DS_HARDWARE_PROFILE.audio.channels`).
An `AudioStreamPlayer` node kind exists in the domain model
(`packages/core/src/scene-node.ts`) so scenes can represent "there is a
sound/music player here," and it's counted against the 16-channel
budget in the Hardware tab — but no actual audio file loading or
playback exists anywhere in the app yet.

## Description
`AudioStreamPlayer` nodes can be added to a scene (via the Scene menu's
"Add 2D Node" list — it's modeled as a 2D-space node), appear in the
Scene Tree and Inspector like any other node, and are counted in the
Hardware tab's audio channel budget (`computeSceneBudget.audioPlayersUsed`
vs. `audioChannelsLimit`).

## Acceptance Criteria
```gherkin
Scenario: AudioStreamPlayer nodes count toward the audio channel budget
  Given a scene with 4 AudioStreamPlayer nodes
  Then the Hardware tab's audio channel budget shows "4 / 16"

Scenario: An AudioStreamPlayer node has no actual sound
  Given an AudioStreamPlayer node in the scene
  Then no audio file is associated with it
  And nothing plays when the scene is viewed or the Play button is pressed
```

## Notes
- This story exists specifically to record that the node kind and
  budget counting are intentionally ahead of actual playback — don't
  mistake the presence of `AudioStreamPlayer` in the model for
  functioning audio. Real playback is `TASK.audio-asset-playback.md`.
