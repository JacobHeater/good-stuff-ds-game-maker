import { getAnimationPlayer } from "../animation";
import { flattenSceneTree, is3DNodeKind, type SceneNode, type SceneNodeKind } from "../scene-node";
import type {
  AssignStmt,
  ButtonName,
  Expr,
  ExprType,
  FuncDecl,
  MemberExpr,
  NodeProp,
  NodeTarget,
  ScriptProgram,
  ScriptType,
  SourceSpan,
  Stmt,
  VarDecl
} from "./ast";
import type { ScriptDiagnostic } from "./lexer";
import { parseScript } from "./parser";

/** A DS `float` is 20.12 fixed point: this is the largest whole number it can hold. */
export const MAX_SCRIPT_FLOAT = 524287;
export const MAX_SCRIPT_INT = 2147483647;

export const BUTTON_NAMES: readonly ButtonName[] = ["a", "b", "x", "y", "l", "r", "start", "select", "up", "down", "left", "right"];

/** Names that mean something built in, so a script's own variables and functions can't use them. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "abs", "min", "max", "clamp", "sqrt", "sin", "cos", "int", "float", "bool", "void",
  "Input", "self", "position", "rotation", "scale", "visible", "volume", "pitch", "play", "stop", "is_playing", "speed_scale", "overlaps", "move_and_collide", "is_on_floor", "is_on_wall", "is_on_ceiling", "delta"
]);

/** What the checker needs to know about the project the script lives in. */
export interface ScriptSceneContext {
  /** The scene tree, to find the nodes `$Name` refers to. */
  root: SceneNode;
  /** The nodes the script is attached to; empty when it isn't attached yet, in which case `self` may use every member. */
  attached: ReadonlyArray<{
    name: string;
    kind: SceneNodeKind;
    /** Whether a collision shape is under it (or it is one); left out when not known. */
    hasShape?: boolean;
    /** The names of an AnimationPlayer's animations, in order; left out when not known. */
    animations?: readonly string[];
  }>;
}

/** What a script does that the compiler needs to know before it generates anything. */
export interface ScriptUsage {
  /** Ids of the nodes named with `$Name`. */
  referencedNodeIds: Set<string>;
  /** The script writes its own node's position, rotation or scale / visibility, or calls `play()` on it. */
  selfWritesTransform: boolean;
  selfWritesVisible: boolean;
  selfCallsPlay: boolean;
  /** Ids of other nodes it writes or plays. */
  nodeWritesTransform: Set<string>;
  nodeWritesVisible: Set<string>;
  nodeCallsPlay: Set<string>;
  /** The script calls `overlaps()` on its own node, or names it as the other node. */
  selfOverlaps: boolean;
  /** Ids of the other nodes named in `overlaps()`. */
  nodeOverlaps: Set<string>;
  /** The script calls `move_and_collide()` on its own node, and on which other nodes (by id). */
  selfMoves: boolean;
  nodeMoves: Set<string>;
  /** The script calls `play("name")` on its own node (an AnimationPlayer), and on which other nodes (by id). */
  selfPlaysAnimation: boolean;
  nodePlaysAnimation: Set<string>;
}

export interface ScriptCheckResult {
  /** True when there are no errors (warnings are allowed): the script can be compiled. */
  ok: boolean;
  diagnostics: ScriptDiagnostic[];
  /** The syntax tree, annotated with types and what each name means. Only complete and consistent when `ok`. */
  program: ScriptProgram;
  usage: ScriptUsage;
}

interface Signature {
  params: ScriptType[];
  returns: ScriptType | "void";
  decl: FuncDecl;
}

interface LocalInfo {
  type: ScriptType;
  span: SourceSpan;
  used: boolean;
  /** Loop variables aren't reported as unused. */
  quiet: boolean;
}

const an = (type: string): string => (type === "int" ? "an int" : `a ${type}`);
const isNumeric = (type: ExprType | undefined): type is "int" | "float" => type === "int" || type === "float";

/**
 * Checks a script: syntax, then types and meanings, against the scene it will run in. Never throws. See
 * requirements/scripting/TASK.script-language-front-end.md for the language it implements.
 */
export function checkScript(source: string, context: ScriptSceneContext): ScriptCheckResult {
  const parsed = parseScript(source);
  const usage: ScriptUsage = {
    referencedNodeIds: new Set(),
    selfWritesTransform: false,
    selfWritesVisible: false,
    selfCallsPlay: false,
    nodeWritesTransform: new Set(),
    nodeWritesVisible: new Set(),
    nodeCallsPlay: new Set(),
    selfOverlaps: false,
    nodeOverlaps: new Set(),
    selfMoves: false,
    nodeMoves: new Set(),
    selfPlaysAnimation: false,
    nodePlaysAnimation: new Set()
  };
  // With syntax errors the tree is missing pieces, and checking it would report a cascade of names that "don't exist".
  if (parsed.diagnostics.length > 0) {
    return { ok: false, diagnostics: sortDiagnostics(parsed.diagnostics), program: parsed.program, usage };
  }
  const checker = new Checker(parsed.program, context, usage);
  checker.run();
  const diagnostics = sortDiagnostics(checker.diagnostics);
  return { ok: !diagnostics.some((d) => d.severity === "error"), diagnostics, program: parsed.program, usage };
}

function sortDiagnostics(diagnostics: ScriptDiagnostic[]): ScriptDiagnostic[] {
  return [...diagnostics].sort((a, b) => a.line - b.line || a.column - b.column);
}

class Checker {
  readonly diagnostics: ScriptDiagnostic[] = [];
  private readonly members = new Map<string, VarDecl>();
  private readonly functions = new Map<string, Signature>();
  private scopes: Array<Map<string, LocalInfo>> = [];
  private current: FuncDecl | null = null;
  private loopDepth = 0;
  private readonly nodesByName = new Map<string, SceneNode[]>();

  constructor(
    private readonly program: ScriptProgram,
    private readonly context: ScriptSceneContext,
    private readonly usage: ScriptUsage
  ) {
    for (const node of flattenSceneTree(context.root)) {
      const list = this.nodesByName.get(node.name) ?? [];
      list.push(node);
      this.nodesByName.set(node.name, list);
    }
  }

  private error(span: SourceSpan, message: string): void {
    this.diagnostics.push({ severity: "error", message, line: span.line, column: span.column, endColumn: span.endColumn });
  }

  private warn(span: SourceSpan, message: string): void {
    this.diagnostics.push({ severity: "warning", message, line: span.line, column: span.column, endColumn: span.endColumn });
  }

  run(): void {
    // Variables.
    for (const variable of this.program.variables) {
      if (this.members.has(variable.name)) this.error(variable.nameSpan, `"${variable.name}" is already declared in this script.`);
      else if (RESERVED_NAMES.has(variable.name)) this.error(variable.nameSpan, `"${variable.name}" is a built-in name and can't be used for a variable.`);
      else this.members.set(variable.name, variable);
    }
    // Function signatures first, so functions can call each other in any order.
    for (const func of this.program.functions) this.declareFunction(func);
    for (const variable of this.program.variables) this.checkMemberInit(variable);
    for (const func of this.program.functions) this.checkFunction(func);
  }

  // ---- Declarations

  private declareFunction(func: FuncDecl): void {
    const params: ScriptType[] = [];
    const isProcess = func.name === "_process";
    const isReady = func.name === "_ready";
    if (this.functions.has(func.name)) this.error(func.nameSpan, `"${func.name}" is already declared in this script.`);
    else if (this.members.has(func.name)) this.error(func.nameSpan, `"${func.name}" is already used by a variable.`);
    else if (RESERVED_NAMES.has(func.name)) this.error(func.nameSpan, `"${func.name}" is a built-in name and can't be used for a function.`);

    if (isReady && func.params.length !== 0) this.error(func.nameSpan, "_ready() takes no parameters.");
    if (isProcess && func.params.length !== 1) this.error(func.nameSpan, "_process must be written _process(delta): it takes one parameter, the seconds since the last frame.");
    if ((isReady || isProcess) && func.returnType !== "void") this.error(func.nameSpan, `${func.name} can't return a value.`);

    const seen = new Set<string>();
    func.params.forEach((param, index) => {
      if (seen.has(param.name)) this.error(param, `The parameter "${param.name}" is declared twice.`);
      seen.add(param.name);
      if (RESERVED_NAMES.has(param.name) && !(isProcess && param.name === "delta")) this.error(param, `"${param.name}" is a built-in name and can't be used for a parameter.`);
      if (isProcess && index === 0) {
        if (param.declaredType !== undefined && param.declaredType !== "float") this.error(param, "The parameter of _process is a float (seconds).");
        params.push("float");
      } else {
        if (param.declaredType === undefined) this.error(param, `The parameter "${param.name}" needs a type, like ${param.name}: int.`);
        params.push(param.declaredType ?? "int");
      }
    });
    if (!this.functions.has(func.name)) this.functions.set(func.name, { params, returns: func.returnType, decl: func });
  }

  private checkMemberInit(variable: VarDecl): void {
    // (Not `!literal`: 0 and false are literals too.)
    if (this.literalValue(variable.init) === null) {
      this.error(variable.init, "A variable's initial value must be a number or true or false, like var speed = 2.0.");
      variable.ty = variable.declaredType ?? "int";
      return;
    }
    const type = this.typeOfExpr(variable.init);
    variable.ty = this.resolveVarType(variable.declaredType, type, variable.init);
  }

  /** The value of a plain literal (a number, optionally negated, or a bool), or null when the expression is anything else. */
  private literalValue(expr: Expr): number | boolean | null {
    if (expr.kind === "int" || expr.kind === "float" || expr.kind === "bool") return expr.value;
    if (expr.kind === "unary" && expr.op === "-" && (expr.operand.kind === "int" || expr.operand.kind === "float")) return -expr.operand.value;
    return null;
  }

  private resolveVarType(declared: ScriptType | undefined, actual: ExprType, at: SourceSpan): ScriptType {
    const valueType = this.asValue(actual, at);
    if (declared === undefined) return valueType ?? "int";
    if (valueType !== null) this.requireAssignable(valueType, declared, at);
    return declared;
  }

  private checkFunction(func: FuncDecl): void {
    this.current = func;
    this.loopDepth = 0;
    const scope = new Map<string, LocalInfo>();
    const signature = this.functions.get(func.name);
    func.params.forEach((param, index) => {
      if (!scope.has(param.name)) scope.set(param.name, { type: signature?.params[index] ?? "int", span: param, used: true, quiet: true });
    });
    for (const param of func.params) {
      if (this.members.has(param.name) || this.functions.has(param.name)) {
        this.error(param, `"${param.name}" is already declared; choose another name for the parameter.`);
      }
    }
    this.scopes = [scope];
    this.checkBlock(func.body, true);
    this.closeScope();
    if (func.returnType !== "void" && !this.alwaysReturns(func.body)) {
      this.error(func.nameSpan, `The function "${func.name}" must return a value on every path.`);
    }
    this.current = null;
    this.scopes = [];
  }

  private alwaysReturns(body: Stmt[]): boolean {
    for (const statement of body) {
      if (statement.kind === "return") return true;
      if (statement.kind === "if" && statement.elseBody && statement.branches.every((b) => this.alwaysReturns(b.body)) && this.alwaysReturns(statement.elseBody)) return true;
    }
    return false;
  }

  // ---- Statements

  private checkBlock(body: Stmt[], reuseScope = false): void {
    if (!reuseScope) this.scopes.push(new Map());
    let terminated = false;
    let reported = false;
    for (const statement of body) {
      if (terminated && !reported) {
        this.warn(statement, "This code can never run, because the line above always leaves this block.");
        reported = true;
      }
      this.checkStatement(statement);
      if (statement.kind === "return" || statement.kind === "break" || statement.kind === "continue") terminated = true;
    }
    if (!reuseScope) this.closeScope();
  }

  private closeScope(): void {
    const scope = this.scopes.pop();
    if (!scope) return;
    for (const [name, info] of scope) {
      if (!info.used && !info.quiet) this.warn(info.span, `The variable "${name}" is never used.`);
    }
  }

  private declareLocal(name: string, span: SourceSpan, type: ScriptType, quiet = false): void {
    if (RESERVED_NAMES.has(name)) {
      this.error(span, `"${name}" is a built-in name and can't be used for a variable.`);
      return;
    }
    if (this.members.has(name) || this.functions.has(name) || this.lookupLocal(name)) {
      this.error(span, `"${name}" is already declared; choose another name.`);
      return;
    }
    this.scopes[this.scopes.length - 1].set(name, { type, span, used: false, quiet });
  }

  private lookupLocal(name: string): LocalInfo | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const info = this.scopes[i].get(name);
      if (info) return info;
    }
    return undefined;
  }

  private checkStatement(statement: Stmt): void {
    switch (statement.kind) {
      case "var": {
        const type = this.typeOfExpr(statement.init);
        statement.ty = this.resolveVarType(statement.declaredType, type, statement.init);
        this.declareLocal(statement.name, statement.nameSpan, statement.ty);
        return;
      }
      case "assign":
        this.checkAssign(statement);
        return;
      case "if":
        for (const branch of statement.branches) {
          this.requireBool(branch.condition);
          this.checkBlock(branch.body);
        }
        if (statement.elseBody) this.checkBlock(statement.elseBody);
        return;
      case "while":
        this.requireBool(statement.condition);
        this.loopDepth++;
        this.checkBlock(statement.body);
        this.loopDepth--;
        return;
      case "for": {
        if (statement.start) this.requireInt(statement.start, "range");
        this.requireInt(statement.end, "range");
        this.scopes.push(new Map());
        this.declareLocal(statement.variable, statement.variableSpan, "int", true);
        this.loopDepth++;
        this.checkBlock(statement.body, true);
        this.loopDepth--;
        this.closeScope();
        return;
      }
      case "break":
      case "continue":
        if (this.loopDepth === 0) this.error(statement, `"${statement.kind}" can only be used inside a "while" or "for" loop.`);
        return;
      case "pass":
        return;
      case "return":
        this.checkReturn(statement);
        return;
      case "expr":
        if (statement.expr.kind !== "call") {
          this.typeOfExpr(statement.expr);
          this.error(statement.expr, "This doesn't do anything. A line must be an assignment or a call.");
        } else {
          this.typeOfExpr(statement.expr);
        }
        return;
    }
  }

  private checkReturn(statement: Extract<Stmt, { kind: "return" }>): void {
    const returns = this.current?.returnType ?? "void";
    if (statement.value === undefined) {
      if (returns !== "void") this.error(statement, `This function returns a ${returns}, so "return" needs a value.`);
      return;
    }
    const type = this.typeOfExpr(statement.value);
    if (returns === "void") {
      this.error(statement.value, "This function doesn't return a value; declare one with -> int, -> float or -> bool.");
      return;
    }
    const valueType = this.asValue(type, statement.value);
    if (valueType !== null) this.requireAssignable(valueType, returns, statement.value);
  }

  private checkAssign(statement: AssignStmt): void {
    const targetType = this.typeOfExpr(statement.target);
    const lvalue = this.assignableType(statement.target);
    const valueType = this.typeOfExpr(statement.value);
    if (lvalue === null) return;
    const value = this.asValue(valueType, statement.value);
    if (value === null) return;
    let result: ScriptType = value;
    if (statement.op !== "=") {
      if (!isNumeric(lvalue)) {
        this.error(statement, `"${statement.op}" only works on numbers, not a bool.`);
        return;
      }
      const combined = this.arithmeticType(statement.op[0] as "+" | "-" | "*" | "/" | "%", lvalue, value, statement);
      if (combined === null) return;
      result = combined;
    }
    this.requireAssignable(result, lvalue, statement.value);
    void targetType;
  }

  /** The type of what can be assigned to `target`, or null after reporting that it can't be assigned to. */
  private assignableType(target: Expr): ScriptType | null {
    if (target.kind === "name") {
      if (target.res?.kind === "local" || target.res?.kind === "member") return target.ty as ScriptType;
      if (target.res?.kind === "nodeProp" && target.ty !== undefined) {
        this.noteWrite(target.res.target, target.res.prop);
        return target.ty as ScriptType;
      }
    }
    if (target.kind === "member" && target.res) {
      if (target.res.kind === "nodeAxis") {
        this.noteWrite(target.res.target, target.res.prop);
        return "float";
      }
      if (target.res.kind === "nodeProp") {
        this.noteWrite(target.res.target, target.res.prop);
        return target.ty as ScriptType;
      }
    }
    if (target.ty !== undefined && target.ty !== "unknown") {
      this.error(target, target.ty === "vec3" ? "A whole vector can't be assigned in this version; assign .x, .y and .z one at a time." : "You can't assign to this.");
    }
    return null;
  }

  private noteWrite(target: NodeTarget, prop: NodeProp): void {
    const transform = prop === "position" || prop === "rotation" || prop === "scale";
    if (target.kind === "self") {
      if (transform) this.usage.selfWritesTransform = true;
      if (prop === "visible") this.usage.selfWritesVisible = true;
    } else {
      if (transform) this.usage.nodeWritesTransform.add(target.nodeId);
      if (prop === "visible") this.usage.nodeWritesVisible.add(target.nodeId);
    }
  }

  // ---- Type rules

  private requireBool(expr: Expr): void {
    const type = this.typeOfExpr(expr);
    const value = this.asValue(type, expr);
    if (value !== null && value !== "bool") {
      this.error(expr, `The condition must be true or false (a bool), not ${an(value)}; compare it, like x != 0.`);
    }
  }

  private requireInt(expr: Expr, what: string): void {
    const type = this.typeOfExpr(expr);
    const value = this.asValue(type, expr);
    if (value === "float") this.error(expr, `${what}() counts whole numbers; use int(x) to drop the fraction.`);
    else if (value === "bool") this.error(expr, `${what}() needs an int, not a bool.`);
  }

  /** `type` as a value type, or null after reporting that it isn't one (a vector, a node, a string, or nothing). */
  private asValue(type: ExprType, at: SourceSpan): ScriptType | null {
    switch (type) {
      case "int":
      case "float":
      case "bool":
        return type;
      case "void":
        this.error(at, "This call doesn't give a value.");
        return null;
      case "vec3":
        this.error(at, "A vector can't be used as a value in this version; use .x, .y or .z.");
        return null;
      case "node":
        this.error(at, "A node can't be used as a value in this version; use one of its members, like .position.x.");
        return null;
      case "string":
        this.error(at, "A string can't be used as a value; it only names a button in Input.is_button_down(\"a\").");
        return null;
      case "unknown":
        return null;
    }
  }

  private requireAssignable(from: ScriptType, to: ScriptType, at: SourceSpan): void {
    if (from === to) return;
    if (from === "int" && to === "float") return;
    if (from === "float" && to === "int") {
      this.error(at, "A float can't go into an int without losing its fraction; use int(x).");
    } else if (from === "bool" || to === "bool") {
      this.error(at, `${an(from)[0].toUpperCase()}${an(from).slice(1)} can't be used as ${an(to)}.`);
    }
  }

  /** The type of `left op right` for + - * / %, or null (after reporting) when it isn't allowed. */
  private arithmeticType(op: "+" | "-" | "*" | "/" | "%", left: ScriptType, right: ScriptType, at: SourceSpan): ScriptType | null {
    if (!isNumeric(left) || !isNumeric(right)) {
      this.error(at, `"${op}" needs numbers, but ${left === "bool" ? "the left side" : "the right side"} is a bool.`);
      return null;
    }
    if (op === "%") {
      if (left !== "int" || right !== "int") {
        this.error(at, '"%" only works on ints; use int(x) first.');
        return null;
      }
      return "int";
    }
    return left === "int" && right === "int" ? "int" : "float";
  }

  // ---- Expressions

  /** Checks `expr` and returns its type (also stored on the node). Errors are reported; the type is then a best guess. */
  private typeOfExpr(expr: Expr): ExprType {
    const type = this.computeType(expr);
    expr.ty = type;
    return type;
  }

  private computeType(expr: Expr): ExprType {
    switch (expr.kind) {
      case "int":
        if (expr.value > MAX_SCRIPT_INT) this.error(expr, `This number is too big for an int (the most is ${MAX_SCRIPT_INT}).`);
        return "int";
      case "float":
        if (expr.value > MAX_SCRIPT_FLOAT) this.error(expr, `This number is too big for the DS's float (the most is about ${MAX_SCRIPT_FLOAT}).`);
        return "float";
      case "bool":
        return "bool";
      case "string":
        return "string";
      case "nodeRef": {
        const target = this.resolveNodeRef(expr.name, expr);
        if (!target) return "unknown";
        expr.res = { kind: "nodeRef", target };
        return "node";
      }
      case "name":
        return this.computeName(expr);
      case "unary": {
        const operand = this.asValue(this.typeOfExpr(expr.operand), expr.operand);
        if (operand === null) return expr.op === "not" ? "bool" : "int";
        if (expr.op === "not") {
          if (operand !== "bool") this.error(expr, `"not" needs a bool, not ${operand === "int" ? "an int" : "a float"}.`);
          return "bool";
        }
        if (operand === "bool") {
          this.error(expr, '"-" needs a number, not a bool.');
          return "int";
        }
        return operand;
      }
      case "binary":
        return this.computeBinary(expr);
      case "call":
        return this.computeCall(expr);
      case "member":
        return this.computeMember(expr);
    }
  }

  private computeBinary(expr: Extract<Expr, { kind: "binary" }>): ExprType {
    const leftType = this.typeOfExpr(expr.left);
    const rightType = this.typeOfExpr(expr.right);
    const left = this.asValue(leftType, expr.left);
    const right = this.asValue(rightType, expr.right);
    const op = expr.op;
    const resultGuess: ExprType = ["<", "<=", ">", ">=", "==", "!=", "and", "or"].includes(op) ? "bool" : "int";
    if (left === null || right === null) return resultGuess;
    if (op === "and" || op === "or") {
      if (left !== "bool" || right !== "bool") this.error(expr, `"${op}" needs bools on both sides.`);
      return "bool";
    }
    if (op === "==" || op === "!=") {
      if ((left === "bool") !== (right === "bool")) this.error(expr, `A bool can't be compared with a ${left === "bool" ? right : left}.`);
      return "bool";
    }
    if (op === "<" || op === "<=" || op === ">" || op === ">=") {
      if (left === "bool" || right === "bool") this.error(expr, `"${op}" compares numbers, not bools.`);
      return "bool";
    }
    return this.arithmeticType(op, left, right, expr) ?? "int";
  }

  private computeName(expr: Extract<Expr, { kind: "name" }>): ExprType {
    const local = this.lookupLocal(expr.name);
    if (local) {
      local.used = true;
      expr.res = { kind: "local", name: expr.name };
      return local.type;
    }
    const member = this.members.get(expr.name);
    if (member) {
      expr.res = { kind: "member", name: expr.name };
      return member.ty ?? member.declaredType ?? "int";
    }
    if (expr.name === "self") {
      expr.res = { kind: "nodeRef", target: { kind: "self" } };
      return "node";
    }
    if (expr.name === "position" || expr.name === "rotation" || expr.name === "scale") {
      if (!this.selfSupports("transform", expr.name, expr)) return "unknown";
      expr.res = { kind: "nodeVector", target: { kind: "self" }, prop: expr.name };
      return "vec3";
    }
    if (expr.name === "visible") {
      if (!this.selfSupports("transform", "visible", expr)) return "unknown";
      expr.res = { kind: "nodeProp", target: { kind: "self" }, prop: "visible" };
      return "bool";
    }
    if (expr.name === "speed_scale") {
      if (!this.selfSupports("animation", "speed_scale", expr)) return "unknown";
      expr.res = { kind: "nodeProp", target: { kind: "self" }, prop: "speed_scale" };
      return "float";
    }
    if (expr.name === "volume" || expr.name === "pitch") {
      if (!this.selfSupports("audio", expr.name, expr)) return "unknown";
      expr.res = { kind: "nodeProp", target: { kind: "self" }, prop: expr.name };
      return "float";
    }
    if (expr.name === "Input") {
      this.error(expr, 'Input has functions, not values: use Input.is_button_down("a"), for example.');
      return "unknown";
    }
    if (this.functions.has(expr.name) || RESERVED_NAMES.has(expr.name)) {
      this.error(expr, `"${expr.name}" is a function; call it with parentheses, like ${expr.name}().`);
      return "unknown";
    }
    this.error(expr, `Unknown name "${expr.name}".`);
    return "unknown";
  }

  /** Resolves `$Name` against the scene; reports a missing or ambiguous name. */
  private resolveNodeRef(name: string, at: SourceSpan): NodeTarget | null {
    const nodes = this.nodesByName.get(name) ?? [];
    if (nodes.length === 0) {
      this.error(at, `There is no node named "${name}" in the scene.`);
      return null;
    }
    if (nodes.length > 1) {
      this.error(at, `${nodes.length} nodes are named "${name}", so $${name} could mean any of them; rename all but one.`);
      return null;
    }
    this.usage.referencedNodeIds.add(nodes[0].id);
    return { kind: "node", nodeId: nodes[0].id, name };
  }

  private kindOf(target: NodeTarget): SceneNodeKind | null {
    if (target.kind === "self") return null;
    return flattenSceneTree(this.context.root).find((node) => node.id === target.nodeId)?.kind ?? null;
  }

  /** Whether `self` can use a member needing `capability`; reports (naming the node kind that can't) when it can't. */
  private selfSupports(capability: "transform" | "audio" | "collision" | "animation", member: string, at: SourceSpan): boolean {
    for (const attached of this.context.attached) {
      if (!this.kindSupports(attached.kind, capability)) {
        this.error(at, `"${member}" isn't available on ${attached.name} (a ${attached.kind}), and this script is attached to it.`);
        return false;
      }
    }
    return true;
  }

  private kindSupports(kind: SceneNodeKind, capability: "transform" | "audio" | "collision" | "animation"): boolean {
    if (capability === "collision") return kind === "CollisionShape3D";
    if (capability === "animation") return kind === "AnimationPlayer";
    return capability === "transform" ? is3DNodeKind(kind) : kind === "AudioStreamPlayer";
  }

  private nodeSupports(target: NodeTarget, capability: "transform" | "audio" | "collision" | "animation", member: string, at: SourceSpan): boolean {
    if (target.kind === "self") return this.selfSupports(capability, member, at);
    const kind = this.kindOf(target);
    if (kind === null || this.kindSupports(kind, capability)) return true;
    this.error(at, `$${target.name} is a ${kind}, which has no "${member}".`);
    return false;
  }

  private computeMember(expr: MemberExpr): ExprType {
    const object = expr.object;
    if (object.kind === "name" && object.name === "Input" && !this.lookupLocal("Input")) {
      this.error(expr, `Input.${expr.name} must be called: Input.${expr.name}(...).`);
      return "unknown";
    }
    const baseType = this.typeOfExpr(object);
    if (baseType === "unknown") return "unknown";
    if (baseType === "vec3" && object.res && object.res.kind === "nodeVector") {
      const axis = ["x", "y", "z"].indexOf(expr.name);
      if (axis < 0) {
        this.error(expr.nameSpan, `A vector has .x, .y and .z, not .${expr.name}.`);
        return "unknown";
      }
      expr.res = { kind: "nodeAxis", target: object.res.target, prop: object.res.prop, axis: axis as 0 | 1 | 2 };
      return "float";
    }
    if (baseType === "node" && object.res && object.res.kind === "nodeRef") {
      const target = object.res.target;
      switch (expr.name) {
        case "position":
        case "rotation":
        case "scale":
          if (!this.nodeSupports(target, "transform", expr.name, expr.nameSpan)) return "unknown";
          expr.res = { kind: "nodeVector", target, prop: expr.name };
          return "vec3";
        case "visible":
          if (!this.nodeSupports(target, "transform", expr.name, expr.nameSpan)) return "unknown";
          expr.res = { kind: "nodeProp", target, prop: "visible" };
          return "bool";
        case "volume":
        case "pitch":
          if (!this.nodeSupports(target, "audio", expr.name, expr.nameSpan)) return "unknown";
          expr.res = { kind: "nodeProp", target, prop: expr.name };
          return "float";
        case "speed_scale":
          if (!this.nodeSupports(target, "animation", expr.name, expr.nameSpan)) return "unknown";
          expr.res = { kind: "nodeProp", target, prop: "speed_scale" };
          return "float";
        case "is_playing":
          this.error(expr.nameSpan, "is_playing must be called: is_playing().");
          return "unknown";
        case "overlaps":
          this.error(expr.nameSpan, "overlaps must be called with the other shape: overlaps($Other).");
          return "unknown";
        case "move_and_collide":
        case "is_on_floor":
        case "is_on_wall":
        case "is_on_ceiling":
          this.error(expr.nameSpan, `${expr.name} must be called: ${expr.name === "move_and_collide" ? "move_and_collide(dx, dy, dz)" : `${expr.name}()`}.`);
          return "unknown";
        default:
          this.error(expr.nameSpan, `A node has no member "${expr.name}"; it has position, rotation, scale, visible, and (sound players) volume, pitch, play() and stop(), (collision shapes) overlaps(other), and (bodies) move_and_collide(dx, dy, dz), is_on_floor(), is_on_wall() and is_on_ceiling(), and (animation players) play("name"), stop(), is_playing() and speed_scale.`);
          return "unknown";
      }
    }
    if (baseType !== "vec3" && baseType !== "node") this.asValue(baseType, object);
    else this.error(expr.nameSpan, `Can't take .${expr.name} of this.`);
    return "unknown";
  }

  private computeCall(expr: Extract<Expr, { kind: "call" }>): ExprType {
    const callee = expr.callee;
    if (callee.kind === "name") return this.callNamed(expr, callee.name);
    if (callee.kind === "member") {
      const object = callee.object;
      if (object.kind === "name" && object.name === "Input" && !this.lookupLocal("Input")) return this.callInput(expr, callee.name, callee.nameSpan);
      const baseType = this.typeOfExpr(object);
      if (baseType === "unknown") {
        for (const arg of expr.args) this.typeOfExpr(arg);
        return "unknown";
      }
      if (baseType === "node" && object.res && object.res.kind === "nodeRef") {
        if (callee.name === "play" || callee.name === "stop") return this.checkPlayOrStop(expr, callee.name, object.res.target, callee.nameSpan);
        if (callee.name === "is_playing") return this.checkAnimationCall(expr, "is_playing", object.res.target, callee.nameSpan);
        if (callee.name === "overlaps") return this.checkOverlaps(expr, object.res.target, callee.nameSpan);
        if (callee.name === "move_and_collide" || callee.name === "is_on_floor" || callee.name === "is_on_wall" || callee.name === "is_on_ceiling") {
          return this.checkBodyCall(expr, callee.name, object.res.target, callee.nameSpan);
        }
        this.error(callee.nameSpan, `A node has no function "${callee.name}"; sound players have play() and stop(), collision shapes have overlaps(other), bodies have move_and_collide(dx, dy, dz), is_on_floor(), is_on_wall() and is_on_ceiling(), and animation players have play("name"), stop() and is_playing().`);
        return "unknown";
      }
      this.error(callee, "This can't be called.");
      return "unknown";
    }
    this.error(callee, "This can't be called.");
    return "unknown";
  }

  /**
   * `a.overlaps(b)` (or `overlaps(b)` for `self`): both sides must be nodes with a collision shape. The result is a bool even when something is
   * wrong, so one mistake doesn't cascade into more.
   */
  private checkOverlaps(expr: Extract<Expr, { kind: "call" }>, a: NodeTarget, nameSpan: SourceSpan): ExprType {
    if (expr.args.length !== 1) {
      this.checkArgCount(expr, 1, "overlaps()");
      for (const arg of expr.args) this.typeOfExpr(arg);
      return "bool";
    }
    const arg = expr.args[0];
    const argType = this.typeOfExpr(arg);
    if (argType === "unknown") return "bool";
    if (argType !== "node" || arg.res?.kind !== "nodeRef") {
      this.error(arg, "overlaps() needs the other shape's node, like overlaps($Coin) or $Player.overlaps($Coin).");
      return "bool";
    }
    const b = arg.res.target;
    const okA = this.requireShape(a, nameSpan);
    const okB = okA && this.requireShape(b, arg);
    if (okA && okB) {
      expr.res = { kind: "overlapsCall", a, b };
      for (const target of [a, b]) {
        if (target.kind === "self") this.usage.selfOverlaps = true;
        else this.usage.nodeOverlaps.add(target.nodeId);
      }
    }
    return "bool";
  }

  /**
   * `body.move_and_collide(dx, dy, dz)` and `body.is_on_floor()` / `is_on_wall()` / `is_on_ceiling()`: the body is a 3D node with a collision shape under it
   * (or that is one). move_and_collide moves the node, so it counts as a script that writes the node's position.
   */
  private checkBodyCall(expr: Extract<Expr, { kind: "call" }>, name: string, target: NodeTarget, nameSpan: SourceSpan): ExprType {
    const moving = name === "move_and_collide";
    if (moving) {
      if (expr.args.length !== 3) {
        this.checkArgCount(expr, 3, "move_and_collide()");
        for (const arg of expr.args) this.typeOfExpr(arg);
      } else {
        for (const arg of expr.args) {
          const value = this.asValue(this.typeOfExpr(arg), arg);
          if (value === "bool") this.error(arg, "move_and_collide() needs numbers for how far to move on X, Y and Z, not a bool.");
        }
      }
    } else {
      this.checkArgCount(expr, 0, `${name}()`);
    }
    if (this.nodeSupports(target, "transform", name, nameSpan) && this.requireBody(target, name, nameSpan)) {
      expr.res = moving ? { kind: "moveCall", target } : { kind: "bodyState", target, state: name === "is_on_floor" ? "floor" : name === "is_on_wall" ? "wall" : "ceiling" };
      if (moving) {
        if (target.kind === "self") {
          this.usage.selfMoves = true;
          this.usage.selfWritesTransform = true;
        } else {
          this.usage.nodeMoves.add(target.nodeId);
          this.usage.nodeWritesTransform.add(target.nodeId);
        }
      }
    }
    return "bool";
  }

  /** Whether `target` has a collision shape under it (or is one); reports what to do when it doesn't. */
  private requireBody(target: NodeTarget, name: string, at: SourceSpan): boolean {
    if (target.kind === "self") {
      for (const attached of this.context.attached) {
        if (attached.hasShape === false) {
          this.error(at, `${name}() needs a node with a collision shape under it, and this script is attached to ${attached.name}, which has none. Add a CollisionShape3D under it.`);
          return false;
        }
      }
      return true;
    }
    const node = flattenSceneTree(this.context.root).find((candidate) => candidate.id === target.nodeId);
    if (!node || flattenSceneTree(node).some((candidate) => candidate.kind === "CollisionShape3D")) return true;
    this.error(at, `${name}() needs a node with a collision shape under it, and $${target.name} has none. Add a CollisionShape3D under it.`);
    return false;
  }

  /** Whether `target` is a CollisionShape3D (the only thing `overlaps()` works on); reports what to do when it isn't. */
  private requireShape(target: NodeTarget, at: SourceSpan): boolean {
    if (target.kind === "self") {
      for (const attached of this.context.attached) {
        if (attached.kind === "CollisionShape3D") continue;
        this.error(
          at,
          `overlaps() works on CollisionShape3D nodes, and this script is attached to ${attached.name} (a ${attached.kind}). Attach it to a shape, or name one: $ShapeName.overlaps($Other).`
        );
        return false;
      }
      return true;
    }
    const kind = this.kindOf(target);
    if (kind === null || kind === "CollisionShape3D") return true;
    this.error(at, `overlaps() works on CollisionShape3D nodes, but $${target.name} is a ${kind}. Add a CollisionShape3D under it and use that node's name.`);
    return false;
  }

  /** The kinds of node `target` is: for `self` the nodes the script is attached to (none while it is not attached), otherwise the named node's kind. */
  private targetKinds(target: NodeTarget): SceneNodeKind[] {
    if (target.kind === "self") return this.context.attached.map((attached) => attached.kind);
    const kind = this.kindOf(target);
    return kind === null ? [] : [kind];
  }

  /**
   * `play` and `stop` mean different things on the two kinds of player: a sound player's `play()` starts its sound, an animation player's `play("name")`
   * starts an animation. Which is meant follows from the node; a script that isn't attached yet is taken by its arguments.
   */
  private checkPlayOrStop(expr: Extract<Expr, { kind: "call" }>, name: "play" | "stop", target: NodeTarget, nameSpan: SourceSpan): ExprType {
    const kinds = this.targetKinds(target);
    const animation = kinds.length > 0 ? kinds.every((kind) => kind === "AnimationPlayer") : name === "play" && expr.args.length === 1;
    if (animation) return this.checkAnimationCall(expr, name, target, nameSpan);
    if (kinds.length > 0 && !kinds.every((kind) => kind === "AudioStreamPlayer")) {
      // Neither kind of player: say what the node is, without complaining about the arguments too.
      this.nodeSupports(target, "audio", name, nameSpan);
      for (const arg of expr.args) this.typeOfExpr(arg);
      return "void";
    }
    this.checkArgCount(expr, 0, `${name}()`);
    if (this.nodeSupports(target, "audio", name, nameSpan)) {
      expr.res = { kind: "audioCall", target, method: name };
      if (name === "play") this.notePlay(target);
    }
    return "void";
  }

  /** `play("name")`, `stop()` and `is_playing()` on an AnimationPlayer; the name must be one of the player's animations. */
  private checkAnimationCall(expr: Extract<Expr, { kind: "call" }>, method: "play" | "stop" | "is_playing", target: NodeTarget, nameSpan: SourceSpan): ExprType {
    const result: ExprType = method === "is_playing" ? "bool" : "void";
    if (!this.nodeSupports(target, "animation", method, nameSpan)) {
      for (const arg of expr.args) this.typeOfExpr(arg);
      return result;
    }
    if (method !== "play") {
      this.checkArgCount(expr, 0, `${method}()`);
      expr.res = { kind: "animCall", target, method, animation: 0 };
      return result;
    }
    if (expr.args.length !== 1) {
      this.checkArgCount(expr, 1, 'play("name")');
      for (const arg of expr.args) this.typeOfExpr(arg);
      return result;
    }
    const arg = expr.args[0];
    if (arg.kind !== "string") {
      this.typeOfExpr(arg);
      this.error(arg, 'play() needs the animation\'s name in quotes, like play("open").');
      return result;
    }
    arg.ty = "string";
    // The animations this could mean: those of the named player, or of every player the script is attached to.
    let lists: Array<{ who: string; names: readonly string[] }> | null = null;
    if (target.kind === "self") {
      const known = this.context.attached.every((attached) => attached.animations !== undefined);
      if (known && this.context.attached.length > 0) lists = this.context.attached.map((attached) => ({ who: attached.name, names: attached.animations! }));
    } else {
      const node = flattenSceneTree(this.context.root).find((candidate) => candidate.id === target.nodeId);
      if (node) lists = [{ who: `$${target.name}`, names: getAnimationPlayer(node).animations.map((animation) => animation.name) }];
    }
    let index = 0;
    if (lists) {
      const indexes: number[] = [];
      for (const { who, names } of lists) {
        const at = names.indexOf(arg.value);
        if (at < 0) {
          this.error(
            arg,
            names.length === 0
              ? `${who} has no animations yet. Create one in the Animation panel.`
              : `${who} has no animation "${arg.value}". Its animations are: ${names.map((name) => `"${name}"`).join(", ")}.`
          );
          return result;
        }
        indexes.push(at);
      }
      if (indexes.some((at) => at !== indexes[0])) {
        this.error(arg, `The animation "${arg.value}" is not in the same place in every animation player this script is attached to, so it can't say which to start.`);
        return result;
      }
      index = indexes[0];
    }
    expr.res = { kind: "animCall", target, method: "play", animation: index };
    if (target.kind === "self") this.usage.selfPlaysAnimation = true;
    else this.usage.nodePlaysAnimation.add(target.nodeId);
    return result;
  }

  private notePlay(target: NodeTarget): void {
    if (target.kind === "self") this.usage.selfCallsPlay = true;
    else this.usage.nodeCallsPlay.add(target.nodeId);
  }

  private checkArgCount(expr: Extract<Expr, { kind: "call" }>, count: number, name: string): boolean {
    if (expr.args.length === count) return true;
    this.error(expr, `${name} takes ${count} argument${count === 1 ? "" : "s"}, but ${expr.args.length} ${expr.args.length === 1 ? "was" : "were"} given.`);
    return false;
  }

  private callInput(expr: Extract<Expr, { kind: "call" }>, name: string, nameSpan: SourceSpan): ExprType {
    if (name === "is_button_down" || name === "is_button_pressed" || name === "is_button_released") {
      if (!this.checkArgCount(expr, 1, `Input.${name}`)) return "bool";
      const arg = expr.args[0];
      if (arg.kind !== "string") {
        this.typeOfExpr(arg);
        this.error(arg, `Input.${name} needs a button name in quotes, like "a", "left" or "start".`);
        return "bool";
      }
      arg.ty = "string";
      if (!(BUTTON_NAMES as readonly string[]).includes(arg.value)) {
        this.error(arg, `"${arg.value}" isn't a button. The buttons are ${BUTTON_NAMES.join(", ")}.`);
        return "bool";
      }
      expr.res = { kind: "input", fn: name, button: arg.value as ButtonName };
      return "bool";
    }
    if (name === "is_touching" || name === "touch_x" || name === "touch_y") {
      this.checkArgCount(expr, 0, `Input.${name}`);
      expr.res = { kind: "touch", fn: name };
      return name === "is_touching" ? "bool" : "int";
    }
    this.error(nameSpan, `Input has no function "${name}". It has is_button_down, is_button_pressed, is_button_released, is_touching, touch_x and touch_y.`);
    return "unknown";
  }

  private callNamed(expr: Extract<Expr, { kind: "call" }>, name: string): ExprType {
    const local = this.lookupLocal(name);
    if (local || this.members.has(name)) {
      this.error(expr.callee, `"${name}" is a variable, not a function.`);
      for (const arg of expr.args) this.typeOfExpr(arg);
      return "unknown";
    }
    const signature = this.functions.get(name);
    if (signature) {
      expr.callee.res = { kind: "function", name };
      expr.res = { kind: "function", name };
      if (expr.args.length !== signature.params.length) {
        this.error(expr, `${name} takes ${signature.params.length} argument${signature.params.length === 1 ? "" : "s"}, but ${expr.args.length} ${expr.args.length === 1 ? "was" : "were"} given.`);
        for (const arg of expr.args) this.typeOfExpr(arg);
      } else {
        expr.args.forEach((arg, index) => {
          const value = this.asValue(this.typeOfExpr(arg), arg);
          if (value !== null) this.requireAssignable(value, signature.params[index], arg);
        });
      }
      return signature.returns;
    }
    switch (name) {
      case "abs":
      case "sqrt":
      case "sin":
      case "cos":
      case "int":
      case "float":
        return this.callMath1(expr, name);
      case "min":
      case "max":
        return this.callMathN(expr, name, 2);
      case "clamp":
        return this.callMathN(expr, name, 3);
      case "overlaps":
        return this.checkOverlaps(expr, { kind: "self" }, expr.callee);
      case "move_and_collide":
      case "is_on_floor":
      case "is_on_wall":
      case "is_on_ceiling":
        return this.checkBodyCall(expr, name, { kind: "self" }, expr.callee);
      case "play":
      case "stop":
        return this.checkPlayOrStop(expr, name, { kind: "self" }, expr.callee);
      case "is_playing":
        return this.checkAnimationCall(expr, "is_playing", { kind: "self" }, expr.callee);
    }
    for (const arg of expr.args) this.typeOfExpr(arg);
    this.error(expr.callee, `Unknown function "${name}".`);
    return "unknown";
  }

  private numericArgs(expr: Extract<Expr, { kind: "call" }>, name: string, count: number): Array<"int" | "float"> | null {
    if (!this.checkArgCount(expr, count, `${name}()`)) {
      for (const arg of expr.args) this.typeOfExpr(arg);
      return null;
    }
    const types: Array<"int" | "float"> = [];
    let ok = true;
    for (const arg of expr.args) {
      const value = this.asValue(this.typeOfExpr(arg), arg);
      if (value === null) ok = false;
      else if (value === "bool") {
        this.error(arg, `${name}() needs numbers, not a bool.`);
        ok = false;
      } else types.push(value);
    }
    return ok ? types : null;
  }

  private callMath1(expr: Extract<Expr, { kind: "call" }>, name: "abs" | "sqrt" | "sin" | "cos" | "int" | "float"): ExprType {
    const args = this.numericArgs(expr, name, 1);
    expr.res = { kind: "builtin", name };
    if (name === "int") return "int";
    if (name === "abs") return args ? args[0] : "int";
    return "float";
  }

  private callMathN(expr: Extract<Expr, { kind: "call" }>, name: "min" | "max" | "clamp", count: number): ExprType {
    const args = this.numericArgs(expr, name, count);
    expr.res = { kind: "builtin", name };
    if (!args) return "int";
    return args.every((t) => t === "int") ? "int" : "float";
  }
}
