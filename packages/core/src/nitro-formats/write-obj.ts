import type { DecodedNsbmd } from "./decode-nsbmd";
import { applyToPoint, fromTrs, multiply, type Mat4 } from "./mat4";

/**
 * A decoded NSBMD as a plain, static Wavefront OBJ: every mesh's vertices are transformed by its bone's full
 * world matrix (composed by walking the bone tree, parent before child -- bones are always listed in that order,
 * the same order `decodeNsbmd` read them in) and written out flat, since OBJ has no concept of bones at all. This
 * is the right "give up the skeleton" choice for OBJ specifically (`write-glb.ts` keeps it); a static snapshot of
 * a model's bind pose is exactly what OBJ can represent.
 */
export function writeObj(model: DecodedNsbmd, name: string): string {
  const worldMatrix: Mat4[] = model.bones.map(() => fromTrs({ x: 0, y: 0, z: 0 }, [1, 0, 0, 0, 1, 0, 0, 0, 1], { x: 1, y: 1, z: 1 }));
  model.bones.forEach((bone, i) => {
    const local = fromTrs(bone.position, bone.rotation, bone.scale);
    worldMatrix[i] = bone.parentIndex >= 0 ? multiply(worldMatrix[bone.parentIndex], local) : local;
  });

  const lines: string[] = [`# ${name}, converted from NSBMD by Good Stuff DS Game Maker`, "o " + name.replace(/\s+/g, "_")];
  let vertexOffset = 0;
  const hasAnyUvs = model.meshes.some((m) => m.uvs);

  for (const mesh of model.meshes) {
    const matrix = worldMatrix[mesh.boneIndex] ?? fromTrs({ x: 0, y: 0, z: 0 }, [1, 0, 0, 0, 1, 0, 0, 0, 1], { x: 1, y: 1, z: 1 });
    const vertexCount = mesh.positions.length / 3;
    for (let i = 0; i < vertexCount; i++) {
      const p = applyToPoint(matrix, { x: mesh.positions[i * 3], y: mesh.positions[i * 3 + 1], z: mesh.positions[i * 3 + 2] });
      lines.push(`v ${p.x.toFixed(6)} ${p.y.toFixed(6)} ${p.z.toFixed(6)}`);
    }
    if (hasAnyUvs) {
      for (let i = 0; i < vertexCount; i++) {
        const u = mesh.uvs?.[i * 2] ?? 0;
        const v = mesh.uvs?.[i * 2 + 1] ?? 0;
        lines.push(`vt ${u.toFixed(6)} ${(1 - v).toFixed(6)}`); // OBJ's V runs bottom-to-top; this project's own V runs top-to-bottom
      }
    }
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const face = (localIndex: number): string => {
        const oneBased = vertexOffset + localIndex + 1;
        return hasAnyUvs ? `${oneBased}/${oneBased}` : `${oneBased}`;
      };
      lines.push(`f ${face(mesh.indices[t])} ${face(mesh.indices[t + 1])} ${face(mesh.indices[t + 2])}`);
    }
    vertexOffset += vertexCount;
  }

  return lines.join("\n") + "\n";
}
