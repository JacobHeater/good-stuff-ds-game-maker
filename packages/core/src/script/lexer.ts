import type { SourceSpan } from "./ast";

/** A problem found in a script, located for the editor and for the compiler's messages. */
export interface ScriptDiagnostic extends SourceSpan {
  severity: "error" | "warning";
  message: string;
}

export type TokenKind = "ident" | "keyword" | "int" | "float" | "string" | "nodeRef" | "op" | "newline" | "indent" | "dedent" | "eof";

export interface Token extends SourceSpan {
  kind: TokenKind;
  /** The text of an identifier, keyword or operator; the number's digits; a string's content; a node reference's name. */
  text: string;
}

export const KEYWORDS: ReadonlySet<string> = new Set([
  "var", "func", "if", "elif", "else", "while", "for", "in", "return", "break", "continue", "pass", "and", "or", "not", "true", "false", "range"
]);

const TWO_CHAR_OPS = new Set(["==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "->"]);
const ONE_CHAR_OPS = new Set(["+", "-", "*", "/", "%", "<", ">", "=", "(", ")", ":", ",", "."]);

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentStart = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

export interface LexResult {
  tokens: Token[];
  diagnostics: ScriptDiagnostic[];
}

/**
 * Splits a script into tokens, turning the indentation into `indent` and `dedent` tokens as Python and GDScript do. A line ending
 * ends a statement (`newline`) unless it is inside brackets. Never throws: a bad character is reported and skipped.
 */
export function lexScript(source: string): LexResult {
  const tokens: Token[] = [];
  const diagnostics: ScriptDiagnostic[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const indents = [0];
  let depth = 0; // open brackets
  let indentChar: " " | "\t" | null = null;
  let mixedReported = false;
  let lineHasTokens = false;

  const error = (line: number, column: number, endColumn: number, message: string): void => {
    diagnostics.push({ severity: "error", message, line, column, endColumn });
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const text = lines[lineIndex];
    const line = lineIndex + 1;
    let i = 0;

    if (depth === 0) {
      // Indentation of a line that starts a statement.
      let width = 0;
      while (i < text.length && (text[i] === " " || text[i] === "\t")) {
        if (indentChar === null) indentChar = text[i] as " " | "\t";
        else if (text[i] !== indentChar && !mixedReported) {
          mixedReported = true;
          error(line, i + 1, i + 2, "This script mixes tabs and spaces for indentation; use one or the other.");
        }
        width++;
        i++;
      }
      // A blank line or a comment on its own doesn't change the indentation.
      if (i >= text.length || text[i] === "#") continue;
      const current = indents[indents.length - 1];
      if (width > current) {
        indents.push(width);
        tokens.push({ kind: "indent", text: "", line, column: 1, endColumn: width + 1 });
      } else if (width < current) {
        while (indents.length > 1 && width < indents[indents.length - 1]) {
          indents.pop();
          tokens.push({ kind: "dedent", text: "", line, column: 1, endColumn: width + 1 });
        }
        if (width !== indents[indents.length - 1]) {
          error(line, 1, width + 1, "This line is indented to a level that no earlier line uses.");
          indents.push(width); // carry on as if it were a new level
          tokens.push({ kind: "indent", text: "", line, column: 1, endColumn: width + 1 });
        }
      }
    }

    // The rest of the line.
    while (i < text.length) {
      const c = text[i];
      if (c === " " || c === "\t") {
        i++;
        continue;
      }
      if (c === "#") break;
      const start = i;
      const column = i + 1;

      if (isDigit(c)) {
        while (i < text.length && isDigit(text[i])) i++;
        let isFloat = false;
        if (text[i] === "." && i + 1 < text.length && isDigit(text[i + 1])) {
          isFloat = true;
          i++;
          while (i < text.length && isDigit(text[i])) i++;
        }
        tokens.push({ kind: isFloat ? "float" : "int", text: text.slice(start, i), line, column, endColumn: i + 1 });
        lineHasTokens = true;
        continue;
      }
      if (isIdentStart(c)) {
        while (i < text.length && isIdentPart(text[i])) i++;
        const word = text.slice(start, i);
        tokens.push({ kind: KEYWORDS.has(word) ? "keyword" : "ident", text: word, line, column, endColumn: i + 1 });
        lineHasTokens = true;
        continue;
      }
      if (c === '"') {
        i++;
        const contentStart = i;
        while (i < text.length && text[i] !== '"') i++;
        if (i >= text.length) {
          error(line, column, text.length + 1, "This string is missing its closing quote.");
          tokens.push({ kind: "string", text: text.slice(contentStart), line, column, endColumn: text.length + 1 });
        } else {
          tokens.push({ kind: "string", text: text.slice(contentStart, i), line, column, endColumn: i + 2 });
          i++;
        }
        lineHasTokens = true;
        continue;
      }
      if (c === "$") {
        i++;
        if (text[i] === '"') {
          const nameStart = i + 1;
          i++;
          while (i < text.length && text[i] !== '"') i++;
          if (i >= text.length) {
            error(line, column, text.length + 1, "This node name is missing its closing quote.");
            tokens.push({ kind: "nodeRef", text: text.slice(nameStart), line, column, endColumn: text.length + 1 });
          } else {
            tokens.push({ kind: "nodeRef", text: text.slice(nameStart, i), line, column, endColumn: i + 2 });
            i++;
          }
        } else if (i < text.length && isIdentStart(text[i])) {
          const nameStart = i;
          while (i < text.length && isIdentPart(text[i])) i++;
          tokens.push({ kind: "nodeRef", text: text.slice(nameStart, i), line, column, endColumn: i + 1 });
        } else {
          error(line, column, column + 1, "A $ must be followed by a node's name, like $Player or $\"Player 2\".");
        }
        lineHasTokens = true;
        continue;
      }
      const two = text.slice(i, i + 2);
      if (TWO_CHAR_OPS.has(two)) {
        tokens.push({ kind: "op", text: two, line, column, endColumn: column + 2 });
        i += 2;
        lineHasTokens = true;
        continue;
      }
      if (ONE_CHAR_OPS.has(c)) {
        if (c === "(") depth++;
        else if (c === ")" && depth > 0) depth--;
        tokens.push({ kind: "op", text: c, line, column, endColumn: column + 1 });
        i++;
        lineHasTokens = true;
        continue;
      }
      error(line, column, column + 1, `Unexpected character "${c}".`);
      i++;
    }

    if (depth === 0 && lineHasTokens) {
      tokens.push({ kind: "newline", text: "", line, column: text.length + 1, endColumn: text.length + 1 });
      lineHasTokens = false;
    }
  }

  const lastLine = lines.length;
  if (depth > 0) error(lastLine, 1, 2, 'A "(" is never closed.');
  if (lineHasTokens) tokens.push({ kind: "newline", text: "", line: lastLine, column: 1, endColumn: 1 });
  while (indents.length > 1) {
    indents.pop();
    tokens.push({ kind: "dedent", text: "", line: lastLine, column: 1, endColumn: 1 });
  }
  tokens.push({ kind: "eof", text: "", line: lastLine, column: 1, endColumn: 1 });
  return { tokens, diagnostics };
}
