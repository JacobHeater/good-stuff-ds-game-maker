---
status: done
component: audio
related: [TASK.sound-import-conversion.md, STORY.import-sound-and-audio-player.md, STORY.named-audio-clips.md, scripting/STORY.string-variables.md]
---

# Story: Imported sounds are compressed (IMA-ADPCM)

## Context
Owner's request: "my songs are to big i need them compressed more." Until now a sound was stored and embedded in the ROM as
plain mono 16-bit PCM; the only lever for size was resampling to a lower rate, already automatic once a sound (or the
scene's sounds together) passed the 2 MB sound-memory budget. For music specifically -- longer than a sound effect, and the
thing the owner was actually running into the limit with -- a lower sample rate alone trades away a lot of quality for not
much space. Asked how to compress further (real compression vs. just allowing an even lower sample rate), the owner chose
real compression: IMA-ADPCM, the Nintendo DS sound hardware's own compressed format.

## Decision
IMA-ADPCM instead of a lower sample-rate ceiling or a manual per-import quality control, because:
- **It's free.** The DS hardware decodes IMA-ADPCM as it plays (`SoundFormat_ADPCM` in libnds) -- no runtime CPU cost, no
  extra RAM beyond the (already far smaller) compressed data itself. A lower sample rate has a real, audible cost (fewer
  samples a second); ADPCM's cost is a little quantization noise at the *same* sample rate, which is usually the better
  trade for music.
- **About a quarter the size.** Each sample after the first is 4 bits instead of 16 (plus a fixed 4-byte header), so the
  same budget holds about 4x as many seconds, or the same song fits at a much higher sample rate than it did as PCM16.
- Made the **default** for every future import, not an opt-in: there is no real reason to keep storing new sounds as
  uncompressed PCM16, and the owner's ask was "compressed more" for sounds in general, not a one-off toggle. `format: "pcm16"`
  still exists for anything that wants the old, lossless behavior (tests mostly use it to keep comparing exact sample
  values, where ADPCM's quantization would be beside the point).

## Description
- **Codec** (`core/src/ima-adpcm.ts`, new): `encodeImaAdpcm`/`decodeImaAdpcm`, a from-scratch implementation of the standard
  IMA-ADPCM algorithm (the same one the DS hardware and the common WAV IMA-ADPCM variant use): a 4-byte header (the first
  sample as plain PCM16, a starting step-table index, a reserved byte), then one 4-bit nibble a remaining sample, low
  nibble of each byte first, no periodic block resets (the predictor and index run for the whole sound, which is what lets
  the DS hardware stream it from one continuous byte range rather than being re-synced every so many samples).
- **Core** (`imported-sound.ts`): `ImportedSound` gained `format?: "pcm16" | "ima-adpcm"` (absent means "pcm16" -- every
  sound saved before this existed) and `sampleCount?: number` (only meaningful, and required, for "ima-adpcm": the encoded
  byte length alone can't say the exact sample count back, since the final byte may hold one unused nibble). `samples` is
  still base64, now of whichever format's raw bytes. `getSoundByteSize` reads the literal decoded byte length directly
  (format-agnostic, so it already reports the real, compressed size); `getSoundSampleCount`/`getSoundSamples` branch on
  `format` so every existing caller (duration display, preview playback, the compiler) keeps working against decoded PCM
  samples without caring which format a sound is stored as. New `rawSoundBytes(sound)` returns the exact stored bytes
  as-is, for the one place that needs them undecoded: embedding into the ROM. `createSoundFromPcm` encodes to "ima-adpcm"
  by default (pass `format: "pcm16"` for the old behavior) and its budget-fit math (the "resample down until it fits" step)
  now accounts for the chosen format's bytes-a-sample, so an ima-adpcm import goes much further before it needs resampling
  at all.
- **Persistence**: `importedSound`'s JSON schema gained optional `format`/`sampleCount` properties;
  `JsonSchemaProjectSnapshotValidator` checks an ima-adpcm sound's byte length matches `imaAdpcmByteSize(sampleCount)`
  exactly (instead of the old "whole number of 16-bit samples" check, which doesn't apply to a nibble-packed stream).
- **Compiler**: `DsSound` is now `{ key, label, sampleRate, format, bytes }` (`bytes`, not `samples` -- it's the exact bytes
  to embed, not decoded PCM values) -- `translate-scene-3d.ts` reads them with `rawSoundBytes`, not `getSoundSamples`,
  specifically so an ima-adpcm sound is embedded compressed, not re-expanded back to PCM16 and the whole point lost.
  `scene-data-writer.ts` emits each sound's bytes as a `uint8_t` array and a `format` code in `GsSound` (a libnds
  `SoundFormat`: 1 for pcm16, 2 for ima-adpcm) instead of always assuming 16-bit PCM.
- **Runtime**: `GsSound` is `{ byteCount, sampleRate, format, data }` (was `{ sampleCount, sampleRate, samples }`); the one
  place that plays a sound, `audio_start` in `gs_runtime.c`, now calls `soundPlaySample(sound->data, (SoundFormat)
  sound->format, sound->byteCount, ...)` instead of hardcoding `SoundFormat_16Bit` -- the DS hardware takes it from there,
  so nothing else in the runtime (volume, pitch, looping, named clips) needed to change.
- **Editor**: the byte-size readout in `AudioPlayerField.tsx` already calls `getSoundByteSize`, which is format-agnostic, so
  a freshly imported (now compressed) sound simply shows a smaller number; sound preview (`sound-preview.ts`) already
  decodes through `getSoundSamples`, which now handles ima-adpcm transparently. Added, after the owner hit the DS's ARM9
  binary size limit with their existing (pre-this-feature, still pcm16) sounds: a "Compress" button next to that byte-size
  readout, for both a player's own sound and a named clip's, that re-encodes the sound already in the project to ima-adpcm
  **in place** -- no need to still have the original audio file to re-import. `compressSoundToAdpcm(sound)` (core) decodes
  through the existing `getSoundSamples` (so it works from either format) and re-encodes; a new `COMPRESS_SOUND` editor-store
  action replaces that one sound in `project.sounds`, undoably, logging the before/after byte count. A no-op if the sound is
  already ima-adpcm (returns the same object, so the button doesn't show).

## Notes (built and verified)
- Unit tests: `core/src/ima-adpcm.test.ts` (new: round-trips a tone closely, handles 0/1/odd sample counts, silence in/out),
  `core/src/imported-sound.test.ts` (existing resample/clip/fit-math tests pinned to `format: "pcm16"` since they're about
  that math specifically and compare exact sample values; new `describe("compressing to ima-adpcm by default", ...)`:
  it's the default, about a quarter pcm16's size, round-trips lossily but closely, embeds the encoded bytes rather than
  decoded samples, and fits a sound that would have needed resampling as pcm16 at full rate as ima-adpcm; new
  `describe("compressing a sound already in the project", ...)`: re-encodes in place keeping id/name/rate, stays close to
  the original tone, is a no-op on an already-compressed sound), persistence's `json-schema-project-snapshot-validator`
  validation, `compiler/sounds.test.ts` (updated exact-string `GsSound`/sound-data C for the new fields),
  `ui/state/sound-edits.test.ts` (new `describe("compressing a sound already in the project", ...)`: logs the before/after
  byte count, undoable, no-op on an already-compressed or missing sound, no-op with no project open). Full fast suite
  (1195 tests) and typecheck (core/persistence/compiler/ui) pass.
- **Also fixed along the way**: the owner hit the real-world case this story exists for -- an existing project with
  several scenes' worth of (pre-this-feature, still pcm16) music overflowing the DS's ARM9 binary size limit at Play/Export
  (`ld`: "region 'lma9' overflowed"). Investigating it surfaced a real, independent bug: `RomBuilder`'s `firstErrorLine`
  (`compiler/src/build/rom-builder.ts`) picked the first output line containing the word "error", which for a linker
  failure is only ever the generic "collect2.exe: error: ld returned 1 exit status" -- the actually useful
  "undefined reference to `symbol'" lines don't contain that word and were silently dropped, for any linker failure, not
  just this one. Fixed to prefer (deduplicated) "undefined reference" lines when present. Also added: in dev,
  `play-ipc.ts` now streams the full raw toolchain output to the main process's own console (gated on `!app.isPackaged`),
  so a build failure the short in-app message doesn't fully explain can still be read in full without any extra setup.
- **Not verified:** an actual ROM build and real DS/emulator playback of an ima-adpcm sound (no `*.rom.test.ts` case) --
  in particular that the encoder's output is byte-for-byte what the DS hardware's decoder expects (the algorithm matches
  the documented standard, but this hasn't been played back for real). **Not built:** a manual per-sound compression
  choice in the Inspector for a *fresh* import (format is a `createSoundFromPcm` option, not exposed in the UI -- every
  future import is simply compressed by default); streaming/on-demand per-scene assets, so a big enough multi-scene
  project can still overflow the ARM9 binary size limit even with every sound compressed -- compressing sounds narrows
  that ceiling's bite, it doesn't remove it.
