/**
 * IMA-ADPCM: the DS sound hardware's own compressed format (`SoundFormat_ADPCM` in libnds), about a quarter the size of
 * 16-bit PCM at the same sample rate since each sample after the first is 4 bits instead of 16 (requirements/audio/
 * STORY.compressed-sound.md). The DS decodes it in hardware as it plays, so there is no runtime CPU or memory cost beyond
 * reading fewer bytes -- the standard tradeoff is a little quantization noise, not a performance one.
 *
 * The layout (identical to the DS hardware's and to the common WAV IMA-ADPCM variant) is a 4-byte header -- the first
 * sample as plain 16-bit PCM, then the encoder's starting step-table index, then a reserved byte -- followed by one 4-bit
 * nibble per remaining sample, low nibble of each byte first. There are no periodic block headers: the predictor and
 * index carry on for the whole sound, which is what lets the DS hardware stream it from one continuous byte range.
 */

const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
];
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const MAX_INDEX = STEP_TABLE.length - 1;

/** How many bytes `encodeImaAdpcm` produces for a sound with this many samples: a 4-byte header, then one nibble each for the rest. */
export function imaAdpcmByteSize(sampleCount: number): number {
  return 4 + Math.ceil(Math.max(0, sampleCount - 1) / 2);
}

export function encodeImaAdpcm(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(imaAdpcmByteSize(samples.length));
  if (samples.length === 0) return out;

  let predictor = samples[0];
  let index = 0;
  new DataView(out.buffer).setInt16(0, predictor, true);
  out[2] = index;
  out[3] = 0;

  let byteOffset = 4;
  let pendingLowNibble = -1;
  for (let i = 1; i < samples.length; i++) {
    let diff = samples[i] - predictor;
    let nibble = 0;
    if (diff < 0) {
      nibble = 8;
      diff = -diff;
    }
    const step = STEP_TABLE[index];
    let quantized = step >> 3;
    if (diff >= step) {
      nibble |= 4;
      diff -= step;
      quantized += step;
    }
    const halfStep = step >> 1;
    if (diff >= halfStep) {
      nibble |= 2;
      diff -= halfStep;
      quantized += halfStep;
    }
    const quarterStep = step >> 2;
    if (diff >= quarterStep) {
      nibble |= 1;
      quantized += quarterStep;
    }
    predictor = Math.max(-32768, Math.min(32767, nibble & 8 ? predictor - quantized : predictor + quantized));
    index = Math.max(0, Math.min(MAX_INDEX, index + INDEX_TABLE[nibble]));

    if (pendingLowNibble < 0) {
      pendingLowNibble = nibble;
    } else {
      out[byteOffset++] = pendingLowNibble | (nibble << 4);
      pendingLowNibble = -1;
    }
  }
  if (pendingLowNibble >= 0) out[byteOffset] = pendingLowNibble;
  return out;
}

/** The inverse of `encodeImaAdpcm`. `sampleCount` must be the exact count encoded (the byte length alone can't say, since the last byte may hold one real nibble and one unused). */
export function decodeImaAdpcm(bytes: Uint8Array, sampleCount: number): Int16Array {
  const out = new Int16Array(Math.max(0, sampleCount));
  if (out.length === 0) return out;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let predictor = view.getInt16(0, true);
  let index = Math.max(0, Math.min(MAX_INDEX, bytes[2]));
  out[0] = predictor;

  let byteOffset = 4;
  let currentByte = 0;
  for (let i = 1; i < out.length; i++) {
    let nibble: number;
    if ((i & 1) === 1) {
      currentByte = bytes[byteOffset++];
      nibble = currentByte & 0x0f;
    } else {
      nibble = (currentByte >> 4) & 0x0f;
    }

    const step = STEP_TABLE[index];
    let diff = step >> 3;
    if (nibble & 4) diff += step;
    if (nibble & 2) diff += step >> 1;
    if (nibble & 1) diff += step >> 2;
    predictor = Math.max(-32768, Math.min(32767, nibble & 8 ? predictor - diff : predictor + diff));
    index = Math.max(0, Math.min(MAX_INDEX, index + INDEX_TABLE[nibble]));
    out[i] = predictor;
  }
  return out;
}
