---
status: done
component: scene-designer
related: [EPIC.full-2d-games.md, STORY.standalone-2d-scripting.md, audio/STORY.import-sound-and-audio-player.md, audio/STORY.named-audio-clips.md, audio/STORY.compressed-sound.md]
---

# Story: An AudioStreamPlayer plays sound in a standalone 2D project

## Context
Item 2 of `EPIC.full-2d-games.md`. Sound was the first of the `gs_stubs2d.c` no-ops from
`STORY.standalone-2d-scripting.md` to become real. The data model (`DsAudioPlayer`/`DsAudioClip`/`DsSound` in
`ds-scene.ts`) was already fully generic -- built for 3D, with nothing 3D-specific in it -- so this story is almost
entirely "collect the same way, write the same way, run the same way," ported into the 2D compiler and runtime.

## Description
- **Compiler** (`translate-scene-2d.ts`): new `collectAudio`, a close port of `translateScene3D`'s own audio-player
  collection -- the same diagnostics, with the same codes and wording (`player-without-sound`, `missing-sound`,
  `sound-pitch-clamped`, `sound-not-started`, `too-many-sounds`, `sound-memory`), the same sound-dedup
  (`indexOfSound`), the same own-sound-before-clips ordering. The one real difference: 3D decides whether a player
  "starts at once" using the node's place in a parent-visibility chain (`effectivelyVisible`); a 2D node has no such
  chain, so its own `.visible` already is the answer. `AudioStreamPlayer` is no longer in `warnUnbuilt`'s list.
- **Data** (`ds-scene.ts`): `DsScene2D` gained `sounds`/`audioPlayers`/`audioClips`, the same `DsSound`/`DsAudioPlayer`/
  `DsAudioClip` types a 3D project already uses. `DsAudioPlayer` gained an optional `node` (a 2D-only field: which
  entry of `DsScene2D.nodes` this player is, for a script to reach it by, or -1). A 3D project's node table instead
  keeps the audio index directly on the node entry, since every node there already carries one; a 2D node table only
  ever holds what a script needs (`STORY.standalone-2d-scripting.md`), so the player looks itself up by node index
  instead.
- **Runtime** (`runtime2d/`): `scene2d.h` gained `GsSound`/`GsAudioClip`/`GsAudioPlayer` (identical layout to the 3D
  runtime's own `scene.h`, `GsAudioPlayer` with the extra `node` field) and `GsScene2D.soundCount/sounds`,
  `audioPlayerCount/audioPlayers`, `audioClipCount/audioClips`. `gs_runtime2d.c` gained a direct port of the 3D
  runtime's sound section (`gs_init_audio2d`, `gs_start_audio2d`, `gs_audio_play/play_clip/stop`, `gs_audio_get/
  set_volume`, `gs_audio_get/set_pitch`) -- the only change from a plain copy is `gs_node_audio_player`, which
  searches `GsScene2D.audioPlayers` for the one whose own `node` field matches, rather than reading an index straight
  off a node-table entry. `gs_stubs2d.c`'s audio no-ops are gone, replaced by the real thing.

## Notes (built and verified)
- Unit tests: new `describe("audio in a 2D project", ...)` in `compiler/translate-scene-2d.test.ts` -- a player's own
  sound and clips compile the same way a 3D project's do; a script-reached player gets a node index and
  `gs_node_audio_player` resolves it; `play("name")` on a named clip resolves exactly as in 3D; the sound budget,
  16-channel limit and a missing sound all give the same codes/messages a 3D project does. The existing "a capability
  not built yet" test (`STORY.standalone-2d-scripting.md`) now demonstrates an AnimationPlayer instead of sound, since
  sound is real; a new test confirms an `AudioStreamPlayer` with no sound still gets the 3D-identical
  `player-without-sound` warning rather than the old generic `two-d-node-not-built`. Full fast suite and typecheck
  pass (counts in the combined `EPIC.full-2d-games.md` entries, since sound/collision/camera landed in one pass).
- **Verified with a real devkitARM build**: a project with a player's own autoplay sound, a named clip started with
  `play("name")`, `stop()`, and a live `volume` write, alongside the scripting from `STORY.standalone-2d-scripting.md`
  -- compiled and linked with no errors.
- **Not verified:** actually running the built ROM (no emulator launch, no `*.rom.test.ts`). **Not built:** nothing
  further for sound itself -- it's at parity with the 3D runtime's own sound system (compression, named clips, the
  same budget rules all already apply).
