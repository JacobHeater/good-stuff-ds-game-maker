import { createSpriteFromRgba, type ImportedSprite } from "../imported-sprite";
import type { ImportedMesh } from "../imported-mesh";
import { createProjectSnapshot, type ProjectSnapshot } from "../project-snapshot";
import { DEFAULT_START_SCENE_ID, withSceneEntries } from "../project-scenes";
import { createSceneNode, type MeshPrimitive, type SceneNode } from "../scene-node";

/**
 * A second small real game, built the same way `coin-game.ts` was (requirements/scene-designer/STORY.coin-collector-example.md), to
 * exercise everything the engine has grown since: a TileMap3D island, a SkyBox3D day/night cycle, an Inventory with its own on-screen
 * panel, and spawn pools (requirements/scene-designer/STORY.spawn-pools.md) for runtime-placed campfires -- on top of the same
 * move_and_collide/overlaps/labels/globals/save/change_scene foundation the coin game already proved. Walk the island (D-pad), jump
 * (A), chop trees and pick up coconuts for Wood and Coconut, place a campfire (B, costs 2 Wood, a 3-slot spawn pool) or put out the
 * last one you placed (X), and don't let the crab catch you (it steals a Wood) or walk off the edge (back to lives, same as the coin
 * game's chaser catching the player). The bottom screen holds the Inventory's own drawn panel and the HUD labels.
 */

const ISLAND_RADIUS = 3; // cells -3..3 on each axis: a 7x7 flat island, one TileMap3D chunk (TILE_MAP_3D_CHUNK_SIZE is 8), no streaming to worry about.

/** Reused verbatim from `coin-game.ts`: a mesh with a box collision shape under it. */
const box = (name: string, position: [number, number, number], scale: [number, number, number], solid = true, primitive: MeshPrimitive = "cube", shapeName = `${name}Shape`, color?: string): SceneNode => {
  const shape = createSceneNode({ name: shapeName, kind: "CollisionShape3D" });
  shape.collision = { shape: "box", size: { x: 1, y: 1, z: 1 }, solid };
  const node = createSceneNode({
    name,
    kind: "MeshInstance3D",
    mesh: primitive,
    transform3D: { position: { x: position[0], y: position[1], z: position[2] }, scale: { x: scale[0], y: scale[1], z: scale[2] } },
    children: [shape]
  });
  if (color) node.mesh = { ...node.mesh!, color };
  return node;
};

/**
 * An invisible-but-solid box, like the ground or a boundary: a plain `Node3D` (which draws nothing by design, unlike
 * a `MeshInstance3D` with `visible: false`), left visible, with a `CollisionShape3D` child. A compile-time prune
 * drops a node's whole subtree -- the shape under it included -- once it is both invisible AND not named by any
 * script, regardless of whether its own shape is `solid` (`STORY.solid-shapes-and-move-and-collide.md`'s own "a
 * hidden solid shape stops nothing" rule, enforced again at runtime, is about *script-controlled* visibility -- a
 * node that starts and stays invisible with nothing ever able to show it is simply dead weight, so the compiler
 * removes it). `box()`'s own `visible: false` would hit exactly this: `coin-game.ts`'s own walls/ground survive
 * only because they stay visible throughout.
 */
const collider = (name: string, position: [number, number, number], size: [number, number, number]): SceneNode => {
  const shape = createSceneNode({ name: `${name}Shape`, kind: "CollisionShape3D" });
  shape.collision = { shape: "box", size: { x: size[0], y: size[1], z: size[2] }, solid: true };
  return createSceneNode({ name, kind: "Node3D", transform3D: { position: { x: position[0], y: position[1], z: position[2] } }, children: [shape] });
};

function label(name: string, row: number, text: string, color: number, visible = true): SceneNode {
  return { ...createSceneNode({ name, kind: "Label", screen: "bottom", position: { x: 8, y: row * 8 }, visible }), label: { text, color } };
}

/** A single-color `ImportedSprite`, the same helper `spawn-pools.rom.test.ts`/`inventory-ui-panel.rom.test.ts` already use for hand-built test projects with no real art. */
function solidSprite(id: string, width: number, height: number, color: readonly [number, number, number]): ImportedSprite {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...color, 255], i * 4);
  const made = createSpriteFromRgba(rgba, width, height, { name: id });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id, ...made.sprite };
}

/** A sprite sheet of same-size frames, each one plain color -- the Inventory's slot graphic (empty/filled) and item icon sheet (one frame per item) both need this shape. */
function framedSprite(id: string, frameWidth: number, frameHeight: number, frames: ReadonlyArray<readonly [number, number, number]>): ImportedSprite {
  const width = frameWidth * frames.length;
  const rgba = new Uint8Array(width * frameHeight * 4);
  for (let y = 0; y < frameHeight; y++) {
    for (let f = 0; f < frames.length; f++) {
      for (let x = 0; x < frameWidth; x++) rgba.set([...frames[f], 255], (y * width + f * frameWidth + x) * 4);
    }
  }
  const made = createSpriteFromRgba(rgba, width, frameHeight, { name: id, frame: { width: frameWidth, height: frameHeight } });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id, ...made.sprite };
}

const WORLD_SCRIPT = `# Keeps the day/night cycle and the persisted best day; everyone else just reads these globals.
global var day = 1
global var bestDay = 0
global var lives = 3

var dayTimer = 0.0
var isDay = true

func _ready():
    if has_save():
        load_game()
    $Day.value = day
    $Best.value = bestDay
    $Lives.value = lives
    $DayNight.text = "DAY"

func _process(delta):
    dayTimer += delta
    if isDay and dayTimer >= 10.0:
        isDay = false
        dayTimer = 0.0
        $SkyDay.visible = false
        $SkyNight.visible = true
        $DayNight.text = "NIGHT"
    elif not isDay and dayTimer >= 10.0:
        isDay = true
        dayTimer = 0.0
        day += 1
        $Day.value = day
        $SkyDay.visible = true
        $SkyNight.visible = false
        $DayNight.text = "DAY"
`;

const PLAYER_SCRIPT = `# Runs, jumps, falls back from the edge, and places/removes campfires from the Wood in the Bag.
global var day = 1
global var bestDay = 0
global var lives = 3
global var lastFire = -1

var vy = 0.0
var over = false

func _ready():
    pass

func _process(delta):
    if over:
        if Input.is_button_pressed("start"):
            change_scene("Island")
        return

    var speed = 5.0
    var dx = 0.0
    var dz = 0.0
    if Input.is_button_down("left"):
        dx = -speed * delta
    if Input.is_button_down("right"):
        dx = speed * delta
    if Input.is_button_down("up"):
        dz = -speed * delta
    if Input.is_button_down("down"):
        dz = speed * delta
    if is_on_floor():
        vy = 0.0
        if Input.is_button_pressed("a"):
            vy = 8.0
    vy -= 20.0 * delta
    move_and_collide(dx, vy * delta, dz)

    if position.y < -3.0:
        position.x = 0.0
        position.y = 1.0
        position.z = 0.0
        vy = 0.0
        lives -= 1
        $Lives.value = lives
        if lives <= 0:
            over = true
            if bestDay == 0 or day > bestDay:
                bestDay = day
            save_game()
            $Message.visible = true

    if Input.is_button_pressed("b"):
        if $Bag.count("Wood") >= 2:
            var h = spawn("Campfires", position.x, position.y, position.z)
            if is_spawned(h):
                $Bag.remove("Wood", 2)
                lastFire = h
    if Input.is_button_pressed("x"):
        if is_spawned(lastFire):
            despawn(lastFire)
            lastFire = -1
`;

const TREE_SCRIPT = `# A tree: chopped for 2 Wood when the player bumps into it.
func _process(delta):
    if visible and $TreeShape.overlaps($PlayerShape):
        visible = false
        $Bag.add("Wood", 2)
`;

const COCONUT_SCRIPT = `# A coconut: picked up for 1 Coconut when the player walks over it.
func _process(delta):
    if visible and $CoconutShape.overlaps($PlayerShape):
        visible = false
        $Bag.add("Coconut", 1)
`;

const CRAB_SCRIPT = `# Wanders the island, turning away whenever the ground ahead runs out, and snatches a Wood if it catches the player.
var angle = 0.0
var retarget = 0.0

func _ready():
    angle = float(randi(360))

func _process(delta):
    retarget -= delta
    var ahead = ray_cast(position.x, position.y + 0.5, position.z, sin(angle), -1.0, cos(angle), 2.0)
    if ahead < 0.0 or retarget <= 0.0:
        angle = float(randi(360))
        retarget = 2.0
    move_and_collide(sin(angle) * delta, -10.0 * delta, cos(angle) * delta)
    rotation.y = -angle
    if $CrabShape.overlaps($PlayerShape) and $Bag.count("Wood") > 0:
        $Bag.remove("Wood", 1)
`;

const CAMERA_SCRIPT = `# Follows the player from a fixed distance, same as the coin game's.
func _process(delta):
    position.x = $Player.position.x
    position.z = $Player.position.z + 9.0
`;

/** The game as a project: a 3D project with one scene, five scripts, a TileMap3D island, a day/night SkyBox3D pair, an Inventory with its own panel, and a 3-slot campfire spawn pool. */
export function createIslandSurvivalProject(): ProjectSnapshot {
  const grassTile: ImportedMesh = {
    id: "grass-tile",
    name: "GrassTile",
    // A flat quad on the XZ plane (Y up), 1x1, centered on its own cell -- a cell's key is its world position directly (1 cell = 1 unit).
    positions: [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3]
  };
  const grid = createSceneNode({ name: "Grid", kind: "TileMap3D" });
  const cells: Record<string, { paletteId: string; rotationY: 0 }> = {};
  for (let x = -ISLAND_RADIUS; x <= ISLAND_RADIUS; x++) {
    for (let z = -ISLAND_RADIUS; z <= ISLAND_RADIUS; z++) cells[`${x},0,${z}`] = { paletteId: "grass", rotationY: 0 };
  }
  grid.tileMap3D = { palette: [{ id: "grass", importedMeshId: "grass-tile", color: "#4c9a52" }], cells };

  const skyDay = createSceneNode({ name: "SkyDay", kind: "SkyBox3D" });
  skyDay.skyBox = { topColor: "#4aa3e0", horizonColor: "#eef3a8", current: true };
  const skyNight = createSceneNode({ name: "SkyNight", kind: "SkyBox3D", visible: false });
  skyNight.skyBox = { topColor: "#0a0f2e", horizonColor: "#372a66" };

  const ground = collider("Ground", [0, -0.5, 0], [ISLAND_RADIUS * 2 + 1, 1, ISLAND_RADIUS * 2 + 1]);
  // Purely decorative (nothing interacts with it, so it gets no collision shape at all): the open water past the island's own edge.
  const ocean = createSceneNode({ name: "Ocean", kind: "MeshInstance3D", mesh: "plane", transform3D: { position: { x: 0, y: -1, z: 0 }, scale: { x: 60, y: 1, z: 60 } } });
  ocean.mesh = { ...ocean.mesh!, color: "#1a6faa" };

  const player: SceneNode = { ...box("Player", [0, 1, 0], [0.8, 0.8, 0.8], true, "cube", "PlayerShape", "#3b82f6"), scriptId: "player" };
  const camera: SceneNode = {
    ...createSceneNode({ name: "Camera", kind: "Camera3D", transform3D: { position: { x: 0, y: 9, z: 9 }, rotation: { x: -45, y: 0, z: 0 } } }),
    scriptId: "camera"
  };
  const world: SceneNode = { ...createSceneNode({ name: "World", kind: "Node3D" }), scriptId: "world" };

  const treePlaces: Array<[number, number]> = [[-2, -2], [2, -2], [0, 2]];
  const trees = treePlaces.map(([x, z], i) => ({ ...box(`Tree${i + 1}`, [x, 0.6, z], [0.6, 1.2, 0.6], true, "cylinder", "TreeShape", "#2f6b3a"), scriptId: "tree" }));
  const coconutPlaces: Array<[number, number]> = [[-2, 2], [2, 2], [0, -2]];
  const coconuts = coconutPlaces.map(([x, z], i) => ({ ...box(`Coconut${i + 1}`, [x, 0.5, z], [0.5, 0.5, 0.5], false, "sphere", "CoconutShape", "#caa05a"), scriptId: "coconut" }));
  const crab: SceneNode = { ...box("Crab", [3, 0.5, -3], [0.7, 0.5, 0.7], false, "sphere", "CrabShape", "#e0342f"), scriptId: "crab" };

  const campfireTemplate = box("CampfireBody", [0, 0, 0], [0.5, 0.6, 0.5], false, "cylinder", "CampfireBodyShape", "#ff7f11");
  campfireTemplate.children = []; // a spawned copy is purely decorative -- nothing interacts with it, so it needs no collision shape at all.
  const campfires: SceneNode = { ...createSceneNode({ name: "Campfires", kind: "Node3D" }), instanceOf: "campfire-template", spawnPoolCount: 3 };

  const bag: SceneNode = createSceneNode({ name: "Bag", kind: "Inventory", screen: "bottom", position: { x: 96, y: 140 } });
  bag.inventory = { slots: 3, columns: 3, slotSpacingX: 2, slotSpacingY: 2, backgroundSpriteId: "bag-bg", slotSpriteId: "bag-slot", highlightSpriteId: "bag-hi" };

  const island = createSceneNode({
    name: "Island",
    kind: "Node3D",
    children: [
      camera,
      createSceneNode({ name: "Sun", kind: "DirectionalLight3D", transform3D: { position: { x: 0, y: 8, z: 0 }, rotation: { x: -50, y: -30, z: 0 } } }),
      skyDay,
      skyNight,
      world,
      grid,
      ground,
      ocean,
      player,
      crab,
      campfires,
      ...trees,
      ...coconuts,
      bag,
      label("DayNight", 1, "DAY", 7),
      label("Day", 3, "Day {}", 3),
      label("Best", 5, "Best {}", 6),
      label("Lives", 7, "Lives {}", 2),
      label("Message", 10, "YOU DIED, START to retry", 2, false),
      label("Hint", 22, "Pad+A move/jump  B/X fire", 7)
    ]
  });

  const project = createProjectSnapshot({ name: "Island Survival", mode: "3D", scene: island });
  return {
    ...withSceneEntries(project, [
      { id: DEFAULT_START_SCENE_ID, name: "Island", scene: island, isStart: true },
      { id: "campfire-template", name: "CampfireTemplate", scene: campfireTemplate, isStart: false }
    ]),
    meshes: [grassTile],
    sprites: [
      solidSprite("bag-bg", 64, 32, [40, 70, 40]),
      framedSprite("bag-slot", 16, 16, [
        [90, 90, 90],
        [140, 140, 140]
      ]),
      solidSprite("bag-hi", 16, 16, [227, 16, 227]),
      framedSprite("item-icons", 16, 16, [
        [130, 86, 40],
        [202, 160, 90]
      ])
    ],
    itemIconsSpriteId: "item-icons",
    items: [
      { id: "wood", name: "Wood", iconFrame: 0, maxStack: 20 },
      { id: "coconut", name: "Coconut", iconFrame: 1, maxStack: 20 }
    ],
    scripts: [
      { id: "world", name: "World", source: WORLD_SCRIPT },
      { id: "player", name: "Player", source: PLAYER_SCRIPT },
      { id: "tree", name: "Tree", source: TREE_SCRIPT },
      { id: "coconut", name: "Coconut", source: COCONUT_SCRIPT },
      { id: "crab", name: "Crab", source: CRAB_SCRIPT },
      { id: "camera", name: "CameraFollow", source: CAMERA_SCRIPT }
    ]
  };
}
