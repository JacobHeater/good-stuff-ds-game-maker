import { getAnimationPlayer } from "../animation";
import { getSpriteAnimations } from "../sprite-animation";
import { flattenSceneTree, is3DNodeKind, type SceneNode, type SceneNodeKind } from "../scene-node";
import { BUTTON_NAMES, type ScriptSceneContext } from "./checker";

/**
 * What the script editor suggests while typing (requirements/scripting/TASK.script-autocomplete.md). This is plain code with no editor in it: it looks at the
 * text before the cursor and at the scene, and says where the word being typed starts and what could go there. The editor narrows the list as more is typed.
 */

export type ScriptCompletionKind = "keyword" | "function" | "variable" | "property" | "constant" | "type" | "class" | "text";

export interface ScriptCompletion {
  /** What is shown, and what the typed letters are matched against. */
  label: string;
  kind: ScriptCompletionKind;
  /** A short signature or kind, shown beside the label. */
  detail?: string;
  /** A sentence about it, shown when the row is highlighted. */
  info?: string;
  /** The text to put in place of the typed word (the label when left out). */
  insert?: string;
  /** How many characters back from the end of `insert` to put the cursor (so `abs()` can leave it between the brackets). */
  caretBack?: number;
  /** Open the list again after inserting (`is_button_down("` wants a button name next). */
  reopen?: boolean;
}

export interface ScriptCompletionResult {
  /** The offset in the source where the word being completed begins; the typed letters up to the cursor are replaced by the choice. */
  from: number;
  options: ScriptCompletion[];
}

// ---- The language's own words

const fn = (label: string, detail: string, info: string, insert = `${label}()`, caretBack = 1): ScriptCompletion => ({ label, kind: "function", detail, info, insert, caretBack });

const BUILTIN_FUNCTIONS: ScriptCompletion[] = [
  fn("abs", "(x)", "The size of a number without its sign."),
  fn("min", "(a, b)", "The smaller of two numbers.", "min(, )", 3),
  fn("max", "(a, b)", "The larger of two numbers.", "max(, )", 3),
  fn("clamp", "(v, lo, hi)", "Keeps v between lo and hi.", "clamp(, , )", 5),
  fn("sqrt", "(x) -> float", "The square root."),
  fn("sin", "(degrees) -> float", "The sine of an angle in degrees, from -1 to 1."),
  fn("cos", "(degrees) -> float", "The cosine of an angle in degrees, from -1 to 1."),
  fn("randi", "(n) -> int", "A random whole number from 0 up to n - 1: randi(6) is 0, 1, 2, 3, 4 or 5.", "randi()"),
  fn("randf", "() -> float", "A random number from 0 up to (not including) 1."),
  fn("atan2", "(y, x) -> float", "The angle, in degrees from -180 to 180, of the direction x, y: atan2(1, 1) is 45. Handy to turn toward something.", "atan2(, )", 3),
  fn("int", "(x) -> int", "A whole number: drops the fraction of a float."),
  fn("float", "(x) -> float", "A number with a fraction."),
  fn("change_scene", '("name")', "Switches to another scene of the project when this frame ends. The scene's name goes in quotes.", 'change_scene("")', 2),
  fn("save_game", "() -> bool", "Writes every global variable to the game's save file. True when it was saved."),
  fn("load_game", "() -> bool", "Reads the save file back into the global variables. True when there was a save to load."),
  fn("has_save", "() -> bool", "Whether there is a save file with a game in it.")
];

const WORDS: ScriptCompletion[] = [
  { label: "Input", kind: "class", detail: "buttons and touch", info: "Ask for the buttons and the touch screen: Input.is_button_down(\"a\")." },
  { label: "self", kind: "constant", detail: "the node this script is on", info: "The node the script is attached to: self.position." },
  { label: "true", kind: "constant" },
  { label: "false", kind: "constant" },
  { label: "and", kind: "keyword" },
  { label: "or", kind: "keyword" },
  { label: "not", kind: "keyword" },
  { label: "range", kind: "function", detail: "(n) or (a, b)", info: "The numbers to go through in a for loop: for i in range(10):", insert: "range()", caretBack: 1 }
];

/** Statements, offered at the start of a line. */
const STATEMENTS: ScriptCompletion[] = [
  { label: "func _process(delta):", kind: "keyword", detail: "runs every frame", info: "The function that runs every frame; delta is the seconds since the last one.", insert: "func _process(delta):\n    " },
  { label: "func _ready():", kind: "keyword", detail: "runs once", info: "Runs once, when the game starts.", insert: "func _ready():\n    " },
  { label: "func", kind: "keyword", detail: "a new function", info: "A function of your own: func jump(power: float):", insert: "func " },
  { label: "global", kind: "keyword", detail: "a variable for the whole game", info: "global var score = 0 makes a variable every script can use, in every scene; it keeps its value when the scene changes, and save_game() stores it.", insert: "global var " },
  { label: "var", kind: "keyword", detail: "a variable", info: "A variable: var speed = 2.0. At the top of the script it keeps its value between frames.", insert: "var " },
  { label: "if", kind: "keyword", insert: "if " },
  { label: "elif", kind: "keyword", insert: "elif " },
  { label: "else", kind: "keyword", insert: "else:", caretBack: 0 },
  { label: "while", kind: "keyword", insert: "while " },
  { label: "for", kind: "keyword", detail: "for i in range(10):", insert: "for i in range(10):", caretBack: 0 },
  { label: "return", kind: "keyword", insert: "return " },
  { label: "break", kind: "keyword" },
  { label: "continue", kind: "keyword" },
  { label: "pass", kind: "keyword", info: "Does nothing: a place holder for an empty block." }
];

const TYPES: ScriptCompletion[] = [
  { label: "int", kind: "type", detail: "whole number" },
  { label: "float", kind: "type", detail: "number with a fraction" },
  { label: "bool", kind: "type", detail: "true or false" }
];

const INPUT_FUNCTIONS: ScriptCompletion[] = [
  { label: "is_button_down", kind: "function", detail: '("button") -> bool', info: "True every frame the button is held.", insert: 'is_button_down("")', caretBack: 2, reopen: true },
  { label: "is_button_pressed", kind: "function", detail: '("button") -> bool', info: "True only on the frame the button goes down.", insert: 'is_button_pressed("")', caretBack: 2, reopen: true },
  { label: "is_button_released", kind: "function", detail: '("button") -> bool', info: "True only on the frame the button comes up.", insert: 'is_button_released("")', caretBack: 2, reopen: true },
  { label: "is_touching", kind: "function", detail: "() -> bool", info: "True while the touch screen is being touched.", insert: "is_touching()" },
  { label: "touch_x", kind: "function", detail: "() -> int", info: "Where the touch is, across the screen (0 to 255).", insert: "touch_x()" },
  { label: "touch_ground_x", kind: "function", detail: "(height) -> float", info: "The world X where the stylus points on the flat plane at that height (0 when not touching). Needs the 3D scene on the touch screen.", insert: "touch_ground_x()" },
  { label: "touch_ground_z", kind: "function", detail: "(height) -> float", info: "The world Z where the stylus points on the flat plane at that height (0 when not touching). Needs the 3D scene on the touch screen.", insert: "touch_ground_z()" },
  { label: "touch_y", kind: "function", detail: "() -> int", info: "Where the touch is, down the screen (0 to 191).", insert: "touch_y()" }
];

const AXES: ScriptCompletion[] = ["x", "y", "z"].map((axis) => ({ label: axis, kind: "property", detail: "float" }));

const BUTTONS: ScriptCompletion[] = BUTTON_NAMES.map((name) => ({ label: name, kind: "constant", detail: "button" }));

// ---- What a node has

const VECTORS = new Set(["position", "rotation", "scale"]);

interface Capabilities {
  transform: boolean;
  /** A Sprite2D: position and scale with .x and .y, rotation as one number, and visible. */
  sprite: boolean;
  audio: boolean;
  animation: boolean;
  /** `speed_scale` (an AnimationPlayer only). */
  speed: boolean;
  shape: boolean;
  body: boolean;
  touch: boolean;
  /** A Label: `visible`, `value` and `text`. */
  label: boolean;
  /** The animation names to offer in `play("`. */
  animations: readonly string[];
}

function prop(label: string, detail: string, info: string): ScriptCompletion {
  return { label, kind: "property", detail, info };
}
function method(label: string, detail: string, info: string, insert: string, caretBack = 1, reopen = false): ScriptCompletion {
  return { label, kind: "function", detail, info, insert, caretBack, reopen };
}

/** The members a node with these capabilities has: what `.` after it offers, and what a script attached to it can write without `self.`. */
function membersFor(c: Capabilities): ScriptCompletion[] {
  const list: ScriptCompletion[] = [];
  if (c.transform) {
    list.push(prop("position", "vector", "Where it is: position.x, position.y, position.z."), prop("rotation", "vector", "Its angle in degrees around each axis."));
    list.push(prop("scale", "vector", "Its size on each axis (1 is normal)."), prop("visible", "bool", "Whether it is shown (and, for a collision shape, whether it counts)."));
  }
  if (c.sprite) {
    list.push(prop("position", "vector", "Where its center is on the screen, in pixels: position.x and position.y."), prop("rotation", "float", "Its angle in degrees, clockwise."));
    list.push(prop("scale", "vector", "Its size on each axis (1 is normal, negative flips it): scale.x and scale.y."), prop("visible", "bool", "Whether it is shown."));
  }
  if (c.audio) {
    list.push(prop("volume", "float", "How loud, from 0 to 100."), prop("pitch", "float", "How high the sound plays (1 is normal)."));
    list.push(method("play", "()", "Starts the sound from the beginning.", "play()"), method("stop", "()", "Stops the sound.", "stop()"));
  }
  if (c.animation) {
    list.push(method("play", '("name")', "Starts one of its animations from its beginning.", 'play("")', 2, true));
    list.push(method("stop", "()", "Stops the animation where it is.", "stop()"), method("is_playing", "() -> bool", "Whether an animation is running.", "is_playing()"));
  }
  if (c.label) {
    list.push(prop("visible", "bool", "Whether it is shown."), prop("value", "int", "The whole number shown where its text has {}."));
    list.push(prop("text", "text", 'Its text; set it to text in quotes: text = "Game Over".'));
  }
  if (c.speed) list.push(prop("speed_scale", "float", "How fast animations play (1 is normal, 2 is double)."));
  if (c.touch) {
    list.push(method("is_touched", "() -> bool", "Whether the stylus is touching it right now.", "is_touched()"));
    list.push(method("is_touch_pressed", "() -> bool", "Whether the stylus went down on it this frame.", "is_touch_pressed()"));
    list.push(method("is_touch_released", "() -> bool", "Whether the stylus was lifted this frame after touching it.", "is_touch_released()"));
  }
  if (c.shape) list.push(method("overlaps", "(other) -> bool", "Whether it touches another collision shape.", "overlaps()", 1, true));
  if (c.body) {
    list.push(method("move_and_collide", "(dx, dy, dz) -> bool", "Moves it by that much, stopped by solid collision shapes. True when it was stopped.", "move_and_collide(, , )", 5));
    list.push(method("probe_solid", "(y, x0, x1, x2) -> int", "Which of three points (x0, x1, x2 along the longer side of the body's collision shape, y up from the shape's center) are inside a solid shape, as a number: 1 for the first, 2 the second, 4 the third, added up.", "probe_solid(, , , )", 7));
    list.push(method("ray_cast", "(ox, oy, oz, dx, dy, dz, max) -> float", "How far along a ray (starting at ox, oy, oz and going toward dx, dy, dz) the nearest solid shape is, not counting the body's own, or -1 when nothing is within max.", "ray_cast(, , , , , , )", 13));
    list.push(method("is_on_floor", "() -> bool", "Whether the last move landed on something.", "is_on_floor()"));
    list.push(method("is_on_wall", "() -> bool", "Whether the last move ran into a wall.", "is_on_wall()"));
    list.push(method("is_on_ceiling", "() -> bool", "Whether the last move bumped a ceiling.", "is_on_ceiling()"));
  }
  return list;
}

function capabilitiesOfKind(kind: SceneNodeKind, hasShape: boolean, animations: readonly string[]): Capabilities {
  const shape = kind === "CollisionShape3D";
  return { transform: is3DNodeKind(kind), sprite: kind === "Sprite2D" || kind === "AnimatedSprite2D", audio: kind === "AudioStreamPlayer", animation: kind === "AnimationPlayer" || kind === "AnimatedSprite2D" || (kind === "MeshInstance3D" && animations.length > 0), speed: kind === "AnimationPlayer", shape, body: shape || hasShape, touch: kind === "TouchArea2D" || kind === "TouchArea3D", label: kind === "Label", animations };
}

const EVERYTHING: Capabilities = { transform: true, sprite: false, audio: true, animation: true, speed: true, shape: true, body: true, touch: true, label: false, animations: [] };

/** What `self` can do: what every node the script is attached to can do (everything when it is attached to none yet). */
function selfCapabilities(context: ScriptSceneContext): Capabilities {
  if (context.attached.length === 0) return EVERYTHING;
  const each = context.attached.map((a) => capabilitiesOfKind(a.kind, a.hasShape ?? false, a.animations ?? []));
  return {
    transform: each.every((c) => c.transform),
    sprite: each.every((c) => c.sprite),
    audio: each.every((c) => c.audio),
    animation: each.every((c) => c.animation),
    speed: each.every((c) => c.speed),
    shape: each.every((c) => c.shape),
    body: each.every((c) => c.body),
    touch: each.every((c) => c.touch),
    label: each.every((c) => c.label),
    animations: [...new Set(each.flatMap((c) => c.animations))]
  };
}

function findNode(context: ScriptSceneContext, name: string): SceneNode | undefined {
  return flattenSceneTree(context.root).find((node) => node.name === name);
}

function nodeCapabilities(node: SceneNode): Capabilities {
  const animations = node.kind === "AnimationPlayer" ? getAnimationPlayer(node).animations.map((a) => a.name) : node.kind === "MeshInstance3D" ? getSpriteAnimations(node).animations.map((a) => a.name) : [];
  return capabilitiesOfKind(node.kind, flattenSceneTree(node).some((n) => n.kind === "CollisionShape3D"), animations);
}

/** The node a `$Name` or `$"Name"` (or `self`) stands for, as what it can do; null when it isn't there. */
function receiverCapabilities(receiver: string, context: ScriptSceneContext): Capabilities | null {
  if (receiver === "self") return selfCapabilities(context);
  if (!receiver.startsWith("$")) return null;
  const name = receiver.startsWith('$"') ? receiver.slice(2, -1) : receiver.slice(1);
  const node = findNode(context, name);
  return node ? nodeCapabilities(node) : null;
}

// ---- Reading the text before the cursor

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const RECEIVER = String.raw`\$"[^"\n]*"|\$${IDENT}|${IDENT}`;

/** Where the line's text before the cursor is inside a string or a comment: `stringStart` is the index of the opening quote. */
function lineState(before: string): { comment: boolean; stringStart: number | null } {
  let stringStart: number | null = null;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (stringStart !== null) {
      if (ch === '"') stringStart = null;
    } else if (ch === '"') stringStart = i;
    else if (ch === "#") return { comment: true, stringStart: null };
  }
  return { comment: false, stringStart };
}

interface ScopeNames {
  variables: Map<string, string>;
  functions: Map<string, string[]>;
  locals: Map<string, string>;
}

const withoutComment = (line: string): string => {
  const state = lineState(line);
  if (!state.comment) return line;
  // Cut at the `#` that starts the comment (the first one outside a string).
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inString = !inString;
    else if (line[i] === "#" && !inString) return line.slice(0, i);
  }
  return line;
};

/** The script's own names, read from the text without parsing it (it is usually half written while completing). */
function scopeAt(lines: string[], lineIndex: number, globals: ScriptSceneContext["globals"]): ScopeNames {
  const scope: ScopeNames = { variables: new Map(), functions: new Map(), locals: new Map() };
  // The project's global variables, which every script can use.
  for (const global of globals ?? []) scope.variables.set(global.name, global.type);
  for (const raw of lines) {
    const line = withoutComment(raw);
    const variable = new RegExp(String.raw`^(?:global\s+)?var\s+(${IDENT})\s*(?::\s*(\w+))?\s*(?:=\s*(.*))?$`).exec(line);
    if (variable) {
      const initial = variable[3]?.trim() ?? "";
      scope.variables.set(variable[1], variable[2] ?? (/^-?\d+\.\d/.test(initial) ? "float" : /^(true|false)$/.test(initial) ? "bool" : "int"));
      continue;
    }
    const func = new RegExp(String.raw`^func\s+(${IDENT})\s*\(([^)]*)\)`).exec(line);
    if (func && func[1] !== "_process" && func[1] !== "_ready") scope.functions.set(func[1], func[2].split(",").map((p) => p.trim()).filter(Boolean));
  }
  // The function the cursor is in: the closest line above (or at) it that starts at the left edge, which must be a func.
  let start = -1;
  for (let i = lineIndex; i >= 0; i--) {
    const line = withoutComment(lines[i]);
    if (line.trim() === "" || /^\s/.test(line)) continue;
    if (/^func\b/.test(line)) start = i;
    break;
  }
  if (start >= 0) {
    const header = new RegExp(String.raw`^func\s+${IDENT}\s*\(([^)]*)\)`).exec(withoutComment(lines[start]));
    for (const param of header?.[1].split(",") ?? []) {
      const [name, type] = param.split(":").map((s) => s.trim());
      if (name) scope.locals.set(name, type ?? (/^func\s+_process/.test(lines[start]) ? "float" : ""));
    }
    for (let i = start + 1; i <= lineIndex; i++) {
      const line = withoutComment(lines[i]);
      const local = new RegExp(String.raw`^\s+var\s+(${IDENT})\s*(?::\s*(\w+))?`).exec(line);
      if (local) scope.locals.set(local[1], local[2] ?? "");
      const loop = new RegExp(String.raw`^\s+for\s+(${IDENT})\s+in\b`).exec(line);
      if (loop) scope.locals.set(loop[1], "int");
    }
  }
  return scope;
}

// ---- The completion

/**
 * The suggestions at `offset` in `source`, or null when nothing should be offered. `explicit` is true when the writer asked for the list (Ctrl+Space):
 * a word with no letters typed yet is then completed too.
 */
export function completeScript(source: string, offset: number, context: ScriptSceneContext, explicit = false): ScriptCompletionResult | null {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const before = source.slice(lineStart, offset);
  const lines = source.split("\n");
  const lineIndex = source.slice(0, offset).split("\n").length - 1;
  const state = lineState(before);
  if (state.comment) return null;

  // ---- Inside quotes.
  if (state.stringStart !== null) {
    const head = before.slice(0, state.stringStart);
    const closed = source[offset] === '"' ? "" : '"';
    const from = lineStart + state.stringStart + 1;
    const asString = (options: ScriptCompletion[]): ScriptCompletionResult => ({ from, options: options.map((o) => ({ ...o, insert: `${o.insert ?? o.label}${closed}` })) });
    if (/\$$/.test(head)) {
      return asString(nodeNames(context).map((o) => ({ ...o, label: o.label.slice(1).replace(/^"|"$/g, "") })));
    }
    if (new RegExp(String.raw`\bInput\s*\.\s*is_button_(?:down|pressed|released)\s*\(\s*$`).test(head)) return asString(BUTTONS);
    const play = new RegExp(String.raw`(?:(${RECEIVER})\s*\.\s*)?\bplay\s*\(\s*$`).exec(head);
    if (play) {
      const caps = play[1] ? receiverCapabilities(play[1], context) : selfCapabilities(context);
      if (!caps || caps.animations.length === 0) return null;
      return asString(caps.animations.map((name) => ({ label: name, kind: "text", detail: "animation" })));
    }
    return null;
  }

  // ---- After `$`.
  const dollar = /\$([A-Za-z0-9_]*)$/.exec(before);
  if (dollar) return { from: offset - dollar[1].length - 1, options: nodeNames(context) };

  // ---- After a dot.
  const dot = new RegExp(String.raw`(${RECEIVER})((?:\s*\.\s*${IDENT})*)\s*\.\s*(${IDENT})?$`).exec(before);
  if (dot) {
    const from = offset - (dot[3]?.length ?? 0);
    const base = dot[1];
    const path = dot[2].split(".").map((s) => s.trim()).filter(Boolean);
    if (path.length === 0 && base === "Input") return { from, options: INPUT_FUNCTIONS };
    if (path.length === 0 && VECTORS.has(base)) return { from, options: AXES };
    if (path.length === 1 && VECTORS.has(path[0]) && (base === "self" || base.startsWith("$"))) return { from, options: AXES };
    if (path.length === 0) {
      const caps = receiverCapabilities(base, context);
      if (caps) return { from, options: membersFor(caps) };
    }
    return null;
  }

  // ---- A plain word.
  const word = new RegExp(`(${IDENT})$`).exec(before);
  const prefix = word?.[1] ?? "";
  const start = offset - prefix.length;
  const ahead = before.slice(0, before.length - prefix.length);
  if (!prefix && !explicit) return null;
  if (/[0-9.]$/.test(ahead) && prefix) return null; // the tail of a number like 2.5f
  if (new RegExp(String.raw`\b(?:func|var)\s+$|\bfor\s+$`).test(ahead)) return null; // naming something new
  if (/(?:\bvar\s+\w+\s*:|[(,]\s*\w+\s*:|->)\s*$/.test(ahead)) return { from: start, options: TYPES };

  const scope = scopeAt(lines, lineIndex, context.globals);
  // The script's own names first (the likeliest), then the language's.
  const options: ScriptCompletion[] = [];
  for (const [name, type] of scope.locals) options.push({ label: name, kind: "variable", detail: type || "local" });
  for (const [name, type] of scope.variables) if (!scope.locals.has(name)) options.push({ label: name, kind: "variable", detail: type });
  for (const [name, params] of scope.functions) options.push({ label: name, kind: "function", detail: `(${params.join(", ")})`, insert: `${name}()`, caretBack: params.length === 0 ? 0 : 1 });
  // Statements start a line; the function templates only at the left edge (a function inside a function is not a thing).
  if (ahead.trim() === "") options.push(...STATEMENTS.filter((o) => ahead === "" || !o.label.startsWith("func")));
  options.push(...WORDS, ...BUILTIN_FUNCTIONS);
  const caps = selfCapabilities(context);
  options.push(...membersFor(caps).map((m) => ({ ...m, detail: `${m.detail ?? ""} (this node)`.trim() })));
  return { from: start, options };
}

function nodeNames(context: ScriptSceneContext): ScriptCompletion[] {
  const seen = new Set<string>();
  const options: ScriptCompletion[] = [];
  for (const node of flattenSceneTree(context.root)) {
    if (seen.has(node.name)) continue;
    seen.add(node.name);
    const plain = new RegExp(`^${IDENT}$`).test(node.name);
    options.push({ label: plain ? `$${node.name}` : `$"${node.name}"`, kind: "class", detail: node.kind, info: `The node named ${node.name}.` });
  }
  return options.sort((x, y) => x.label.replace(/^\$"?/, "").localeCompare(y.label.replace(/^\$"?/, ""), undefined, { sensitivity: "base" }));
}
