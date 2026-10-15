/**
 * The DS geometry engine's own command set (GBATEK "DS 3D Geometry Commands") -- the instruction stream an NSBMD
 * Mesh's blob of bytes actually is. Opcodes and parameter counts/layouts here are the hardware's, cross-checked
 * against libnds's own `nds/arm9/video.h` register offsets (each `GFX_*`/`MATRIX_*` register address is
 * `0x04000400 + opcode*4`, confirmed to match GBATEK's own opcode table exactly) -- the one part of this whole
 * conversion feature with a fully-pinned-down, non-speculative source.
 */
export interface GxCommand {
  opcode: number;
  /** u32 words, already packed into their documented bit layout. */
  params: readonly number[];
}

const NOP: GxCommand = { opcode: 0x00, params: [] };

/** Packs a command list into the FIFO's own "four opcodes, then their parameters" packet format (GBATEK/nsbmd_docs: each packet's first u32 gives four 8-bit opcodes, then every parameter of command 1, then of command 2, etc; a short final group is padded with NOP). */
export function packGxCommands(commands: readonly GxCommand[]): number[] {
  const words: number[] = [];
  for (let i = 0; i < commands.length; i += 4) {
    const group = [commands[i] ?? NOP, commands[i + 1] ?? NOP, commands[i + 2] ?? NOP, commands[i + 3] ?? NOP];
    let opcodeWord = 0;
    for (let k = 0; k < 4; k++) opcodeWord |= (group[k].opcode & 0xff) << (8 * k);
    words.push(opcodeWord >>> 0);
    for (const cmd of group) for (const param of cmd.params) words.push(param >>> 0);
  }
  return words;
}

function u16pair(low: number, high: number): number {
  return ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0;
}

/** A signed value's low `bits` bits, two's-complement -- for packing a signed field into a bitfield parameter word. */
function signedBits(value: number, bits: number): number {
  const max = 2 ** bits;
  const wrapped = ((Math.round(value) % max) + max) % max;
  return wrapped;
}

/** VTX_16 (0x23): sets the next vertex's position, num(1.3.12) (DS screen-space fixed point; see `fx16` -- scale 4096, clamped to +/-8) on each axis. 2 parameters. */
export function vtx16(x: number, y: number, z: number): GxCommand {
  return { opcode: 0x23, params: [u16pair(signedBits(x, 16), signedBits(y, 16)), signedBits(z, 16)] };
}

/** TEXCOORD (0x22): sets the next vertex's texture coordinates, 1 sign + 11 integer + 4 fraction bits a component (scale 16, in texels). 1 parameter. */
export function texcoord(s: number, t: number): GxCommand {
  return { opcode: 0x22, params: [u16pair(signedBits(s * 16, 16), signedBits(t * 16, 16))] };
}

/** BEGIN_VTXS (0x40): starts a vertex list. `type` 0 = separate triangles, 1 = separate quads (unused here; this converter always emits separate triangles). 1 parameter. */
export function beginVtxs(type: 0 | 1 | 2 | 3): GxCommand {
  return { opcode: 0x40, params: [type] };
}

/** END_VTXS (0x41): a no-op terminator for a BEGIN_VTXS/VTX_* run. 0 parameters. */
export function endVtxs(): GxCommand {
  return { opcode: 0x41, params: [] };
}
