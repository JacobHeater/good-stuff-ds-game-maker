/**
 * Identifies the two physical screens of a Nintendo DS style project.
 */
export type ScreenId = "top" | "bottom";

export * from "./hardware";
export * from "./scene-node";
export * from "./budget";

/**
 * A single scene/room in the game, analogous to a Godot Scene.
 */
export interface GameScene {
  id: string;
  name: string;
  screen: ScreenId;
  width: number;
  height: number;
}

/**
 * The root document describing an entire DS-style game project.
 */
export interface GameProject {
  id: string;
  name: string;
  version: string;
  scenes: GameScene[];
}

/** The native DS resolution, used as sensible scene defaults. */
export const DS_SCREEN_RESOLUTION = {
  width: 256,
  height: 192
} as const;

/**
 * Creates a new, empty game project with a single default scene on the top screen.
 */
export function createEmptyProject(name: string): GameProject {
  return {
    id: crypto.randomUUID(),
    name,
    version: "0.0.1",
    scenes: [
      {
        id: crypto.randomUUID(),
        name: "Main Scene",
        screen: "top",
        ...DS_SCREEN_RESOLUTION
      }
    ]
  };
}
