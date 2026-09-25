---
status: done
component: persistence
related: [audio/STORY.import-sound-and-audio-player.md, audio/TASK.sound-import-conversion.md, TASK.embed-imported-textures-in-project-file.md, EPIC.project-persistence.md]
---

# Task: Embed imported sounds and audio player settings in the project file

## Context
Imported models and textures live inside the `.gsds` (`meshes`, `textures`), so a project is one file. Sounds do the same.
`formatVersion` stays 1 because everything is optional and additive; a build from before this change refuses (or, with an older
schema, rejects) a project that contains sounds, the same one-way compatibility models and textures have.

## Description
- `ProjectSnapshot.sounds?: ImportedSound[]`: `{ id, name, sampleRate, samples }`, `samples` being base64 of little-endian signed 16-bit
  mono PCM. Absent when there are none, so a project that never imported one is byte-identical to before.
- `SceneNode.audio?: { soundId?, autoplay, volume, pitch, loop }` on an `AudioStreamPlayer`. Absent means the defaults: no sound,
  autoplay on, volume 1, pitch 1, no loop.
- The JSON schema describes both; `volume` is 0..1 and `pitch` 0.25..4, so an out-of-range value is refused on open.
- What the schema can't say, the validator checks: sound ids are unique, the sample rate is a whole number from 3000 to 32000, the
  samples are valid base64 holding a whole number of 16-bit samples (and at least one), and every `soundId` names a sound in the file.
- `withUpdatedScene` drops sounds no player uses; the `sounds` key disappears when none remain. Saving one sound used by several
  players writes it once.
- Duplicating a player copies its settings (and shares the sound).

## Acceptance Criteria
```gherkin
Scenario: A project without sounds is unchanged
  Given a project that never imported a sound
  Then its saved file has no "sounds" key and no "audio" on any node

Scenario: Sounds and player settings round-trip
  Given a project with a sound and a player using it with Autoplay off, volume 0.4, pitch 1.5 and loop on
  When it is saved and loaded
  Then both are identical

Scenario: An out-of-range value is rejected
  Given a file with a volume above 1 or a pitch below 0.25 or above 4
  Then it is rejected with a message naming the field

Scenario: A player naming a missing sound is rejected
  Given a player whose soundId isn't in the file's sounds
  Then the file is rejected and the message names the player and the sound id

Scenario: Damaged sound data is rejected
  Given a sound with invalid base64, an odd number of bytes, no samples or a sample rate outside 3000-32000
  Then the file is rejected with a message naming the sound

Scenario: Shared and unused sounds
  Given two players that use one sound and a third sound that nothing uses
  When the scene is saved
  Then the file holds one sound, once

Scenario: Duplicating a player keeps its settings
  When a player is duplicated
  Then the copy has the same sound, autoplay, volume, pitch and loop
```

## Notes (built)
- **Done.** Schema (`importedSound`, `audioPlayerData`, `audio` on a node) and validator checks in `packages/persistence`, tested by
  `imported-sound-schema.test.ts` (9 tests); `withUpdatedScene` drops unused sounds (`packages/core/src/project-snapshot.ts`); a duplicated
  player keeps its settings because `duplicateSceneNode` copies the node. The real save/reopen is covered in `sound-player.mjs`
  (shared sound once, the unused one dropped, settings restored). Everything is optional, so an old project opens unchanged, and
  a build from before this change refuses a project that contains `sounds` (additive, one-way, like models and textures).
