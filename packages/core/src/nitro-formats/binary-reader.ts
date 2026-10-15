/** The read-side companion to `binary-writer.ts`: a cursor over a byte buffer for decoding the Nitro formats. */
export class BinaryReader {
  constructor(
    readonly bytes: Uint8Array,
    public pos = 0
  ) {}

  seek(pos: number): this {
    this.pos = pos;
    return this;
  }

  u8(): number {
    return this.bytes[this.pos++];
  }

  i8(): number {
    const v = this.u8();
    return v >= 0x80 ? v - 0x100 : v;
  }

  u16(): number {
    const v = this.bytes[this.pos] | (this.bytes[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }

  i16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  u32(): number {
    const v = (this.bytes[this.pos] | (this.bytes[this.pos + 1] << 8) | (this.bytes[this.pos + 2] << 16) | (this.bytes[this.pos + 3] << 24)) >>> 0;
    this.pos += 4;
    return v;
  }

  i32(): number {
    const v = this.u32();
    return v >= 0x80000000 ? v - 0x100000000 : v;
  }

  /** A num(1.19.12) -- the DS GPU's own position/matrix fixed point (see `fx32`). */
  fx32(): number {
    return this.i32() / 4096;
  }

  /** A num(1.3.12) -- the DS GPU's own rotation-matrix-entry fixed point (see `fx16`). */
  fx16(): number {
    return this.i16() / 4096;
  }

  stamp(): string {
    const s = String.fromCharCode(this.bytes[this.pos], this.bytes[this.pos + 1], this.bytes[this.pos + 2], this.bytes[this.pos + 3]);
    this.pos += 4;
    return s;
  }

  name16(): string {
    const chars: number[] = [];
    for (let i = 0; i < 16; i++) {
      const c = this.u8();
      if (c !== 0) chars.push(c);
    }
    return String.fromCharCode(...chars);
  }

  bytes_(length: number): Uint8Array {
    const out = this.bytes.slice(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }
}

/**
 * A Nitro dictionary's entries: each one's name and a reader positioned at the start of its own `elementSize` bytes
 * of data (see `nitro-dictionary.ts`'s `writeDictionary`, the encode-side counterpart, and nsbmd_docs.txt's
 * `NameList(T)`). `elementSize` is the size(s) the caller expects each entry to be (known from the format's own
 * documented structure, e.g. 8 for a Texture) -- usually one fixed size, but a list of acceptable sizes where real
 * encoders disagree.
 *
 * This does NOT locate `element_size` by jumping past the dictionary's "Unknown" section using that section's own
 * declared length (nsbmd_docs.txt's `Unknown.UnknownHeader.unknown_size`) -- a real file encountered during testing
 * declared that length 4 bytes longer than this project's own `8 + 4*count` formula expects (nsbmd_docs.txt itself
 * flags the field's meaning as unconfirmed, with a "?"), which silently misread `element_size` as a large garbage
 * value instead of the dictionary's real, plain 4-byte-offset entries, then cascaded into nonsense offsets for
 * everything the dictionary pointed to. `size` and `count`, by contrast, have to be right for *any* reader to find
 * the dictionary's own data at all, so `element_size` is derived algebraically from them instead, via the same
 * `size = 16 + count*(20 + element_size)` relationship `nitro-dictionary.ts`'s `dictionarySize` computes forwards --
 * ignoring the Unknown section's declared length entirely, so whatever real-world value it holds (and whatever it
 * actually means) can no longer misalign every later read.
 */
export function readDictionary(bytes: Uint8Array, at: number, elementSize: number | readonly number[]): Array<{ name: string; data: BinaryReader }> {
  const r = new BinaryReader(bytes, at);
  r.u8(); // dummy
  const count = r.u8();
  const size = r.u16();
  const derivedElementSize = count > 0 ? (size - 16) / count - 20 : 0;
  const allowedSizes = Array.isArray(elementSize) ? elementSize : [elementSize as number];
  if (!Number.isInteger(derivedElementSize) || derivedElementSize < 0 || (count > 0 && !allowedSizes.includes(derivedElementSize))) {
    throw new Error(`Expected a dictionary of ${allowedSizes.join(" or ")}-byte entries at offset ${at}, but its size (${size}) and count (${count}) imply ${derivedElementSize}-byte entries.`);
  }
  const dataStart = at + size - count * (derivedElementSize + 16);
  const entries = Array.from({ length: count }, (_, i) => ({ name: "", data: new BinaryReader(bytes, dataStart + i * derivedElementSize) }));
  const namesStart = dataStart + count * derivedElementSize;
  for (let i = 0; i < count; i++) entries[i].name = new BinaryReader(bytes, namesStart + i * 16).name16();
  return entries;
}
