import type { Schema } from "ajv";

/** Bump when the recent-projects file's shape changes incompatibly. */
export const RECENT_PROJECTS_FORMAT_VERSION = 1 as const;

/**
 * JSON Schema for the recent-projects file (`RecentProjectEntry[]` wrapped in a
 * versioned envelope). Hand-authored like `PROJECT_SNAPSHOT_JSON_SCHEMA`; keep
 * it in step with `RecentProjectEntry` in `@goodstuff/core`. Unlike a project
 * file, a store that fails this schema isn't reported to the user — it's
 * treated as empty (see `RecentProjectsReader`).
 */
export const RECENT_PROJECTS_JSON_SCHEMA: Schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://goodstuff-ds-game-maker/schemas/recent-projects.json",
  title: "RecentProjects",
  type: "object",
  additionalProperties: false,
  required: ["formatVersion", "projects"],
  properties: {
    formatVersion: { const: RECENT_PROJECTS_FORMAT_VERSION },
    projects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "name", "mode", "lastOpenedAt"],
        properties: {
          path: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          mode: { enum: ["2D", "3D"] },
          lastOpenedAt: { type: "string" }
        }
      }
    }
  }
};
