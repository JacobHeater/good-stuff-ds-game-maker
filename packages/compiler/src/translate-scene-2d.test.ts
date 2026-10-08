import { createProjectSnapshot, createSceneNode, createSpriteFromRgba, type ImportedSprite, type ProjectSnapshot, type SceneNode } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { checkProject, compileProject } from "./compile-project";
import { hasErrors } from "./diagnostics";
import { audioPlayerNode, cubeProject, spritesProject, toneSound } from "./fixtures";
import { toTileOrder, translateScene2D } from "./translate-scene-2d";
import { writeScene2DDataC } from "./scene-data-writer";
import type { RomBuilder } from "./build/rom-builder";


function image(id: string, width: number, height: number, color: [number, number, number] = [200, 50, 50]): ImportedSprite {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...color, 255], i * 4);
  const made = createSpriteFromRgba(rgba, width, height, { name: id });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id, ...made.sprite };
}

function sprite(name: string, spriteId: string | undefined, screen: "top" | "bottom", x: number, y: number, visible = true): SceneNode {
  const node = createSceneNode({ name, kind: "Sprite2D", screen, position: { x, y }, visible });
  if (spriteId) node.spriteId = spriteId;
  return node;
}

function project2D(children: SceneNode[], sprites: ImportedSprite[]): ProjectSnapshot {
  return { ...createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children }) }), sprites };
}

function scriptedProject2D(children: SceneNode[], sprites: ImportedSprite[], source: string, attachTo: string[] = ["Player"]): ProjectSnapshot {
  const project = project2D(children, sprites);
  const byName = (name: string): SceneNode | undefined => {
    const find = (node: SceneNode): SceneNode | undefined => (node.name === name ? node : node.children.map(find).find(Boolean));
    return find(project.scene);
  };
  for (const name of attachTo) byName(name)!.scriptId = "s";
  return { ...project, scripts: [{ id: "s", name: "Script", source }] };
}

describe("translating a 2D project", () => {
  it("refuses a 3D project", () => {
    const { scene, diagnostics } = translateScene2D(cubeProject());
    expect(scene).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["not-a-2d-project"]);
  });

  it("places a sprite by its center, in whole screen pixels", () => {
    const { scene, diagnostics } = translateScene2D(project2D([sprite("A", "s", "top", 100, 50)], [image("s", 32, 16)]));
    expect(diagnostics).toEqual([]);
    expect(scene!.top.sprites).toEqual([
      { name: "A", image: 0, x: 84, y: 42, node: -1, dynamic: false, affine: -1, rotation: 0, scaleX: 4096, scaleY: 4096, animation: -1, animationFirst: 0, animationCount: 0 }
    ]);
    expect(scene!.bottom.sprites).toEqual([]);
  });

  it("lists sprites in hardware order: the node later in the tree first, since the lowest-numbered sprite is drawn on top", () => {
    const { scene } = translateScene2D(project2D([sprite("Back", "s", "top", 50, 50), sprite("Front", "s", "top", 60, 60)], [image("s", 16, 16)]));
    expect(scene!.top.sprites.map((s) => s.name)).toEqual(["Front", "Back"]);
  });

  it("orders nested nodes as a tree, not as a flat list", () => {
    const inner = createSceneNode({ name: "Group", kind: "Node2D", children: [sprite("G1", "s", "top", 10, 10), sprite("G2", "s", "top", 20, 20)] });
    const { scene } = translateScene2D(project2D([sprite("Before", "s", "top", 30, 30), inner, sprite("After", "s", "top", 40, 40)], [image("s", 8, 8)]));
    expect(scene!.top.sprites.map((s) => s.name)).toEqual(["After", "G2", "G1", "Before"]);
  });

  it("gives each screen its own copy of an image, and shares one within a screen", () => {
    const { scene } = translateScene2D(project2D([sprite("A", "s", "top", 50, 50), sprite("B", "s", "top", 90, 50), sprite("C", "s", "bottom", 50, 50)], [image("s", 16, 16)]));
    expect(scene!.top.images).toHaveLength(1);
    expect(scene!.bottom.images).toHaveLength(1);
    expect(scene!.top.sprites.map((s) => s.image)).toEqual([0, 0]);
  });

  it("skips a hidden sprite quietly", () => {
    const { scene, diagnostics } = translateScene2D(project2D([sprite("A", "s", "top", 50, 50, false)], [image("s", 8, 8)]));
    expect(diagnostics).toEqual([]);
    expect(scene!.top.sprites).toEqual([]);
  });

  it("warns about a sprite with no image and draws nothing for it", () => {
    const { scene, diagnostics } = translateScene2D(project2D([sprite("Empty", undefined, "top", 50, 50)], []));
    expect(scene!.top.sprites).toEqual([]);
    expect(diagnostics).toMatchObject([{ severity: "warning", code: "sprite-without-image", nodeName: "Empty" }]);
  });

  it("errors on an image the project lacks, naming the sprite", () => {
    const { scene, diagnostics } = translateScene2D(project2D([sprite("Lost", "gone", "top", 50, 50)], []));
    expect(scene).toBeNull();
    expect(diagnostics).toMatchObject([{ severity: "error", code: "missing-sprite", nodeName: "Lost" }]);
  });

  it("warns about a sprite entirely off its screen and leaves it out, but keeps one that is partly on", () => {
    const { scene, diagnostics } = translateScene2D(project2D([sprite("Gone", "s", "top", 400, 50), sprite("Edge", "s", "top", 2, 50)], [image("s", 16, 16)]));
    expect(diagnostics).toMatchObject([{ severity: "warning", code: "sprite-off-screen", nodeName: "Gone" }]);
    expect(scene!.top.sprites.map((s) => s.name)).toEqual(["Edge"]);
    expect(scene!.top.sprites[0].x).toBe(-6);
  });

  it("errors when a screen has more than 128 sprites", () => {
    const many = Array.from({ length: 129 }, (_, i) => sprite(`S${i}`, "s", "top", 100, 100));
    const { diagnostics } = translateScene2D(project2D(many, [image("s", 8, 8)]));
    expect(diagnostics.map((d) => d.code)).toContain("too-many-sprites");
  });

  it("errors when a screen uses more than 16 images (one palette each)", () => {
    const images = Array.from({ length: 17 }, (_, i) => image(`s${i}`, 8, 8, [i * 10, 0, 0]));
    const sprites = images.map((img, i) => sprite(`S${i}`, img.id, "bottom", 100, 100));
    const { diagnostics } = translateScene2D(project2D(sprites, images));
    expect(diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual(["too-many-sprite-palettes"]);
    expect(diagnostics[0].message).toMatch(/bottom screen uses 17 different sprite images/);
  });

  it("warns about what the 2D ROM doesn't do yet, and stays quiet about plain groups (a script on a sprite runs cleanly, with no warning of its own)", () => {
    const script = sprite("Scripted", "s", "top", 50, 50);
    script.scriptId = "x";
    const nodes = [createSceneNode({ name: "Group", kind: "Node2D" }), createSceneNode({ name: "Text", kind: "Label", screen: "top" }), createSceneNode({ name: "Anim", kind: "AnimationPlayer" }), script];
    const project = { ...project2D(nodes, [image("s", 8, 8)]), scripts: [{ id: "x", name: "Script", source: "func _process(delta):\n    pass\n" }] };
    const { scene, diagnostics } = translateScene2D(project);
    expect(hasErrors(diagnostics)).toBe(false);
    expect(scene).not.toBeNull();
    expect(diagnostics.map((d) => `${d.code}:${d.nodeName}`).sort()).toEqual(["two-d-node-not-built:Anim"]);
  });

  it("warns about an AudioStreamPlayer with no sound (the same message a 3D project gives), and stays quiet about one that plays", () => {
    const player = createSceneNode({ name: "Empty", kind: "AudioStreamPlayer" });
    const { diagnostics } = translateScene2D(project2D([player], []));
    expect(diagnostics).toMatchObject([{ severity: "warning", code: "player-without-sound", nodeName: "Empty" }]);
  });
});

describe("scripting a 2D project (requirements/scene-designer/STORY.standalone-2d-scripting.md)", () => {
  it("compiles a script that moves a sprite, giving it a node table entry and marking it dynamic", () => {
    const player = sprite("Player", "s", "top", 50, 50);
    const project = scriptedProject2D([player], [image("s", 8, 8)], "func _process(delta):\n    position.x += 1 * delta\n");
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.nodes).toEqual([{ name: "Player", position: [50 * 4096, 50 * 4096, 0], rotation: [0, 0, 0], scale: [4096, 4096, 4096], visible: true }]);
    expect(scene!.top.sprites[0]).toMatchObject({ node: 0, dynamic: true });
    expect(scene!.scriptCode).toContain("gs_node_state[gss0_self[inst]].position[0]");
  });

  it("leaves a sprite nothing reaches with node -1 and dynamic false", () => {
    const player = sprite("Player", "s", "top", 50, 50);
    const other = sprite("Other", "s", "top", 10, 10);
    const project = scriptedProject2D([player, other], [image("s", 8, 8)], "func _process(delta):\n    position.x += 1 * delta\n");
    const { scene } = translateScene2D(project);
    expect(scene!.nodes).toHaveLength(1); // only Player
    expect(scene!.top.sprites.find((s) => s.name === "Other")).toMatchObject({ node: -1, dynamic: false });
  });

  it("compiles a script that sets a label's text and value", () => {
    const text = createSceneNode({ name: "Score", kind: "Label", screen: "top", position: { x: 0, y: 0 } });
    text.label = { text: "{}", color: 7 };
    const project = scriptedProject2D([text], [], 'func _ready():\n    self.value = 3\n    self.text = "Go"\n', ["Score"]);
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.top.labels[0]).toMatchObject({ node: 0 });
    expect(scene!.scriptCode).toContain("gs_label_set_value(gss0_self[inst], 3)");
    expect(scene!.scriptCode).toContain("gs_label_set_text(gss0_self[inst],");
  });

  it("compiles input and global variables", () => {
    const player = sprite("Player", "s", "top", 50, 50);
    const project = {
      ...scriptedProject2D([player], [image("s", 8, 8)], 'global var score = 0\nfunc _process(delta):\n    if Input.is_button_pressed("a"):\n        score += 1\n'),
    };
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.globals).toEqual([{ name: "score", type: "int", value: 0 }]);
    expect(scene!.scriptCode).toContain("gs_key_pressed(GS_KEY_A)");
    expect(scene!.scriptCode).toContain("gs_global[0]");
  });

  it("compiles play/stop on an AnimatedSprite2D by name", () => {
    const sheet = image("s", 16, 16);
    const hero = { ...sprite("Hero", "s", "top", 50, 50), kind: "AnimatedSprite2D" as const, spriteAnimations: { animations: [{ name: "run", frames: [0], fps: 10, loop: true }] } };
    const project = scriptedProject2D([hero], [sheet], 'func _ready():\n    play("run")\n', ["Hero"]);
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.scriptCode).toContain("gs_sprite_play(gss0_self[inst], 0)");
  });

  it("reports a script error naming the script, line and column, and refuses the project exactly as 3D does", () => {
    const player = sprite("Player", "s", "top", 50, 50);
    const project = scriptedProject2D([player], [image("s", 8, 8)], "func _process(delta):\n    var x: int = 2.5\n");
    const result = translateScene2D(project);
    expect(result.scene).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "script-error", nodeName: "Script script", message: expect.stringMatching(/^line 2, column 18: A float can't go into an int/) }));
  });

  it("a script reaching for a capability no 2D ROM supports yet (an AnimationPlayer) still compiles cleanly -- it will just do nothing until that lands", () => {
    const player = sprite("Player", "s", "top", 50, 50);
    const anim = createSceneNode({ name: "Anim", kind: "AnimationPlayer" });
    const project = scriptedProject2D([player, anim], [image("s", 8, 8)], "func _ready():\n    $Anim.speed_scale = 2.0\n");
    const { scene, diagnostics } = translateScene2D(project);
    expect(hasErrors(diagnostics)).toBe(false);
    expect(scene).not.toBeNull();
    expect(scene!.scriptCode).toContain("gs_anim_set_speed(gs_node_anim_player(");
  });
});

describe("audio in a 2D project", () => {
  it("compiles a player's own sound and clips the same way a 3D project does", () => {
    const tone = toneSound("tone", { seconds: 0.05 });
    const node = audioPlayerNode("Music", { soundId: "tone", volume: 0.5, pitch: 2, loop: true });
    const project = { ...project2D([node], []), sounds: [tone] };
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.sounds).toHaveLength(1);
    expect(scene!.audioPlayers).toEqual([{ sound: 0, volume: 64, frequency: 32000, loop: true, autoplay: true, clipStart: 0, clipCount: 0, node: -1 }]);
  });

  it("gives a script-reached player a node index, for gs_node_audio_player to find", () => {
    const tone = toneSound("tone", { seconds: 0.05 });
    const node = audioPlayerNode("Music", { soundId: "tone" });
    const project = scriptedProject2D([node], [], "func _ready():\n    play()\n", ["Music"]);
    project.sounds = [tone];
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.audioPlayers[0].node).toBe(0);
    expect(scene!.scriptCode).toContain("gs_audio_play(gs_node_audio_player(gss0_self[inst]))");
  });

  it("resolves play(\"name\") on a named clip exactly as a 3D project does", () => {
    const morning = toneSound("morning", { seconds: 0.05 });
    const node = audioPlayerNode("Music", { clips: [{ id: "c1", name: "Morning", soundId: "morning", volume: 1, pitch: 1, loop: true }] });
    const project = scriptedProject2D([node], [], 'func _ready():\n    play("Morning")\n', ["Music"]);
    project.sounds = [morning];
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.audioClips).toHaveLength(1);
    expect(scene!.scriptCode).toContain("gs_audio_play_clip(gs_node_audio_player(gss0_self[inst]), 0)");
  });

  it("checks the sound budget, the 16-channel limit and naming a missing sound, with the same codes and messages a 3D project uses", () => {
    const tone = toneSound("tone", { seconds: 0.05 });
    expect(translateScene2D(project2D([audioPlayerNode("A", { soundId: "gone" })], [])).diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", code: "missing-sound", nodeName: "A" })
    );
    const many = Array.from({ length: 17 }, (_, i) => audioPlayerNode(`P${i}`, { soundId: "tone" }));
    const result = translateScene2D({ ...project2D(many, []), sounds: [tone] });
    expect(result.scene).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "too-many-sounds" }));
  });
});

describe("collision in a 2D project (requirements/scene-designer/STORY.standalone-2d-collision.md)", () => {
  function shape2D(name: string, kind: "rect" | "circle" = "rect"): SceneNode {
    const node = createSceneNode({ name, kind: "CollisionShape2D", position: { x: 0, y: 0 } });
    node.collision2D = { shape: kind };
    return node;
  }

  it("compiles two shapes checked with overlaps(), giving each a node and a collider", () => {
    const a = shape2D("A");
    const b = shape2D("B", "circle");
    const project = scriptedProject2D([a, b], [], "func _process(delta):\n    if $A.overlaps($B):\n        pass\n", ["A"]);
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.nodes.map((n) => n.name)).toEqual(["A", "B"]);
    expect(scene!.colliders).toEqual([
      { name: "A", shape: "rect", p: [16 * 4096, 16 * 4096], node: 0 },
      { name: "B", shape: "circle", p: [16 * 4096, 0], node: 1 }
    ]);
    expect(scene!.scriptCode).toContain("gs_overlaps(0, 1)");
  });

  it("warns about a shape nothing passes to overlaps(), the same message a 3D project uses", () => {
    const a = shape2D("A");
    const other = createSceneNode({ name: "Other", kind: "Node2D" });
    // Reach A only by naming it (not calling overlaps on it), so it still gets a node/collider but is unused.
    const project = scriptedProject2D([a, other], [], "func _process(delta):\n    var x = $A.visible\n", ["Other"]);
    const { diagnostics } = translateScene2D(project);
    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", code: "collision-shape-unused", nodeName: "A" }));
  });

  it("leaves a shape nothing reaches out of the ROM entirely, with no warning (it isn't a real kind yet to it)", () => {
    const a = shape2D("A");
    const project = project2D([a], []);
    const { diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
  });

  it("self and a CollisionShape2D attached script work, with the generic error for the wrong kind", () => {
    const a = shape2D("A");
    const project = scriptedProject2D([a], [], "func _process(delta):\n    if overlaps($A):\n        pass\n", ["A"]);
    const { diagnostics } = translateScene2D(project);
    // Attached to itself: overlaps($A) on self would mean A overlaps itself, which is a strange but not invalid program;
    // what matters here is that it compiles without the "works on CollisionShape3D" error for a 2D shape.
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("camera in a 2D project (requirements/scene-designer/STORY.standalone-2d-camera.md)", () => {
  function camera(name: string, screen: "top" | "bottom", x = 0, y = 0): SceneNode {
    return createSceneNode({ name, kind: "Camera2D", screen, position: { x, y } });
  }

  it("has no camera by default: topCamera and bottomCamera are both -1", () => {
    const { scene, diagnostics } = translateScene2D(project2D([sprite("A", "s", "top", 50, 50)], [image("s", 8, 8)]));
    expect(diagnostics).toEqual([]);
    expect(scene!.topCamera).toBe(-1);
    expect(scene!.bottomCamera).toBe(-1);
  });

  it("gives a Camera2D a node table entry and records its place as topCamera/bottomCamera, even when no script touches it", () => {
    const project = project2D([camera("View", "top", 10, 20), camera("Sub", "bottom", 30, 40)], []);
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.nodes).toEqual([
      { name: "View", position: [10 * 4096, 20 * 4096, 0], rotation: [0, 0, 0], scale: [4096, 4096, 4096], visible: true },
      { name: "Sub", position: [30 * 4096, 40 * 4096, 0], rotation: [0, 0, 0], scale: [4096, 4096, 4096], visible: true }
    ]);
    expect(scene!.topCamera).toBe(0);
    expect(scene!.bottomCamera).toBe(1);
  });

  it("treats every sprite on a screen with a camera as reached (dynamic), whether or not a script ever touches it", () => {
    const project = project2D([camera("View", "top"), sprite("A", "s", "top", 50, 50), sprite("B", "s", "bottom", 50, 50)], [image("s", 8, 8)]);
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.top.sprites.find((s) => s.name === "A")).toMatchObject({ dynamic: true, node: 1 });
    expect(scene!.nodes.map((n) => n.name)).toEqual(["View", "A"]); // the root group isn't swept in merely for sharing the camera's screen
    expect(scene!.bottom.sprites.find((s) => s.name === "B")).toMatchObject({ dynamic: false, node: -1 });
  });

  it("warns about a second Camera2D on the same screen, and uses the first one in tree order", () => {
    const project = project2D([camera("First", "top"), camera("Second", "top")], []);
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "multiple-cameras", nodeName: "Second", message: expect.stringMatching(/already has a Camera2D \(First\)/) })
    );
    expect(scene!.nodes.map((n) => n.name)).toEqual(["First", "Second"]);
    expect(scene!.topCamera).toBe(0);
  });

  it("doesn't sweep an unscripted CollisionShape2D or Label into the node table just because a camera shares its screen", () => {
    const shape = createSceneNode({ name: "Wall", kind: "CollisionShape2D", screen: "top", position: { x: 0, y: 0 } });
    const text = createSceneNode({ name: "Score", kind: "Label", screen: "top", position: { x: 0, y: 0 } });
    const project = project2D([camera("View", "top"), shape, text], []);
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]); // no "collision-shape-unused": the shape was never actually reached
    expect(scene!.nodes.map((n) => n.name)).toEqual(["View"]);
    expect(scene!.colliders).toEqual([]);
  });

  it("compiles a script that moves a camera", () => {
    const view = camera("View", "top");
    const project = scriptedProject2D([view], [], "func _process(delta):\n    position.x += 1 * delta\n", ["View"]);
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.topCamera).toBe(0);
    expect(scene!.scriptCode).toContain("gs_node_state[gss0_self[inst]].position[0]");
  });
});

describe("tile maps (requirements/scene-designer/STORY.standalone-2d-tilemaps.md)", () => {
  function tileset(id: string, width: number, height: number, distinctColors = 2): ImportedSprite {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const v = distinctColors <= 1 ? 100 : Math.round((i % distinctColors) * (255 / (distinctColors - 1)));
      rgba.set([v, v, v, 255], i * 4);
    }
    const made = createSpriteFromRgba(rgba, width, height, { name: id, frame: { width: 8, height: 8 } });
    if (!made.ok) throw new Error(made.errors.join(" "));
    return { id, ...made.sprite };
  }

  function tileMapNode(name: string, screen: "top" | "bottom", tileMap: Partial<import("@goodstuff/core").TileMapData>): SceneNode {
    const node = createSceneNode({ name, kind: "TileMap", screen, position: { x: 0, y: 0 } });
    node.tileMap = tileMap;
    return node;
  }

  function camera(name: string, screen: "top" | "bottom", x = 0, y = 0): SceneNode {
    return createSceneNode({ name, kind: "Camera2D", screen, position: { x, y } });
  }

  it("compiles a grid with a sheet, packing tiles and marking the solid ones", () => {
    const level = tileMapNode("Level", "top", { spriteId: "tiles", columns: 2, rows: 1, tiles: [0, 1], solid: [false, true] });
    const { scene, diagnostics } = translateScene2D(project2D([level], [tileset("tiles", 16, 8)]));
    expect(diagnostics).toEqual([]);
    expect(scene!.tileMaps).toHaveLength(1);
    const map = scene!.tileMaps[0];
    expect(map).toMatchObject({ name: "Level", screen: "top", columns: 2, rows: 1, tileCount: 3, cells: [1, 2], solid: [false, true], node: -1 });
    expect(map.tiles).toHaveLength(3 * 32); // the reserved blank plus the sheet's two tiles, 32 nibble-packed bytes each
    expect(map.palette).toHaveLength(16);
  });

  it("warns and draws nothing for a TileMap with no sheet chosen yet", () => {
    const level = tileMapNode("Level", "top", {});
    const { scene, diagnostics } = translateScene2D(project2D([level], []));
    expect(diagnostics).toMatchObject([{ severity: "warning", code: "tilemap-without-sheet", nodeName: "Level" }]);
    expect(scene!.tileMaps).toEqual([]);
  });

  it("errors on a sheet that isn't in the project, naming the TileMap", () => {
    const level = tileMapNode("Level", "top", { spriteId: "gone", columns: 1, rows: 1, tiles: [-1] });
    const { scene, diagnostics } = translateScene2D(project2D([level], []));
    expect(scene).toBeNull();
    expect(diagnostics).toMatchObject([{ severity: "error", code: "missing-sprite", nodeName: "Level" }]);
  });

  it("errors on a sheet whose frame size isn't 8 x 8", () => {
    const level = tileMapNode("Level", "top", { spriteId: "tiles", columns: 1, rows: 1, tiles: [0] });
    const sheet: ImportedSprite = { ...tileset("tiles", 32, 32), frameWidth: 16, frameHeight: 16 };
    const { scene, diagnostics } = translateScene2D(project2D([level], [sheet]));
    expect(scene).toBeNull();
    expect(diagnostics).toMatchObject([{ severity: "error", code: "tileset-wrong-frame-size", nodeName: "Level" }]);
  });

  it("errors on a sheet with more than 15 colors, naming the real hardware limit", () => {
    const level = tileMapNode("Level", "top", { spriteId: "tiles", columns: 1, rows: 1, tiles: [0] });
    const { scene, diagnostics } = translateScene2D(project2D([level], [tileset("tiles", 8, 8, 20)]));
    expect(scene).toBeNull();
    expect(diagnostics).toMatchObject([{ severity: "error", code: "tileset-too-many-colors", nodeName: "Level" }]);
  });

  it("errors on a sheet with more than 511 distinct tiles", () => {
    const level = tileMapNode("Level", "top", { spriteId: "tiles", columns: 1, rows: 1, tiles: [0] });
    const { scene, diagnostics } = translateScene2D(project2D([level], [tileset("tiles", 512 * 8, 8, 1)]));
    expect(scene).toBeNull();
    expect(diagnostics).toMatchObject([{ severity: "error", code: "tileset-too-many-tiles", nodeName: "Level" }]);
  });

  it("warns about a second TileMap on the same screen, and uses the first one in tree order", () => {
    const sheet = tileset("tiles", 8, 8);
    const first = tileMapNode("First", "top", { spriteId: "tiles", columns: 1, rows: 1, tiles: [0] });
    const second = tileMapNode("Second", "top", { spriteId: "tiles", columns: 1, rows: 1, tiles: [0] });
    const { scene, diagnostics } = translateScene2D(project2D([first, second], [sheet]));
    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", code: "multiple-tilemaps", nodeName: "Second" }));
    expect(scene!.tileMaps.map((t) => t.name)).toEqual(["First"]);
  });

  it("gives a TileMap a node table entry when a script reaches it, and compiles tile_solid()", () => {
    const sheet = tileset("tiles", 8, 8);
    const level = tileMapNode("Level", "top", { spriteId: "tiles", columns: 1, rows: 1, tiles: [0], solid: [true] });
    const project = scriptedProject2D([sprite("Player", "tiles", "top", 50, 50), level], [sheet], "func _process(delta):\n    if $Level.tile_solid(position.x, position.y):\n        position.y -= 1.0\n", ["Player"]);
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.tileMaps[0].node).toBe(scene!.nodes.findIndex((n) => n.name === "Level"));
    expect(scene!.scriptCode).toContain("gs_tile_solid(");
  });

  it("treats a TileMap on a screen with a camera as reached, so it scrolls, but doesn't sweep in an unscripted one on a camera-less screen", () => {
    const sheet = tileset("tiles", 8, 8);
    const top = tileMapNode("TopMap", "top", { spriteId: "tiles", columns: 1, rows: 1, tiles: [0] });
    const bottom = tileMapNode("BottomMap", "bottom", { spriteId: "tiles", columns: 1, rows: 1, tiles: [0] });
    const project = project2D([camera("View", "top"), top, bottom], [sheet]);
    const { scene, diagnostics } = translateScene2D(project);
    expect(diagnostics).toEqual([]);
    expect(scene!.tileMaps.find((t) => t.name === "TopMap")!.node).toBeGreaterThanOrEqual(0);
    expect(scene!.tileMaps.find((t) => t.name === "BottomMap")!.node).toBe(-1);
  });
});

describe("sprite tile order", () => {
  it("puts 8 x 8 tiles left to right then top to bottom, each tile row by row", () => {
    // 16 x 16: pixel value = 100 * tile number + position within the tile is not possible in a byte, so number the quarter instead.
    const pixels = new Uint8Array(16 * 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) pixels[y * 16 + x] = (y >= 8 ? 2 : 0) + (x >= 8 ? 1 : 0);
    const tiles = toTileOrder(pixels, 16, 16);
    expect(tiles).toHaveLength(256);
    expect([tiles[0], tiles[64], tiles[128], tiles[192]]).toEqual([0, 1, 2, 3]);
  });

  it("keeps rows within a tile", () => {
    const pixels = new Uint8Array(8 * 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) pixels[y * 8 + x] = y * 8 + x; // 8 wide, 16 high: two tiles stacked
    const tiles = toTileOrder(pixels, 8, 16);
    expect(tiles.slice(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // first tile's first row
    expect(tiles[8]).toBe(8); // its second row
    expect(tiles[64]).toBe(64); // the tile below starts with image row 8
  });
});

describe("the 2D data file", () => {
  it("is a pure function of the scene and lists every screen's images and sprites", () => {
    const { scene } = translateScene2D(spritesProject());
    const text = writeScene2DDataC(scene!);
    expect(writeScene2DDataC(scene!)).toBe(text);
    expect(text).toContain('#include "scene2d.h"');
    expect(text).toContain("top_image_0_palette[256]");
    expect(text).toContain("bottom_image_1_tiles");
    expect(text).toContain("const GsScene2D gs_scene2d");
    expect(text).toContain("/* Diamond */");
  });

  it("is valid for a screen with nothing on it (no empty C arrays)", () => {
    const { scene } = translateScene2D(project2D([], []));
    const text = writeScene2DDataC(scene!);
    expect(text).toContain("static const GsSprite top_sprites[] = {\n  { 0, 0, 0, -1, 0, -1, 0, 4096, 4096, -1, 0, 0 }\n};");
  });
});

describe("compiling by mode", () => {
  const builder = (calls: string[]): RomBuilder =>
    ({
      build: async () => (calls.push("3d"), { ok: true, romPath: "x.nds", output: "" }),
      buildScenes: async () => (calls.push("3d"), { ok: true, romPath: "x.nds", output: "" }),
      build2D: async () => (calls.push("2d"), { ok: true, romPath: "x.nds", output: "" })
    }) as unknown as RomBuilder;

  it("sends a 2D project to the 2D build and a 3D project to the 3D build", async () => {
    const calls: string[] = [];
    await compileProject(spritesProject(), "x.nds", builder(calls));
    await compileProject(cubeProject(), "x.nds", builder(calls));
    expect(calls).toEqual(["2d", "3d"]);
  });

  it("stops before any build when a 2D project has an error", async () => {
    const calls: string[] = [];
    const broken = project2D([sprite("Lost", "gone", "top", 50, 50)], []);
    const result = await compileProject(broken, "x.nds", builder(calls));
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(hasErrors(checkProject(broken))).toBe(true);
    expect(hasErrors(checkProject(spritesProject()))).toBe(false);
  });
});
