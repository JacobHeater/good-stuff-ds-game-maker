import { DS_AMBIENT, DS_COLOR_LEVELS, DS_MAX_LIGHTS } from "@goodstuff/core";
import { DataTexture, ShaderMaterial, Vector3, type Object3D, type Side, type Texture } from "three";

/**
 * The editor viewport's meshes are shaded the way the DS shades them, not the way three.js would
 * (requirements/scene-designer/BUG.editor-lighting-differs-from-rom.md). The model is in core's `ds-lighting.ts`:
 * each directional light adds `(ambient + diffuse * cos) * light color`, computed **per vertex** and blended across the
 * face, clamped to full brightness; no tone mapping, no gamma; and with no lights a mesh shows its own color, unlit.
 *
 * Normals are rotated without scale (as the ROM does: see requirements/compiler/BUG.rom-lighting-breaks-on-scaled-meshes.md).
 */

export interface ViewportLight {
  /** The light node's object; its local -Z axis, in the world, is the way the light travels. */
  object: Object3D;
  /** 0..31: the level of the light's white color. */
  level: number;
}

const registry = new Set<ViewportLight>();

/** A drawn directional light adds itself here; the returned function removes it. Insertion order is the light order. */
export function registerViewportLight(light: ViewportLight): () => void {
  registry.add(light);
  return () => {
    registry.delete(light);
  };
}

/** Uniform objects shared by every mesh's material, so updating them once a frame updates every mesh. */
const sharedUniforms = {
  uLightDir: { value: Array.from({ length: DS_MAX_LIGHTS }, () => new Vector3(0, 0, -1)) },
  uLightColor: { value: Array.from({ length: DS_MAX_LIGHTS }, () => new Vector3(0, 0, 0)) },
  uLightCount: { value: 0 }
};

/** Copies the registered lights (the first four) into the shared uniforms. Call once per frame, before rendering. */
export function syncViewportLights(): void {
  let count = 0;
  for (const light of registry) {
    if (count >= DS_MAX_LIGHTS) break;
    light.object.updateWorldMatrix(true, false);
    const e = light.object.matrixWorld.elements;
    // The way the light travels is its local -Z axis: minus the third column of its world matrix.
    sharedUniforms.uLightDir.value[count].set(-e[8], -e[9], -e[10]).normalize();
    const level = light.level / DS_COLOR_LEVELS;
    sharedUniforms.uLightColor.value[count].set(level, level, level);
    count++;
  }
  sharedUniforms.uLightCount.value = count;
}

const VERTEX_SHADER = /* glsl */ `
  uniform vec3 uLightDir[${DS_MAX_LIGHTS}];
  uniform vec3 uLightColor[${DS_MAX_LIGHTS}];
  uniform int uLightCount;
  uniform float uAmbient;
  uniform vec3 uDiffuse;
  varying vec3 vColor;
  varying vec2 vUv;

  void main() {
    // The rotation part of the model matrix only: normals aren't scaled (the DS gets the same).
    mat3 m = mat3(modelMatrix);
    vec3 n = normalize(mat3(normalize(m[0]), normalize(m[1]), normalize(m[2])) * normal);

    vec3 color;
    if (uLightCount == 0) {
      color = uDiffuse; // no lights: nothing is lit, the mesh shows its own color
    } else {
      color = vec3(0.0);
      for (int i = 0; i < ${DS_MAX_LIGHTS}; i++) {
        if (i >= uLightCount) break;
        float facing = max(dot(n, -uLightDir[i]), 0.0);
        color += uLightColor[i] * (uAmbient + uDiffuse * facing);
      }
    }
    vColor = min(color, vec3(1.0)); // per vertex, blended across the face, as on the DS
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform float uUseMap;
  uniform vec3 uTint;
  varying vec3 vColor;
  varying vec2 vUv;

  void main() {
    vec4 texel = uUseMap > 0.5 ? texture2D(map, vUv) : vec4(1.0);
    if (texel.a < 0.5) discard; // the DS's texture transparency is on or off
    gl_FragColor = vec4(vColor * texel.rgb * uTint, 1.0); // no tone mapping, no gamma: the numbers are what's shown
  }
`;

/** A 1x1 white picture, so the sampler always has something bound even when a mesh has no texture. */
const blank = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
blank.needsUpdate = true;

export interface DsMaterialOptions {
  /** The material's diffuse color, 0..1 per channel: the plain mesh grey, white for a textured mesh, or the selection color. */
  diffuse: readonly [number, number, number];
  /** Multiplies the final color; used to tint a selected textured mesh. */
  tint?: readonly [number, number, number];
  map?: Texture | null;
  /** Which faces are drawn. The DS runtime draws every face (culling off), so a mesh that can be seen from behind is double-sided. */
  side: Side;
}

/** A material that shades with the DS's lighting. Dispose it when done. */
export function createDsMaterial(options: DsMaterialOptions): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uAmbient: { value: DS_AMBIENT },
      uDiffuse: { value: new Vector3(...options.diffuse) },
      uTint: { value: new Vector3(...(options.tint ?? [1, 1, 1])) },
      map: { value: options.map ?? blank },
      uUseMap: { value: options.map ? 1 : 0 }
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: options.side
  });
}
