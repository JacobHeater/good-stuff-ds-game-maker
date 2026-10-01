import type { ScriptType } from "./ast";
import { parseScript } from "./parser";

/**
 * The project's global variables (requirements/scripting/STORY.game-state-and-save.md): a script declares one with `global var score = 0` at the top; every script of the project can then
 * use `score` by name, in every scene, and it keeps its value when the scene changes. The game's save file holds them. Declared with literals, so the compiler can give each its starting value.
 */
export interface ProjectGlobal {
  name: string;
  type: ScriptType;
  /** The starting value as written: a whole number, a number with a fraction, 0/1 for a bool, or the text for a string. */
  initial: number | string;
}

/** The most global variables a game has (the save file holds one 32-bit number for each). */
export const MAX_PROJECT_GLOBALS = 64;

export interface GlobalProblem {
  scriptName: string;
  message: string;
  line?: number;
}

function literalOf(expr: { kind: string; [key: string]: unknown }): { value: number | string; isInt: boolean; isBool: boolean; isString: boolean } | null {
  if (expr.kind === "int" || expr.kind === "float") return { value: expr.value as number, isInt: expr.kind === "int", isBool: false, isString: false };
  if (expr.kind === "bool") return { value: expr.value ? 1 : 0, isInt: false, isBool: true, isString: false };
  if (expr.kind === "string") return { value: expr.value as string, isInt: false, isBool: false, isString: true };
  if (expr.kind === "unary" && expr.op === "-") {
    const inner = literalOf(expr.operand as { kind: string });
    return inner && !inner.isBool && !inner.isString ? { ...inner, value: -(inner.value as number) } : null;
  }
  return null;
}

/**
 * Every `global var` of the scripts, sorted by name (the order is the global's place in the ROM). The same name declared in several scripts must have the same type and starting value; when it
 * doesn't, or there are too many, that is in `problems`. Declarations that aren't literals are left to each script's own check.
 */
export function collectProjectGlobals(scripts: ReadonlyArray<{ name: string; source: string }>): { globals: ProjectGlobal[]; problems: GlobalProblem[] } {
  const found = new Map<string, ProjectGlobal & { where: string }>();
  const problems: GlobalProblem[] = [];
  for (const script of scripts) {
    if (!script.source.includes("global")) continue;
    for (const variable of parseScript(script.source).program.variables) {
      if (!variable.global) continue;
      const literal = literalOf(variable.init as { kind: string });
      if (!literal) continue;
      const type: ScriptType = variable.declaredType ?? (literal.isBool ? "bool" : literal.isString ? "string" : literal.isInt ? "int" : "float");
      const existing = found.get(variable.name);
      if (!existing) {
        found.set(variable.name, { name: variable.name, type, initial: literal.value, where: script.name });
      } else if (existing.type !== type || existing.initial !== literal.value) {
        const show = (value: number | string): string => (typeof value === "string" ? JSON.stringify(value) : String(value));
        problems.push({
          scriptName: script.name,
          line: variable.line,
          message: `The global "${variable.name}" is declared in ${existing.where} as ${existing.type} starting at ${show(existing.initial)}, but here as ${type} starting at ${show(literal.value)}. Every script that declares it must say the same.`
        });
      }
    }
  }
  const globals = [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(({ name, type, initial }) => ({ name, type, initial }));
  if (globals.length > MAX_PROJECT_GLOBALS) {
    problems.push({ scriptName: "", message: `The project has ${globals.length} global variables, but a game can have ${MAX_PROJECT_GLOBALS}.` });
  }
  return { globals, problems };
}
