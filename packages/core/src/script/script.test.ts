import { describe, expect, it } from "vitest";

import { createSceneNode, type SceneNode, type SceneNodeKind } from "../scene-node";
import { checkScript, lexScript, type ScriptCheckResult, type ScriptSceneContext } from "./index";

/** A scene with a Player mesh, a Music sound player, a Camera3D, a light and a node named with a space. */
function scene(): SceneNode {
  return createSceneNode({
    name: "Main",
    kind: "Node3D",
    children: [
      createSceneNode({ name: "Player", kind: "MeshInstance3D" }),
      createSceneNode({ name: "Music", kind: "AudioStreamPlayer" }),
      createSceneNode({ name: "Cam", kind: "Camera3D" }),
      createSceneNode({ name: "Sun", kind: "DirectionalLight3D" }),
      createSceneNode({ name: "Player 2", kind: "MeshInstance3D" })
    ]
  });
}
const attachedTo = (...kinds: SceneNodeKind[]): ScriptSceneContext["attached"] => kinds.map((kind) => ({ name: `the ${kind}`, kind }));
const check = (source: string, attached: ScriptSceneContext["attached"] = attachedTo("MeshInstance3D"), root = scene()): ScriptCheckResult =>
  checkScript(source, { root, attached });
const errors = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "error");
const warnings = (r: ScriptCheckResult) => r.diagnostics.filter((d) => d.severity === "warning");
/** [line, column, message-fragment] of each error. */
const where = (r: ScriptCheckResult) => errors(r).map((d) => [d.line, d.column, d.message] as const);

const EXAMPLE = `var speed = 2.0                       # a variable that keeps its value between frames

func _ready():
    pass

func _process(delta):
    if Input.is_button_down("left"):
        position.x -= speed * delta
    if Input.is_button_pressed("a"):
        $Player.visible = not $Player.visible
    rotation.y += 90.0 * delta        # 90 degrees a second
`;

describe("the example script", () => {
  it("checks with no errors and returns its variables and functions, typed", () => {
    const r = check(EXAMPLE);
    expect(errors(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.program.variables.map((v) => [v.name, v.ty])).toEqual([["speed", "float"]]);
    expect(r.program.functions.map((f) => f.name)).toEqual(["_ready", "_process"]);
    expect(r.usage.selfWritesTransform).toBe(true);
    expect(r.usage.nodeWritesVisible.size).toBe(1);
    expect(r.usage.referencedNodeIds.size).toBe(1);
  });

  it("with an audio player: play, stop, volume and pitch work on self and on $Music", () => {
    const r = check(
      `func _process(delta):
    volume = 0.5
    pitch += 0.1 * delta
    if Input.is_button_pressed("a"):
        play()
    if Input.is_button_pressed("b"):
        stop()
        $Music.play()
        $Music.volume = 1
`,
      attachedTo("AudioStreamPlayer")
    );
    expect(errors(r)).toEqual([]);
    expect(r.usage.selfCallsPlay).toBe(true);
    expect(r.usage.nodeCallsPlay.size).toBe(1);
  });
});

describe("layout", () => {
  it("makes nested blocks from indentation, ignoring blank lines and comments between them", () => {
    const r = check(`func f(n: int) -> int:
    var total = 0

    # count up
    for i in range(n):
        if i % 2 == 0:
            total += i

            # deeper comment
        else:
            total -= 1
    while total > 100:
        total -= 100
    return total
`);
    expect(errors(r)).toEqual([]);
    expect(r.program.functions[0].body).toHaveLength(4);
  });

  it("reports an unexpected indent once, and still checks the code inside it", () => {
    const r = check(`func f():
    var a = 1
        var b = nothing
    pass
`);
    const list = where(r);
    expect(list.filter(([, , m]) => /indented more/.test(m))).toHaveLength(1);
    expect(list.some(([line, , m]) => line === 3 && /Unknown name "nothing"/.test(m))).toBe(false); // syntax errors stop semantic checking
  });

  it("reports a missing block, an unmatched dedent and mixed tabs and spaces, each with its line", () => {
    expect(where(check("func f():\npass\n"))[0]).toEqual([2, 1, expect.stringMatching(/indented block/)]);
    expect(where(check("func f():\n    if true:\n        pass\n  pass\n"))[0][0]).toBe(4);
    const mixed = check("func f():\n    pass\n\tpass\n");
    expect(mixed.diagnostics.some((d) => d.line === 3 && /mixes tabs and spaces/.test(d.message))).toBe(true);
  });

  it("gives a broken block header one error and doesn't blame its body", () => {
    const r = check(`func f():
    if true
        pass
    pass
`);
    expect(errors(r)).toHaveLength(1);
    expect(errors(r)[0]).toMatchObject({ line: 2, message: expect.stringContaining('Expected a ":"') });
  });

  it("lets a line continue inside parentheses and takes one-line bodies", () => {
    const r = check(`func f(a: int, b: int) -> int:
    var x = max(
        a,
        b
    )
    if x > 0: return x
    return 0
`);
    expect(errors(r)).toEqual([]);
  });

  it("lexes tabs-only indentation, CRLF line ends and $\"quoted\" node names", () => {
    const r = check('func _process(delta):\r\n\t$"Player 2".visible = false\r\n\t$Player.visible = true\r\n');
    expect(errors(r)).toEqual([]);
    expect(lexScript("$Player").tokens[0]).toMatchObject({ kind: "nodeRef", text: "Player" });
  });
});

describe("types", () => {
  it("makes int next to float a float, and int op int an int", () => {
    const r = check(`func f() -> float:
    var a = 1
    var b = 2.5
    var c = a + b
    var d = a * 2
    var e = a / 2
    var g = a / 2.0
    var h: float = a
    return c + float(d) + float(e) + g + h
`);
    expect(errors(r)).toEqual([]);
    const locals = r.program.functions[0].body.filter((s) => s.kind === "var").map((s) => (s.kind === "var" ? [s.name, s.ty] : []));
    expect(locals).toEqual([["a", "int"], ["b", "float"], ["c", "float"], ["d", "int"], ["e", "int"], ["g", "float"], ["h", "float"]]);
  });

  it("refuses a float in an int with a hint to use int(x)", () => {
    const r = check(`func f():
    var a: int = 2.5
    var b = 1
    b = 2.5
    b += 0.5
    var c = int(2.5)
    c = c + 1
`);
    expect(where(r).map(([line, , m]) => [line, /int\(x\)/.test(m)])).toEqual([[2, true], [4, true], [5, true]]);
  });

  it("refuses bools as numbers and numbers as bools", () => {
    const r = check(`func f():
    var a = true
    var b = a + 1
    if 1:
        pass
    while 2.0:
        pass
    var c: int = true
    var d: bool = 1
    var e = -a
    var g = not 1
    var h = 1 and 2
    var i = true < false
`);
    expect(errors(r).map((d) => d.line)).toEqual([3, 4, 6, 8, 9, 10, 11, 12, 13]);
  });

  it("allows == and != on numbers of either type, and on two bools", () => {
    const r = check("func f(a: int, b: float, c: bool) -> bool:\n    return a == b or a != 3 or c == true or (c != false and a < b)\n");
    expect(errors(r)).toEqual([]);
    expect(where(check("func f(a: int, c: bool) -> bool:\n    return a == c\n"))).toHaveLength(1);
  });

  it("allows % on ints only", () => {
    expect(errors(check("func f(a: int) -> int:\n    return a % 3\n"))).toEqual([]);
    expect(where(check("func f(a: float) -> float:\n    return a % 3\n"))).toHaveLength(1);
    expect(where(check("func f(a: int) -> int:\n    var b = a\n    b %= 2.0\n    return b\n"))[0][2]).toMatch(/only works on ints/);
  });

  it("types the built-in functions", () => {
    const r = check(`func f(a: int, b: float) -> float:
    var i = abs(a) + min(a, 3) + max(1, a) + clamp(a, 0, 9) + int(b)
    var g = abs(b) + min(a, b) + max(b, 1) + clamp(b, 0, 1) + sqrt(a) + sin(b) + cos(90) + float(a)
    return g + float(i)
`);
    expect(errors(r)).toEqual([]);
    const [i, g] = r.program.functions[0].body;
    expect([(i as { ty?: string }).ty, (g as { ty?: string }).ty]).toEqual(["int", "float"]);
  });

  it("checks user function calls: arity, argument types (int goes to float, not back), and return values", () => {
    const r = check(`func scaled(v: float, k: int) -> float:
    return v * float(k)

func nothing():
    pass

func f():
    var a = scaled(1, 2)
    var b = scaled(1.5, 2.5)
    var c = scaled(1)
    var d = nothing()
    scaled(1, 2, 3)
    nothing()
`);
    expect(where(r).map(([line]) => line)).toEqual([9, 10, 11, 12]);
  });

  it("checks return: the value's type, a missing value, a value in a void function, and every path returning", () => {
    const r = check(`func a() -> int:
    return 1.5

func b() -> int:
    return

func c():
    return 1

func d(x: int) -> int:
    if x > 0:
        return 1

func e(x: int) -> int:
    if x > 0:
        return 1
    else:
        return 2

func f(x: int) -> float:
    return x
`);
    expect(errors(r).map((d) => d.line)).toEqual([2, 5, 8, 10]);
    expect(errors(r).find((d) => d.line === 10)!.message).toMatch(/must return a value on every path/);
  });

  it("gives variables literal initial values, of the declared type (0 and false are literals too)", () => {
    expect(errors(check("var a = 1\nvar b = -2.5\nvar c = true\nvar d: float = 3\nvar e = -1\nvar zero = 0\nvar off = false\nvar nothing = 0.0\nvar negzero = -0\n"))).toEqual([]);
    const r = check("var a = 1 + 2\nvar b: int = 1.5\nvar c: bool = 1\nvar d = speed\n");
    expect(where(r).map(([line, , m]) => [line, m])).toEqual([
      [1, expect.stringContaining("initial value must be")],
      [2, expect.stringContaining("float can't go into an int")],
      [3, expect.stringContaining("An int can't be used as a bool")],
      [4, expect.stringContaining("initial value must be")]
    ]);
  });

  it("limits numbers to what the DS holds", () => {
    expect(errors(check("var a = 2147483647\nvar b = 524287.0\n"))).toEqual([]);
    const r = check("var a = 2147483648\nvar b = 524288.0\n");
    expect(where(r).map(([line, , m]) => [line, /too big/.test(m)])).toEqual([[1, true], [2, true]]);
  });
});

describe("mistakes are located", () => {
  it("names each kind of mistake at its line and column", () => {
    const source = `var speed = 1.0
func f(a: int) -> int:
    var x = unknown_thing
    var y = nofunc(1)
    var z = abs(1, 2)
    var w = Input.is_button_down("jump")
    var v = position.q
    speed = speed + missing
    return a
func f():
    pass
func g():
    break
func _process():
    pass
func h(p):
    pass
`;
    const r = check(source);
    const list = where(r);
    const find = (line: number) => list.filter(([l]) => l === line).map(([, c, m]) => [c, m] as const);
    expect(find(3)).toEqual([[13, 'Unknown name "unknown_thing".']]);
    expect(find(4)).toEqual([[13, expect.stringContaining('Unknown function "nofunc"')]]);
    expect(find(5)).toEqual([[13, expect.stringContaining("abs() takes 1 argument, but 2 were given")]]);
    expect(find(6)).toEqual([[34, expect.stringContaining('"jump" isn\'t a button')]]);
    expect(find(7)).toEqual([[22, expect.stringContaining("A vector has .x, .y and .z, not .q")]]);
    expect(find(8)).toEqual([[21, 'Unknown name "missing".']]);
    expect(find(10)).toEqual([[6, expect.stringContaining('"f" is already declared')]]);
    expect(find(13)).toEqual([[5, expect.stringContaining('"break" can only be used inside')]]);
    expect(find(14)).toEqual([[6, expect.stringContaining("_process must be written _process(delta)")]]);
    expect(find(16)).toEqual([[8, expect.stringContaining('The parameter "p" needs a type')]]);
  });

  it("doesn't stop at the first error", () => {
    const r = check("func f():\n    var a = nope\n    var b = 1 +\n    var c = ?\n");
    expect(errors(r).length).toBeGreaterThanOrEqual(2); // syntax errors: the bad expression and the stray character
    const semantic = check("func f():\n    var a = nope\n    var b = 1.5\n    var c: int = b\n    zip()\n");
    expect(errors(semantic).map((d) => d.line)).toEqual([2, 4, 5]);
  });

  it("rejects names that are built in, keywords as names, duplicates and shadowing", () => {
    const r = check(`var position = 1
var speed = 1
var speed = 2
func abs():
    pass
func f(speed: int):
    var play = 1
    var local = 1
    var local = 2
`);
    expect(errors(r).map((d) => d.line)).toEqual([1, 3, 4, 6, 7, 9]);
    expect(where(check("var if = 1\n"))[0][2]).toMatch(/Expected a variable name/);
  });

  it("warns about an unused local and unreachable code, but they don't stop the build", () => {
    const r = check(`func f() -> int:
    var unused = 1
    return 1
    var after = 2
`);
    expect(errors(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(warnings(r).map((d) => [d.line, d.message])).toEqual([
      [2, expect.stringMatching(/The variable "unused" is never used/)],
      [4, expect.stringMatching(/This code can never run/)],
      [4, expect.stringMatching(/The variable "after" is never used/)]
    ]);
  });

  it("checks break and continue inside loops, and for-range arguments", () => {
    const r = check(`func f(n: int, x: float):
    for i in range(n):
        if i == 3:
            continue
        break
    for j in range(x):
        pass
    for k in range(1, 2.5):
        pass
    var i = 0
`);
    expect(errors(r).map((d) => d.line)).toEqual([6, 8]);
  });

  it("requires a statement to be an assignment or call", () => {
    const r = check("func f():\n    var a = 1\n    a\n    a + 1\n    a = 2\n");
    expect(errors(r).map((d) => d.line)).toEqual([3, 4]);
  });

  it("checks hook signatures", () => {
    expect(where(check("func _ready(a: int):\n    pass\n"))[0][2]).toMatch(/takes no parameters/);
    expect(where(check("func _ready() -> int:\n    return 1\n"))[0][2]).toMatch(/can't return a value/);
    expect(errors(check("func _process(dt: float):\n    pass\n"))).toEqual([]);
    expect(where(check("func _process(dt: int):\n    pass\n"))[0][2]).toMatch(/float \(seconds\)/);
    expect(errors(check("func _process(delta):\n    var t = delta * 2.0\n    t += 1\n"))).toEqual([]);
  });
});

describe("nodes", () => {
  it("resolves $Name against the scene, and reports missing and ambiguous names", () => {
    expect(errors(check("func f():\n    $Player.visible = true\n    $Cam.position.x = 1.0\n    $\"Player 2\".visible = false\n"))).toEqual([]);
    const missing = check("func f():\n    $Nobody.visible = true\n");
    expect(where(missing)).toEqual([[2, 5, 'There is no node named "Nobody" in the scene.']]);
    const twice = scene();
    twice.children.push(createSceneNode({ name: "Player", kind: "MeshInstance3D" }));
    const r = check("func f():\n    $Player.visible = true\n", attachedTo("MeshInstance3D"), twice);
    expect(where(r)[0][2]).toMatch(/2 nodes are named "Player"/);
  });

  it("gives members depending on the node's kind", () => {
    const onMesh = check("func f():\n    play()\n", attachedTo("MeshInstance3D"));
    expect(where(onMesh)[0][2]).toMatch(/"play" isn't available on the MeshInstance3D \(a MeshInstance3D\)/);
    expect(errors(check("func f():\n    play()\n", attachedTo("AudioStreamPlayer")))).toEqual([]);
    const audioPosition = check("func f():\n    position.x = 1.0\n", attachedTo("AudioStreamPlayer"));
    expect(where(audioPosition)[0][2]).toMatch(/"position" isn't available/);
    expect(where(check("func f():\n    $Player.play()\n"))[0][2]).toMatch(/\$Player is a MeshInstance3D, which has no "play"/);
    expect(where(check("func f():\n    $Music.position.x = 1.0\n"))[0][2]).toMatch(/\$Music is a AudioStreamPlayer, which has no "position"/);
    expect(errors(check("func f():\n    $Sun.rotation.x = 10.0\n    $Cam.position.z = 3.0\n"))).toEqual([]);
  });

  it("needs a script on several kinds to be valid for all of them, naming the one that isn't", () => {
    const r = check("func f():\n    play()\n", [
      { name: "Music", kind: "AudioStreamPlayer" },
      { name: "Cam", kind: "Camera3D" }
    ]);
    expect(where(r)).toHaveLength(1);
    expect(where(r)[0][2]).toContain("Cam");
    expect(where(r)[0][2]).toContain("Camera3D");
  });

  it("lets an unattached script use every member (it's checked again when attached)", () => {
    expect(errors(check("func f():\n    play()\n    position.x = 1.0\n    volume = 0.5\n", []))).toEqual([]);
  });

  it("uses whole vectors and nodes only as the base of a member", () => {
    const r = check("func f():\n    var a = position\n    position = 1\n    var b = $Player\n    var c = self\n");
    expect(errors(r).map((d) => d.line)).toEqual([2, 3, 4, 5]);
  });

  it("writes each kind of member with the right type", () => {
    const ok = check("func f():\n    position.x += 1\n    rotation.y = 90\n    scale.z *= 2.0\n    visible = false\n");
    expect(errors(ok)).toEqual([]);
    const bad = check("func f():\n    visible = 1\n    position.x = true\n    visible += true\n");
    expect(errors(bad).map((d) => d.line)).toEqual([2, 3, 4]);
  });
});

describe("Input", () => {
  it("accepts every button and the touch functions", () => {
    const buttons = ["a", "b", "x", "y", "l", "r", "start", "select", "up", "down", "left", "right"];
    const body = buttons.map((b, i) => `    if Input.is_button_${["down", "pressed", "released"][i % 3]}("${b}"):\n        pass`).join("\n");
    const r = check(`func f():\n${body}\n    if Input.is_touching():\n        var x = Input.touch_x() + Input.touch_y()\n        x += 1\n`);
    expect(errors(r)).toEqual([]);
    expect(r.program.functions[0].body[0]).toMatchObject({ kind: "if" });
  });

  it("rejects bad button names, non-literal names, wrong arity and unknown functions", () => {
    const r = check(`func f(name: int):
    if Input.is_button_down("jump"):
        pass
    if Input.is_button_down(name):
        pass
    if Input.is_button_down():
        pass
    if Input.is_touching(1):
        pass
    if Input.nothing():
        pass
    var v = Input.is_button_down
`);
    expect(errors(r).map((d) => d.line)).toEqual([2, 4, 6, 8, 10, 12]);
  });
});
