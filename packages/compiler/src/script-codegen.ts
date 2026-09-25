import type { AssignStmt, Expr, FuncDecl, NodeTarget, ScriptProgram, ScriptType, Stmt, VarDecl } from "@goodstuff/core";

/**
 * Translates checked scripts to C (requirements/compiler/TASK.compile-scripts-to-c.md). Pure: a function of its input, so the same
 * scripts always give the same text. The input has already passed `checkScript`, so every expression carries its type and what it
 * refers to; nothing here re-derives meaning, and anything unexpected is a bug (it throws) rather than a diagnostic.
 *
 * Numbers: `int` is `int32_t`; `float` is `int32_t` in the DS's 20.12 fixed point; `bool` is `int`. All three are plain C ints, so
 * comparisons, `abs`, `min`, `max` and `clamp` are the same code for `int` and `float`; only `*` and `/` (and the conversions)
 * differ. The helpers are in the runtime's `gs_api.h`.
 */

export interface CompiledScript {
  /** The script's name, for comments and `#line` directives. */
  name: string;
  /** The checked syntax tree. */
  program: ScriptProgram;
  /** Indices (into the scene's node table) of the nodes it is attached to; instance `i` belongs to `instances[i]`. */
  instances: number[];
}

const FIXED_ONE = 4096;

const BUTTON_MASK: Record<string, string> = {
  a: "GS_KEY_A", b: "GS_KEY_B", x: "GS_KEY_X", y: "GS_KEY_Y", l: "GS_KEY_L", r: "GS_KEY_R",
  start: "GS_KEY_START", select: "GS_KEY_SELECT", up: "GS_KEY_UP", down: "GS_KEY_DOWN", left: "GS_KEY_LEFT", right: "GS_KEY_RIGHT"
};

/** Text that is safe on one line inside a C comment. */
function commentSafe(text: string): string {
  return text.replace(/[^ -~]/g, "?").replace(/\*\//g, "* /").replace(/\/\*/g, "/ *").slice(0, 60);
}

/** A name safe to use in C identifiers and `#line` file names. */
function identSafe(text: string): string {
  return text.replace(/[^A-Za-z0-9]/g, "_");
}

interface Typed {
  code: string;
  ty: ScriptType;
}

class ScriptWriter {
  private readonly lines: string[] = [];
  private indent = 1;
  private temp = 0;
  private current!: FuncDecl;

  constructor(
    private readonly script: CompiledScript,
    private readonly index: number,
    private readonly nodeIndexById: ReadonlyMap<string, number>
  ) {}

  private get prefix(): string {
    return `gss${this.index}`;
  }

  private funcName(name: string): string {
    return `${this.prefix}_${name}`;
  }

  private line(text: string): void {
    this.lines.push("\t".repeat(this.indent) + text);
  }

  private raw(text: string): void {
    this.lines.push(text);
  }

  private fail(what: string, at: { line: number }): never {
    throw new Error(`script code generation: ${what} (script "${this.script.name}", line ${at.line}); the checker should have caught this`);
  }

  // ---- The whole script

  write(): string[] {
    const { program, instances } = this.script;
    const count = instances.length;
    this.raw(`/* script ${commentSafe(this.script.name)}: attached to ${count} node${count === 1 ? "" : "s"} */`);

    // State: one struct per attached node, with each variable's initial value.
    this.raw(`typedef struct {`);
    if (program.variables.length === 0) this.raw("\tint32_t unused;");
    for (const variable of program.variables) this.raw(`\tint32_t m_${variable.name}; /* ${variable.ty} */`);
    this.raw(`} ${this.prefix}_State;`);
    const initial = program.variables.length === 0 ? "0" : program.variables.map((v) => this.initialValue(v)).join(", ");
    this.raw(`static ${this.prefix}_State ${this.prefix}_state[${count}] = {`);
    for (let i = 0; i < count; i++) this.raw(`\t{ ${initial} }${i < count - 1 ? "," : ""}`);
    this.raw("};");
    this.raw(`static const uint16_t ${this.prefix}_self[${count}] = { ${instances.join(", ")} };`);
    this.raw("");

    // Prototypes, so functions can call each other in any order.
    for (const func of program.functions) this.raw(`${this.signature(func)};`);
    this.raw("");
    for (const func of program.functions) this.writeFunction(func);
    return this.lines;
  }

  private initialValue(variable: VarDecl): string {
    const expr = variable.init;
    const literal =
      expr.kind === "unary" && expr.op === "-" && (expr.operand.kind === "int" || expr.operand.kind === "float")
        ? -expr.operand.value
        : expr.kind === "int" || expr.kind === "float"
          ? expr.value
          : expr.kind === "bool"
            ? (expr.value ? 1 : 0)
            : this.fail("a variable's initial value isn't a literal", expr);
    if (variable.ty === "float") return String(Math.round(literal * FIXED_ONE));
    return String(literal);
  }

  private signature(func: FuncDecl): string {
    const params = ["int inst", ...func.params.map((p) => `int32_t p_${p.name}`)];
    const returns = func.returnType === "void" ? "void" : "int32_t";
    return `static ${returns} ${this.funcName(func.name)}(${params.join(", ")})`;
  }

  private writeFunction(func: FuncDecl): void {
    this.current = func;
    this.raw(`#line ${func.line} "${identSafe(this.script.name)}"`);
    this.raw(`${this.signature(func)} {`);
    this.indent = 1;
    this.block(func.body);
    this.raw("}");
    this.raw("");
  }

  // ---- Statements

  private block(body: Stmt[]): void {
    for (const statement of body) this.statement(statement);
  }

  private statement(statement: Stmt): void {
    this.raw(`#line ${statement.line} "${identSafe(this.script.name)}"`);
    switch (statement.kind) {
      case "var": {
        const type = statement.ty ?? this.fail("a local without a type", statement);
        this.line(`${type === "bool" ? "int" : "int32_t"} v_${statement.name} = ${this.convert(this.expr(statement.init), type)};`);
        return;
      }
      case "assign":
        this.assign(statement);
        return;
      case "if": {
        statement.branches.forEach((branch, i) => {
          this.line(`${i === 0 ? "if" : "} else if"} (${this.expr(branch.condition).code}) {`);
          this.indent++;
          this.block(branch.body);
          this.indent--;
        });
        if (statement.elseBody) {
          this.line("} else {");
          this.indent++;
          this.block(statement.elseBody);
          this.indent--;
        }
        this.line("}");
        return;
      }
      case "while":
        this.line(`while (${this.expr(statement.condition).code}) {`);
        this.indent++;
        this.block(statement.body);
        this.indent--;
        this.line("}");
        return;
      case "for": {
        // The limit is worked out once, before the loop, as in Python.
        const end = `gs_end_${statement.line}_${this.temp++}`;
        const start = statement.start ? this.expr(statement.start).code : "0";
        this.line(`for (int32_t v_${statement.variable} = ${start}, ${end} = ${this.expr(statement.end).code}; v_${statement.variable} < ${end}; v_${statement.variable}++) {`);
        this.indent++;
        this.block(statement.body);
        this.indent--;
        this.line("}");
        return;
      }
      case "break":
        this.line("break;");
        return;
      case "continue":
        this.line("continue;");
        return;
      case "pass":
        this.line(";");
        return;
      case "return":
        if (statement.value === undefined) this.line("return;");
        else this.line(`return ${this.convert(this.expr(statement.value), this.current.returnType === "void" ? "int" : this.current.returnType)};`);
        return;
      case "expr":
        this.line(`${this.expr(statement.expr, true).code};`);
        return;
    }
  }

  private nodeIndex(target: NodeTarget): string {
    if (target.kind === "self") return `${this.prefix}_self[inst]`;
    const index = this.nodeIndexById.get(target.nodeId);
    if (index === undefined) throw new Error(`script code generation: node "${target.name}" isn't in the node table`);
    return String(index);
  }

  private assign(statement: AssignStmt): void {
    const target = statement.target;
    const value = this.expr(statement.value);
    // The type the target holds, its current value as C, and how to store a new value.
    let type: ScriptType;
    let current: string;
    let store: (code: string) => string;
    if (target.kind === "name" && target.res?.kind === "local") {
      type = target.ty as ScriptType;
      current = `v_${target.name}`;
      store = (code) => `${current} = ${code};`;
      // A parameter is named p_, not v_.
      if (this.current.params.some((p) => p.name === target.name)) {
        current = `p_${target.name}`;
        store = (code) => `${current} = ${code};`;
      }
    } else if (target.kind === "name" && target.res?.kind === "member") {
      type = target.ty as ScriptType;
      current = `${this.prefix}_state[inst].m_${target.name}`;
      store = (code) => `${current} = ${code};`;
    } else if ((target.kind === "member" || target.kind === "name") && target.res?.kind === "nodeAxis") {
      type = "float";
      current = `gs_node_state[${this.nodeIndex(target.res.target)}].${target.res.prop}[${target.res.axis}]`;
      store = (code) => `${current} = ${code};`;
    } else if ((target.kind === "member" || target.kind === "name") && target.res?.kind === "nodeProp") {
      const res = target.res;
      if (res.prop === "visible") {
        type = "bool";
        current = `gs_node_state[${this.nodeIndex(res.target)}].visible`;
        store = (code) => `${current} = ${code};`;
      } else if (res.prop === "speed_scale") {
        type = "float";
        const player = `gs_node_anim_player(${this.nodeIndex(res.target)})`;
        current = `gs_anim_get_speed(${player})`;
        store = (code) => `gs_anim_set_speed(${player}, ${code});`;
      } else {
        type = "float";
        const player = `gs_node_audio_player(${this.nodeIndex(res.target)})`;
        current = `gs_audio_get_${res.prop}(${player})`;
        store = (code) => `gs_audio_set_${res.prop}(${player}, ${code});`;
      }
    } else {
      this.fail("an assignment to something that can't be assigned", target);
    }

    if (statement.op === "=") {
      this.line(store(this.convert(value, type)));
      return;
    }
    const combined = this.arith(statement.op[0] as "+" | "-" | "*" | "/" | "%", { code: current, ty: type }, value);
    this.line(store(this.convert(combined, type)));
  }

  // ---- Expressions

  /** `value` as a C expression of type `to` (an int becomes a float; nothing else changes). */
  private convert(value: Typed, to: ScriptType): string {
    if (value.ty === "int" && to === "float") return this.intToFloat(value.code);
    return value.code;
  }

  private intToFloat(code: string): string {
    if (/^-?\d+$/.test(code) && Math.abs(Number(code)) <= 524287) return String(Number(code) * FIXED_ONE);
    return `gs_i2f(${code})`;
  }

  /** `+ - * / %` on two typed values, giving the C code and the result type. */
  private arith(op: "+" | "-" | "*" | "/" | "%", a: Typed, b: Typed): Typed {
    if (op === "%") return { code: `gs_modi(${a.code}, ${b.code})`, ty: "int" };
    if (a.ty === "int" && b.ty === "int") {
      if (op === "/") return { code: `gs_divi(${a.code}, ${b.code})`, ty: "int" };
      return { code: `(${a.code} ${op} ${b.code})`, ty: "int" };
    }
    if (op === "+" || op === "-") return { code: `(${this.convert(a, "float")} ${op} ${this.convert(b, "float")})`, ty: "float" };
    if (op === "*") {
      // A fixed-point number times a plain int needs no shift.
      if (a.ty === "int" || b.ty === "int") return { code: `(${a.code} * ${b.code})`, ty: "float" };
      return { code: `gs_mulf(${a.code}, ${b.code})`, ty: "float" };
    }
    // Division.
    if (b.ty === "int") return { code: `gs_divi(${a.code}, ${b.code})`, ty: "float" };
    return { code: `gs_divf(${this.convert(a, "float")}, ${b.code})`, ty: "float" };
  }

  private expr(expr: Expr, asStatement = false): Typed {
    switch (expr.kind) {
      case "int":
        return { code: String(expr.value), ty: "int" };
      case "float":
        return { code: String(Math.round(expr.value * FIXED_ONE)), ty: "float" };
      case "bool":
        return { code: expr.value ? "1" : "0", ty: "bool" as ScriptType };
      case "string":
        return this.fail("a string used as a value", expr);
      case "nodeRef":
        return this.fail("a node used as a value", expr);
      case "name":
        return this.name(expr);
      case "unary": {
        const operand = this.expr(expr.operand);
        if (expr.op === "not") return { code: `(!${operand.code})`, ty: "bool" };
        return { code: `(-${operand.code})`, ty: operand.ty };
      }
      case "binary":
        return this.binary(expr);
      case "member":
        return this.member(expr);
      case "call":
        return this.call(expr, asStatement);
    }
  }

  private name(expr: Extract<Expr, { kind: "name" }>): Typed {
    const res = expr.res;
    if (res?.kind === "local") {
      const isParam = this.current.params.some((p) => p.name === expr.name);
      return { code: `${isParam ? "p_" : "v_"}${expr.name}`, ty: expr.ty as ScriptType };
    }
    if (res?.kind === "member") return { code: `${this.prefix}_state[inst].m_${expr.name}`, ty: expr.ty as ScriptType };
    if (res?.kind === "nodeProp") return this.nodeProp(res.target, res.prop);
    return this.fail(`the name "${expr.name}" is used as a value`, expr);
  }

  private nodeProp(target: NodeTarget, prop: "visible" | "volume" | "pitch" | "speed_scale"): Typed {
    if (prop === "visible") return { code: `gs_node_state[${this.nodeIndex(target)}].visible`, ty: "bool" as ScriptType };
    if (prop === "speed_scale") return { code: `gs_anim_get_speed(gs_node_anim_player(${this.nodeIndex(target)}))`, ty: "float" };
    return { code: `gs_audio_get_${prop}(gs_node_audio_player(${this.nodeIndex(target)}))`, ty: "float" };
  }

  private member(expr: Extract<Expr, { kind: "member" }>): Typed {
    const res = expr.res;
    if (res?.kind === "nodeAxis") return { code: `gs_node_state[${this.nodeIndex(res.target)}].${res.prop}[${res.axis}]`, ty: "float" };
    if (res?.kind === "nodeProp") return this.nodeProp(res.target, res.prop);
    return this.fail("a member used as a value", expr);
  }

  private binary(expr: Extract<Expr, { kind: "binary" }>): Typed {
    const a = this.expr(expr.left);
    const b = this.expr(expr.right);
    switch (expr.op) {
      case "and":
        return { code: `(${a.code} && ${b.code})`, ty: "bool" as ScriptType };
      case "or":
        return { code: `(${a.code} || ${b.code})`, ty: "bool" as ScriptType };
      case "+":
      case "-":
      case "*":
      case "/":
      case "%":
        return this.arith(expr.op, a, b);
      default: {
        // Comparisons: an int next to a float is compared as a float.
        const mixed = (a.ty === "int" && b.ty === "float") || (a.ty === "float" && b.ty === "int");
        const left = mixed ? this.convert(a, "float") : a.code;
        const right = mixed ? this.convert(b, "float") : b.code;
        return { code: `(${left} ${expr.op} ${right})`, ty: "bool" as ScriptType };
      }
    }
  }

  private call(expr: Extract<Expr, { kind: "call" }>, asStatement: boolean): Typed {
    const res = expr.res;
    if (!res) return this.fail("a call that wasn't resolved", expr);
    switch (res.kind) {
      case "function": {
        const func = this.script.program.functions.find((f) => f.name === res.name) ?? this.fail(`unknown function ${res.name}`, expr);
        const args = expr.args.map((arg, i) => this.convert(this.expr(arg), func.params[i].declaredType ?? "float"));
        return { code: `${this.funcName(func.name)}(${["inst", ...args].join(", ")})`, ty: func.returnType === "void" ? ("int" as ScriptType) : func.returnType };
      }
      case "input":
        return { code: `gs_key_${res.fn.slice("is_button_".length)}(${BUTTON_MASK[res.button]})`, ty: "bool" as ScriptType };
      case "touch":
        if (res.fn === "is_touching") return { code: "gs_touching", ty: "bool" as ScriptType };
        return { code: res.fn === "touch_x" ? "gs_touch_x" : "gs_touch_y", ty: "int" };
      case "audioCall":
        return { code: `gs_audio_${res.method}(gs_node_audio_player(${this.nodeIndex(res.target)}))`, ty: "int" };
      case "animCall": {
        const player = `gs_node_anim_player(${this.nodeIndex(res.target)})`;
        if (res.method === "play") return { code: `gs_anim_play(${player}, ${res.animation})`, ty: "int" };
        if (res.method === "stop") return { code: `gs_anim_stop(${player})`, ty: "int" };
        return { code: `gs_anim_is_playing(${player})`, ty: "bool" as ScriptType };
      }
      case "moveCall":
        return {
          code: `gs_move_and_collide(${this.nodeIndex(res.target)}, ${expr.args.map((arg) => this.convert(this.expr(arg), "float")).join(", ")})`,
          ty: "bool" as ScriptType
        };
      case "bodyState":
        return { code: `gs_body_state(${this.nodeIndex(res.target)}, GS_BODY_${res.state.toUpperCase()})`, ty: "bool" as ScriptType };
      case "overlapsCall":
        return { code: `gs_overlaps(${this.nodeIndex(res.a)}, ${this.nodeIndex(res.b)})`, ty: "bool" as ScriptType };
      case "builtin":
        return this.builtin(expr, res.name);
      default:
        void asStatement;
        return this.fail("a call to something that isn't callable", expr);
    }
  }

  private builtin(expr: Extract<Expr, { kind: "call" }>, name: string): Typed {
    const args = expr.args.map((arg) => this.expr(arg));
    switch (name) {
      case "int":
        return { code: args[0].ty === "float" ? `gs_f2i(${args[0].code})` : args[0].code, ty: "int" };
      case "float":
        return { code: this.convert(args[0], "float"), ty: "float" };
      case "sqrt":
        return { code: `gs_sqrt(${this.convert(args[0], "float")})`, ty: "float" };
      case "sin":
      case "cos":
        return { code: `gs_${name}(${this.convert(args[0], "float")})`, ty: "float" };
      case "abs":
      case "min":
      case "max":
      case "clamp": {
        const ty: ScriptType = args.every((a) => a.ty === "int") ? "int" : "float";
        return { code: `gs_${name}(${args.map((a) => this.convert(a, ty)).join(", ")})`, ty };
      }
    }
    return this.fail(`unknown built-in ${name}`, expr);
  }
}

/**
 * The text of `script_code.c` for the given scripts: each script's state and functions, then the table of script instances
 * (one per attached node, in node-table order) that the runtime calls each frame.
 */
export function generateScriptCode(scripts: readonly CompiledScript[], nodeIndexById: ReadonlyMap<string, number>): string {
  const out: string[] = [];
  out.push("/* GENERATED by @goodstuff/compiler from the project's scripts. Do not edit: the next build overwrites this file. */");
  out.push('#include "gs_api.h"');
  out.push("");
  // Generated code may define helpers a script never calls, and locals it never reads; that is the script author's business, not a warning.
  out.push('#pragma GCC diagnostic ignored "-Wunused-function"');
  out.push('#pragma GCC diagnostic ignored "-Wunused-variable"');
  out.push('#pragma GCC diagnostic ignored "-Wunused-but-set-variable"');
  out.push("");

  const entries: Array<{ node: number; script: number; inst: number; ready: boolean; process: boolean }> = [];
  scripts.forEach((script, index) => {
    if (script.instances.length === 0) return;
    out.push(...new ScriptWriter(script, index, nodeIndexById).write());
    script.instances.forEach((node, inst) => {
      entries.push({
        node,
        script: index,
        inst,
        ready: script.program.functions.some((f) => f.name === "_ready"),
        process: script.program.functions.some((f) => f.name === "_process")
      });
    });
  });

  entries.sort((a, b) => a.node - b.node || a.script - b.script);
  out.push("const GsScriptInstance gs_script_instances[] = {");
  if (entries.length === 0) out.push("\t{ 0, 0, 0, 0 }");
  entries.forEach((e, i) => {
    const ready = e.ready ? `gss${e.script}__ready` : "0";
    const process = e.process ? `(void (*)(int, int32_t))gss${e.script}__process` : "0";
    out.push(`\t{ ${ready}, ${process}, ${e.node}, ${e.inst} }${i < entries.length - 1 ? "," : ""}`);
  });
  out.push("};");
  out.push(`const uint16_t gs_script_instance_count = ${entries.length};`);
  out.push("");
  return out.join("\n");
}
