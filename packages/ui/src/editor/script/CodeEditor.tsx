import { acceptCompletion, autocompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, indentUnit, StreamLanguage, syntaxHighlighting, type StringStream } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, type Command } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { completeScript, type ScriptCompletion, type ScriptDiagnostic, type ScriptSceneContext } from "@goodstuff/core";
import { useEffect, useRef } from "react";

/**
 * The script editor (requirements/scripting/TASK.script-editor-and-attachment.md): CodeMirror with line numbers, syntax colors for the language
 * (keywords, the built-in functions and names, numbers, strings, `$Node` references, comments), an Enter that indents after a `:`, Tab for
 * four spaces, the checker's errors and warnings underlined with their messages on hover, and auto-complete
 * (requirements/scripting/TASK.script-autocomplete.md; what to suggest is decided by `completeScript` in core, this only shows it).
 */

const KEYWORDS = new Set(["var", "func", "if", "elif", "else", "while", "for", "in", "return", "break", "continue", "pass", "and", "or", "not", "range"]);
const BUILTINS = new Set(["abs", "min", "max", "clamp", "sqrt", "sin", "cos", "int", "float", "Input", "self", "play", "stop", "overlaps", "move_and_collide", "is_on_floor", "is_on_wall", "is_on_ceiling"]);
const NODE_MEMBERS = new Set(["position", "rotation", "scale", "visible", "volume", "pitch"]);
const TYPES = new Set(["bool"]);

interface ScriptStreamState {
  /** The next identifier is being declared (after `func`). */
  declaring: boolean;
}

const scriptLanguage = StreamLanguage.define<ScriptStreamState>({
  startState: () => ({ declaring: false }),
  token(stream: StringStream, state: ScriptStreamState) {
    if (stream.eatSpace()) return null;
    if (stream.match("#")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^"[^"]*"?/)) return "string";
    if (stream.match(/^\$"[^"]*"?/) || stream.match(/^\$[A-Za-z_]\w*/)) return "variable-2";
    if (stream.match(/^\d+(\.\d+)?/)) return "number";
    if (stream.match(/^(->|[+\-*/%<>=!]=?)/)) return "operator";
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current();
      if (state.declaring) {
        state.declaring = false;
        return "def";
      }
      if (word === "func") {
        state.declaring = true;
        return "keyword";
      }
      if (word === "true" || word === "false") return "atom";
      if (KEYWORDS.has(word)) return "keyword";
      if (word === "int" || word === "float" || TYPES.has(word)) return "variable-3";
      if (BUILTINS.has(word)) return "builtin";
      return NODE_MEMBERS.has(word) ? "property" : "variable";
    }
    stream.next();
    return null;
  }
});

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c586c0" },
  { tag: tags.string, color: "#ce9178" },
  { tag: tags.number, color: "#b5cea8" },
  { tag: tags.atom, color: "#569cd6" },
  { tag: tags.comment, color: "#6a9955", fontStyle: "italic" },
  { tag: tags.definition(tags.variableName), color: "#dcdcaa" },
  { tag: tags.standard(tags.variableName), color: "#4ec9b0" },
  { tag: tags.special(tags.variableName), color: "#9cdcfe" },
  { tag: tags.typeName, color: "#4ec9b0" },
  { tag: tags.propertyName, color: "#9cdcfe" },
  { tag: tags.operator, color: "#d4d4d4" }
]);

const theme = EditorView.theme(
  {
    "&": { color: "var(--color-editor-text)", backgroundColor: "var(--color-editor-bg)", height: "100%", fontSize: "13px" },
    ".cm-scroller": { fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace", lineHeight: "1.5" },
    ".cm-content": { caretColor: "#ffffff" },
    "&.cm-focused": { outline: "none" },
    ".cm-gutters": { backgroundColor: "var(--color-editor-panel)", color: "var(--color-editor-text-muted)", border: "none" },
    ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.04)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255, 255, 255, 0.06)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(79, 168, 255, 0.28)" },
    ".cm-tooltip": { backgroundColor: "var(--color-editor-panel-alt)", border: "1px solid var(--color-editor-border)", color: "var(--color-editor-text)" },
    ".cm-tooltip-autocomplete > ul": { fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace", maxHeight: "16em" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "rgba(79, 168, 255, 0.35)", color: "var(--color-editor-text)" },
    ".cm-completionDetail": { color: "var(--color-editor-text-muted)", marginLeft: "0.8em", fontStyle: "normal" },
    ".cm-completionInfo": { padding: "4px 8px", maxWidth: "24em", whiteSpace: "normal" }
  },
  { dark: true }
);

/** Enter keeps the indentation of the line, and adds a level after a line that ends in a colon (a new block). */
const enterWithIndent: Command = (view) => {
  const { state } = view;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const indent = /^[ \t]*/.exec(line.text)![0];
  const opensBlock = /:\s*(#.*)?$/.test(state.doc.sliceString(line.from, head));
  view.dispatch(state.update(state.replaceSelection(`\n${indent}${opensBlock ? "    " : ""}`), { scrollIntoView: true, userEvent: "input" }));
  return true;
};

/** A suggestion from core as the editor's own: choosing it puts `insert` in place of the typed word, leaves the cursor `caretBack` characters from its end, and may reopen the list. */
function toCompletion(option: ScriptCompletion, index: number): Completion {
  const insert = option.insert ?? option.label;
  return {
    label: option.label,
    type: option.kind,
    // Keep core's order (the likeliest first) when nothing has been typed to rank by; the editor would sort by letters.
    boost: Math.max(-99, 99 - index),
    detail: option.detail,
    info: option.info,
    apply: (view, _completion, from, to) => {
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length - (option.caretBack ?? 0) }, userEvent: "input.complete", scrollIntoView: true });
      if (option.reopen) startCompletion(view);
    }
  };
}

/** The editor's completion source: asks core what fits at the cursor, given the scene as it is right now. */
function completionSource(getContext: () => ScriptSceneContext | null) {
  return (completionContext: CompletionContext): CompletionResult | null => {
    const context = getContext();
    if (!context) return null;
    const result = completeScript(completionContext.state.doc.toString(), completionContext.pos, context, completionContext.explicit);
    if (!result) return null;
    return { from: result.from, options: result.options.map((option, index) => toCompletion(option, index)), validFor: /^[\w$"]*$/ };
  };
}

/** Marks a change made by this component (showing a different text), so it isn't reported back as something the user typed. */
const fromOutside = Annotation.define<boolean>();

function makeState(value: string, onChange: (value: string) => void, getContext: () => ScriptSceneContext | null): EditorState {
  return EditorState.create({
    doc: value,
    extensions: [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      bracketMatching(),
      lintGutter(),
      indentUnit.of("    "),
      EditorState.tabSize.of(4),
      scriptLanguage,
      syntaxHighlighting(highlight),
      autocompletion({ override: [completionSource(getContext)], icons: false, maxRenderedOptions: 60 }),
      theme,
      keymap.of([{ key: "Enter", run: enterWithIndent }, { key: "Tab", run: acceptCompletion }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.some((t) => t.annotation(fromOutside))) onChange(update.state.doc.toString());
      })
    ]
  });
}

export interface CodeEditorProps {
  /** Which text this is (the script's id): a different one gets a fresh undo history of its own. */
  documentKey: string;
  value: string;
  onChange: (value: string) => void;
  diagnostics: readonly ScriptDiagnostic[];
  /** Move the cursor here (1-based line and column) and focus the editor whenever `nonce` changes. */
  goTo: { line: number; column: number; nonce: number } | null;
  /** What auto-complete needs to know about the project: the scene and the nodes the script is on. Called when a list is opened. */
  getCompletionContext: () => ScriptSceneContext | null;
}

export function CodeEditor({ documentKey, value, onChange, diagnostics, goTo, getCompletionContext }: CodeEditorProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const contextRef = useRef(getCompletionContext);
  contextRef.current = getCompletionContext;
  const shownKey = useRef(documentKey);

  useEffect(() => {
    const created = new EditorView({ state: makeState(value, (text) => onChangeRef.current(text), () => contextRef.current()), parent: host.current! });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // The editor is created once; later changes to `value` and `documentKey` are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A different script gets a new state (and so its own undo history); the same script with a new text (an undo of the scene, say) is
  // shown without becoming a step in the editor's own history.
  useEffect(() => {
    const current = view.current;
    if (!current) return;
    if (shownKey.current !== documentKey) {
      shownKey.current = documentKey;
      current.setState(makeState(value, (text) => onChangeRef.current(text), () => contextRef.current()));
      return;
    }
    if (current.state.doc.toString() !== value) {
      current.dispatch({
        changes: { from: 0, to: current.state.doc.length, insert: value },
        annotations: [fromOutside.of(true), Transaction.addToHistory.of(false)]
      });
    }
  }, [documentKey, value]);

  useEffect(() => {
    const current = view.current;
    if (!current) return;
    const doc = current.state.doc;
    const marks: Diagnostic[] = diagnostics.map((d) => {
      const line = doc.line(Math.min(Math.max(1, d.line), doc.lines));
      const from = Math.min(line.to, line.from + Math.max(0, d.column - 1));
      const to = Math.max(from + 1, Math.min(line.to, line.from + Math.max(0, d.endColumn - 1)));
      return { from, to: Math.min(to, Math.max(doc.length, from)), severity: d.severity, message: d.message };
    });
    current.dispatch(setDiagnostics(current.state, marks));
  }, [diagnostics, value, documentKey]);

  useEffect(() => {
    const current = view.current;
    if (!current || !goTo) return;
    const line = current.state.doc.line(Math.min(Math.max(1, goTo.line), current.state.doc.lines));
    const position = Math.min(line.to, line.from + Math.max(0, goTo.column - 1));
    current.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    current.focus();
    // Only a new request moves the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo?.nonce]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" data-testid="code-editor" />;
}
