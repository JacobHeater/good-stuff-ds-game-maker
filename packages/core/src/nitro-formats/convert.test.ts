import { describe, expect, it } from "vitest";

import { createSceneNode } from "../scene-node";
import type { Animation } from "../animation";
import type { ImportedMesh } from "../imported-mesh";
import type { ImportedSound } from "../imported-sound";
import { animationToNsbca, meshToNsbmd, riggedModelToNsbmd, soundToStrm } from "./convert";

function stamp(bytes: Uint8Array): string {
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

const triangle: Pick<ImportedMesh, "positions" | "indices"> = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };

describe("meshToNsbmd", () => {
  it("wraps a plain mesh as a valid, single-bone BMD0", () => {
    const { bytes, warnings } = meshToNsbmd(triangle);
    expect(warnings).toEqual([]);
    expect(stamp(bytes)).toBe("BMD0");
  });
});

describe("riggedModelToNsbmd", () => {
  it("walks a Node3D bone tree, attaching each MeshInstance3D to its parent bone", () => {
    const mesh: ImportedMesh = { id: "m1", name: "Body", normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], ...triangle };
    const meshNode = createSceneNode({ name: "BodyMesh", kind: "MeshInstance3D" });
    meshNode.mesh = { importedMeshId: "m1", triangleCount: 1 };
    const leg = createSceneNode({ name: "Leg", kind: "Node3D", children: [meshNode] });
    const hip = createSceneNode({ name: "Hip", kind: "Node3D", children: [leg] });
    const { bytes, warnings } = riggedModelToNsbmd(hip, new Map([["m1", mesh]]));
    expect(warnings).toEqual([]);
    expect(stamp(bytes)).toBe("BMD0");
  });

  it("drops a mesh instance with no matching imported mesh, quietly (nothing to draw for it)", () => {
    const meshNode = createSceneNode({ name: "Missing", kind: "MeshInstance3D" });
    meshNode.mesh = { importedMeshId: "gone", triangleCount: 1 };
    const root = createSceneNode({ name: "Root", kind: "Node3D", children: [meshNode] });
    const { bytes } = riggedModelToNsbmd(root, new Map());
    expect(stamp(bytes)).toBe("BMD0");
  });
});

describe("animationToNsbca", () => {
  it("resamples a sparse position track into a full per-frame NSBCA track", () => {
    const bone = createSceneNode({ name: "Arm", kind: "Node3D" });
    const root = createSceneNode({ name: "Root", kind: "Node3D", children: [bone] });
    const animation: Animation = {
      id: "a1",
      name: "Wave",
      length: 1,
      loop: true,
      tracks: [{ id: "t1", nodeId: bone.id, property: "position", keys: [{ time: 0, value: { x: 0, y: 0, z: 0 } }, { time: 1, value: { x: 1, y: 0, z: 0 } }] }]
    };
    const { bytes, warnings } = animationToNsbca(root, animation, 30);
    expect(warnings).toEqual([]);
    expect(stamp(bytes)).toBe("BCA0");
  });

  it("leaves an un-animated bone with no track at all", () => {
    const bone = createSceneNode({ name: "Still", kind: "Node3D" });
    const root = createSceneNode({ name: "Root", kind: "Node3D", children: [bone] });
    const animation: Animation = { id: "a1", name: "Empty", length: 1, loop: false, tracks: [] };
    const { bytes } = animationToNsbca(root, animation, 30);
    expect(stamp(bytes)).toBe("BCA0");
  });
});

describe("soundToStrm", () => {
  it("converts a PCM16 ImportedSound into a valid STRM", () => {
    const pcm = new Uint8Array(20);
    const sound: ImportedSound = { id: "s1", name: "Beep", sampleRate: 16000, samples: Buffer.from(pcm).toString("base64") };
    const bytes = soundToStrm(sound);
    expect(stamp(bytes)).toBe("STRM");
  });
});
