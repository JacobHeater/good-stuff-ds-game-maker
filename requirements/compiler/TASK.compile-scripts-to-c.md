---
status: done
component: compiler
related: [scripting/STORY.write-and-run-scripts.md, scripting/TASK.script-language-front-end.md, TASK.runtime-node-table-and-script-services.md, TASK.compile-sounds.md, STORY.compile-diagnostics-for-unsupported-content.md, TASK.rom-build-driver.md]
---

# Task: Compile scripts to C

## Context
The compiler turns a project into constant data (`scene_data.c`) that a fixed C runtime draws. Scripts are code, so the compiler also
writes a second generated file, `script_code.c`, that the runtime calls. Scripts are checked first by the shared front end
(`scripting/TASK.script-language-front-end.md`); only a script with no errors is translated.

## Description
- `translateScene3D` finds every node with a script, checks each script (against the scene and the kinds of node it is attached to);
  each error becomes a compile error naming the script, line and column, and the build stops.
- Code generation (`packages/compiler/src/script-codegen.ts`, pure) writes, per script, a state struct (its variables; one array
  element per attached node), one C function per script function taking the instance index, and per attached node an entry in the
  table the runtime walks (`GsScriptInstance { ready, process, node }`). Numbers: `int` is `int32_t`; `float` is `int32_t` 20.12
  fixed point with `gs_mulf`/`gs_divf` (64-bit intermediates, division by zero gives 0); `bool` is `int`; the build uses `-fwrapv` so integer
  wraparound is defined. Node members compile to reads and writes of the runtime's node state, audio members to calls into the runtime's
  audio functions, input to reads of the frame's key state, all declared in the checked-in `runtime/include/gs_api.h`.
- `$Name` becomes a constant node index; node names in comments are made safe like model names. Function and variable names are
  prefixed (`gss<script>_<name>`) so they can never collide with libnds.
- The generated code is deterministic and readable (one C line per script line where practical, with `#line` directives so a gcc error, should one
  ever slip through, points at the script).
- A player whose sound has Autoplay off is no longer warned about (`sound-not-started`) when a script calls `play()` on it.
- The committed fallback `runtime/source/script_code.c` is the empty script table, generated from the cube fixture, and drift-tested like
  `scene_data.c`.

## Acceptance Criteria
```gherkin
Scenario: A script with errors stops the build
  Given a script with a type error
  When the project is compiled
  Then no C is written and the diagnostic names the script, line and column

Scenario: Generated code is checked by the real compiler
  Given every script in the tests
  When the generated C is built with the DS toolchain
  Then it builds with no warnings from gcc

Scenario: Arithmetic is right on the DS
  Given scripts computing int and float arithmetic, conversions, comparisons, short-circuit logic, loops, recursion, and
    the built-in math functions, including division by zero, overflow and negative numbers
  When they run on the DS
  Then every result equals the value the language reference says, checked against results computed independently in TypeScript

Scenario: Each attached node has its own variables
  Given one script attached to two nodes
  Then the generated state has two elements, and the tests show them independent

Scenario: Determinism
  Then the same project gives byte-identical C

Scenario: Scripts and sounds
  Given a sound player with Autoplay off
  Then it is warned about unless a script calls play() on it

Scenario: The fallback runtime still builds by itself
  Then the committed script_code.c equals what the compiler generates for the cube fixture
```

## Notes
- There is no C compiler for the development machine itself, only the ARM one, so the arithmetic is verified by a test ROM that
  runs the generated functions on the DS and writes their results into the framebuffer, which the test reads back from an emulator
  capture (`packages/compiler/src/testing/script-semantics.rom.test.ts`).
- **Built and verified.** `packages/compiler/src/script-codegen.ts` generates `script_code.c` (per-attached-node state instances,
  `_ready`/`_process`, member names `m_<name>`); the build writes it next to `scene_data.c`. Script errors are compile errors listing
  the script, line and column (28 tests in `scripts.test.ts`). Arithmetic is verified on the DS itself: 139 checks in
  `script-semantics.rom.test.ts` (fixed-point multiply/divide, int wrap, division by zero, comparisons, loops, and so on), each with
  a mutation check that a deliberately wrong expected value fails.
- The runtime is built with `-fwrapv -fno-strict-aliasing`. The second flag was added when a moving camera intermittently drew
  nothing; the view maths also moved into one function. It has been stable since, but aliasing as the cause was never proven.
