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
    scene: { $ref: "#/definitions/sceneNode" }
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
    meshInstanceData: {
      type: "object",
      additionalProperties: false,
      required: ["primitive", "triangleCount"],
      properties: {
        primitive: { enum: ["cube", "sphere", "plane", "cylinder"] },
        triangleCount: { type: "number", minimum: 0 }
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
            "CollisionShape3D"
          ]
        },
        screen: { enum: ["top", "bottom"] },
        position: { $ref: "#/definitions/vector2" },
        visible: { type: "boolean" },
        children: { type: "array", items: { $ref: "#/definitions/sceneNode" } },
        transform3D: { $ref: "#/definitions/transform3D" },
        mesh: { $ref: "#/definitions/meshInstanceData" }
      }
    }
  }
};
