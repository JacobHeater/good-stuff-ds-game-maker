---
status: done
component: audio
related: [STORY.import-sound-and-audio-player.md, TASK.audio-asset-playback.md, animation/TASK.animation-script-control.md, scripting/STORY.string-variables.md]
---

# Story: An AudioStreamPlayer can hold several named sounds

## Context
Owner request, with a pasted script showing the intended use:
```
if time == "Morning":
    $Music.play("Morning")
elif time == "Mid-Day":
    $Music.play("Day")
elif time == "Night":
    $Music.play("Night")
```
An AudioStreamPlayer could only ever hold one sound; `play()` took no arguments and just started that one. The owner wanted one player to switch between several sounds by name -- the same shape AnimationPlayer already
has (several named animations, `play("name")` starts one), just for audio.

## Decisions (owner chose from options; say if any is wrong)
- **10 total, not 10 new.** The player's existing single sound counts as one of the ten; up to `MAX_EXTRA_AUDIO_CLIPS` (9) more named ones can be added. `play()`/`stop()` with no name are completely unchanged (the
  player's own sound, exactly as before); `play("name")` is the new capability, for one of the named ones.
- **Each named sound has its own volume, pitch and loop**, not one shared setting for the whole player -- the same way each of an AnimationPlayer's animations has its own `loop`. "Night" can loop and be quieter while
  "Morning" doesn't and isn't, without a script touching anything.
- **Only `play("name")` is new; `play`/`stop` on an unnamed player, and a player's own sound, work exactly as before.** A player can also have *only* named sounds and no sound of its own -- useful for exactly the
  owner's case, a player that only ever plays one of several named tracks and is never started bare.

## Description
- **Core** (`audio-player.ts`): `AudioClip { id, name, soundId?, volume, pitch, loop }`; `AudioPlayerData.clips?: AudioClip[]` (up to `MAX_EXTRA_AUDIO_CLIPS`), alongside its existing single-sound fields, which are
  untouched. `getAudioClip`/`audioClipNames` mirror `getAnimationPlayer`'s accessors.
- **Checker** (`checker.ts`): `play("name")` on an AudioStreamPlayer resolves the name to the clip's index among the player's own clips at compile time, the same mechanism `play("name")` on an AnimationPlayer
  already uses for animations (`checkAnimationCall`'s name-to-index resolution, including the "not in the same place in every player this script is attached to" check for a script shared by several players).
  `audioCall`'s `Resolution` gained an optional `clip?: number`; absent means the player's own sound (today's behavior, unchanged). `ScriptSceneContext.attached[].sounds` carries a player's clip names the same way
  `.animations` already carries an AnimationPlayer's.
- **Compiler**: `DsAudioPlayer` gained `clipStart`/`clipCount` (a range into a new scene-wide `DsAudioClip[]` table, the same shape as `GsMesh`'s `frameStart`/`frameCount` into `meshFrames`) and `sound` can now be
  `-1` (a player with named clips only, no sound of its own). Every clip must have a real sound chosen -- an empty or missing one is a compile error naming the clip, never silently skipped or reindexed, since the
  clip's position is exactly what the checker already baked into every `play("name")` that resolved against it. A clip's sound joins the same scene-wide, deduplicated `sounds` table everything else's does, and
  counts toward the same sound-memory budget.
- **Runtime** (`gs_runtime.c`): `gs_audio_play_clip(player, clip)` looks up the clip, sets the player's live volume/pitch from the clip's own settings (replacing whatever was there, the same way starting a
  different animation uses that animation's own loop), and starts it on the player's one hardware channel -- the same channel plain `play()` uses, so only one of a player's sounds (named or not) is ever playing at
  once, same as before. `gs_audio_play`/`gs_init_audio` were made safe for a player whose `sound` is `-1` (nothing to compute a starting pitch from, and a plain `play()` on one of these is simply a no-op).
- **A deliberate safety measure, not asked for but necessary**: a clip's sound is just another entry in the normal, saved+restorable asset pipeline (unlike a *string variable*, which is a raw ROM pointer and
  therefore excluded from the save file, `scripting/STORY.string-variables.md`) -- clips needed no analogous exclusion, since they're sound-table indices resolved the same way everything else here already is.
- **UI**: `AudioPlayerField.tsx` gained a "Named sounds" list (New/rename/delete, mirroring `AnimationPlayerField`'s animations list) under the player's own sound/volume/pitch/loop fields, with the selected clip's
  own sound picker, volume, pitch and loop below it. `editor-store.tsx`'s `audioClips.{create,rename,remove,set}` mirror `animations.*`.

## Notes (built and verified)
- Unit tests: `core/src/script/script-audio.test.ts` (new: resolving `play("name")` to a clip index, the "no named sounds yet" / "has no sound X" errors, the shared-script-inconsistent-index error, bare `play()`/
  `stop()` unaffected), `core/src/script/script-animation.test.ts` (updated: `$Music.play("x")` is no longer an arity error), `compiler/src/named-audio-clips.test.ts` (new: clipStart/clipCount, a player with no
  sound of its own, sound dedup across a player's own sound and its clips, the two "missing clip sound" errors, `gs_audio_play_clip` codegen, the generated `GsAudioClip`/`GsAudioPlayer` C), `compiler/src/sounds.test.ts`
  and `collision.test.ts` (updated exact-string `GsAudioPlayer`/`GsScene` C assertions for the new fields), `ui/.../audio-clip-edits.test.ts` (new: create/rename/delete/set, the 9-clip limit, clearing the `clips`
  field once empty). Full 1176-test fast suite and typecheck (core/persistence/compiler/ui) pass.
- **Not verified:** an actual ROM build (no `testing/*.rom.test.ts` case), the Inspector's new list in the real app (no E2E). **Not built:** more than 9 named clips, a per-clip `is_playing()`/`stop("name")` (stop
  never needs a name -- there's only one channel, so it always stops whatever's playing), and an audio-clip equivalent of AnimationPlayer's Autoplay-by-name (a clips-only player simply never autoplays; its own
  `autoplay` field only ever refers to its own, possibly absent, sound).
