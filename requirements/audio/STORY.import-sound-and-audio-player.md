---
status: done
component: audio
related: [TASK.audio-asset-playback.md, STORY.audio-node-in-hardware-budget.md, TASK.sound-import-conversion.md, persistence/TASK.embed-imported-sounds-in-project-file.md, compiler/TASK.compile-sounds.md, properties-panel/STORY.inspector-panel.md, scene-designer/TASK.undo-redo-for-scene-edits.md, debugger/STORY.hardware-budget-report.md]
---

# Story: Import a sound and play it with an audio player

## Context
`AudioStreamPlayer` nodes have existed since the start and are counted against the DS's 16 audio channels, but they had no
sound (`STORY.audio-node-in-hardware-budget.md`) and nothing played anywhere (`TASK.audio-asset-playback.md`, which this
delivers). Textures and models already go through the same path: import a file, embed it in the project, preview it in the
editor, compile it into the ROM. Sound follows that path.

## Decisions (made with the product owner)
- **Formats: WAV, MP3 and OGG.** The editor's own audio decoder reads the file (so the decoding runs in the editor window, not the
  main process); the pure conversion rules are in core and unit-tested.
- **Convert automatically.** A DS sound channel is mono and plays at up to about 32 kHz, while most files are stereo at 44.1 or 48 kHz.
  Import mixes to mono, resamples down to at most 32 kHz (never up), stores 16-bit samples, and says in the Output log what it did.
  A sound that is too big for the sound budget is compressed more (resampled lower, down to 8 kHz) to fit rather than refused; only one that
  won't fit even at 8 kHz (about 131 s) is refused. (`TASK.sound-import-conversion.md`)
- **Autoplay off means silent, for now.** The game has no scripting, so nothing in the ROM can start a sound except autoplay. A player
  with Autoplay off is compiled into the ROM, ready for scripting, and stays silent unless a script calls `play()` on it (scripting has since been built: `scripting/STORY.write-and-run-scripts.md`); the compiler warns about a player nothing starts.

Choices I made without asking (say if any is wrong):
- **Embedded in the project file, already converted** (like textures): mono 16-bit samples, base64, plus the sample rate. The
  original file isn't kept and nothing depends on it staying put.
- **Autoplay defaults to on.** Nothing else can start a sound yet, so a new player that never played would be a trap. It's a property,
  so it can be turned off.
- **Volume is 0-100%** (the DS has 128 levels, 0-127; `round(127 * volume)`). **Pitch is a speed multiplier, 0.25x to 4x**, as in Godot's
  `pitch_scale` (1 = as recorded, 2 = an octave up and twice as fast). On the DS it sets the playback rate, `round(sample rate * pitch)`
  Hz, limited to what the hardware takes (256-65535 Hz); a pitch that would go past that is clamped and warned about.
- **Loop restarts the whole sound.** No loop points yet.
- **All 16 hardware channels can play PCM**, so at most 16 players may autoplay at once; more is a compile error.
- **A sound budget:** 2 MB of the DS's 4 MB of RAM (half, leaving room for the program, 3D data and textures) for the distinct sounds
  a scene uses. A single sound over it is compressed to fit at import (lower sample rate, down to 8 kHz); the *sum* of the distinct sounds
  a scene uses being over it is a compile error.
- **A hidden player isn't in the game** (like every other node kind); a hidden subtree hides its players.

## Description
- **Import:** Scene > **Import Sound...** (2D and 3D projects; `AudioStreamPlayer` is offered in both) picks a file and adds a new
  `AudioStreamPlayer` under the selected node, with the sound assigned. The Inspector of a player also has an **Import Sound...**
  button that assigns the sound to that player.
- **The audio player** is in the Inspector of an `AudioStreamPlayer`:
  - **Sound:** None or any of the project's sounds (name, length, sample rate).
  - **Play / Stop** for a preview in the editor, a position bar with the time (`0:02 / 0:05`), and the same **volume, pitch and loop** as
    the ROM will use, changing live while it plays. The preview is the sound as stored, so it has already been through the DS conversion.
  - **Autoplay on load** checkbox: the sound starts by itself when the game starts.
  - **Volume** 0-100%, **Pitch** 0.25-4x (with the playback rate in Hz), **Loop** checkbox.
- **The ROM:** Export ROM and Play compile every visible player's sound into the ROM; on startup, every player with Autoplay on starts
  its sound with its volume, pitch and loop.
- **The Hardware tab** shows a sound memory bar (the distinct sounds the players use, of 2 MB) next to the channel bar.
- A player has **no Position fields** in the Inspector (a sound has no place in the scene; it isn't drawn).
- The preview **stops when another node is selected** (or the project is closed), so a sound never keeps playing from a node you've left.
- A sound no player uses isn't saved with the project. Importing, choosing and changing the properties are undoable (a slider drag is one step).

## Acceptance Criteria
```gherkin
Scenario: The Inspector shows the audio player on an AudioStreamPlayer only
  Given an AudioStreamPlayer is selected
  Then the Inspector shows a Sound field set to None, Import Sound..., Autoplay, Volume, Pitch and Loop
  And a mesh, a light and a camera show none of them

Scenario: Importing a sound adds a player
  When Scene > Import Sound... is used and a valid WAV file is picked
  Then a new AudioStreamPlayer is added under the selected node with the sound assigned
  And the Output log says the sound's length, sample rate and size, and what conversion was done

Scenario: The Inspector's import assigns the sound to the selected player
  Given an AudioStreamPlayer is selected
  When Import Sound... is used in the Inspector
  Then the sound is added to the project and assigned to that player, and no new node appears

Scenario: Cancelling does nothing
  When the file dialog is cancelled
  Then the project is unchanged and shows no unsaved changes

Scenario: A file that isn't audio is refused
  Given a file that can't be decoded as audio
  Then it is refused with a reason and nothing is added

Scenario: Stereo and high sample rates are converted
  Given a stereo 44.1 kHz WAV
  When it is imported
  Then it is stored as mono at 32 kHz
  And the Output log says it was mixed to mono and resampled

Scenario: A sound too big for the DS is compressed to fit
  Given a sound that needs more than 2 MB after conversion
  Then it is imported at a lower sample rate so that it fits, and the Output log says the new rate and that it sounds duller

Scenario: A sound too long even at the lowest rate is refused
  Given a sound that would still need more than 2 MB at 8000 Hz
  Then it is refused, saying its length and the longest the DS can hold

Scenario: The editor previews the sound
  Given a player with a sound
  When Play is pressed in the Inspector
  Then the sound plays with the player's volume, pitch and loop
  And the position bar advances and Play becomes Stop
  And a sound that is not looping ends by itself and Stop becomes Play

Scenario: Volume, pitch and loop apply while the preview is playing
  Given the preview is playing
  When the volume, the pitch or Loop is changed
  Then the sound changes immediately without restarting

Scenario: The position bar seeks
  When the position bar is moved, playing or not
  Then the position (and the time shown) jumps there, and Play continues from it

Scenario: The preview stops when another node is selected
  Given the preview is playing
  When another node is selected
  Then the sound stops

Scenario: Autoplay, volume, pitch and loop are saved
  Given a player with Autoplay off, volume 40%, pitch 1.5 and Loop on
  When the project is saved, closed and reopened
  Then the Inspector shows those values

Scenario: A sound is saved once and reopens
  Given two players that use the same sound
  When the project is saved
  Then the file holds that sound once, and both players still use it after reopening

Scenario: Unused sounds are not saved
  Given a sound that no player uses
  When the project is saved
  Then the file does not contain it

Scenario: Sound edits are undoable
  When a sound is imported, chosen or cleared, or a property is changed
  Then Ctrl+Z restores the player and, for an import, removes the sound from the project
  And dragging a slider is one undo step

Scenario: A pitch outside the range can't get in
  Then a file or edit with a pitch outside 0.25-4 or a volume outside 0-1 is rejected or clamped

Scenario: The hardware budget counts sound memory
  Given two players using a 2 KB sound and a 6 KB sound, one of them twice
  Then the Hardware tab shows 8 KB of sound memory (each distinct sound once) of 2 MB

Scenario: The ROM plays an autoplay sound
  Given a scene with a player that has Autoplay on
  When it is compiled and run in the emulator
  Then the emulator produces sound within a moment of starting

Scenario: The ROM is silent without autoplay
  Given a player with Autoplay off
  Then the emulator produces no sound and the compiler warns that nothing starts it

Scenario: Volume, pitch and loop reach the ROM
  Then at 50% volume the emulator's output is about half as loud as at 100%
  And at 2x pitch a sound that isn't looping ends in half the time, and at 0.5x in twice the time
  And a looping sound is still playing long after its length
```

## Notes
- Not in this story: playing a sound from a script or an event, stereo sound and panning (the DS could pan per channel), sound
  effects and music streaming, compressed ADPCM (2x smaller; the mono 16-bit PCM here is 4x the size), loop points, per-player
  spatial sound, and 2D projects' ROMs (2D can't be compiled yet; the editor part works in both).
- **Built and verified.**
  - **Unit tests** (`pnpm test`, 343 in all, 62 of them new for sound): the conversion rules (mono mix, resampling that keeps a 440 Hz
    tone, clipping, the size limit, header sniffing for WAV/MP3/OGG), the player defaults and the DS volume and playback-rate
    mappings, budget, the schema and validator (`imported-sound-schema.test.ts`), the compiler (`sounds.test.ts`), and the store's
    import, choose and setting edits with undo (`sound-edits.test.ts`).
  - **The ROM, on melonDS's real audio output** (`sound.rom.test.ts`, 9 tests; measured with Windows' per-application peak meter,
    `tools/ds-toolchain/measure-melonds-audio.ps1`): an autoplay tone reads 0.2504; **50% volume reads 0.1252 and 25% 0.0626** (exactly
    half and a quarter), 0% and Autoplay off and no player are silent; a non-looping 2 s sound sounds for 2.05 s, **2x pitch for 1.03 s
    and 0.5x for 4.07 s**; a loop is still going after 7 s with no gaps; two players double the level; a 1.97 MB sound (the budget)
    plays beside the 3D scene. Breaking the volume and pitch in the compiler on purpose fails those tests.
  - **The editor, driven for real** (`tests/prototypes/e2e/sound-player.mjs`, 19 checks with an MP3, 18 without): the audio player is on an AudioStreamPlayer only;
    cancelling, a non-audio file and a 140 s sound (too long even at 8 kHz) are refused with reasons, and a 33 s sound over the budget is
    resampled to 31.7 kHz to fit (log says so; undo removes it); Inspector import assigns and Scene > Import Sound... adds a
    player; a stereo 44.1 kHz WAV becomes mono 32 kHz (64000 bytes) and the log says so; the Hardware tab counts 130150 bytes; and the
    **preview is measured on the editor's own audio output**: level 0.500 for a 0.5-amplitude tone, 50% set mid-play reads 0.252, a
    1.5 s sound lasts 1.55 s, at 2x 0.83 s, at 0.5x 3.06 s, pitch raised to 4x after 0.3 s ends at 0.75 s, Loop switched off mid-loop ends
    at 3.05 s, and selecting another node gives true silence. Also the position bar, a real mouse drag of the volume slider being one
    undo step, undo/redo of an import, save (a shared sound once, the unused one dropped) and reopen. Last, the UI-authored project is
    exported and run in melonDS: only the autoplay player sounds, at 40% volume and 1.5x pitch (level 0.1001, 1.09 s; expected 0.1006 and
    1.0 s), and the two silent players are warned about.
  - **MP3:** verified once with a real 44.1 kHz stereo MP3 (2.1 s, decoded and converted to 32 kHz mono, 135,418 bytes) through the
    real import. **OGG has not been exercised**: it goes through the same decoder, and only its header reading is unit-tested with a hand-built header.
- **Known limits:**
  - Autoplay is the only thing that starts a sound in a ROM (no scripting). Every player with a sound and Autoplay on starts at
    once, on its own channel.
  - Sample-rate conversion in the editor is done by Chromium's decoder (a good resampler, but not one this repo controls); the
    pure resampler in core is a box filter and is used only if the decoder hands over more than 32 kHz.
  - No loop points, panning, ADPCM or streaming, so a long piece of music is 32 kHz 16-bit mono = 64 KB a second and the 2 MB budget is
    about 32 seconds in all. ADPCM would make it 4x longer.
  - Pitch is checked on the ROM through duration, not by analysing frequency (the peak meter can't); the editor and the ROM agree on
    the rate by construction (`playbackFrequency`).
  - The editor's preview and the ROM differ in how the sound is resampled to the output device (Web Audio vs the DS's mixer), so they
    are the same sound at the same speed, not bit-identical.
  - The meter tests need a sound output device and the default device; they were run on this machine's.
