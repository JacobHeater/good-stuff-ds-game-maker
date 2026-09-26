import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createProjectSnapshot, createSceneNode, createSpriteFromRgba, type ImportedSprite, type ProjectSnapshot, type SceneNode, type SpriteAnimation } from "@goodstuff/core";
import { describe, expect, it } from "vitest";

import { cubeWithSpritesProject } from "./fixtures";
import { writeScene2DDataC, writeSceneDataC, writeScriptCodeC } from "./scene-data-writer";
import { translateScene2D } from "./translate-scene-2d";
import { translateScene3D } from "./translate-scene-3d";

/** requirements/scene-designer/STORY.animated-sprites.md (the parts that need no toolchain) */

/** A sheet of `count` frames in a row, each `size` pixels square; frame k is filled with color k + 1 so every frame's pixels differ. */
function sheet(id: string, count: number, size = 16): ImportedSprite {
  const width = count * size;
  const rgba = new Uint8Array(width * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < width; x++) rgba.set([40 * (Math.floor(x / size) + 1), 0, 0, 255], (y * width + x) * 4);
  }
  const made = createSpriteFromRgba(rgba, width, size, { name: id, frame: { width: size, height: size } });
  if (!made.ok) throw new Error(made.errors.join(" "));
  return { id, ...made.sprite };
}

const run: SpriteAnimation = { name: "run", frames: [0, 1, 2, 3], fps: 12, loop: true };
const jump: SpriteAnimation = { name: "jump", frames: [4], fps: 8, loop: false };

function animated(name: string, animations: SpriteAnimation[], start?: string, extra: Partial<SceneNode> = {}): SceneNode {
  return {
    ...createSceneNode({ name, kind: "AnimatedSprite2D", screen: "top", position: { x: 100, y: 50 } }),
    spriteId: "sheet",
    spriteAnimations: { animations, ...(start ? { start } : {}) },
    ...extra
  };
}

function project2D(children: SceneNode[], sprites: ImportedSprite[] = [sheet("sheet", 5)]): ProjectSnapshot {
  return { ...createProjectSnapshot({ name: "P", mode: "2D", scene: createSceneNode({ name: "Main", kind: "Node2D", children }) }), sprites };
}

describe("compiling an animated sprite into a 2D project", () => {
  it("puts every frame of the sheet in sprite memory under one palette, sized as one frame", () => {
    const { scene, diagnostics } = translateScene2D(project2D([animated("Hero", [run, jump], "run")]));
    expect(diagnostics).toEqual([]);
    const [image] = scene!.top.images;
    expect(image).toMatchObject({ width: 16, height: 16, frames: 5 });
    expect(image.tiles).toHaveLength(5 * 16 * 16);
    // Each frame is a flat color and the frames come one after another: the first byte of each frame's first tile is its palette index.
    expect([0, 1, 2, 3, 4].map((frame) => image.tiles[frame * 256])).toEqual([1, 2, 3, 4, 5]);
    expect(scene!.top.images).toHaveLength(1); // one palette for the whole sheet
  });

  it("turns frames a second into a step per game frame: 12 a second at 30 frames a second is 0.4, at 60 it is 0.2", () => {
    const at30 = translateScene2D(project2D([animated("Hero", [run])]), { fpsTarget: 30 }).scene!;
    const at60 = translateScene2D(project2D([animated("Hero", [run])]), { fpsTarget: 60 }).scene!;
    expect(at30.top.animations[0]).toEqual({ frames: [0, 1, 2, 3], step: 1638, loop: true });
    expect(at60.top.animations[0].step).toBe(819);
  });

  it("says which animation plays at the start and where the sprite's animations sit in the screen's table", () => {
    const { scene } = translateScene2D(project2D([animated("A", [run, jump], "jump"), animated("B", [jump, run], "run"), animated("C", [run])]));
    const sprites = [...scene!.top.sprites].reverse(); // tree order
    expect(sprites.map((s) => [s.name, s.animation, s.animationFirst, s.animationCount])).toEqual([
      ["A", 1, 0, 2],
      ["B", 3, 2, 2],
      ["C", -1, 4, 1]
    ]);
    expect(scene!.top.animations).toHaveLength(5);
  });

  it("a sprite with no start animation shows frame 0 and plays nothing; two sprites of one sheet share its image", () => {
    const { scene } = translateScene2D(project2D([animated("A", [run]), animated("B", [jump], "jump")]));
    expect(scene!.top.images).toHaveLength(1);
    expect(scene!.top.sprites.find((s) => s.name === "A")!.animation).toBe(-1);
  });

  it("counts the whole sheet against the sprite memory of its screen", () => {
    const big = sheet("sheet", 16, 64); // 16 frames of 64 x 64 = 64 KB
    const one = translateScene2D(project2D([animated("A", [run])], [big]));
    expect(one.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const twoSheets = translateScene2D(project2D([animated("A", [run]), { ...animated("B", [run]), spriteId: "other" }], [big, { ...sheet("other", 16, 64) }, ]));
    expect(twoSheets.diagnostics.filter((d) => d.code === "sprite-memory")).toEqual([]); // 128 KB is exactly what a screen has
    const three = translateScene2D(project2D([animated("A", [run]), { ...animated("B", [run]), spriteId: "other" }, { ...animated("C", [run]), spriteId: "third" }], [big, sheet("other", 16, 64), sheet("third", 16, 64)]));
    expect(three.diagnostics.map((d) => d.code)).toContain("sprite-memory");
  });

  it("refuses an animation that shows a frame the sheet doesn't have, naming the sprite and the animation", () => {
    const { scene, diagnostics } = translateScene2D(project2D([animated("Hero", [{ name: "run", frames: [0, 5], fps: 8, loop: true }])]));
    expect(scene).toBeNull();
    expect(diagnostics).toMatchObject([{ severity: "error", code: "animation-frame-out-of-range", nodeName: "Hero" }]);
    expect(diagnostics[0].message).toMatch(/"run" shows frame 5.*has 5 frames \(0 to 4\)/);
  });

  it("warns about a sheet with several frames and no animations, and about a missing sheet, without errors", () => {
    const none = translateScene2D(project2D([animated("Hero", [])]));
    expect(none.diagnostics).toMatchObject([{ severity: "warning", code: "animated-sprite-without-animations" }]);
    const noSheet = translateScene2D(project2D([{ ...animated("Hero", [run]), spriteId: undefined }]));
    expect(noSheet.diagnostics.map((d) => d.code)).toEqual(["sprite-without-image"]);
    expect(noSheet.diagnostics[0].message).toMatch(/no sprite sheet/);
  });

  it("no longer says an AnimatedSprite2D isn't built", () => {
    expect(translateScene2D(project2D([animated("Hero", [run], "run")])).diagnostics.map((d) => d.code)).not.toContain("two-d-node-not-built");
  });

  it("writes the frame count, the animations and each sprite's animation fields into the C", () => {
    const text = writeScene2DDataC(translateScene2D(project2D([animated("Hero", [run, jump], "run")]), { fpsTarget: 30 }).scene!);
    expect(text).toContain("5 frames of 16 x 16, 1280 bytes");
    expect(text).toContain("{ 16, 16, 5, top_image_0_palette, top_image_0_tiles }");
    expect(text).toContain("static const uint16_t top_animation_0_frames[] = { 0, 1, 2, 3 };");
    expect(text).toContain("{ top_animation_0_frames, 4, 1, 1638 },");
    expect(text).toContain("{ top_animation_1_frames, 1, 0, 1092 }");
    expect(text).toContain("{ 92, 42, 0, 0, 0, 2 }"); // x, y, image, starts with animation 0, its animations begin at 0, and it has 2
    expect(text).toContain("{ 1, 1, top_images, top_sprites, 2, top_animations, 0, top_labels }");
  });

  it("an empty screen still has valid (non-empty) animation tables", () => {
    const text = writeScene2DDataC(translateScene2D(project2D([])).scene!);
    expect(text).toContain("static const GsSpriteAnimation top_animations[] = {\n  { 0, 0, 0, 0 }\n};");
  });
});

describe("an AnimatedSprite2D on the 2D screen of a 3D project", () => {
  function scripted(source: string, attachTo = "Hero", animations = [run, jump]): ProjectSnapshot {
    const base = cubeWithSpritesProject();
    const hero = animated("Hero", animations, "run", { screen: "bottom", ...(attachTo === "Hero" ? { scriptId: "s" } : {}) });
    const others = base.scene.children.filter((n) => n.kind !== "Sprite2D").map((n) => (attachTo === "Cube" && n.name === "Cube" ? { ...n, scriptId: "s" } : n));
    return { ...base, scene: { ...base.scene, children: [...others, hero] }, sprites: [...(base.sprites ?? []), sheet("sheet", 5)], scripts: [{ id: "s", name: "S", source }] };
  }
  const errors = (p: ProjectSnapshot): string[] => translateScene3D(p).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

  it("compiles play, stop and is_playing on itself to calls on its node, with the animation's place in its own list", () => {
    const p = scripted('func _process(delta):\n    if is_playing():\n        stop()\n    else:\n        play("jump")\n');
    const { scene, diagnostics } = translateScene3D(p);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const code = writeScriptCodeC(scene!);
    expect(code).toContain("gs_sprite_is_playing(gss0_self[inst])");
    expect(code).toContain("gs_sprite_stop(gss0_self[inst])");
    expect(code).toContain("gs_sprite_play(gss0_self[inst], 1)");
    expect(code).not.toContain("gs_anim_play");
  });

  it("can be played by name from another node's script", () => {
    const p = scripted('func _process(delta):\n    $Hero.play("run")\n', "Cube");
    const { scene, diagnostics } = translateScene3D(p);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const sprite = scene!.sprites2D.sprites[0];
    expect(sprite.node).toBeGreaterThanOrEqual(0);
    expect(sprite.animationCount).toBe(2);
    expect(writeScriptCodeC(scene!)).toContain(`gs_sprite_play(${sprite.node}, 0)`);
  });

  it("says which animations exist when the name is wrong, and doesn't allow speed_scale", () => {
    expect(errors(scripted('func _process(delta):\n    play("fly")\n'))[0]).toMatch(/has no animation "fly".*"run", "jump"/);
    expect(errors(scripted("func _process(delta):\n    speed_scale = 2.0\n"))[0]).toMatch(/speed_scale/);
  });

  it("moves, turns and hides like a Sprite2D, and the whole sheet sits in the sprite memory once", () => {
    const p = scripted("func _process(delta):\n    position.x += 10.0 * delta\n    rotation += 90.0 * delta\n    visible = true\n");
    const { scene, diagnostics } = translateScene3D(p);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const hero = scene!.sprites2D.sprites.find((s) => s.name === "Hero")!;
    expect(hero).toMatchObject({ dynamic: true, affine: 0, animation: 0, animationCount: 2 });
    expect(scene!.sprites2D.images.find((i) => i.frames === 5)).toBeTruthy();
    expect(writeSceneDataC(scene!)).toContain("two_d_animations");
  });
});

describe("the two runtimes share one animation stepper", () => {
  it("has the same gs_sprite_anim.h in runtime/ and runtime2d/", () => {
    const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    expect(readFileSync(resolve(base, "runtime2d", "include", "gs_sprite_anim.h"), "utf-8")).toBe(readFileSync(resolve(base, "runtime", "include", "gs_sprite_anim.h"), "utf-8"));
  });
});
