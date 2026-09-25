import type {
  AssignOp,
  AssignStmt,
  BinaryOp,
  Expr,
  ForStmt,
  FuncDecl,
  IfStmt,
  Param,
  ScriptProgram,
  ScriptType,
  SourceSpan,
  Stmt,
  VarDecl
} from "./ast";
import { lexScript, type ScriptDiagnostic, type Token } from "./lexer";

export interface ParseResult {
  program: ScriptProgram;
  diagnostics: ScriptDiagnostic[];
}

const TYPE_NAMES: ReadonlySet<string> = new Set(["int", "float", "bool"]);
const ASSIGN_OPS: ReadonlySet<string> = new Set(["=", "+=", "-=", "*=", "/=", "%="]);

/** Thrown inside the parser to abandon the current statement; caught at the statement boundary. */
class SyntaxProblem extends Error {}

/** Parses a script. Never throws: syntax errors are diagnostics, and parsing carries on at the next statement. */
export function parseScript(source: string): ParseResult {
  const lexed = lexScript(source);
  const parser = new Parser(lexed.tokens);
  parser.parseProgram();
  return { program: parser.program, diagnostics: [...lexed.diagnostics, ...parser.diagnostics] };
}

const spanOf = (token: Token): SourceSpan => ({ line: token.line, column: token.column, endColumn: token.endColumn });

/** The span from the start of `from` to the end of `to` (cut at the end of `from`'s line when they are on different lines). */
function joinSpans(from: SourceSpan, to: SourceSpan): SourceSpan {
  return { line: from.line, column: from.column, endColumn: to.line === from.line ? to.endColumn : from.endColumn };
}

class Parser {
  readonly diagnostics: ScriptDiagnostic[] = [];
  readonly program: ScriptProgram = { variables: [], functions: [] };
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  private get current(): Token {
    return this.tokens[this.position];
  }

  private advance(): Token {
    const token = this.current;
    if (token.kind !== "eof") this.position++;
    return token;
  }

  /** The current token's kind, read afresh (TypeScript keeps a narrowing of `this.current.kind` across calls that move it). */
  private kind(): Token["kind"] {
    return this.tokens[this.position].kind;
  }

  private isOp(text: string): boolean {
    return this.current.kind === "op" && this.current.text === text;
  }

  private isKeyword(text: string): boolean {
    return this.current.kind === "keyword" && this.current.text === text;
  }

  private fail(span: SourceSpan, message: string): never {
    this.diagnostics.push({ severity: "error", message, ...span });
    throw new SyntaxProblem(message);
  }

  /** Reports at the current token without abandoning the statement. */
  private report(span: SourceSpan, message: string): void {
    this.diagnostics.push({ severity: "error", message, ...span });
  }

  private describe(token: Token): string {
    switch (token.kind) {
      case "eof":
        return "the end of the script";
      case "newline":
        return "the end of the line";
      case "indent":
        return "an indented line";
      case "dedent":
        return "the end of the block";
      case "string":
        return "a string";
      case "nodeRef":
        return `$${token.text}`;
      default:
        return `"${token.text}"`;
    }
  }

  private expectOp(text: string, what: string): Token {
    if (!this.isOp(text)) this.fail(spanOf(this.current), `Expected ${what}, but found ${this.describe(this.current)}.`);
    return this.advance();
  }

  private expectIdent(what: string): Token {
    if (this.current.kind !== "ident") this.fail(spanOf(this.current), `Expected ${what}, but found ${this.describe(this.current)}.`);
    return this.advance();
  }

  /** Skips to just past the next `newline` at this nesting level, leaving blocks it opened balanced. */
  private recover(): void {
    let depth = 0;
    while (this.current.kind !== "eof") {
      const kind = this.current.kind;
      if (kind === "indent") depth++;
      else if (kind === "dedent") {
        if (depth === 0) return; // the end of the enclosing block: leave it for the caller
        depth--;
      } else if (kind === "newline" && depth === 0) {
        this.advance();
        return;
      }
      this.advance();
    }
  }

  /** Skips a whole indented block (the body of a header that couldn't be parsed), so its lines aren't reported as stray. */
  private skipBlock(): void {
    let depth = 0;
    do {
      if (this.current.kind === "indent") depth++;
      else if (this.current.kind === "dedent") depth--;
      this.advance();
    } while (depth > 0 && this.current.kind !== "eof");
  }

  /** After a statement failed to parse: if it was a block header, its indented body goes with it. */
  private skipBodyOfFailedHeader(start: Token): void {
    const header = start.kind === "keyword" && ["if", "elif", "else", "while", "for", "func"].includes(start.text);
    if (header && this.current.kind === "indent") this.skipBlock();
  }

  parseProgram(): void {
    while (this.current.kind !== "eof") {
      if (this.current.kind === "newline") {
        this.advance();
        continue;
      }
      const start = this.current;
      try {
        if (this.isKeyword("var")) this.program.variables.push(this.parseVarDecl());
        else if (this.isKeyword("func")) this.program.functions.push(this.parseFunc());
        else if (this.current.kind === "indent") this.fail(spanOf(this.current), "This line is indented, but nothing above it opens a block.");
        else this.fail(spanOf(this.current), `Only "var" and "func" can start a line at the top of a script, but found ${this.describe(this.current)}.`);
      } catch (error) {
        if (!(error instanceof SyntaxProblem)) throw error;
        this.recover();
        this.skipBodyOfFailedHeader(start);
        // A stray dedent left over from a bad line.
        while (this.current.kind === "dedent") this.advance();
      }
    }
  }

  private parseType(): ScriptType {
    const token = this.expectIdent("a type (int, float or bool)");
    if (!TYPE_NAMES.has(token.text)) this.fail(spanOf(token), `"${token.text}" isn't a type; use int, float or bool.`);
    return token.text as ScriptType;
  }

  private parseVarDecl(): VarDecl {
    const start = this.advance(); // var
    const name = this.expectIdent("a variable name");
    let declaredType: ScriptType | undefined;
    if (this.isOp(":")) {
      this.advance();
      declaredType = this.parseType();
    }
    this.expectOp("=", 'an "=" and an initial value');
    const init = this.parseExpr();
    this.endStatement();
    return { ...joinSpans(spanOf(start), init), name: name.text, nameSpan: spanOf(name), declaredType, init };
  }

  private parseFunc(): FuncDecl {
    const start = this.advance(); // func
    const name = this.expectIdent("a function name");
    this.expectOp("(", 'a "(" after the function name');
    const params: Param[] = [];
    if (!this.isOp(")")) {
      for (;;) {
        const param = this.expectIdent("a parameter name");
        let declaredType: ScriptType | undefined;
        if (this.isOp(":")) {
          this.advance();
          declaredType = this.parseType();
        }
        params.push({ ...spanOf(param), name: param.text, declaredType });
        if (this.isOp(",")) {
          this.advance();
          continue;
        }
        break;
      }
    }
    this.expectOp(")", 'a ")" to close the parameters');
    let returnType: ScriptType | "void" = "void";
    if (this.isOp("->")) {
      this.advance();
      if (this.current.kind === "ident" && this.current.text === "void") {
        this.advance();
      } else {
        returnType = this.parseType();
      }
    }
    const body = this.parseBlock("the function's");
    return { ...spanOf(start), endColumn: name.endColumn, name: name.text, nameSpan: spanOf(name), params, returnType, body };
  }

  /** After a `:` — either a statement on the same line, or a newline and an indented block. */
  private parseBlock(owner: string): Stmt[] {
    this.expectOp(":", `a ":" to start ${owner} body`);
    if (this.current.kind !== "newline") {
      // A one-line body: `if x: pass`
      const statement = this.parseSimpleStatement();
      return [statement];
    }
    this.advance(); // newline
    if (this.kind() !== "indent") this.fail(spanOf(this.current), `Expected an indented block of statements for ${owner} body.`);
    this.advance();
    const body: Stmt[] = [];
    while (this.kind() !== "dedent" && this.kind() !== "eof") {
      if (this.kind() === "newline") {
        this.advance();
        continue;
      }
      const start = this.current;
      try {
        body.push(this.parseStatement());
      } catch (error) {
        if (!(error instanceof SyntaxProblem)) throw error;
        this.recover();
        this.skipBodyOfFailedHeader(start);
      }
    }
    if (this.kind() === "dedent") this.advance();
    return body;
  }

  private endStatement(): void {
    if (this.current.kind === "newline") {
      this.advance();
      return;
    }
    if (this.current.kind === "dedent" || this.current.kind === "eof") return;
    this.fail(spanOf(this.current), `Expected the end of the line, but found ${this.describe(this.current)}.`);
  }

  private parseStatement(): Stmt {
    const token = this.current;
    if (token.kind === "indent") {
      // Report it once, then read the block anyway so the code inside is still checked.
      this.report(spanOf(token), "This line is indented more than the one above it, which doesn't open a block.");
      this.advance();
      while (this.current.kind !== "dedent" && this.current.kind !== "eof") {
        if (this.current.kind === "newline") {
          this.advance();
          continue;
        }
        const inner = this.current;
        try {
          this.parseStatement();
        } catch (error) {
          if (!(error instanceof SyntaxProblem)) throw error;
          this.recover();
          this.skipBodyOfFailedHeader(inner);
        }
      }
      if (this.current.kind === "dedent") this.advance();
      return { kind: "pass", ...spanOf(token) };
    }
    if (token.kind === "keyword") {
      switch (token.text) {
        case "if":
          return this.parseIf();
        case "while": {
          this.advance();
          const condition = this.parseExpr();
          const body = this.parseBlock("the loop's");
          return { kind: "while", ...spanOf(token), condition, body };
        }
        case "for":
          return this.parseFor();
        case "elif":
        case "else":
          this.fail(spanOf(token), `"${token.text}" has no "if" before it.`);
      }
    }
    return this.parseSimpleStatement();
  }

  private parseSimpleStatement(): Stmt {
    const token = this.current;
    if (token.kind === "keyword") {
      switch (token.text) {
        case "var": {
          this.advance();
          const name = this.expectIdent("a variable name");
          let declaredType: ScriptType | undefined;
          if (this.isOp(":")) {
            this.advance();
            declaredType = this.parseType();
          }
          this.expectOp("=", 'an "=" and an initial value');
          const init = this.parseExpr();
          this.endStatement();
          return { kind: "var", ...spanOf(token), endColumn: name.endColumn, name: name.text, nameSpan: spanOf(name), declaredType, init };
        }
        case "break":
        case "continue":
        case "pass": {
          this.advance();
          this.endStatement();
          return { kind: token.text, ...spanOf(token) } as Stmt;
        }
        case "return": {
          this.advance();
          let value: Expr | undefined;
          if (this.current.kind !== "newline" && this.current.kind !== "dedent" && this.current.kind !== "eof") value = this.parseExpr();
          this.endStatement();
          return { kind: "return", ...spanOf(token), value };
        }
        case "if":
        case "while":
        case "for":
          this.fail(spanOf(token), `"${token.text}" can't go on the same line after a ":"; put it on its own indented line.`);
      }
    }
    const target = this.parseExpr();
    if (this.current.kind === "op" && ASSIGN_OPS.has(this.current.text)) {
      const op = this.advance().text as AssignOp;
      const value = this.parseExpr();
      this.endStatement();
      const statement: AssignStmt = { kind: "assign", ...joinSpans(target, value), op, target, value };
      return statement;
    }
    this.endStatement();
    return { kind: "expr", ...spanOf(token), endColumn: target.line === token.line ? target.endColumn : token.endColumn, expr: target };
  }

  private parseIf(): IfStmt {
    const start = this.advance(); // if
    const branches: IfStmt["branches"] = [];
    const condition = this.parseExpr();
    branches.push({ condition, body: this.parseBlock('the "if"') });
    let elseBody: Stmt[] | undefined;
    for (;;) {
      if (this.isKeyword("elif")) {
        this.advance();
        const next = this.parseExpr();
        branches.push({ condition: next, body: this.parseBlock('the "elif"') });
        continue;
      }
      if (this.isKeyword("else")) {
        this.advance();
        elseBody = this.parseBlock('the "else"');
      }
      break;
    }
    return { kind: "if", ...spanOf(start), branches, elseBody };
  }

  private parseFor(): ForStmt {
    const start = this.advance(); // for
    const variable = this.expectIdent("the loop variable's name");
    if (!this.isKeyword("in")) this.fail(spanOf(this.current), `Expected "in" after the loop variable, but found ${this.describe(this.current)}.`);
    this.advance();
    if (!this.isKeyword("range")) this.fail(spanOf(this.current), 'A "for" loop must loop over range(n) or range(a, b).');
    this.advance();
    this.expectOp("(", 'a "(" after range');
    const first = this.parseExpr();
    let startExpr: Expr | undefined;
    let end = first;
    if (this.isOp(",")) {
      this.advance();
      startExpr = first;
      end = this.parseExpr();
    }
    this.expectOp(")", 'a ")" to close range(...)');
    const body = this.parseBlock("the loop's");
    return { kind: "for", ...spanOf(start), variable: variable.text, variableSpan: spanOf(variable), start: startExpr, end, body };
  }

  // ---- Expressions, from loosest to tightest.

  parseExpr(): Expr {
    return this.parseOr();
  }

  private binary(op: BinaryOp, left: Expr, right: Expr): Expr {
    return { kind: "binary", ...joinSpans(left, right), op, left, right };
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isKeyword("or")) {
      this.advance();
      left = this.binary("or", left, this.parseAnd());
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.isKeyword("and")) {
      this.advance();
      left = this.binary("and", left, this.parseNot());
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.isKeyword("not")) {
      const token = this.advance();
      const operand = this.parseNot();
      return { kind: "unary", ...joinSpans(spanOf(token), operand), op: "not", operand };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    while (this.current.kind === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(this.current.text)) {
      const op = this.advance().text as BinaryOp;
      left = this.binary(op, left, this.parseAdditive());
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.advance().text as BinaryOp;
      left = this.binary(op, left, this.parseMultiplicative());
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
      const op = this.advance().text as BinaryOp;
      left = this.binary(op, left, this.parseUnary());
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.isOp("-")) {
      const token = this.advance();
      const operand = this.parseUnary();
      return { kind: "unary", ...joinSpans(spanOf(token), operand), op: "-", operand };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.isOp(".")) {
        this.advance();
        const name = this.expectIdent("a member name after the dot");
        expr = { kind: "member", ...joinSpans(expr, spanOf(name)), object: expr, name: name.text, nameSpan: spanOf(name) };
        continue;
      }
      if (this.isOp("(")) {
        this.advance();
        const args: Expr[] = [];
        if (!this.isOp(")")) {
          for (;;) {
            args.push(this.parseExpr());
            if (this.isOp(",")) {
              this.advance();
              continue;
            }
            break;
          }
        }
        const close = this.expectOp(")", 'a ")" to close the call');
        expr = { kind: "call", ...joinSpans(expr, spanOf(close)), callee: expr, args };
        continue;
      }
      return expr;
    }
  }

  private parsePrimary(): Expr {
    const token = this.current;
    switch (token.kind) {
      case "int": {
        this.advance();
        const value = Number(token.text);
        return { kind: "int", ...spanOf(token), value };
      }
      case "float": {
        this.advance();
        return { kind: "float", ...spanOf(token), value: Number(token.text) };
      }
      case "string":
        this.advance();
        return { kind: "string", ...spanOf(token), value: token.text };
      case "nodeRef":
        this.advance();
        return { kind: "nodeRef", ...spanOf(token), name: token.text };
      case "ident":
        this.advance();
        return { kind: "name", ...spanOf(token), name: token.text };
      case "keyword":
        if (token.text === "true" || token.text === "false") {
          this.advance();
          return { kind: "bool", ...spanOf(token), value: token.text === "true" };
        }
        break;
      case "op":
        if (token.text === "(") {
          this.advance();
          const inner = this.parseExpr();
          this.expectOp(")", 'a ")" to close the parenthesis');
          return inner;
        }
        break;
      default:
        break;
    }
    this.fail(spanOf(token), `Expected a value, but found ${this.describe(token)}.`);
  }
}
