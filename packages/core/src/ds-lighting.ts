/**
 * How the DS lights a surface, defined once so the editor's viewport and the compiler agree on it
 * (requirements/scene-designer/BUG.editor-lighting-differs-from-rom.md). This is the hardware's model, not a
 * physically based one:
 *
 *  - A directional light is a *color*. It adds `(ambient + diffuse * cos) * light color` to a vertex's color,
 *    where `cos` is how squarely the light meets the surface (0 when it grazes or faces away), `ambient` is the
 *    material's ambient color and `diffuse` its diffuse color. The sum over the lights is clamped to full brightness.
 *  - It is computed **per vertex** and blended across a face, not per pixel.
 *  - There is no tone mapping and no gamma: the number is what is shown.
 *  - With **no lights** a polygon isn't lit at all and shows its own color at full brightness.
 *  - At most four directional lights.
 *
 * The runtime's `AMBIENT_COLOR` (packages/compiler/runtime/source/main.c) and the compiler's default mesh color are
 * these same numbers; a test builds ROMs and checks the emulator against this file's formula.
 */

/** The DS has four hardware lights. */
export const DS_MAX_LIGHTS = 4;

/** Each color channel is 5 bits: 0..31. */
export const DS_COLOR_LEVELS = 31;

/** The material ambient color every mesh uses, as a fraction of full (8 of 31). Matches `AMBIENT_COLOR RGB15(8, 8, 8)` in the runtime. */
export const DS_AMBIENT = 8 / DS_COLOR_LEVELS;

/** The diffuse color of an untextured mesh, as a fraction of full (24 of 31). A textured mesh is white (1). */
export const DS_PLAIN_MESH_DIFFUSE = 24 / DS_COLOR_LEVELS;

/** A light's intensity as the DS holds it: the level (0..31) of a white light. The DS has nothing brighter than full white. */
export function lightLevelFromIntensity(intensity: number): number {
  const clamped = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 1;
  return Math.round(clamped * DS_COLOR_LEVELS);
}

export interface DsLightInput {
  /** The way the light travels, unit length, in the same space as the normal. */
  direction: readonly [number, number, number];
  /** 0..31, the level of the (white) light's color. */
  level: number;
}

/**
 * The color the DS gives a vertex, per channel 0..1: the sum over the lights of `(ambient + diffuse * cos) * light color`,
 * clamped. `normal` must be unit length. With no lights the vertex keeps its diffuse color, unlit.
 */
export function dsVertexBrightness(
  normal: readonly [number, number, number],
  lights: readonly DsLightInput[],
  diffuse: number = DS_PLAIN_MESH_DIFFUSE
): number {
  if (lights.length === 0) return Math.min(1, diffuse);
  let sum = 0;
  for (const light of lights.slice(0, DS_MAX_LIGHTS)) {
    const facing = Math.max(0, -(normal[0] * light.direction[0] + normal[1] * light.direction[1] + normal[2] * light.direction[2]));
    sum += (light.level / DS_COLOR_LEVELS) * (DS_AMBIENT + diffuse * facing);
  }
  return Math.min(1, sum);
}
