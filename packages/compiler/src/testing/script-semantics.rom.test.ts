import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSceneNode, type SceneNode } from "@goodstuff/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NodeToolchainLocator } from "../build/node-adapters";
import type { DsScene3D } from "../ds-scene";
import { scriptedProject } from "../fixtures";
import { composeTransform, IDENTITY, multiply } from "../matrix";
import { translateScene3D } from "../translate-scene-3d";
import { runDump, type DumpItem } from "./framebuffer-dump";

/**
 * What scripts compute, checked on the real DS CPU. The generated C is built into a test ROM that runs each expression and draws the
 * answers on the screen (see framebuffer-dump.ts); an emulator capture is decoded and every answer is compared with the value the language
 * reference says, worked out here independently in TypeScript (BigInt fixed-point helpers, not by reading the generated code).
 *
 * Requirements: requirements/compiler/TASK.compile-scripts-to-c.md ("Arithmetic is right on the DS"), TASK.runtime-node-table-and-script-services.md.
 */

const toolchain = await new NodeToolchainLocator().locate();

// ---- The DS's number formats, restated independently of the code under test.
/** A float literal as the DS holds it (20.12). */
const F = (x: number): number => Math.round(x * 4096);
const wrap = (x: bigint | number): number => Number(BigInt.asIntN(32, BigInt(x)));
const mulf = (a: number, b: number): number => wrap((BigInt(a) * BigInt(b)) >> 12n);
const divf = (a: number, b: number): number => (b === 0 ? 0 : wrap((BigInt(a) << 12n) / BigInt(b)));

const SOURCE = `var counter = 0
var ratio = 0.5
var flag = true
var big = 2147483647
var tiny = -3

func add(a: int, b: int) -> int:
    return a + b
func sub(a: int, b: int) -> int:
    return a - b
func mul(a: int, b: int) -> int:
    return a * b
func idiv(a: int, b: int) -> int:
    return a / b
func imod(a: int, b: int) -> int:
    return a % b

func fadd(a: float, b: float) -> float:
    return a + b
func fsub(a: float, b: float) -> float:
    return a - b
func fmul(a: float, b: float) -> float:
    return a * b
func fdiv(a: float, b: float) -> float:
    return a / b
func imulf(a: int, b: float) -> float:
    return a * b
func fmuli(a: float, b: int) -> float:
    return a * b
func fdivi(a: float, b: int) -> float:
    return a / b
func idivf(a: int, b: float) -> float:
    return a / b
func iaddf(a: int, b: float) -> float:
    return a + b
func fsubi(a: float, b: int) -> float:
    return a - b
func lt(a: int, b: float) -> bool:
    return a < b
func ge(a: float, b: int) -> bool:
    return a >= b
func eqf(a: int, b: float) -> bool:
    return a == b
func neg(a: float) -> float:
    return -a
func ineg(a: int) -> int:
    return -a

func toint(a: float) -> int:
    return int(a)
func tofloat(a: int) -> float:
    return float(a)
func roundtrip(a: int) -> int:
    return int(float(a))

func logic(a: bool, b: bool) -> bool:
    return (a and b) or (not a and not b)
func bump() -> bool:
    counter += 1
    return true
func shortand(a: bool) -> int:
    counter = 0
    var r = a and bump()
    return counter
func shortor(a: bool) -> int:
    counter = 0
    var r = a or bump()
    return counter

func sumto(n: int) -> int:
    var total = 0
    for i in range(n):
        total += i
    return total
func sumrange(a: int, b: int) -> int:
    var total = 0
    for i in range(a, b):
        total += i
    return total
func loopbreak() -> int:
    var n = 0
    while true:
        n += 1
        if n == 7:
            break
    return n
func loopcontinue() -> int:
    var s = 0
    for i in range(10):
        if i % 2 == 0:
            continue
        s += i
    return s
func rangeonce() -> int:
    var n = 5
    var c = 0
    for i in range(n):
        n = 100
        c += 1
    return c
func nested() -> int:
    var t = 0
    for i in range(4):
        for j in range(3):
            t += i * j
    return t
func whilecount() -> int:
    var n = 10
    var steps = 0
    while n > 0:
        n -= 3
        steps += 1
    return steps
func fact(n: int) -> int:
    if n <= 1:
        return 1
    return n * fact(n - 1)
func fib(n: int) -> int:
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
func branch(x: int) -> int:
    if x < 0:
        return -1
    elif x == 0:
        return 0
    else:
        return 1

func babs(a: int) -> int:
    return abs(a)
func fabs(a: float) -> float:
    return abs(a)
func imin(a: int, b: int) -> int:
    return min(a, b)
func imax(a: int, b: int) -> int:
    return max(a, b)
func iclamp(a: int, lo: int, hi: int) -> int:
    return clamp(a, lo, hi)
func fmin(a: float, b: float) -> float:
    return min(a, b)
func fmax(a: float, b: float) -> float:
    return max(a, b)
func fclamp(a: float, lo: float, hi: float) -> float:
    return clamp(a, lo, hi)
func mmin(a: int, b: float) -> float:
    return min(a, b)
func fsqrt(a: float) -> float:
    return sqrt(a)
func fsin(a: float) -> float:
    return sin(a)
func fcos(a: float) -> float:
    return cos(a)
func isin(a: int) -> float:
    return sin(a)

func bumpcounter() -> int:
    counter += 1
    return counter
func initbig() -> int:
    return big
func inittiny() -> int:
    return tiny
func getratio() -> float:
    return ratio
func getflag() -> bool:
    return flag
func halve():
    ratio /= 2.0

func setnode():
    position.x = 1.5
    position.y += 2 * 0.25
    rotation.z = 90
    scale.x *= 2
    visible = false
func getx() -> float:
    return position.x
func getvisible() -> bool:
    return visible
func otherx() -> float:
    return $Camera.position.x
func setother():
    $Camera.rotation.y = 45.5

func inputs() -> int:
    var r = 0
    if Input.is_button_down("a"):
        r += 1
    if Input.is_button_down("left"):
        r += 2
    if Input.is_button_down("b"):
        r += 4
    if Input.is_button_pressed("a"):
        r += 8
    if Input.is_button_pressed("left"):
        r += 16
    if Input.is_button_released("a"):
        r += 32
    if Input.is_touching():
        r += 64
    return r
func touchx() -> int:
    return Input.touch_x()
func touchy() -> int:
    return Input.touch_y()
func allbuttons() -> int:
    var r = 0
    if Input.is_button_down("b"):
        r += 1
    if Input.is_button_down("x"):
        r += 2
    if Input.is_button_down("y"):
        r += 4
    if Input.is_button_down("l"):
        r += 8
    if Input.is_button_down("r"):
        r += 16
    if Input.is_button_down("start"):
        r += 32
    if Input.is_button_down("select"):
        r += 64
    if Input.is_button_down("up"):
        r += 128
    if Input.is_button_down("down"):
        r += 256
    if Input.is_button_down("right"):
        r += 512
    return r

func mark():
    $Group.position.x = 0.0
`;

interface Case {
  name: string;
  item: DumpItem;
  expected: number;
  /** Trig comes from a lookup table with 12 bits of fraction: allow this much difference. */
  tolerance?: number;
}

const call = (fn: string, args: Array<number | string> = [], inst = 0): string => `gss0_${fn}(${[inst, ...args].join(", ")})`;
const c = (name: string, fn: string, args: Array<number | string>, expected: number, tolerance = 0): Case => ({ name, item: { expr: call(fn, args) }, expected, tolerance });

const cases: Case[] = [
  // Integers.
  c("3 + 4", "add", [3, 4], 7),
  c("-5 + 2", "add", [-5, 2], -3),
  c("2147483647 + 1 wraps", "add", [2147483647, 1], -2147483648),
  c("3 - 10", "sub", [3, 10], -7),
  c("6 * 7", "mul", [6, 7], 42),
  c("-6 * 7", "mul", [-6, 7], -42),
  c("65536 * 65536 wraps to 0", "mul", [65536, 65536], 0),
  c("100000 * 100000 wraps", "mul", [100000, 100000], 1410065408),
  c("7 / 2 drops the fraction", "idiv", [7, 2], 3),
  c("-7 / 2 truncates toward zero", "idiv", [-7, 2], -3),
  c("7 / -2", "idiv", [7, -2], -3),
  c("5 / 0 is 0", "idiv", [5, 0], 0),
  c("INT_MIN / -1 wraps instead of trapping", "idiv", [-2147483648, -1], -2147483648),
  c("7 % 3", "imod", [7, 3], 1),
  c("-7 % 3 keeps the sign of the left side", "imod", [-7, 3], -1),
  c("7 % -3", "imod", [7, -3], 1),
  c("5 % 0 is 0", "imod", [5, 0], 0),
  c("5 % -1 is 0", "imod", [5, -1], 0),
  c("-(5)", "ineg", [5], -5),

  // Floats (20.12 fixed point).
  c("1.5 + 2.25", "fadd", [F(1.5), F(2.25)], F(3.75)),
  c("1 - 2.5", "fsub", [F(1), F(2.5)], F(-1.5)),
  c("1.5 * 2.5", "fmul", [F(1.5), F(2.5)], mulf(F(1.5), F(2.5))),
  c("-1.5 * 2.5", "fmul", [F(-1.5), F(2.5)], -15360),
  c("0.1 * 0.1 (0.1 is 410/4096)", "fmul", [F(0.1), F(0.1)], 41),
  c("-0.1 * 0.1 rounds down (arithmetic shift)", "fmul", [F(-0.1), F(0.1)], -42),
  c("500000 * 4 overflows and wraps", "fmul", [F(500000), F(4)], mulf(F(500000), F(4))),
  c("1 / 3", "fdiv", [F(1), F(3)], divf(F(1), F(3))),
  c("-1 / 3 truncates toward zero", "fdiv", [F(-1), F(3)], -1365),
  c("7.5 / 0.5", "fdiv", [F(7.5), F(0.5)], F(15)),
  c("1.0 / 0.0 is 0", "fdiv", [F(1), 0], 0),
  c("-(1.5)", "neg", [F(1.5)], F(-1.5)),

  // int and float together.
  c("3 * 1.5", "imulf", [3, F(1.5)], F(4.5)),
  c("1.5 * 3", "fmuli", [F(1.5), 3], F(4.5)),
  c("4.5 / 2", "fdivi", [F(4.5), 2], F(2.25)),
  c("4.5 / 0 is 0", "fdivi", [F(4.5), 0], 0),
  c("3 / 1.5", "idivf", [3, F(1.5)], F(2)),
  c("3 + 0.5", "iaddf", [3, F(0.5)], F(3.5)),
  c("2.5 - 1", "fsubi", [F(2.5), 1], F(1.5)),
  c("2 < 2.5", "lt", [2, F(2.5)], 1),
  c("3 < 2.5", "lt", [3, F(2.5)], 0),
  c("2.5 >= 3", "ge", [F(2.5), 3], 0),
  c("3.0 >= 3", "ge", [F(3), 3], 1),
  c("2 == 2.0", "eqf", [2, F(2)], 1),
  c("2 == 2.5", "eqf", [2, F(2.5)], 0),

  // Conversions.
  c("int(2.9) drops the fraction", "toint", [F(2.9)], 2),
  c("int(-2.9) truncates toward zero", "toint", [F(-2.9)], -2),
  c("int(0.5)", "toint", [F(0.5)], 0),
  c("int(-0.5)", "toint", [F(-0.5)], 0),
  c("float(3)", "tofloat", [3], F(3)),
  c("float(-2)", "tofloat", [-2], F(-2)),
  c("float(524287) is the largest whole float", "tofloat", [524287], 524287 * 4096),
  c("int(float(1234))", "roundtrip", [1234], 1234),

  // Booleans and short-circuiting.
  c("true == true", "logic", [1, 1], 1),
  c("true == false", "logic", [1, 0], 0),
  c("false == false", "logic", [0, 0], 1),
  c("false == true", "logic", [0, 1], 0),
  c("false and f() doesn't call f", "shortand", [0], 0),
  c("true and f() calls f", "shortand", [1], 1),
  c("true or f() doesn't call f", "shortor", [1], 0),
  c("false or f() calls f", "shortor", [0], 1),

  // Control flow.
  c("sum of range(10)", "sumto", [10], 45),
  c("range(0) doesn't run", "sumto", [0], 0),
  c("range(-3) doesn't run", "sumto", [-3], 0),
  c("range(3, 7)", "sumrange", [3, 7], 18),
  c("range(5, 5) doesn't run", "sumrange", [5, 5], 0),
  c("while true with break", "loopbreak", [], 7),
  c("continue skips evens", "loopcontinue", [], 25),
  c("range's limit is worked out once", "rangeonce", [], 5),
  c("nested loops", "nested", [], 18),
  c("while counting down by 3", "whilecount", [], 4),
  c("10! by recursion", "fact", [10], 3628800),
  c("fib(15) by recursion", "fib", [15], 610),
  c("if / elif / else: negative", "branch", [-5], -1),
  c("if / elif / else: zero", "branch", [0], 0),
  c("if / elif / else: positive", "branch", [9], 1),

  // Built-in functions.
  c("abs(-5)", "babs", [-5], 5),
  c("abs(5)", "babs", [5], 5),
  c("abs(INT_MIN) wraps", "babs", [-2147483648], -2147483648),
  c("abs(-1.5)", "fabs", [F(-1.5)], F(1.5)),
  c("min(3, -2)", "imin", [3, -2], -2),
  c("max(3, -2)", "imax", [3, -2], 3),
  c("clamp(15, 0, 10)", "iclamp", [15, 0, 10], 10),
  c("clamp(-5, 0, 10)", "iclamp", [-5, 0, 10], 0),
  c("clamp(5, 0, 10)", "iclamp", [5, 0, 10], 5),
  c("min(1.5, 2.5)", "fmin", [F(1.5), F(2.5)], F(1.5)),
  c("max(1.5, 2.5)", "fmax", [F(1.5), F(2.5)], F(2.5)),
  c("clamp(3.5, 0.0, 1.0)", "fclamp", [F(3.5), 0, F(1)], F(1)),
  c("min(3, 2.5) mixes int and float", "mmin", [3, F(2.5)], F(2.5)),
  c("min(1, 2.5) mixes int and float", "mmin", [1, F(2.5)], F(1)),
  c("sqrt(16.0)", "fsqrt", [F(16)], F(4)),
  c("sqrt(2.0)", "fsqrt", [F(2)], Math.floor(Math.sqrt(F(2) * 4096)), 1),
  c("sqrt(0.0)", "fsqrt", [0], 0),
  c("sqrt(-4.0) is 0", "fsqrt", [F(-4)], 0),
  c("sin(0)", "fsin", [0], 0, 3),
  c("sin(90)", "fsin", [F(90)], 4096, 3),
  c("sin(30)", "fsin", [F(30)], 2048, 3),
  c("sin(-90)", "fsin", [F(-90)], -4096, 3),
  c("sin(450) wraps around a full turn", "fsin", [F(450)], 4096, 3),
  c("sin(-450)", "fsin", [F(-450)], -4096, 3),
  c("sin(45.5)", "fsin", [F(45.5)], F(Math.sin((45.5 * Math.PI) / 180)), 4),
  c("cos(0)", "fcos", [0], 4096, 3),
  c("cos(90)", "fcos", [F(90)], 0, 3),
  c("cos(180)", "fcos", [F(180)], -4096, 3),
  c("cos(60)", "fcos", [F(60)], 2048, 3),
  c("sin(30) with an int argument", "isin", [30], 2048, 3),

  // Variables that keep their values, per node.
  c("a variable's initial int value", "initbig", [], 2147483647),
  c("a negative initial value", "inittiny", [], -3),
  c("a float initial value", "getratio", [], F(0.5)),
  c("a bool initial value", "getflag", [], 1),
  // (shortor(false) above called bump() once and left the counter at 1.)
  c("the counter continues from where it was", "bumpcounter", [], 2),
  c("and keeps its value between calls", "bumpcounter", [], 3),
  { name: "the second node has its own counter", item: { expr: call("bumpcounter", [], 1) }, expected: 1 },
  { name: "compound assignment on a float variable", item: { setup: `${call("halve")};`, expr: "gss0_state[0].m_ratio" }, expected: F(0.25) },
  { name: "and it left the other node's copy alone", item: { expr: "gss0_state[1].m_ratio" }, expected: F(0.5) },

  // Nodes: reading and writing what the Inspector shows.
  { name: "position.x before any write", item: { expr: "gs_node_state[1].position[0]" }, expected: 0 },
  { name: "position.x = 1.5", item: { setup: `${call("setnode")};`, expr: "gs_node_state[1].position[0]" }, expected: F(1.5) },
  { name: "position.y += 2 * 0.25", item: { expr: "gs_node_state[1].position[1]" }, expected: F(0.5) },
  { name: "rotation.z = 90 (an int into a float)", item: { expr: "gs_node_state[1].rotation[2]" }, expected: F(90) },
  { name: "rotation.y is untouched (30 degrees from the scene)", item: { expr: "gs_node_state[1].rotation[1]" }, expected: F(30) },
  { name: "scale.x *= 2", item: { expr: "gs_node_state[1].scale[0]" }, expected: F(2) },
  { name: "visible = false", item: { expr: "gs_node_state[1].visible" }, expected: 0 },
  c("reading position.x back", "getx", [], F(1.5)),
  c("reading visible back", "getvisible", [], 0),
  { name: "the camera node, written by the same script on another node, is unchanged", item: { expr: "gs_node_state[2].position[0]" }, expected: F(2.5) },
  c("$Camera.position.x reads another node", "otherx", [], F(2.5)),
  { name: "$Camera.rotation.y = 45.5 writes another node", item: { setup: `${call("setother")};`, expr: "gs_node_state[2].rotation[1]" }, expected: F(45.5) },
  { name: "the script on the second node acts on its own node", item: { setup: `${call("setnode", [], 1)};`, expr: "gs_node_state[2].position[0]" }, expected: F(1.5) },
  c("and reads its own", "getx", [], F(1.5)),
  { name: "the second node's own read", item: { expr: call("getx", [], 1) }, expected: F(1.5) },

  // Buttons and touch.
  { name: "A and Left held, A pressed, touching", item: { setup: "gs_keys_held = GS_KEY_A | GS_KEY_LEFT; gs_keys_pressed = GS_KEY_A; gs_keys_released = 0; gs_touching = 1; gs_touch_x = 77; gs_touch_y = 150;", expr: call("inputs") }, expected: 1 + 2 + 8 + 64 },
  { name: "touch x", item: { expr: call("touchx") }, expected: 77 },
  { name: "touch y", item: { expr: call("touchy") }, expected: 150 },
  { name: "A released, B held, not touching", item: { setup: "gs_keys_held = GS_KEY_B; gs_keys_pressed = 0; gs_keys_released = GS_KEY_A; gs_touching = 0; gs_touch_x = 0; gs_touch_y = 0;", expr: call("inputs") }, expected: 4 + 32 },
  { name: "no touch reads 0, 0", item: { expr: `${call("touchx")} + ${call("touchy")}` }, expected: 0 },
  { name: "every other button", item: { setup: "gs_keys_held = GS_KEY_B | GS_KEY_X | GS_KEY_Y | GS_KEY_L | GS_KEY_R | GS_KEY_START | GS_KEY_SELECT | GS_KEY_UP | GS_KEY_DOWN | GS_KEY_RIGHT;", expr: call("allbuttons") }, expected: 1023 },
  { name: "and none held", item: { setup: "gs_keys_held = 0;", expr: call("allbuttons") }, expected: 0 }
];

// ---- Node transforms: the runtime's per-frame composition against the editor's own (double precision) math.
const GROUP = { position: [1, 2, 3], rotation: [30, 45, 60], scale: [2, 2, 2] } as const;
const CHILD = { position: [0.5, -1, 2], rotation: [10, 20, 30], scale: [1, 1, 1] } as const;
const GRANDCHILD = { position: [1, 0, 0], rotation: [0, 0, 90], scale: [0.5, 0.5, 0.5] } as const;
const CHAIN = [
  { node: 4, ...GROUP },
  { node: 5, ...CHILD },
  { node: 6, ...GRANDCHILD }
];
const v3 = (v: readonly number[]) => ({ x: v[0], y: v[1], z: v[2] });

/** Set every node's local values, run the runtime's update once (in the first item), then read each node's world matrix (16) and scale (3). */
const transformItems: DumpItem[] = [];
for (const { node, position, rotation, scale } of CHAIN) {
  for (let k = 0; k < 16; k++) transformItems.push({ expr: `gs_world_matrix[${node}].m[${k}]` });
  for (let a = 0; a < 3; a++) transformItems.push({ expr: `gs_world_scale[${node}][${a}]` });
  void position;
  void rotation;
  void scale;
}
transformItems[0].setup =
  CHAIN.map(({ node, position, rotation, scale }) =>
    [
      ...position.map((v, a) => `gs_node_state[${node}].position[${a}] = ${F(v)};`),
      ...rotation.map((v, a) => `gs_node_state[${node}].rotation[${a}] = ${F(v)};`),
      ...scale.map((v, a) => `gs_node_state[${node}].scale[${a}] = ${F(v)};`)
    ].join(" ")
  ).join(" ") + " gs_update_nodes();";

const sceneNodes = (): SceneNode[] => {
  const grandchild = createSceneNode({ name: "Grandchild", kind: "MeshInstance3D" });
  const child = createSceneNode({ name: "Child", kind: "MeshInstance3D", children: [grandchild] });
  return [createSceneNode({ name: "Group", kind: "Node3D", children: [child] })];
};

describe.skipIf(!toolchain.found)("scripts on the DS compute what the language reference says", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-script-sem-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  let values: number[] = [];
  let scene: DsScene3D;

  beforeAll(async () => {
    const translated = translateScene3D(scriptedProject([{ name: "Semantics", source: SOURCE, attachTo: ["Cube", "Camera"] }], sceneNodes()));
    if (!translated.scene) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    scene = translated.scene;
    const items = [...cases.map((k) => k.item), ...transformItems];
    values = (await runDump(scene, items, work, "semantics")).values;
  }, 240_000);

  it("gave every node that scripts move a place in the node table, dynamic", () => {
    // The script writes its own node's position (so Cube and Camera, which it is attached to, move) and $Group's (so the whole branch moves).
    expect(scene.nodes.map((n) => [n.name, n.dynamic])).toEqual([["Main", false], ["Cube", true], ["Camera", true], ["Sun", false], ["Group", true], ["Child", true], ["Grandchild", true]]);
  });

  cases.forEach((k, i) => {
    it(k.name, () => {
      const actual = values[i];
      if (k.tolerance) expect(Math.abs(actual - k.expected), `got ${actual}, wanted ${k.expected} (+-${k.tolerance})`).toBeLessThanOrEqual(k.tolerance);
      else expect(actual).toBe(k.expected);
    });
  });

  it("composes parents and children like the editor does (rotation in XYZ order, scale down the chain), within fixed-point precision", () => {
    const base = cases.length;
    let world: readonly number[] = IDENTITY;
    CHAIN.forEach(({ position, rotation, scale }, index) => {
      world = multiply(world, composeTransform(v3(position), v3(rotation), v3(scale)));
      const offset = base + index * 19;
      const matrix = values.slice(offset, offset + 16).map((v) => v / 4096);
      const scaleOut = values.slice(offset + 16, offset + 19).map((v) => v / 4096);
      // The runtime keeps rotation + translation and the scale apart; put them together to compare with the editor's matrix.
      const rebuilt = [0, 1, 2, 3].flatMap((col) => (col < 3 ? [0, 1, 2, 3].map((row) => (row < 3 ? matrix[col * 4 + row] * scaleOut[col] : 0)) : [matrix[12], matrix[13], matrix[14], 1]));
      const worst = Math.max(...rebuilt.map((v, k) => Math.abs(v - world[k])));
      expect(worst, `node ${index}: worst entry differs by ${worst}`).toBeLessThan(0.012); // 50 / 4096
    });
  });

  it("keeps rotations unit length (no drift from the fixed-point trigonometry)", () => {
    const base = cases.length;
    for (let index = 0; index < CHAIN.length; index++) {
      const offset = base + index * 19;
      for (let col = 0; col < 3; col++) {
        const [x, y, z] = [0, 1, 2].map((row) => values[offset + col * 4 + row] / 4096);
        expect(Math.abs(Math.hypot(x, y, z) - 1), `node ${index} axis ${col}`).toBeLessThan(0.01);
      }
    }
  });
});
