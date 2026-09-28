/**
 * A mesh's color (requirements/scene-designer/STORY.mesh-colors.md): the DS lights a mesh with a diffuse color, so a plain mesh can be any color (5 bits a channel, 32 levels), and a textured
 * one is tinted by it. Stored as "#rrggbb"; a mesh with none is the DS's plain grey (24 of 31), or white when it has a texture so the picture shows in its own colors.
 */

/** The color as levels 0..31 of red, green and blue (what the DS holds), or null when it isn't "#rrggbb". */
export function parseMeshColor(color: string | undefined): [number, number, number] | null {
  if (color === undefined || !/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  const channel = (offset: number): number => Math.round((parseInt(color.slice(offset, offset + 2), 16) * 31) / 255);
  return [channel(1), channel(3), channel(5)];
}

/** "#rrggbb" for levels 0..31 (the nearest 8-bit values). */
export function meshColorFromLevels(levels: readonly [number, number, number]): string {
  const hex = (level: number): string => Math.round((Math.min(31, Math.max(0, level)) * 255) / 31).toString(16).padStart(2, "0");
  return `#${hex(levels[0])}${hex(levels[1])}${hex(levels[2])}`;
}

/** What the DS draws the mesh's diffuse color as, in levels 0..31: its own color, else white for a textured mesh and grey for a plain one. */
export function getMeshDiffuseLevels(mesh: { color?: string }, textured: boolean): [number, number, number] {
  return parseMeshColor(mesh.color) ?? (textured ? [31, 31, 31] : [24, 24, 24]);
}

/** A mesh's opacity level as the DS holds it: its POLY_ALPHA, 0..31, from a 0..1 fraction (the same scale a light's intensity uses). */
export function alphaLevelFromOpacity(opacity: number): number {
  const clamped = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  return Math.round(clamped * 31);
}

/** A mesh's opacity, 0..1 (absent is fully opaque). */
export function getMeshOpacity(mesh: { alpha?: number }): number {
  return mesh.alpha === undefined ? 1 : Math.min(1, Math.max(0, mesh.alpha));
}
