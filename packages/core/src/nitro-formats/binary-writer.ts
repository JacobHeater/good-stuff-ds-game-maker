/**
 * A small growable byte buffer for building the binary Nitro (Nintendo DS first-party) file formats in
 * `nitro-formats/` -- NSBMD, NSBTX, NSBCA, STRM. These formats are full of internal byte offsets (a chunk
 * pointing at data later in the same file), so `placeholder`/`patch` let code write a field before the value
 * it depends on is known yet, then fill it in once the real position is.
 */
export class BinaryWriter {
  private bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }

  u32(value: number): this {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
    return this;
  }

  /** A signed value written as its two's-complement bit pattern, in `bytes` bytes (1, 2 or 4). */
  signed(value: number, bytes: 1 | 2 | 4): this {
    const bits = bytes * 8;
    const wrapped = value < 0 ? value + 2 ** bits : value;
    if (bytes === 1) return this.u8(wrapped);
    if (bytes === 2) return this.u16(wrapped);
    return this.u32(wrapped >>> 0);
  }

  /** A 16-byte, null-padded ASCII name (the format's own "Name" idiom), truncated if too long. */
  name16(text: string): this {
    const ascii = Array.from(text, (ch) => ch.charCodeAt(0) & 0x7f).slice(0, 16);
    for (let i = 0; i < 16; i++) this.u8(ascii[i] ?? 0);
    return this;
  }

  bytes_(data: ArrayLike<number>): this {
    for (let i = 0; i < data.length; i++) this.bytes.push(data[i] & 0xff);
    return this;
  }

  /** Reserves `bytes` zero bytes now, returning their position so `patchU32`/`patchU16` can fill them in later. */
  placeholder(bytes: 2 | 4): number {
    const at = this.bytes.length;
    if (bytes === 2) this.u16(0);
    else this.u32(0);
    return at;
  }

  patchU32(at: number, value: number): void {
    this.bytes[at] = value & 0xff;
    this.bytes[at + 1] = (value >>> 8) & 0xff;
    this.bytes[at + 2] = (value >>> 16) & 0xff;
    this.bytes[at + 3] = (value >>> 24) & 0xff;
  }

  patchU16(at: number, value: number): void {
    this.bytes[at] = value & 0xff;
    this.bytes[at + 1] = (value >>> 8) & 0xff;
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

/** A real number as num(1.19.12): 32-bit, 1 sign bit, 19 integer bits, 12 fraction bits (the DS GPU's own position/matrix format; 0x1000 is 1.0). */
export function fx32(value: number): number {
  return Math.round(value * 4096);
}

/** A real number as num(1.3.12): 16-bit, 1 sign bit, 3 integer bits, 12 fraction bits (used for rotation matrix entries; clamped to its +/-8 range). */
export function fx16(value: number): number {
  const clamped = Math.max(-8, Math.min(8 - 1 / 4096, value));
  return Math.round(clamped * 4096);
}
