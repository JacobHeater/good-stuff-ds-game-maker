import { describe, expect, it } from "vitest";

import { BinaryWriter } from "./binary-writer";
import { readDictionary } from "./binary-reader";

/**
 * Builds a Nitro NameList(T) dictionary by hand (not via `nitro-dictionary.ts`'s own `writeDictionary`), so the
 * dictionary's declared "Unknown section" length can be set independently of the actual number of bytes physically
 * present there -- the exact real-world quirk `readDictionary`'s own doc comment describes.
 */
function buildDictionary(entries: ReadonlyArray<{ name: string; offset: number }>, elementSize: number, declaredUnknownSize: number): Uint8Array {
  const count = entries.length;
  const totalSize = 16 + count * (20 + elementSize); // the reliable total this project's own `dictionarySize` computes
  const w = new BinaryWriter();
  w.u8(0); // dummy
  w.u8(count);
  w.u16(totalSize);
  w.u16(8); // subheader_size
  w.u16(declaredUnknownSize); // may or may not match 8 + 4*count -- readDictionary must not depend on it
  w.u32(0x17f);
  for (let i = 0; i < count; i++) w.u32(0); // the actual, physically-present unknown[count] array (always 4 bytes/entry here)
  w.u16(elementSize);
  w.u16(0); // data_section_size (not read by readDictionary)
  for (const entry of entries) w.u32(entry.offset);
  for (const entry of entries) w.name16(entry.name);
  return w.toBytes();
}

describe("readDictionary", () => {
  it("reads a well-formed dictionary whose declared Unknown-section length matches the usual 8 + 4*count formula", () => {
    const bytes = buildDictionary([{ name: "one", offset: 100 }, { name: "two", offset: 200 }], 4, 8 + 4 * 2);
    const entries = readDictionary(bytes, 0, 4);
    expect(entries.map((e) => e.name)).toEqual(["one", "two"]);
    expect(entries.map((e) => e.data.u32())).toEqual([100, 200]);
  });

  it("still reads a dictionary correctly when its declared Unknown-section length is longer than 8 + 4*count -- a real NSBMD encountered in the wild does this, and naively jumping past that declared length misreads element_size as garbage", () => {
    const entries = [{ name: "model", offset: 48 }];
    // The real-world file's Models dictionary declared an Unknown-section length 4 bytes longer than this
    // project's own formula predicts for a single entry (16 instead of 12); the physical unknown[count] array
    // itself is still just 4 bytes/entry, same as always.
    const bytes = buildDictionary(entries, 4, 8 + 4 * entries.length + 4);
    const decoded = readDictionary(bytes, 0, 4);
    expect(decoded.map((e) => e.name)).toEqual(["model"]);
    expect(decoded.map((e) => e.data.u32())).toEqual([48]);
  });

  it("refuses a dictionary whose size/count imply an entry width the caller didn't expect", () => {
    const bytes = buildDictionary([{ name: "one", offset: 1 }], 8, 8 + 4);
    expect(() => readDictionary(bytes, 0, 4)).toThrow(/4-byte entries/);
  });
});
