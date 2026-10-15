import { BinaryWriter } from "./binary-writer";

/**
 * The generic "dictionary" (NameList) layout every Nitro G3D format (NSBMD/NSBTX/NSBCA and friends) uses to list
 * its models, meshes, materials, bones, textures, palettes and animations: a named lookup table where each entry
 * is either an inline struct (materials, textures, palettes, animation tracks) or an offset to one stored
 * elsewhere (models, meshes, bones -- each a `u32` relative to the dictionary's own container).
 *
 * Several fields here (the whole "Unknown" section, `data_section_size`) are not known to affect how a real DS
 * decodes the file -- they come from community reverse-engineering (see STORY.nitro-native-format-converter.md),
 * so this fills them with the same constant values every documented, working example uses, and keeps every field
 * a real reader actually depends on (count, element size, per-entry data, per-entry name) exact.
 */
export interface DictionaryEntry {
  name: string;
  /** This entry's own `element_size` bytes of data (a 4-byte offset, or an inline struct's bytes). */
  data: readonly number[];
}

export function writeDictionary(out: BinaryWriter, entries: readonly DictionaryEntry[], elementSize: number): void {
  const count = entries.length;
  const totalSize = 16 + (20 + elementSize) * count;
  out.u8(0); // dummy
  out.u8(count);
  out.u16(totalSize);
  out.u16(8); // Unknown.UnknownHeader.subheader_size (always 8, per every documented example)
  out.u16(8 + 4 * count); // Unknown.UnknownHeader.unknown_size (the whole Unknown section, including this header)
  out.u32(0x17f); // Unknown.UnknownHeader.unknown (always 0x17F, per every documented example)
  for (let i = 0; i < count; i++) out.u32(0); // Unknown.unknown[count] (per-entry meaning unknown; zero in every documented example)
  out.u16(elementSize);
  out.u16((elementSize + 16) * count); // data_section_size (the data+names that follow; exact meaning unconfirmed)
  for (const entry of entries) {
    if (entry.data.length !== elementSize) throw new Error(`Dictionary entry "${entry.name}" is ${entry.data.length} bytes, not the declared element size ${elementSize}.`);
    out.bytes_(entry.data);
  }
  for (const entry of entries) out.name16(entry.name);
}

/** The byte size of a dictionary with `count` entries of `elementSize` bytes each -- for sizing a chunk before its contents are written. */
export function dictionarySize(count: number, elementSize: number): number {
  return 16 + (20 + elementSize) * count;
}
