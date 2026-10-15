import { BinaryWriter } from "./binary-writer";

/**
 * A standard RIFF/WAVE PCM16 file -- not a Nintendo format at all, just the ordinary, universally-documented WAV
 * container every audio tool reads, so a converted DS sound can be opened anywhere. Channels are interleaved
 * (left/right/left/right... for stereo), matching the format's own convention.
 */
export function writeWav(sampleRate: number, channels: readonly Int16Array[]): Uint8Array {
  const channelCount = channels.length;
  const sampleCount = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = sampleCount * blockAlign;

  const out = new BinaryWriter();
  out.bytes_([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  out.u32(36 + dataSize);
  out.bytes_([0x57, 0x41, 0x56, 0x45]); // "WAVE"
  out.bytes_([0x66, 0x6d, 0x74, 0x20]); // "fmt "
  out.u32(16);
  out.u16(1); // PCM
  out.u16(channelCount);
  out.u32(sampleRate);
  out.u32(sampleRate * blockAlign);
  out.u16(blockAlign);
  out.u16(16);
  out.bytes_([0x64, 0x61, 0x74, 0x61]); // "data"
  out.u32(dataSize);
  for (let i = 0; i < sampleCount; i++) {
    for (const channel of channels) out.signed(channel[i] ?? 0, 2);
  }
  return out.toBytes();
}
