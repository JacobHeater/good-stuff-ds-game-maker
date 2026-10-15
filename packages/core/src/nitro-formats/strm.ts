import { BinaryWriter } from "./binary-writer";

export interface StrmInput {
  sampleRate: number;
  /** One channel's worth of sample data per entry (one entry: mono; two: stereo, left then right). */
  channels: readonly Uint8Array[];
  format: "pcm8" | "pcm16" | "ima-adpcm";
  /** How many samples each channel has (not bytes -- a PCM16/ADPCM byte count doesn't equal the sample count). */
  sampleCount: number;
}

const FORMAT_CODES = { pcm8: 0, pcm16: 1, "ima-adpcm": 2 } as const;
/** The ARM7's sound-DMA clock (GBATEK STRM docs): used for the header's own redundant "Time" field. */
const ARM7_CLOCK = 33513982 / 2;

/**
 * Converts raw PCM (or this project's own IMA-ADPCM, see core's `ima-adpcm.ts`) into an STRM -- the real format
 * Nintendo's own Nitro SDK streamed background music/sound with (`SND_StrmPlayer` and friends), playable by any
 * STRM-aware tool, not a format invented for this project. One block holds the whole stream (STRM supports
 * splitting a long stream into several DMA-sized blocks for looping or re-buffering; this converter always
 * writes everything as a single block, correct for playback but with only whole-track, not partial-block,
 * looping precision -- more than enough for a one-shot file conversion).
 *
 * See requirements/compiler/STORY.nitro-native-format-converter.md.
 */
export function encodeStrm(input: StrmInput): Uint8Array {
  const { sampleRate, channels, format, sampleCount } = input;
  const blockLength = channels[0]?.length ?? 0;

  const out = new BinaryWriter();
  out.bytes_([0x53, 0x54, 0x52, 0x4d]); // "STRM"
  out.u16(0xfeff);
  out.u16(0x0100);
  const filesizeAt = out.placeholder(4);
  out.u16(0x10);
  out.u16(2); // HEAD + DATA

  out.bytes_([0x48, 0x45, 0x41, 0x44]); // "HEAD"
  out.u32(0x50);
  out.u8(FORMAT_CODES[format]);
  out.u8(0); // loop flag: off
  out.u8(channels.length);
  out.u8(0);
  out.u16(sampleRate);
  out.u16(Math.round(ARM7_CLOCK / sampleRate / 32));
  out.u32(0); // loop offset (unused: looping is off)
  out.u32(sampleCount);
  out.u32(0x68);
  out.u32(1); // one block
  out.u32(blockLength);
  out.u32(sampleCount);
  out.u32(blockLength); // this block is also the last block
  out.u32(sampleCount);
  for (let i = 0; i < 0x20; i++) out.u8(0); // reserved

  out.bytes_([0x44, 0x41, 0x54, 0x41]); // "DATA"
  const dataSizeAt = out.placeholder(4);
  const dataStart = out.length;
  for (const channel of channels) out.bytes_(channel);
  out.patchU32(dataSizeAt, 8 + (out.length - dataStart));
  out.patchU32(filesizeAt, out.length);
  return out.toBytes();
}
