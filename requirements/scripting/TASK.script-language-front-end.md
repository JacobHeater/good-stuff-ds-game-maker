---
status: done
component: scripting
related: [STORY.write-and-run-scripts.md, SPIKE.scripting-language-approach.md, TASK.script-editor-and-attachment.md, compiler/TASK.compile-scripts-to-c.md]
---

# Task: The script language and its checker

## Context
The editor needs to show a script's mistakes as it is typed, and the compiler needs to refuse a script with mistakes and then
translate it. Both must agree exactly on what is valid, so the language front end (lexer, parser, type checker) is one
implementation, in `@goodstuff/core` (`packages/core/src/script/`, pure, no Electron or DOM), used by the UI for live diagnostics and by
the compiler before it generates C. The C generation itself is `compiler/TASK.compile-scripts-to-c.md`.

## Description
`checkScript(source, context)` returns the script's syntax tree (when there is one) and a list of diagnostics with a line, column
and message; a script with any error diagnostic can't be compiled. `context` is the scene tree (to resolve `$Name`) and the kinds
of node the script is attached to (what `self` is).

### Language reference (version 1)
**Layout.** Blocks are made by indentation, as in GDScript: a line ending in `:` opens a block, its lines are indented further, and it
ends at the first line indented less. Spaces or tabs, but one script must not mix them. `#` starts a comment. Blank and comment-only
lines are ignored. Inside `( )` a line may continue on the next.

**Types.** `int` (32 bit, wraps on overflow), `float` (the DS's 20.12 fixed-point number: range about +-524288, step 1/4096; the DS has
no floating-point hardware), `bool`. A function that returns nothing is `void` (there is no `void` keyword).

**Top level.** `var name = value` or `var name: type = value` declares a variable that keeps its value between frames (one copy per
node the script is attached to). The initial value must be a literal (`1`, `-2`, `1.5`, `true`, `false`, or a `-` before a number).
`func name(param: type, ...) -> type:` declares a function; the `-> type` is left out for none. `_ready()` (no parameters) and
`_process(delta)` (one parameter; it is a `float`, the seconds since the last frame) are called by the game. Functions may call each other in any
order, and themselves.

**Statements.** `var x = expr` / `var x: type = expr` (a local; visible to the end of its block), `x = expr`, `x += expr` (also `-=`,
`*=`, `/=`, `%=`), `if` / `elif` / `else`, `while`, `for i in range(n)` and `for i in range(a, b)` (`i` is an `int`, `n` and `a` and `b`
are evaluated once), `break`, `continue`, `return` and `return expr`, `pass`, and a call on its own line.

**Expressions.** Literals; names; `( )`; unary `-` and `not`; `* / %`; `+ -`; `< <= > >= == !=`; `and`; `or` (the last two stop early).
`int` and `float` mix: an `int` next to a `float` becomes a `float`. A `float` never becomes an `int` by itself: use `int(x)`,
which drops the fraction toward zero. `%` is for `int` only. Dividing an `int` by zero, or a `float` by zero, gives 0 rather
than crashing.
`bool` is only `true`, `false`, comparisons and `and`/`or`/`not`. There is no implicit conversion between `bool` and numbers.

**Built-in functions.** `abs(x)`, `min(a, b)`, `max(a, b)`, `clamp(v, lo, hi)` (same type as their arguments; `int` mixed with `float`
gives `float`), `sqrt(x)` (`float`), `sin(degrees)` and `cos(degrees)` (`float` in, `float` out, in -1..1), `int(x)`, `float(x)`.

**Input.** `Input.is_button_down("a")` (held), `Input.is_button_pressed("a")` (went down this frame), `Input.is_button_released("a")`
(went up this frame). The name is a string literal and must be one of `a b x y l r start select up down left right`.
`Input.is_touching()` (bool), `Input.touch_x()` and `Input.touch_y()` (`int` pixels, 0..255 and 0..191; 0 when not touching).

**Nodes.** `self` is the node the script is attached to; its members can be used without `self.`. `$Name` (or `$"Name with spaces"`)
is another node, found by its name in the scene (it must exist, and exactly once). Members, for any node with a 3D transform:
`position`, `rotation` (degrees) and `scale`, each with `.x`, `.y` and `.z` (`float`, read and write), and `visible` (`bool`,
read and write). A hidden node stays hidden until `visible = true`, and so do its children. `position` etc. are relative to the
node's parent, as in the editor's Inspector.
For an `AudioStreamPlayer`: `play()` (start its sound from the beginning; restarts it if already playing), `stop()`, `volume`
(`float`, 0..1, read and write, applies at once) and `pitch` (`float`, 0.25..4, read and write, applies at once).
For a `CollisionShape3D`: `a.overlaps(b)` (`bool`), true while the collision shapes of nodes `a` and `b` overlap; `a` and `b` are `$Name` or `self`, and `overlaps(b)` means
`self.overlaps(b)` (`collision/TASK.script-overlaps-check.md`).
For a node with a collision shape under it (a body, or a shape itself): `move_and_collide(dx, dy, dz)` (`bool`: moves the node, stopped by solid shapes) and `is_on_floor()`,
`is_on_wall()`, `is_on_ceiling()` (`bool`) (`collision/STORY.solid-shapes-and-move-and-collide.md`).
For an `AnimationPlayer`: `play("name")` (the name of one of its animations, in quotes), `stop()`, `is_playing()` (`bool`) and `speed_scale` (`float`, read and write)
(`animation/TASK.animation-script-control.md`).
Whole vectors are not values in version 1: use `position.x`, not `position`.

**Scope.** Names are case sensitive. A name can't be declared twice in one scope or shadow a variable or function; keywords
(`var func if elif else while for in return break continue pass and or not true false range`) and built-in names can't be used as names.

**Not in version 1:** classes, `extends`, signals, arrays, dictionaries, strings as values, vectors as values, `const`,
`match`, ternary `if`, `await`, and instancing scenes.

### Diagnostics
Each has a `line` and `column` (1-based) and an end column, a message written for the script author, and a severity. Errors include:
syntax errors (expected `:`, unexpected indent, unterminated `(`), unknown name / function / member / button / node, ambiguous or
missing `$Name`, wrong argument count or type, assigning a `float` to an `int`, a `bool` used as a number and the reverse, `return` type
mismatches and a non-void function that can reach its end without returning, `break`/`continue` outside a loop, invalid hook signatures,
a literal out of range, an initial value that isn't a literal, using a node's member that its kind doesn't have (for example
`play()` on a mesh), and writing to something read-only. Warnings: an unused local, unreachable code after `return`.

## Acceptance Criteria
```gherkin
Scenario: Valid scripts produce no errors and a syntax tree
  Given the example script in the story
  Then checkScript reports no errors and returns its functions and variables

Scenario: Indentation makes blocks
  Given nested if, while and for blocks, blank lines and comments between them
  Then they parse as nested blocks, and inconsistent indentation, mixed tabs and spaces, and a missing block are errors with a line

Scenario: Types are checked
  Given int, float and bool values
  Then an int next to a float is a float, a float into an int is an error with a hint to use int(x), a bool used as a number is an error,
    % on floats is an error, and both branches of a comparison must agree

Scenario: Every kind of mistake has a located message
  Given scripts with an unknown variable, unknown function, wrong argument count, wrong argument type, unknown button name, unknown member,
    a missing return, a duplicate declaration, break outside a loop and a bad hook signature
  Then each gives one error at the right line and column with a message that names the problem

Scenario: Nodes are resolved against the scene
  Given a scene with nodes named Player and Music
  Then $Player and $Music resolve, $Nobody is an error, a name used by two nodes is an error, and $"Name with spaces" works

Scenario: Members depend on the node's kind
  Given a script attached to a MeshInstance3D and one attached to an AudioStreamPlayer
  Then play() is valid on the second and an error on the first, and position is valid on the first and an error on an AudioStreamPlayer

Scenario: A script attached to several kinds must be valid for all of them
  Given a script that calls play() attached to an AudioStreamPlayer and to a Camera3D
  Then it is an error, naming the Camera3D

Scenario: Variables need literal initial values
  Given var x = 1 + 2
  Then it is an error saying the initial value must be a literal

Scenario: Numbers must fit the DS
  Given an int literal over 32 bits or a float literal beyond +-524287
  Then it is an error

Scenario: Diagnostics don't stop at the first error
  Given a script with three unrelated mistakes
  Then all three are reported
```

## Notes
- Version 1 of the language is deliberately small; the reference above is the contract and the tests are written from it.
- **Built and verified.** `packages/core/src/script/` (lexer with indentation tokens, recursive-descent parser that recovers and keeps
  going, checker) is shared by the editor (live diagnostics) and the compiler (which refuses a project with a script error). 33 unit
  tests (`script.test.ts`) written from the reference above. Two things the checker does beyond the reference: an operand whose type
  is already unknown because of an earlier error is not reported again (so one unknown `$Node` gives one error, not five), and a
  local or member that is never read is a warning.
- Found by the emulator tests rather than the unit tests: `var x = 0` was rejected as "needs a value" because of a falsy check; fixed.
- Not in version 1 (out on purpose): vectors as values, arrays, classes, signals, string values beyond node names.
