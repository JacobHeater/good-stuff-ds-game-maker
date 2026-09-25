import type { Schema } from "ajv";

/**
 * Hand-authored JSON Schema for `ProjectSnapshot`, kept manually in sync
 * with `packages/core/src/project-snapshot.ts` and
 * `packages/core/src/scene-node.ts`.
 *
 * This is an interim measure. `requirements/persistence/TASK.generate-json-schema-from-interfaces.md`
 * calls for generating this from the TypeScript interfaces instead (e.g.
 * via `typescript-json-schema` or `ts-json-schema-generator`) so it can
 * never silently drift from them. Swapping this constant for a generated
 * one is meant to be a drop-in replacement for
 * `JsonSchemaProjectSnapshotValidator` — nothing else in this package
 * depends on how the schema was produced, only that it's a valid JSON
 * Schema describing `ProjectSnapshot`. If you add a field to
 * `ProjectSnapshot` or `SceneNode`, update this schema in the same
 * change (`additionalProperties: false` throughout means an
 * out-of-sync schema fails loudly rather than silently accepting or
 * ignoring the new field).
 */
export const PROJECT_SNAPSHOT_JSON_SCHEMA: Schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://goodstuff-ds-game-maker/schemas/project-snapshot.json",
  title: "ProjectSnapshot",
  type: "object",
  additionalProperties: false,
  required: ["formatVersion", "id", "name", "mode", "createdAt", "updatedAt", "scene"],
  properties: {
    formatVersion: { const: 1 },
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    mode: { enum: ["2D", "3D"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    scene: { $ref: "#/definitions/sceneNode" },
    meshes: { type: "array", items: { $ref: "#/definitions/importedMesh" } },
    textures: { type: "array", items: { $ref: "#/definitions/importedTexture" } },
    sounds: { type: "array", items: { $ref: "#/definitions/importedSound" } },
    scripts: { type: "array", items: { $ref: "#/definitions/projectScript" } }
  },
  definitions: {
    vector2: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: {
        x: { type: "number" },
        y: { type: "number" }
      }
    },
    vector3: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y", "z"],
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" }
      }
    },
    transform3D: {
      type: "object",
      additionalProperties: false,
      required: ["position", "rotation", "scale"],
      properties: {
        position: { $ref: "#/definitions/vector3" },
        rotation: { $ref: "#/definitions/vector3" },
        scale: { $ref: "#/definitions/vector3" }
      }
    },
    // A light's brightness: 0..1, the level of a white light (see core's ds-lighting.ts).
    lightData: {
      type: "object",
      additionalProperties: false,
      required: ["intensity"],
      properties: {
        intensity: { type: "number", minimum: 0, maximum: 1 }
      }
    },
    // A mesh uses a built-in primitive OR an imported model, never both and never neither.
    meshInstanceData: {
      type: "object",
      additionalProperties: false,
      required: ["triangleCount"],
      properties: {
        primitive: { enum: ["cube", "sphere", "plane", "cylinder"] },
        importedMeshId: { type: "string", minLength: 1 },
        textureId: { type: "string", minLength: 1 },
        triangleCount: { type: "number", minimum: 0 }
      },
      oneOf: [{ required: ["primitive"] }, { required: ["importedMeshId"] }]
    },
    // The array lengths agreeing with each other, and the indices being in range, aren't expressible in
    // JSON Schema; JsonSchemaProjectSnapshotValidator checks them (and that every importedMeshId exists).
    importedMesh: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "positions", "normals", "indices"],
      properties: {
        id: { type: "string", minLength: 1 },
        name: { type: "string" },
        positions: { type: "array", items: { type: "number" } },
        normals: { type: "array", items: { type: "number" } },
        uvs: { type: "array", items: { type: "number" } },
        indices: { type: "array", items: { type: "integer", minimum: 0 } }
      }
    },
    // The texels are the picture already converted to the DS's 16-bit format (see core's imported-texture.ts).
    // That the size is a power of two from 8 to 1024 and that the data decodes to exactly width * height * 2
    // bytes aren't expressible here; JsonSchemaProjectSnapshotValidator checks them.
    importedTexture: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "width", "height", "texels"],
      properties: {
        id: { type: "string", minLength: 1 },
        name: { type: "string" },
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
        texels: { type: "string" }
      }
    },
    // Mono 16-bit samples, base64 (see core's imported-sound.ts). That the sample rate is 3000-32000, that the data is valid
    // base64 holding a whole number of samples and that every player's soundId exists aren't expressible here;
    // JsonSchemaProjectSnapshotValidator checks them.
    importedSound: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "sampleRate", "samples"],
      properties: {
        id: { type: "string", minLength: 1 },
        name: { type: "string" },
        sampleRate: { type: "integer", minimum: 1 },
        samples: { type: "string" }
      }
    },
    // A script's source text (see core's project-script.ts). That ids are unique, names are non-empty and every
    // node's scriptId exists aren't expressible here; JsonSchemaProjectSnapshotValidator checks them.
    projectScript: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "source"],
      properties: {
        id: { type: "string", minLength: 1 },
        name: { type: "string" },
        source: { type: "string" }
      }
    },
    // An AudioStreamPlayer's sound and playback settings; a missing field is its default (see core's audio-player.ts).
    audioPlayerData: {
      type: "object",
      additionalProperties: false,
      properties: {
        soundId: { type: "string", minLength: 1 },
        autoplay: { type: "boolean" },
        volume: { type: "number", minimum: 0, maximum: 1 },
        pitch: { type: "number", minimum: 0.25, maximum: 4 },
        loop: { type: "boolean" }
      }
    },
    // A CollisionShape3D's shape and size; a missing field is its default (see core's collision-shape.ts). A capsule shorter than it is
    // wide is accepted and read as twice its radius tall.
    collisionShapeData: {
      type: "object",
      additionalProperties: false,
      properties: {
        shape: { enum: ["box", "sphere", "capsule", "cylinder"] },
        size: {
          type: "object",
          additionalProperties: false,
          properties: {
            x: { type: "number", minimum: 0.01, maximum: 1000 },
            y: { type: "number", minimum: 0.01, maximum: 1000 },
            z: { type: "number", minimum: 0.01, maximum: 1000 }
          }
        },
        radius: { type: "number", minimum: 0.01, maximum: 1000 },
        height: { type: "number", minimum: 0.01, maximum: 1000 },
        solid: { type: "boolean" }
      }
    },
    // An AnimationPlayer's animations (see core's animation.ts). That keys are in order and inside the length, that each value suits its property, that
    // ids and names are unique, and that every track's node is in the file and has that property aren't expressible here;
    // JsonSchemaProjectSnapshotValidator checks them.
    animationKey: {
      type: "object",
      additionalProperties: false,
      required: ["time", "value"],
      properties: {
        time: { type: "number", minimum: 0 },
        value: { anyOf: [{ $ref: "#/definitions/vector3" }, { type: "boolean" }, { type: "number" }] }
      }
    },
    animationTrack: {
      type: "object",
      additionalProperties: false,
      required: ["id", "nodeId", "property", "keys"],
      properties: {
        id: { type: "string", minLength: 1 },
        nodeId: { type: "string", minLength: 1 },
        property: { enum: ["position", "rotation", "scale", "visible", "volume", "pitch"] },
        keys: { type: "array", items: { $ref: "#/definitions/animationKey" } }
      }
    },
    animation: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "length", "loop", "tracks"],
      properties: {
        id: { type: "string", minLength: 1 },
        name: { type: "string" },
        length: { type: "number", minimum: 0.1, maximum: 600 },
        loop: { type: "boolean" },
        tracks: { type: "array", items: { $ref: "#/definitions/animationTrack" } }
      }
    },
    animationPlayerData: {
      type: "object",
      additionalProperties: false,
      properties: {
        autoplay: { type: "string", minLength: 1 },
        speed: { type: "number", minimum: 0.05, maximum: 10 },
        animations: { type: "array", items: { $ref: "#/definitions/animation" } }
      }
    },
    sceneNode: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "kind", "screen", "position", "visible", "children"],
      properties: {
        id: { type: "string", minLength: 1 },
        name: { type: "string" },
        kind: {
          enum: [
            "Node2D",
            "Sprite2D",
            "AnimatedSprite2D",
            "Camera2D",
            "TileMap",
            "Label",
            "CollisionShape2D",
            "Area2D",
            "AudioStreamPlayer",
            "Node3D",
            "MeshInstance3D",
            "Camera3D",
            "DirectionalLight3D",
            "OmniLight3D",
            "CollisionShape3D",
            "AnimationPlayer"
          ]
        },
        screen: { enum: ["top", "bottom"] },
        position: { $ref: "#/definitions/vector2" },
        visible: { type: "boolean" },
        children: { type: "array", items: { $ref: "#/definitions/sceneNode" } },
        transform3D: { $ref: "#/definitions/transform3D" },
        mesh: { $ref: "#/definitions/meshInstanceData" },
        light: { $ref: "#/definitions/lightData" },
        audio: { $ref: "#/definitions/audioPlayerData" },
        collision: { $ref: "#/definitions/collisionShapeData" },
        animation: { $ref: "#/definitions/animationPlayerData" },
        scriptId: { type: "string", minLength: 1 }
      }
    }
  }
};
