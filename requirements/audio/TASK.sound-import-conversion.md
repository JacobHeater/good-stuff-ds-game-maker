---
status: done
component: audio
related: [STORY.import-sound-and-audio-player.md, persistence/TASK.embed-imported-sounds-in-project-file.md, scene-designer/STORY.mesh-textures.md]
---

# Task: Convert an audio file to a DS sound

## Context
Textures are decoded in the Electron main process (pngjs) and converted by one pure function in core. Audio can't follow that
exactly, because the app has no decoder for MP3 and OGG outside the editor window's built-in one (Web Audio's `decodeAudioData`),
and the product owner chose WAV, MP3 and OGG (`STORY.import-sound-and-audio-player.md`). So the work is split:

1. **Main process** (`assets-ipc.ts`, `assets.pickSound()`): shows the file dialog and returns the file's bytes. No decoding.
2. **Editor window** (`decode-sound.ts`): decodes the bytes to floating-point samples with `decodeAudioData`, asking for a sample
   rate no higher than 32 kHz so the browser's own (good) resampler does the work.
3. **Core, pure** (`createSoundFromPcm`): every rule below, unit-tested without a browser.

## Description
`createSoundFromPcm(channels, sampleRate, { name })` takes decoded samples (one `Float32Array`-like of -1..1 per channel) and returns
a `ImportedSound` (without an id) with warnings, or refuses with reasons:
- Refused: no samples, channels of different lengths, a non-positive sample rate.
- **Mono:** several channels are averaged; a warning says so.
- **Rate:** above 32,000 Hz it resamples down to 32,000 (averaging the source samples each output sample covers, so it doesn't
  alias); a warning says so. It never resamples up, and never below 3,000 Hz (the decoder's limit).
- **16 bits:** each sample is rounded to a signed 16-bit value; samples outside -1..1 clip, and a warning counts them.
- **Fit:** two bytes a sample. A sound over the 2 MB budget (`DS_HARDWARE_PROFILE.audio.soundMemoryBytes`) is **compressed more**
  instead of refused: resampled down to the highest rate at which it fits (never below `MIN_FITTED_SAMPLE_RATE`, 8000 Hz), and a
  warning says the new rate and that it will sound duller. Only a sound that is still too long at 8000 Hz (about 131 s) is refused, with its length and the longest the DS can hold at that rate.
- **Length** in whole samples is kept exact (no padding); the compiler pads to the DS's 4-byte alignment.
- `sniffSoundSampleRate(bytes)` reads the sample rate from a WAV, MP3 or OGG Vorbis header (null when it can't), so the decoder is
  asked for `min(file rate, 32000)` and a 22 kHz file doesn't get upsampled to 32 kHz and doubled in size.

## Acceptance Criteria
```gherkin
Scenario: A mono sound at a supported rate is stored as it is
  Given 1 second of mono samples at 22050 Hz
  Then the sound is 22050 samples at 22050 Hz, with no warnings
  And each stored sample is the source rounded to 16 bits

Scenario: Stereo is mixed to mono
  Given left and right channels
  Then each stored sample is their average, and a warning says it was mixed to mono

Scenario: A high sample rate is resampled down
  Given 1 second at 48000 Hz containing a 440 Hz tone
  Then the sound is 32000 samples at 32000 Hz, still a 440 Hz tone, and a warning says it was resampled

Scenario: Samples out of range clip and are counted
  Given samples above 1 and below -1
  Then they are stored as 32767 and -32768 and a warning says how many clipped

Scenario: A sound over the memory limit is compressed to fit
  Given 40 seconds of mono samples at 32000 Hz (2.4 MB)
  Then it is stored at the highest rate that fits (26214 Hz), no bigger than 2 MB, still the same length in seconds
  And a warning says it was resampled to fit, and that it will sound duller

Scenario: A sound too long even at the lowest rate is refused
  Given 140 seconds of mono samples at 8000 Hz
  Then it is refused, saying its length and the longest the DS can hold at 8000 Hz

Scenario: Nothing to play is refused
  Given no channels, no samples or channels of different lengths
  Then it is refused with a reason

Scenario: The sample rate is read from the file header
  Given a WAV, an MP3 and an OGG Vorbis header with different sample rates
  Then sniffSoundSampleRate returns each file's rate, and null for anything else

Scenario: The stored samples are exactly what was computed
  When a sound is stored and read back
  Then the samples are identical (little-endian signed 16-bit, base64)
```

## Notes
- The decoder's own handling of a sample rate below 3,000 Hz and of exotic formats is up to Chromium; an undecodable file is refused
  with the decoder's error.

## Notes (built)
- **Done.** `createSoundFromPcm`, `sniffSoundSampleRate` and the DS limits are in `packages/core/src/imported-sound.ts` and
  `audio-player.ts` (21 unit tests in `imported-sound.test.ts`); the decoding is `packages/ui/src/editor/audio/decode-sound.ts`; the
  main process only picks and reads the file (`assets-ipc.ts`, `assets.pickSound()`, 60 MB cap on the file). Verified end to end by
  `tests/prototypes/e2e/sound-player.mjs`, including a stereo 44.1 kHz WAV (became mono 32 kHz) and a real MP3.
- `sourceSampleRate` is an extra option on `createSoundFromPcm`: the browser decoder resamples to the rate it is given, so the file's own
  rate (from the header) is passed along and the warning still says "It is 44100 Hz ... resampled to 32000 Hz".
- The decoder is asked for `min(file rate, 32000)` and never below 3000 Hz; files whose header can't be read (and Opus in Ogg) are decoded at 32000 Hz.
