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
Add Node list, which offers it in both 2D and 3D projects — it's
declared alongside the 2D kinds but isn't drawn by either pipeline), appear in the
Scene Tree and Inspector like any other node, and are counted in the
Hardware tab's audio channel budget (`computeSceneBudget.audioPlayersUsed`
vs. `audioChannelsLimit`).

## Acceptance Criteria
```gherkin
Scenario: AudioStreamPlayer nodes count toward the audio channel budget
  Given a scene with 4 AudioStreamPlayer nodes
  Then the Hardware tab's audio channel budget shows "4 / 16"

Scenario: An AudioStreamPlayer node starts with no sound
  Given a newly added AudioStreamPlayer node
  Then no sound is associated with it
  And nothing plays for it when the game is run
  (This used to say nothing plays at all; sounds can now be imported and played, see
  `STORY.import-sound-and-audio-player.md`.)
```

## Notes
- This story recorded that the node kind and budget counting were
  intentionally ahead of actual playback. Playback now exists:
  `STORY.import-sound-and-audio-player.md` (import, an audio player in
  the Inspector, and sounds in the ROM). The audio channel budget here
  still counts every `AudioStreamPlayer` in the scene; the sound memory
  budget is new.
