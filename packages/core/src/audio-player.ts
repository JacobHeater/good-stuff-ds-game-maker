/**
 * What an AudioStreamPlayer has beyond being a node (requirements/audio/STORY.import-sound-and-audio-player.md). Every field is
 * optional in a saved file: a node without `audio`, or without one of its fields, has the defaults below.
 */
export interface AudioPlayerData {
  /** The id of a sound in the project's `sounds`; absent for a player with nothing to play. */
  soundId?: string;
  /** Start playing by itself when the game starts. */
  autoplay: boolean;
  /** 0..1. On the DS, `round(127 * volume)`. */
  volume: number;
  /** A playback-speed multiplier, `PITCH_MIN`..`PITCH_MAX`: 1 as recorded, 2 an octave up and twice as fast. */
  pitch: number;
  /** Start again from the beginning when the sound ends. */
  loop: boolean;
  /**
   * Named sounds a script can start by name (`$Player.play("Morning")`, requirements/audio/STORY.named-audio-clips.md),
   * up to `MAX_EXTRA_AUDIO_CLIPS`, alongside the player's own sound above (which keeps working exactly as it always has:
   * `play()` with no name still plays it, unaffected by whatever clips exist). Each clip has its own volume/pitch/loop,
   * the same way each of an AnimationPlayer's animations has its own loop -- starting "Night" doesn't have to sound like
   * starting "Morning". A clip with no `soundId` yet is a named slot with nothing chosen.
   */
  clips?: AudioClip[];
}

export interface AudioClip {
  id: string;
  name: string;
  soundId?: string;
  volume: number;
  pitch: number;
  loop: boolean;
}

export const PITCH_MIN = 0.25;
export const PITCH_MAX = 4;
export const DEFAULT_AUDIO_PLAYER: Readonly<Omit<AudioPlayerData, "soundId" | "clips">> = { autoplay: true, volume: 1, pitch: 1, loop: false };
export const DEFAULT_AUDIO_CLIP: Readonly<Omit<AudioClip, "id" | "name" | "soundId">> = { volume: 1, pitch: 1, loop: false };

/** The player's own sound counts as one; this is how many more named clips it can hold. */
export const MAX_EXTRA_AUDIO_CLIPS = 9;

/** The DS's volume is 0 (silent) to 127. */
export const DS_MAX_VOLUME = 127;
/** What the DS's sound hardware accepts as a playback rate: a 16-bit timer reload at about 16.76 MHz. */
export const DS_MIN_PLAYBACK_HZ = 256;
export const DS_MAX_PLAYBACK_HZ = 65535;

/** A player's settings with the defaults filled in. */
export function getAudioPlayer(node: { audio?: Partial<AudioPlayerData> }): AudioPlayerData {
  const audio = node.audio ?? {};
  return {
    ...(audio.soundId !== undefined ? { soundId: audio.soundId } : {}),
    autoplay: audio.autoplay ?? DEFAULT_AUDIO_PLAYER.autoplay,
    volume: audio.volume ?? DEFAULT_AUDIO_PLAYER.volume,
    pitch: audio.pitch ?? DEFAULT_AUDIO_PLAYER.pitch,
    loop: audio.loop ?? DEFAULT_AUDIO_PLAYER.loop,
    ...(audio.clips !== undefined ? { clips: audio.clips } : {})
  };
}

/** A clip's settings with the defaults filled in. */
export function getAudioClip(clip: Partial<AudioClip> & { id: string; name: string }): AudioClip {
  return {
    id: clip.id,
    name: clip.name,
    ...(clip.soundId !== undefined ? { soundId: clip.soundId } : {}),
    volume: clip.volume ?? DEFAULT_AUDIO_CLIP.volume,
    pitch: clip.pitch ?? DEFAULT_AUDIO_CLIP.pitch,
    loop: clip.loop ?? DEFAULT_AUDIO_CLIP.loop
  };
}

/** The names of a player's own clips, in order -- what a script's `play("name")` resolves against. */
export function audioClipNames(player: { clips?: AudioClip[] }): readonly string[] {
  return (player.clips ?? []).map((clip) => clip.name);
}

export function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

export function clampPitch(pitch: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch));
}

/** The DS volume level, 0..127, for a 0..1 volume. */
export function dsVolume(volume: number): number {
  return Math.round(DS_MAX_VOLUME * clampVolume(volume));
}

/**
 * The rate the DS plays a sound at: its sample rate times the pitch, limited to what the hardware takes.
 * `clamped` says the pitch asked for more (or less) than that.
 */
export function playbackFrequency(sampleRate: number, pitch: number): { hz: number; clamped: boolean } {
  const wanted = Math.round(sampleRate * clampPitch(pitch));
  const hz = Math.min(DS_MAX_PLAYBACK_HZ, Math.max(DS_MIN_PLAYBACK_HZ, wanted));
  return { hz, clamped: hz !== wanted };
}
