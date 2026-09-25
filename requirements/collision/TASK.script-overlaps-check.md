---
status: done
component: collision
related: [STORY.collision-shapes-and-overlap-checks.md, scripting/TASK.script-language-front-end.md, scripting/TASK.script-editor-and-attachment.md, compiler/TASK.compile-scripts-to-c.md]
---

# Task: `overlaps()` in the script language

## Context
`STORY.collision-shapes-and-overlap-checks.md`. Scripts can move and show nodes (`scripting/TASK.script-language-front-end.md`) but can't ask
whether two things touch. Version 1 of the language stays as it was; this adds one function.

## Description
`a.overlaps(b)` returns a `bool`: true while the collision shapes of nodes `a` and `b` overlap. Each of `a` and `b` is `$Name`,
`$"Name with spaces"` or `self`; `overlaps(b)` alone means `self.overlaps(b)`. Both nodes must be `CollisionShape3D` nodes; anything else is
an error that says so and, for a mesh or other node, suggests adding a shape under it and using that shape's name. The argument must be a
node reference (not a number or a variable). `overlaps` becomes a built-in name (it can't be a variable or function name). A hidden shape
never overlaps anything (see the Story). The editor highlights it and lists it in the errors with the other members.

## Acceptance Criteria
```gherkin
Scenario: Checking two shapes
  Given a script attached to a mesh, and shapes named PlayerShape and CoinShape in the scene
  When it says: if $PlayerShape.overlaps($CoinShape):
  Then the script is accepted, and the condition is a bool

Scenario: On self
  Given a script attached to a CollisionShape3D
  Then overlaps($Other) and self.overlaps($Other) are both accepted

Scenario: Not a shape
  Given $Coin is a MeshInstance3D
  When a script calls $Coin.overlaps($CoinShape)
  Then it is an error naming Coin and its kind and saying overlaps() needs a CollisionShape3D

Scenario: The argument must be a node
  When a script calls $A.overlaps(3) or $A.overlaps()
  Then it is an error

Scenario: A script attached to something that is not a shape
  Given a script attached to a MeshInstance3D that calls overlaps($Other)
  Then it is an error saying self is a MeshInstance3D, not a CollisionShape3D

Scenario: The shapes are kept in the game
  Given a shape that is hidden in the scene but named in overlaps()
  Then the compiler keeps it (hidden), as for any node a script names
```

## Notes (built and verified)
- `checkOverlaps` and `requireShape` in `packages/core/src/script/checker.ts`; the `overlapsCall` resolution and `ScriptUsage.selfOverlaps` / `nodeOverlaps`;
  `overlaps` is a reserved name and is highlighted in the code editor. 9 tests in `script-overlaps.test.ts` (the accepted forms, every error message, no cascade
  when the first node is unknown, the bool result).
- The `overlaps(other)` form is `self.overlaps(other)`, so a script attached to a shape can write it without naming itself.
- A script that passes a *mesh* gets an error that says what to do (add a CollisionShape3D under it and use that node's name); this is also the message the
  compiler reports for it (`translateScene3D` refuses the project, naming the script, line and column).
