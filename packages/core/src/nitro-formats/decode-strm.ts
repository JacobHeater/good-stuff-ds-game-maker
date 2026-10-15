import { decodeImaAdpcm } from "../ima-adpcm";
import { BinaryReader } from "./binary-reader";

export interface DecodedStrm {
  sampleRate: number;
  /** One entry a channel, decoded to plain PCM16 regardless of the file's own stored format. */
  channels: Int16Array[];
}

export type DecodeStrmResult = { ok: true; strm: DecodedStrm } | { ok: false; errors: string[] };

/**
 * Decodes an STRM back to plain PCM16 -- the inverse of `strm.ts`'s own encoder. Reads PCM8, PCM16 or IMA-ADPCM
 * (this project's own `decodeImaAdpcm`, DS-hardware-exact) and always hands back PCM16, the one format every
 * consumer of this (a WAV writer) needs. Only ever reads the file as a single block (this converter's own encoder
 * never writes more than one, and reconstructing a real multi-block, looping stream isn't needed for a one-shot
 * file conversion) -- a multi-block STRM is still read correctly, just as one continuous stream, ignoring the loop
 * point.
 *
 * See requirements/compiler/STORY.nitro-native-format-converter.md.
 */
export function decodeStrm(bytes: Uint8Array): DecodeStrmResult {
  const r = new BinaryReader(bytes);
  if (r.stamp() !== "STRM") return { ok: false, errors: ["This isn't an STRM file (it doesn't start with \"STRM\")."] };
  r.u16();
  r.u16();
  r.u32();
  r.u16();
  r.u16();
  if (r.stamp() !== "HEAD") return { ok: false, errors: ["This STRM's HEAD block is missing or corrupt."] };
  r.u32();
  const format = r.u8();
  r.u8(); // loop flag
  const channelCount = r.u8();
  r.u8();
  const sampleRate = r.u16();
  r.u16(); // time
  r.u32(); // loop offset
  const sampleCount = r.u32();
  const waveDataOff = r.u32();
  r.u32(); // number of blocks
  const blockLength = r.u32();
  r.u32(); // samples per block
  r.u32(); // last block length
  r.u32(); // samples per last block

  if (format !== 0 && format !== 1 && format !== 2) return { ok: false, errors: [`This STRM uses an unknown sound format (${format}).`] };
  if (channelCount < 1) return { ok: false, errors: ["This STRM has no channels."] };

  const dataStart = waveDataOff; // already points past the "DATA" stamp and its own size field, per the STRM header's own "Wave Data Offset" field
  const channels: Int16Array[] = [];
  for (let c = 0; c < channelCount; c++) {
    const channelBytes = bytes.slice(dataStart + c * blockLength, dataStart + c * blockLength + blockLength);
    if (format === 2) {
      channels.push(decodeImaAdpcm(channelBytes, sampleCount));
    } else if (format === 1) {
      const view = new DataView(channelBytes.buffer, channelBytes.byteOffset, channelBytes.byteLength);
      const samples = new Int16Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) samples[i] = view.getInt16(i * 2, true);
      channels.push(samples);
    } else {
      // PCM8: unsigned, centered at 128.
      const samples = new Int16Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) samples[i] = (channelBytes[i] - 128) << 8;
      channels.push(samples);
    }
  }

  return { ok: true, strm: { sampleRate, channels } };
}
