---
status: done
component: scripting
related: [TASK.script-language-front-end.md, STORY.game-state-and-save.md, scene-designer/STORY.labels-and-text.md, compiler/TASK.compile-scripts-to-c.md]
---

# Story: `var` can be a string

## Context
Owner request: "let's add an update allowing var to be strings." Version 1 of the language deliberately left strings out as a
value type (`TASK.script-language-front-end.md`): the only thing a string literal could ever do was name something at compile
time -- a label's text, an animation's name, a scene's name, a button. A `var` couldn't hold one, so there was no way to give a
piece of text a name, reassign it, or hand it to a function.

## Decisions (owner chose from options; say if any is wrong)
- **Named literals, plus `==`/`!=`, nothing else.** A string variable can be declared from a literal, reassigned to another
  literal or another string variable/parameter/return value, passed to and returned from a user function, and compared for
  equality -- and that's all. No joining ("Score: " + score), no ordering (`<` `>`), no built-in string functions. This is a
  deliberate, load-bearing restriction, not a stub for more later: it means every value a string variable can ever hold, at any
  point in the program, is one of the string literals already sitting in the source, known at compile time -- which is what
  lets it compile to a plain pointer to a ROM constant (`STORY.labels-and-text.md`'s existing machinery) instead of needing
  mutable string storage, a string-building routine, or a length limit on the DS.
- **Global strings too**, sharing the numeric globals' `global var` syntax and cross-script rules (same name, same type,
  same starting value in every script that declares it) -- with one safety difference from a numeric global, below.
- **Still literal-only** where a name resolves to a compile-time index, not a runtime value: `play("name")`, `change_scene("x")`
  and `Input.is_button_down("a")` still require an actual string literal, not a variable. These already worked by naming
  something *at compile time* (which animation/scene/button), and a variable's value isn't known until the game runs -- turning
  these into runtime dispatch (a `strcmp` chain against every possible animation name, say) is real new scope, not part of this
  change. `$Label.text = ...` is different: it already compiled to a runtime pointer swap, so a string variable slots in for
  free.

## Description
- **Core** (`packages/core/src/script/`): `ScriptType` gained `"string"` (`ast.ts`) -- it already existed as an `ExprType` for
  a literal used as a name, so this is a widening, not a new concept. `parser.ts`'s `TYPE_NAMES` accepts `string`. `checker.ts`:
  `literalValue`/`literalType` accept a string literal as a valid initializer; `asValue` no longer rejects `"string"` outright
  (declaring, assigning and comparing a string are now legal uses of a value); every place that used to rely on `asValue`'s
  blanket rejection to keep a string out of a numeric context (arithmetic, `<`/`>`/`<=`/`>=`, `move_and_collide`, `ray_cast`,
  `probe_solid`, `Input.touch_ground_x`, `range()`, `requireInt`) now checks for it explicitly instead, with a message
  naming the actual type instead of always saying "not a bool" (the previous, now-stale assumption that bool was the only
  non-numeric value type). `requireAssignable` refuses mixing a string with anything else. `$Label.text = ...` accepts a
  string-typed value, not just a literal token.
- **Globals** (`globals.ts`): `ProjectGlobal.initial` widened to `number | string`; `literalOf` recognizes a string literal.
- **A string global's save-file safety** (`compiler/translate-scene-3d.ts`'s `orderGlobalsForRuntime`,
  `compiler/scene-data-writer.ts`): a string global's runtime value is a pointer to a ROM constant, which a save file can't
  meaningfully round-trip between two builds that differ only in some unrelated string literal shifting where things sit in
  ROM (the existing `gs_global_signature` guard only catches a *set* of globals changing, not this). So every string global is
  sorted to the end of `gs_global[]`, and `gs_global_count` (the save file's own boundary, `gs_save.c`) only spans the numeric
  prefix -- a string global is simply never saved or loaded, always starting fresh at its compile-time value, with no runtime
  (`gs_save.c`) changes needed at all.
- **Codegen** (`compiler/script-codegen.ts`): a local or member string variable's C storage is a real `const char*` (not an
  `int32_t` behind a cast -- nothing reads the per-node state struct's fields uniformly, so there's no reason to hide the real
  type). A *global* string still lives in the numeric `gs_global[]` array (one slot, like every other global), stored as its
  address cast to `int32_t` and cast back to `const char*` on read (safe on the DS: pointers and `int32_t` are both 32 bits).
  `==`/`!=` on two strings compiles to `strcmp(...) == 0` / `!= 0`, not `==`/`!=` on the pointers themselves -- two separate
  occurrences of the same text in the source aren't guaranteed to share one address. A string literal becomes a C string
  constant via the same `cString(fontSafeText(...))` already used for label text (ASCII-only, quotes/backslashes escaped) --
  applied to *every* string literal now, not just ones assigned straight to `.text`, so a string variable is already
  DS-font-safe wherever it ends up.

## Notes (built and verified)
- Unit tests: `core/src/script/script.test.ts` (a `describe("strings", ...)` block: declaring, reassigning, comparing,
  refusing joining/ordering/mismatched-type assignment, a local's initializer can be any string expression while a member/global's
  must still be a literal, a user function taking and returning a string), `core/src/script/script-labels.test.ts` (a string
  variable now works for `$Label.text`, not just a literal), `core/src/script/script-globals.test.ts` (a string global's type
  and mismatch checking), `compiler/src/game-state.test.ts` (a string global's C: the pointer-cast initializer and assignment,
  and that `gs_global_count`/ordering excludes it), `compiler/src/string-vars.test.ts` (new file: the state struct's real
  `const char*` field, local var codegen, `strcmp` equality, a string function signature, and literal escaping). Full
  1156-test fast suite and typecheck (core/persistence/compiler/ui) pass.
- **Not verified:** an actual ROM build (no `testing/*.rom.test.ts` case) -- in particular, the `(int32_t)(intptr_t)"text"`
  static initializer for a string global hasn't been checked against devkitARM's actual GCC, only reasoned about (it's a
  standard, common embedded-C pattern, but this specific compiler/target combination hasn't compiled it yet). **Not built:**
  string concatenation/joining, string ordering, any built-in string function (length, substring, ...), a variable naming an
  animation/scene/button dynamically, and completion/autocomplete beyond the type keyword itself.
