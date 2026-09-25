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

/** The types a variable, parameter or return value can have. */
export type ScriptType = "int" | "float" | "bool";

/** The type of an expression: a value type, or something that only exists as the base of a member or call. */
/** `unknown` is the type of something that already has an error reported, so it causes no more errors downstream. */
export type ExprType = ScriptType | "void" | "string" | "vec3" | "node" | "unknown";

/** A node a script refers to: the node it is attached to, or another node found by name. */
export type NodeTarget = { kind: "self" } | { kind: "node"; nodeId: string; name: string };

export type NodeProp = "position" | "rotation" | "scale" | "visible" | "volume" | "pitch" | "speed_scale";
export type ButtonName = "a" | "b" | "x" | "y" | "l" | "r" | "start" | "select" | "up" | "down" | "left" | "right";

/** What a name, member access or call resolved to. Set by the checker. */
export type Resolution =
  | { kind: "local"; name: string }
  | { kind: "member"; name: string }
  | { kind: "function"; name: string }
  | { kind: "builtin"; name: "abs" | "min" | "max" | "clamp" | "sqrt" | "sin" | "cos" | "int" | "float" }
  | { kind: "input"; fn: "is_button_down" | "is_button_pressed" | "is_button_released"; button: ButtonName }
  | { kind: "touch"; fn: "is_touching" | "touch_x" | "touch_y" }
  /** `position`, `rotation` or `scale` of a node: a vector, only ever the base of `.x` `.y` `.z`. */
  | { kind: "nodeVector"; target: NodeTarget; prop: "position" | "rotation" | "scale" }
  /** `position.x` etc. */
  | { kind: "nodeAxis"; target: NodeTarget; prop: "position" | "rotation" | "scale"; axis: 0 | 1 | 2 }
  | { kind: "nodeProp"; target: NodeTarget; prop: "visible" | "volume" | "pitch" | "speed_scale" }
  | { kind: "audioCall"; target: NodeTarget; method: "play" | "stop" }
  /** `player.play("name")` (with the animation's place among the player's animations), `stop()` and `is_playing()` on an AnimationPlayer. */
  | { kind: "animCall"; target: NodeTarget; method: "play" | "stop" | "is_playing"; animation: number }
  /** `a.overlaps(b)`: whether two collision shapes touch. */
  | { kind: "overlapsCall"; a: NodeTarget; b: NodeTarget }
  /** `body.move_and_collide(dx, dy, dz)`: moves a node, stopped by solid shapes. */
  | { kind: "moveCall"; target: NodeTarget }
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
