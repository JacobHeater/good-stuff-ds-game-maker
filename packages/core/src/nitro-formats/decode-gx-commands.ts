/** The inverse of `gx-commands.ts`'s `packGxCommands`: unpacks the FIFO's "four opcodes, then their parameters" packets back into a flat command list, using each opcode's own documented parameter count (GBATEK's own geometry command table, the same source `gx-commands.ts` cites). */
export interface DecodedGxCommand {
  opcode: number;
  params: number[];
}

/** Parameter counts for every opcode `nsbmd_docs.txt` says can appear inside a Mesh's own command blob. */
const PARAM_COUNTS: Record<number, number> = {
  0x00: 0, // NOP
  0x14: 1, // MTX_RESTORE
  0x1b: 3, // MTX_SCALE
  0x20: 1, // COLOR
  0x21: 1, // NORMAL
  0x22: 1, // TEXCOORD
  0x23: 2, // VTX_16
  0x24: 1, // VTX_10
  0x25: 1, // VTX_XY
  0x26: 1, // VTX_XZ
  0x27: 1, // VTX_YZ
  0x28: 1, // VTX_DIFF
  0x40: 1, // BEGIN_VTXS
  0x41: 0 // END_VTXS
};

export function unpackGxCommands(words: readonly number[]): DecodedGxCommand[] {
  const commands: DecodedGxCommand[] = [];
  let i = 0;
  while (i < words.length) {
    const opcodeWord = words[i++];
    const opcodes = [opcodeWord & 0xff, (opcodeWord >>> 8) & 0xff, (opcodeWord >>> 16) & 0xff, (opcodeWord >>> 24) & 0xff];
    for (const opcode of opcodes) {
      const paramCount = PARAM_COUNTS[opcode];
      if (paramCount === undefined) return commands; // an opcode this decoder doesn't know: stop rather than misread the rest
      const params = words.slice(i, i + paramCount);
      i += paramCount;
      if (opcode !== 0x00) commands.push({ opcode, params });
    }
  }
  return commands;
}

export function bytesToWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  for (let i = 0; i + 4 <= bytes.length; i += 4) words.push((bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0);
  return words;
}

function signed(value: number, bits: number): number {
  const half = 2 ** (bits - 1);
  return value >= half ? value - 2 * half : value;
}

export interface DecodedVertexStream {
  /** x, y, z per vertex, in the mesh's own (bone-local) space, real units (already divided by 4096). */
  positions: number[];
  /** u, v per vertex, in texels -- absent if the stream never set a texture coordinate. */
  uvs?: number[];
  /** Three vertex indices per triangle (this decoder only ever emits separate triangles, since that's the only primitive type this project's own encoder writes; a real file's quad/strip primitives are triangulated the same way a fan would be). */
  indices: number[];
}

/**
 * Interprets a Mesh's own GX command stream (already unpacked) into a plain vertex/triangle list -- the inverse of
 * `nsbmd.ts`'s `encodeMeshCommands`. Tracks the DS GPU's own per-vertex state (the last vertex's X/Y/Z, since
 * VTX_XY/XZ/YZ/DIFF only specify two axes or an offset and reuse the rest) so a real file using those more compact
 * commands (common in actual Nitro SDK output, to save space) still decodes correctly, not just this project's own
 * always-VTX_16 encoder output.
 */
export function decodeVertexStream(commands: readonly DecodedGxCommand[]): DecodedVertexStream {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let hasUvs = false;
  let lastX = 0;
  let lastY = 0;
  let lastZ = 0;
  let curU = 0;
  let curV = 0;
  let primitiveType = 0;
  let verticesInPrimitive = 0;
  let firstVertexOfPrimitive = 0;

  const pushVertex = (x: number, y: number, z: number): void => {
    const index = positions.length / 3;
    positions.push(x / 4096, y / 4096, z / 4096);
    uvs.push(curU / 16, curV / 16);
    if (primitiveType === 0) {
      // Separate triangles: every 3rd vertex closes a triangle.
      if (verticesInPrimitive % 3 === 2) indices.push(index - 2, index - 1, index);
    } else if (primitiveType === 1) {
      // Separate quads: every 4th vertex closes a quad, split into two triangles.
      if (verticesInPrimitive % 4 === 3) indices.push(index - 3, index - 2, index - 1, index - 3, index - 1, index);
    } else if (primitiveType === 2) {
      // Triangle strip: after the first 2, every new vertex closes a triangle with the previous two.
      if (verticesInPrimitive >= 2) indices.push(index - 2, index - 1, index);
    } else {
      // Quad strip: after the first 4, every pair of new vertices closes a quad (as two triangles).
      if (verticesInPrimitive >= 3 && verticesInPrimitive % 2 === 1) indices.push(index - 3, index - 2, index - 1, index - 2, firstVertexOfPrimitive, index - 1);
    }
    verticesInPrimitive++;
    lastX = x;
    lastY = y;
    lastZ = z;
  };

  for (const { opcode, params } of commands) {
    switch (opcode) {
      case 0x40:
        primitiveType = params[0] & 0x3;
        verticesInPrimitive = 0;
        firstVertexOfPrimitive = positions.length / 3;
        break;
      case 0x41:
        break;
      case 0x22:
        hasUvs = true;
        curU = signed(params[0] & 0xffff, 16);
        curV = signed((params[0] >>> 16) & 0xffff, 16);
        break;
      case 0x23:
        pushVertex(signed(params[0] & 0xffff, 16), signed((params[0] >>> 16) & 0xffff, 16), signed(params[1] & 0xffff, 16));
        break;
      case 0x24: {
        const v = params[0];
        pushVertex(signed(v & 0x3ff, 10) << 6, signed((v >>> 10) & 0x3ff, 10) << 6, signed((v >>> 20) & 0x3ff, 10) << 6);
        break;
      }
      case 0x25:
        pushVertex(signed(params[0] & 0xffff, 16), signed((params[0] >>> 16) & 0xffff, 16), lastZ);
        break;
      case 0x26:
        pushVertex(signed(params[0] & 0xffff, 16), lastY, signed((params[0] >>> 16) & 0xffff, 16));
        break;
      case 0x27:
        pushVertex(lastX, signed(params[0] & 0xffff, 16), signed((params[0] >>> 16) & 0xffff, 16));
        break;
      case 0x28: {
        // GBATEK VTX_DIFF: the raw 10-bit signed value is a 9-bit-fraction number, "divided by 8" to rescale it to
        // the ordinary 12-bit-fraction scale every other position value uses -- which, as a *raw integer*, is the
        // same integer bit pattern either way (dividing a fixed-point value by 8 while adding 3 more fraction bits
        // leaves the stored integer unchanged). So the raw sign-extended value already *is* the delta, in the same
        // 12-bit fixed-point units as `lastX`/`lastY`/`lastZ`.
        const v = params[0];
        pushVertex(lastX + signed(v & 0x3ff, 10), lastY + signed((v >>> 10) & 0x3ff, 10), lastZ + signed((v >>> 20) & 0x3ff, 10));
        break;
      }
      default:
        break; // other commands (MTX_SCALE, COLOR, NORMAL, MTX_RESTORE) don't affect vertex geometry
    }
  }

  return { positions, uvs: hasUvs ? uvs : undefined, indices };
}
