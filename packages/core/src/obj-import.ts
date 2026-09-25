import { DS_HARDWARE_PROFILE } from "./hardware";
import { MAX_IMPORTED_COORDINATE, type ImportedMesh } from "./imported-mesh";

/**
 * Turns the text of a Wavefront .obj file into a mesh the editor, the hardware budget and the compiler
 * can share, or refuses it with reasons. Pure: the caller reads the file (the Electron main process
 * does) and gives us the text. See requirements/scene-designer/TASK.obj-parser.md for what is and isn't
 * handled.
 */
export type ObjImportResult =
  | { ok: true; mesh: Omit<ImportedMesh, "id">; warnings: string[] }
  | { ok: false; errors: string[] };

export interface ObjImportOptions {
  /** The model's name, usually the file's name without its extension. */
  name: string;
}

/** Coordinates are rounded to this many decimals: finer than the DS's 4.12 fixed point (about 0.00024) can hold. */
const DECIMALS = 5;
const SCALE = 10 ** DECIMALS;
/** More errors than this are summarized, so a file that isn't an .obj at all doesn't produce thousands of lines. */
const MAX_REPORTED_ERRORS = 8;
/** A triangle smaller than this (twice its area) is degenerate. */
const DEGENERATE_AREA = 1e-12;

type Vec3 = [number, number, number];

const round = (value: number): number => Math.round(value * SCALE) / SCALE + 0; // + 0 turns -0 into 0

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

/** One corner of a face as written in the file: zero-based indices, with a normal and a texture-coordinate index when the file gave them. */
interface Corner {
  position: number;
  normal: number | undefined;
  uv: number | undefined;
}
interface Face {
  line: number;
  corners: Corner[];
}

function parseNumber(token: string | undefined): number | undefined {
  if (token === undefined || token === "") return undefined;
  const value = Number(token);
  return Number.isFinite(value) ? value : undefined;
}

export function parseObj(text: string, options: ObjImportOptions): ObjImportResult {
  const errors: string[] = [];
  let suppressed = 0;
  const fail = (message: string): void => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(message);
    else suppressed++;
  };

  const positions: Vec3[] = [];
  const positionLines: number[] = [];
  const normals: Vec3[] = [];
  const texCoords: Array<[number, number]> = [];
  const faces: Face[] = [];
  let sawTextureCoordinates = false;
  let sawMaterials = false;
  let sawLinesOrPoints = false;

  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const content = lines[i].split("#")[0].trim();
    if (content === "") continue;
    const tokens = content.split(/\s+/);
    const keyword = tokens[0];
    const args = tokens.slice(1);

    switch (keyword) {
      case "v": {
        const x = parseNumber(args[0]);
        const y = parseNumber(args[1]);
        const z = parseNumber(args[2]);
        if (x === undefined || y === undefined || z === undefined) {
          fail(`Line ${lineNumber}: a vertex needs three numbers ("${content}").`);
          positions.push([0, 0, 0]);
        } else {
          positions.push([x, y, z]);
        }
        positionLines.push(lineNumber);
        break;
      }
      case "vn": {
        const x = parseNumber(args[0]);
        const y = parseNumber(args[1]);
        const z = parseNumber(args[2]);
        if (x === undefined || y === undefined || z === undefined) {
          fail(`Line ${lineNumber}: a normal needs three numbers ("${content}").`);
          normals.push([0, 0, 0]);
        } else {
          normals.push([x, y, z]);
        }
        break;
      }
      case "vt": {
        // `vt u [v [w]]`: v defaults to 0 and w is ignored. OBJ's v axis points up; the project's points down.
        sawTextureCoordinates = true;
        const u = parseNumber(args[0]);
        const v = args[1] === undefined ? 0 : parseNumber(args[1]);
        if (u === undefined || v === undefined) {
          fail(`Line ${lineNumber}: a texture coordinate needs one to three numbers ("${content}").`);
          texCoords.push([0, 0]);
        } else {
          texCoords.push([u, v]);
        }
        break;
      }
      case "mtllib":
      case "usemtl":
        sawMaterials = true;
        break;
      case "l":
      case "p":
        sawLinesOrPoints = true;
        break;
      case "f": {
        if (args.length < 3) {
          fail(`Line ${lineNumber}: a face needs at least three vertices ("${content}").`);
          break;
        }
        const corners: Corner[] = [];
        let bad = false;
        for (const ref of args) {
          const parts = ref.split("/");
          const p = Number(parts[0]);
          const t = parts.length >= 2 && parts[1] !== "" ? Number(parts[1]) : undefined;
          const n = parts.length >= 3 && parts[2] !== "" ? Number(parts[2]) : undefined;
          if (
            !Number.isInteger(p) ||
            p === 0 ||
            (t !== undefined && (!Number.isInteger(t) || t === 0)) ||
            (n !== undefined && (!Number.isInteger(n) || n === 0))
          ) {
            fail(`Line ${lineNumber}: "${ref}" isn't a valid vertex reference (indices start at 1).`);
            bad = true;
            break;
          }
          // A negative index counts back from the most recently declared vertex, as of this line.
          corners.push({
            position: p > 0 ? p - 1 : positions.length + p,
            normal: n === undefined ? undefined : n > 0 ? n - 1 : normals.length + n,
            uv: t === undefined ? undefined : t > 0 ? t - 1 : texCoords.length + t
          });
        }
        if (!bad) faces.push({ line: lineNumber, corners });
        break;
      }
      default:
        // o, g, s, mg, and anything else: nothing to import.
        break;
    }
  }

  if (faces.length === 0 && errors.length === 0) fail("The file has no faces, so there is no surface to import.");

  // Every reference must now point at a declared vertex or normal.
  for (const face of faces) {
    for (const corner of face.corners) {
      if (corner.position < 0 || corner.position >= positions.length) {
        fail(`Line ${face.line}: a face uses vertex ${corner.position + 1}, but the file only has ${positions.length}.`);
        break; // one message per face is enough
      } else if (corner.normal !== undefined && (corner.normal < 0 || corner.normal >= normals.length)) {
        fail(`Line ${face.line}: a face uses normal ${corner.normal + 1}, but the file only has ${normals.length}.`);
        break;
      } else if (corner.uv !== undefined && (corner.uv < 0 || corner.uv >= texCoords.length)) {
        fail(`Line ${face.line}: a face uses texture coordinate ${corner.uv + 1}, but the file only has ${texCoords.length}.`);
        break;
      }
    }
  }
  if (errors.length > 0) return refuse(errors, suppressed);

  // Triangulate (fan) and count before building anything.
  const triangles: Array<{ corners: [Corner, Corner, Corner]; normal: Vec3 | undefined }> = [];
  let degenerate = 0;
  for (const face of faces) {
    for (let k = 1; k < face.corners.length - 1; k++) {
      const corners: [Corner, Corner, Corner] = [face.corners[0], face.corners[k], face.corners[k + 1]];
      const [a, b, c] = corners.map((corner) => positions[corner.position]) as [Vec3, Vec3, Vec3];
      const faceNormal = cross(sub(b, a), sub(c, a));
      const area2 = length(faceNormal);
      if (area2 < DEGENERATE_AREA) {
        degenerate++;
        continue;
      }
      triangles.push({ corners, normal: [faceNormal[0] / area2, faceNormal[1] / area2, faceNormal[2] / area2] });
    }
  }
  if (triangles.length === 0) return refuse(["Every face in the file has no area, so there is no surface to import."], 0);

  const limit = DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame;
  if (triangles.length > limit) {
    return refuse(
      [`The model has ${triangles.length} triangles, but the DS can draw about ${limit} in a whole frame. Reduce the model's triangle count and import it again.`],
      0
    );
  }

  // Positions the model actually uses must fit the DS's vertex format.
  const used = new Set<number>();
  for (const triangle of triangles) for (const corner of triangle.corners) used.add(corner.position);
  for (const index of [...used].sort((a, b) => a - b)) {
    const worst = Math.max(...positions[index].map(Math.abs));
    if (worst > MAX_IMPORTED_COORDINATE) {
      fail(
        `Line ${positionLines[index]}: a vertex coordinate of ${worst} is outside the DS's range of about ±${MAX_IMPORTED_COORDINATE.toFixed(2)}. ` +
          "Scale the model down in your modelling tool and import it again."
      );
    }
  }
  if (errors.length > 0) return refuse(errors, suppressed);

  // Texture coordinates are kept only if every corner of every triangle has one; a model that's textured in
  // places and not in others has no usable mapping.
  const cornersWithUv = triangles.reduce((n, tri) => n + tri.corners.filter((c) => c.uv !== undefined).length, 0);
  const hasUvs = cornersWithUv === triangles.length * 3;
  const partialUvs = cornersWithUv > 0 && !hasUvs;

  // Build the indexed mesh: one unique vertex per distinct (position, normal, texture coordinate).
  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const outUvs: number[] = [];
  const indices: number[] = [];
  const vertexIndex = new Map<string, number>();
  for (const triangle of triangles) {
    for (const corner of triangle.corners) {
      let normal = triangle.normal as Vec3;
      if (corner.normal !== undefined) {
        const given = normals[corner.normal];
        const len = length(given);
        if (len > 0) normal = [given[0] / len, given[1] / len, given[2] / len];
      }
      const p = positions[corner.position];
      const uv: [number, number] | undefined = hasUvs ? texCoords[corner.uv as number] : undefined;
      // OBJ's v axis points up and the project's points down (image space), so v becomes 1 - v.
      const imageUv: [number, number] | undefined = uv ? [uv[0], 1 - uv[1]] : undefined;
      const key = [p[0], p[1], p[2], normal[0], normal[1], normal[2], ...(imageUv ?? [])].map(round).join(",");
      let index = vertexIndex.get(key);
      if (index === undefined) {
        index = outPositions.length / 3;
        outPositions.push(round(p[0]), round(p[1]), round(p[2]));
        outNormals.push(round(normal[0]), round(normal[1]), round(normal[2]));
        if (imageUv) outUvs.push(round(imageUv[0]), round(imageUv[1]));
        vertexIndex.set(key, index);
      }
      indices.push(index);
    }
  }

  const warnings: string[] = [];
  if (sawMaterials) warnings.push("Materials (mtllib/usemtl) were ignored; the model is drawn in a single color.");
  if (partialUvs) {
    warnings.push("Only some faces have texture coordinates, so they were all ignored and the model can't be textured.");
  } else if (sawTextureCoordinates && !hasUvs) {
    warnings.push("Texture coordinates are in the file but no face uses them, so the model can't be textured.");
  }
  if (sawLinesOrPoints) warnings.push("Line and point elements were ignored.");
  if (degenerate > 0) warnings.push(`${degenerate} zero-area triangle${degenerate === 1 ? " was" : "s were"} dropped.`);
  const usedNormalCount = faces.some((face) => face.corners.some((corner) => corner.normal !== undefined));
  if (!usedNormalCount) warnings.push("The file has no normals, so each face is shaded flat.");

  return {
    ok: true,
    mesh: {
      name: options.name.trim() || "Model",
      positions: outPositions,
      normals: outNormals,
      ...(hasUvs ? { uvs: outUvs } : {}),
      indices
    },
    warnings
  };
}

function refuse(errors: string[], suppressed: number): ObjImportResult {
  return { ok: false, errors: suppressed > 0 ? [...errors, `...and ${suppressed} more.`] : errors };
}
