/**
 * The syntax tree of a script (requirements/scripting/TASK.script-language-front-end.md). The parser builds it; the checker
 * annotates it (`ty` on expressions, `res` on names, members and calls) so the compiler's code generator needs no second look
 * at meaning.
 */

/** Where something is in the source: 1-based line and column, and the column just past its end (on the same line). */
export interface SourceSpan {
  line: number;
  column: number;
  endColumn: number;
}

/**
 * The types a variable, parameter or return value can have. A string holds only literal text: it can be declared,
 * reassigned (to another string literal or string variable) and compared with `==`/`!=`, but not built from pieces
 * (no `+` joining text and a number, no runtime-constructed text) -- every value a string variable can ever hold is
 * one of the string literals already in the source, known at compile time, which is what lets it compile to a plain
 * pointer to a ROM constant instead of needing mutable string storage.
 */
export type ScriptType = "int" | "float" | "bool" | "string";

/** The type of an expression: a value type, or something that only exists as the base of a member or call. */
/** `unknown` is the type of something that already has an error reported, so it causes no more errors downstream. */
export type ExprType = ScriptType | "void" | "vec3" | "node" | "unknown";

/** A node a script refers to: the node it is attached to, or another node found by name. */
export type NodeTarget = { kind: "self" } | { kind: "node"; nodeId: string; name: string };

export type NodeProp = "position" | "rotation" | "scale" | "visible" | "volume" | "pitch" | "speed_scale" | "value";
export type ButtonName = "a" | "b" | "x" | "y" | "l" | "r" | "start" | "select" | "up" | "down" | "left" | "right";

/** What a name, member access or call resolved to. Set by the checker. */
export type Resolution =
  | { kind: "local"; name: string }
  | { kind: "member"; name: string }
  /** A project-wide variable (`global var score = 0`): one copy for the whole game, kept when the scene changes. */
  | { kind: "global"; name: string }
  /** `save_game()`, `load_game()` or `has_save()`: the game's save file. */
  | { kind: "saveCall"; fn: "save_game" | "load_game" | "has_save" }
  | { kind: "function"; name: string }
  | { kind: "builtin"; name: "abs" | "min" | "max" | "clamp" | "sqrt" | "sin" | "cos" | "int" | "float" | "randi" | "randf" | "atan2" }
  | { kind: "input"; fn: "is_button_down" | "is_button_pressed" | "is_button_released"; button: ButtonName }
  | { kind: "touch"; fn: "is_touching" | "touch_x" | "touch_y" }
  /** `Input.touch_ground_x(height)` / `touch_ground_z(height)`: where the stylus points on the horizontal plane at that height (axis 0 = x, 1 = z). */
  | { kind: "touchGround"; axis: 0 | 1 }
  /** `position`, `rotation` or `scale` of a node: a vector, only ever the base of `.x` `.y` `.z`. */
  | { kind: "nodeVector"; target: NodeTarget; prop: "position" | "rotation" | "scale" }
  /** `position.x` etc. */
  | { kind: "nodeAxis"; target: NodeTarget; prop: "position" | "rotation" | "scale"; axis: 0 | 1 | 2 }
  | { kind: "nodeProp"; target: NodeTarget; prop: "visible" | "volume" | "pitch" | "speed_scale" | "value" }
  /** `$Label.text`: the text of a Label node, which a script can only set (to a string in quotes). */
  | { kind: "labelText"; target: NodeTarget }
  /** `play()`/`stop()` on an AudioStreamPlayer's own sound, or `play("name")` on one of its named clips (`clip`, its place among them). */
  | { kind: "audioCall"; target: NodeTarget; method: "play" | "stop"; clip?: number }
  /** `player.play("name")` (with the animation's place among the node's animations), `stop()` and `is_playing()` on an AnimationPlayer, or (`sprite`) an AnimatedSprite2D. */
  | { kind: "animCall"; target: NodeTarget; method: "play" | "stop" | "is_playing"; animation: number; sprite?: boolean; mesh?: boolean }
  /** `change_scene("Level2")`: switch to another scene of the project (with its place in the project's list of scenes, the starting scene first). */
  | { kind: "sceneCall"; scene: number }
  /** `a.overlaps(b)`: whether two collision shapes touch. */
  | { kind: "overlapsCall"; a: NodeTarget; b: NodeTarget }
  /** `body.move_and_collide(dx, dy, dz)`: moves a node, stopped by solid shapes. */
  | { kind: "moveCall"; target: NodeTarget }
  /** `area.is_touched()` / `is_touch_pressed()` / `is_touch_released()` on a TouchArea2D or TouchArea3D. */
  | { kind: "touchState"; target: NodeTarget; state: "held" | "pressed" | "released" }
  /** `body.probe_solid(y, x0, x1, x2)`: which of three points, in the body's own frame, are inside a solid shape (a bit mask). */
  | { kind: "probeCall"; target: NodeTarget }
  /** `body.ray_cast(ox, oy, oz, dx, dy, dz, max)`: how far along a ray to the nearest solid shape that is not under the body (a float; -1 for none). */
  | { kind: "rayCall"; target: NodeTarget }
  /** `body.is_on_floor()` etc.: what the body's last move ran into. */
  | { kind: "bodyState"; target: NodeTarget; state: "floor" | "wall" | "ceiling" }
  | { kind: "nodeRef"; target: NodeTarget };

interface ExprBase extends SourceSpan {
  /** Set by the checker. */
  ty?: ExprType;
  res?: Resolution;
}

export interface IntLiteral extends ExprBase {
  kind: "int";
  value: number;
}
export interface FloatLiteral extends ExprBase {
  kind: "float";
  /** As written. */
  value: number;
}
export interface BoolLiteral extends ExprBase {
  kind: "bool";
  value: boolean;
}
export interface StringLiteral extends ExprBase {
  kind: "string";
  value: string;
}
export interface NameExpr extends ExprBase {
  kind: "name";
  name: string;
}
/** `$Name` or `$"Name"`. */
export interface NodeRefExpr extends ExprBase {
  kind: "nodeRef";
  name: string;
  /** `global $Name`: while editing a scene made to be instanced elsewhere (a name tag, a coin), it doesn't need to be found there, since its future siblings aren't known yet.
   * It's still required for real: compiling the project checks it against wherever this scene actually ends up, and reports an error if it isn't there either. */
  isGlobal?: boolean;
}
export interface UnaryExpr extends ExprBase {
  kind: "unary";
  op: "-" | "not";
  operand: Expr;
}
export type BinaryOp = "+" | "-" | "*" | "/" | "%" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "and" | "or";
export interface BinaryExpr extends ExprBase {
  kind: "binary";
  op: BinaryOp;
  left: Expr;
  right: Expr;
}
export interface CallExpr extends ExprBase {
  kind: "call";
  callee: Expr;
  args: Expr[];
}
export interface MemberExpr extends ExprBase {
  kind: "member";
  object: Expr;
  name: string;
  /** Where the member's name is. */
  nameSpan: SourceSpan;
}
export type Expr = IntLiteral | FloatLiteral | BoolLiteral | StringLiteral | NameExpr | NodeRefExpr | UnaryExpr | BinaryExpr | CallExpr | MemberExpr;

interface StmtBase extends SourceSpan {}

export interface LocalVarStmt extends StmtBase {
  kind: "var";
  name: string;
  nameSpan: SourceSpan;
  declaredType?: ScriptType;
  init: Expr;
  /** The variable's type, set by the checker. */
  ty?: ScriptType;
}
export type AssignOp = "=" | "+=" | "-=" | "*=" | "/=" | "%=";
export interface AssignStmt extends StmtBase {
  kind: "assign";
  op: AssignOp;
  target: Expr;
  value: Expr;
}
export interface IfStmt extends StmtBase {
  kind: "if";
  /** `if` and each `elif`, in order. */
  branches: Array<{ condition: Expr; body: Stmt[] }>;
  elseBody?: Stmt[];
}
export interface WhileStmt extends StmtBase {
  kind: "while";
  condition: Expr;
  body: Stmt[];
}
export interface ForStmt extends StmtBase {
  kind: "for";
  variable: string;
  variableSpan: SourceSpan;
  /** `range(n)` is start 0; `range(a, b)` has both. */
  start?: Expr;
  end: Expr;
  body: Stmt[];
}
export interface BreakStmt extends StmtBase {
  kind: "break";
}
export interface ContinueStmt extends StmtBase {
  kind: "continue";
}
export interface PassStmt extends StmtBase {
  kind: "pass";
}
export interface ReturnStmt extends StmtBase {
  kind: "return";
  value?: Expr;
}
export interface ExprStmt extends StmtBase {
  kind: "expr";
  expr: Expr;
}
export type Stmt = LocalVarStmt | AssignStmt | IfStmt | WhileStmt | ForStmt | BreakStmt | ContinueStmt | PassStmt | ReturnStmt | ExprStmt;

export interface Param extends SourceSpan {
  name: string;
  declaredType?: ScriptType;
}

export interface FuncDecl extends SourceSpan {
  name: string;
  nameSpan: SourceSpan;
  params: Param[];
  returnType: ScriptType | "void";
  body: Stmt[];
}

export interface VarDecl extends SourceSpan {
  /** `global var x = 0`: shared by every script and kept across scenes. */
  global?: boolean;
  name: string;
  nameSpan: SourceSpan;
  declaredType?: ScriptType;
  init: Expr;
  /** The variable's type, set by the checker. */
  ty?: ScriptType;
}

export interface ScriptProgram {
  variables: VarDecl[];
  functions: FuncDecl[];
}
