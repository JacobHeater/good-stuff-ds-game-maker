import { createProjectSnapshot } from "../project-snapshot";
import { createSceneNode, type SceneNode } from "../scene-node";
import type { ProjectSnapshot } from "../project-snapshot";

/**
 * A small real game, made only with what the editor offers, to find what the engine can't do yet (requirements/scene-designer/STORY.coin-collector-example.md): run around a walled
 * arena on the top screen, jump, and collect six spinning coins while a chaser follows you (it sends you back to the start if it catches you). The bottom screen shows the coins collected, the time and the best time (kept in the save file). When the last coin is
 * taken a message asks for START to play again. Uses: scripts on several nodes, `$Name` scoped to a node's own children, `move_and_collide` with gravity and jumping, overlaps
 * as a trigger, labels, global variables shared by scripts, saving, changing scene, a camera that follows, atan2/cos/sin to steer, and randi.
 */

const COIN_COUNT = 6;

/** A cube with a box shape under it. Every coin's shape is called "CoinShape": one script on all the coins finds each coin's own (`$Name` looks under the node first). */
const box = (name: string, position: [number, number, number], scale: [number, number, number], solid = true, shapeName = `${name}Shape`, color?: string): SceneNode => {
  const shape = createSceneNode({ name: shapeName, kind: "CollisionShape3D" });
  shape.collision = { shape: "box", size: { x: 1, y: 1, z: 1 }, solid };
  const node = createSceneNode({
    name,
    kind: "MeshInstance3D",
    mesh: "cube",
    transform3D: { position: { x: position[0], y: position[1], z: position[2] }, scale: { x: scale[0], y: scale[1], z: scale[2] } },
    children: [shape]
  });
  if (color) node.mesh = { ...node.mesh!, color };
  return node;
};

function label(name: string, row: number, text: string, color: number, visible = true): SceneNode {
  return { ...createSceneNode({ name, kind: "Label", screen: "bottom", position: { x: 8, y: row * 8 }, visible }), label: { text, color } };
}

const PLAYER_SCRIPT = `# Runs around, jumps, and works out when the game is won.
global var score = 0
global var best = 0

var vy = 0.0
var time = 0.0
var won = false

func _ready():
    if has_save():
        load_game()
    score = 0
    $Coins.value = 0
    $Best.value = best

func _process(delta):
    var speed = 6.0
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
            vy = 9.0
    vy -= 22.0 * delta
    move_and_collide(dx, vy * delta, dz)

    if not won:
        time += delta
        $Time.value = int(time)
        if score >= ${COIN_COUNT}:
            won = true
            $Message.visible = true
            var seconds = int(time)
            if best == 0 or seconds < best:
                best = seconds
                $Best.value = best
                save_game()
    elif Input.is_button_pressed("start"):
        change_scene("Main")
`;

const COIN_SCRIPT = `# A coin: spins, and is taken when the player touches it.
global var score = 0

func _process(delta):
    rotation.y += 180.0 * delta
    if visible and $CoinShape.overlaps($PlayerShape):
        visible = false
        score += 1
        $Coins.value = score
`;

const CHASER_SCRIPT = `# Walks toward the player; if it catches the player, the player goes back to the start and the chaser to a random place along the far wall.
func _process(delta):
    var dx = $Player.position.x - position.x
    var dz = $Player.position.z - position.z
    var a = atan2(dz, dx)
    move_and_collide(cos(a) * 2.5 * delta, -20.0 * delta, sin(a) * 2.5 * delta)
    rotation.y = -a
    if $EnemyShape.overlaps($PlayerShape):
        $Player.position.x = 0.0
        $Player.position.y = 2.0
        $Player.position.z = 0.0
        position.x = randi(20) - 10
        position.z = -10.0
`;

const CAMERA_SCRIPT = `# Follows the player from a fixed distance.
func _process(delta):
    position.x = $Player.position.x
    position.z = $Player.position.z + 9.0
`;

/** The game as a project (a 3D project with one scene, three scripts and a HUD on the bottom screen). */
export function createCoinGameProject(): ProjectSnapshot {
  const coinPlaces: Array<[number, number]> = [[-6, -6], [6, -6], [0, -3], [-6, 5], [6, 5], [0, 8]];
  const coins = coinPlaces.slice(0, COIN_COUNT).map(([x, z], i) => ({ ...box(`Coin${i + 1}`, [x, 0.7, z], [0.6, 0.6, 0.6], false, "CoinShape", "#ffd21f"), scriptId: "coin" }));
  const player: SceneNode = { ...box("Player", [0, 1.5, 0], [0.8, 0.8, 0.8], true, "PlayerShape", "#3b82f6"), scriptId: "player" };
  const camera: SceneNode = {
    ...createSceneNode({ name: "Camera", kind: "Camera3D", transform3D: { position: { x: 0, y: 9, z: 9 }, rotation: { x: -45, y: 0, z: 0 } } }),
    scriptId: "camera"
  };
  const scene = createSceneNode({
    name: "Main",
    kind: "Node3D",
    children: [
      camera,
      createSceneNode({ name: "Sun", kind: "DirectionalLight3D", transform3D: { position: { x: 0, y: 8, z: 0 }, rotation: { x: -50, y: -30, z: 0 } } }),
      box("Ground", [0, -0.5, 0], [24, 1, 24], true, "GroundShape", "#4c9a52"),
      box("WallNorth", [0, 1, -12], [24, 3, 1], true, "WallNorthShape", "#8a8f98"),
      box("WallSouth", [0, 1, 12], [24, 3, 1], true, "WallSouthShape", "#8a8f98"),
      box("WallWest", [-12, 1, 0], [1, 3, 24], true, "WallWestShape", "#8a8f98"),
      box("WallEast", [12, 1, 0], [1, 3, 24], true, "WallEastShape", "#8a8f98"),
      box("Crate", [3, 0.5, 2], [2, 1, 2], true, "CrateShape", "#a5683a"),
      player,
      { ...box("Enemy", [8, 0.6, -8], [0.9, 0.9, 0.9], false, "EnemyShape", "#e0342f"), scriptId: "chaser" },
      ...coins,
      label("Coins", 1, `Coins: {} / ${COIN_COUNT}`, 3),
      label("Time", 3, "Time: {}", 7),
      label("Best", 5, "Best: {}", 6),
      label("Message", 10, "You got them all!", 2, false),
      label("Hint", 20, "D-pad move, A jump", 7)
    ]
  });
  const project = createProjectSnapshot({ name: "Coin Collector", mode: "3D", scene });
  return {
    ...project,
    scripts: [
      { id: "player", name: "Player", source: PLAYER_SCRIPT },
      { id: "coin", name: "Coin", source: COIN_SCRIPT },
      { id: "chaser", name: "Chaser", source: CHASER_SCRIPT },
      { id: "camera", name: "CameraFollow", source: CAMERA_SCRIPT }
    ]
  };
}
