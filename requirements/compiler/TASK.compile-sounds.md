---
status: done
component: compiler
related: [audio/STORY.import-sound-and-audio-player.md, audio/TASK.sound-import-conversion.md, TASK.compile-textures.md, TASK.ds-runtime-c-template.md, STORY.compile-diagnostics-for-unsupported-content.md, STORY.compile-3d-scene-to-nds-rom.md]
---

# Task: Compile sounds and audio players into the ROM

## Context
The runtime is data driven: the compiler writes `scene_data.c`, and `main.c` only reads it. Sounds join textures in that data
(`GsSound`, `GsAudioPlayer` in `runtime/include/scene.h`). libnds's `soundPlaySample` plays 16-bit PCM from main RAM on any of the
16 hardware channels with a volume (0-127), a pan, a playback rate in Hz and an optional loop; the default ARM7 that ships with
libnds runs the sound hardware, so the runtime stays ARM9-only.

## Description
- The translator collects every visible `AudioStreamPlayer` under a visible parent (as it does for every other kind). Each one that
  names a sound becomes a `DsAudioPlayer { sound, volume, frequency, loop, autoplay }`; each distinct sound used becomes a `DsSound`
  (its samples, padded with one silent sample if the count is odd, so the data is a whole number of 4-byte words).
- `volume` is `round(127 * volume)`; `frequency` is `round(sampleRate * pitch)` clamped to 256..65535 Hz.
- The writer emits each sound as `static const int16_t sound_N_samples[] __attribute__((aligned(4)))` and the two tables; the
  committed fallback `scene_data.c` has empty ones.
- The runtime, before its main loop: if there is any player, `soundEnable()`, then for each player with `autoplay` set,
  `soundPlaySample(samples, 16-bit, bytes, frequency, volume, 64 (centre), loop, 0)`. Players with `autoplay` off are not started.
- Diagnostics (each names the player):
  - **error `missing-sound`**: the player names a sound the project doesn't contain.
  - **error `too-many-sounds`**: more than 16 players would autoplay at once (a hardware channel each).
  - **error `sound-memory`**: the distinct sounds together are over the sound budget (2 MB).
  - **warning `player-without-sound`**: a player with no sound assigned; it is left out.
  - **warning `sound-not-started`**: a player whose Autoplay is off; it is in the ROM but nothing starts it, unless a script calls `play()` on it (then there is no warning).
  - **warning `sound-pitch-clamped`**: the pitch would take the playback rate outside 256..65535 Hz.
- A 2D project still can't be compiled (`not-a-3d-project`), so players in it aren't.

## Acceptance Criteria
```gherkin
Scenario: A player becomes a sound and a player entry
  Given a player with a sound, volume 0.5, pitch 2 and loop on, and the sound is 22050 Hz
  Then the scene has one sound and one player with volume 64, frequency 44100 and loop set

Scenario: A sound used by several players is written once
  Given three players that use one sound
  Then the scene has one sound and three players pointing at it

Scenario: Odd sample counts are padded to a whole word
  Given a sound of 5 samples
  Then the emitted sound has 6 samples, the last being 0

Scenario: A hidden player is not in the game
  Given a hidden player, and a player under a hidden node
  Then neither is compiled

Scenario: Missing and empty players are diagnosed
  Given a player naming a sound the project lacks
  Then compiling fails with missing-sound naming the player
  And a player with no sound is a warning and is left out

Scenario: Too many simultaneous sounds are refused
  Given 17 players with Autoplay on
  Then compiling fails with too-many-sounds
  And 17 players with only 16 autoplaying compile

Scenario: Sound memory is checked against the budget
  Given sounds that together are over 2 MB
  Then compiling fails with sound-memory giving the total and the limit

Scenario: Silent players are explained
  Given a player with Autoplay off
  Then compiling succeeds with the sound-not-started warning

Scenario: The pitch is clamped to what the hardware takes
  Given a 32000 Hz sound at pitch 4
  Then the frequency is 65535 and a sound-pitch-clamped warning is reported

Scenario: The generated C matches the layout in scene.h
  Then the sound arrays are 4-byte aligned and the tables fill GsSound and GsAudioPlayer in order

Scenario: The ROM plays autoplay sounds (real emulator)
  Given a ROM with an autoplay tone
  Then melonDS's audio session shows sound within a couple of seconds of starting, and shows none for a player with Autoplay off

Scenario: The ROM applies volume, pitch and loop (real emulator)
  Then at 50% volume the peak level is about half of that at 100%
  And a non-looping sound at 2x pitch ends in about half the time, and at 0.5x in about twice the time
  And a looping sound is still sounding after several times its length
```

## Notes
- The scene needs a camera even if it draws nothing: an audio-only project is still a 3D scene to the compiler.
- Pan is fixed at the centre for now.

## Notes (built)
- **Done.** `translateScene3D` (`packages/compiler/src/translate-scene-3d.ts`), `DsSound`/`DsAudioPlayer`, the writer, `scene.h`, `main.c`
  (`start_audio`) and the regenerated fallback `scene_data.c`. 15 unit tests in `sounds.test.ts`, and 9 emulator tests measured on
  melonDS's audio output in `sound.rom.test.ts` (see `audio/STORY.import-sound-and-audio-player.md` for the numbers).
- An existing translation test ("nodes that draw nothing stay quiet") listed an `AudioStreamPlayer` as a node that produces no
  diagnostic; that is no longer true (a player with no sound warns `player-without-sound`), so the test now covers `CollisionShape3D`
  only (and later, when shapes compiled too, a `Node3D` group only) and the audio cases moved to `sounds.test.ts`.
- The libnds default ARM7 (which ships with libnds) runs the sound hardware, so the runtime stays ARM9-only and the Makefile is unchanged.
- The generated `scene_data.c` for a 2 MB sound is about 7 MB of text and builds in a few seconds.
- Not done: pan (always centre), starting a sound other than at startup, ADPCM, loop points.
