---
status: done
component: touch
related: [STORY.touch-areas.md, scripting/TASK.script-language-front-end.md, collision/TASK.script-overlaps-check.md]
---

# Task: `is_touched()`, `is_touch_pressed()` and `is_touch_released()` in the script language

## Description
- **Language.** On a `TouchArea2D` or `TouchArea3D`, by name (`$Button.is_touched()`) or on the node the script is attached to (`is_touched()` or
  `self.is_touched()`): three calls with no arguments that return a `bool`. Asking any other node is an error naming it ("$Cube is a MeshInstance3D, which
  has no "is_touched""); leaving off the parentheses is an error. The names are reserved (a variable or function of the script can't use them). A script attached to
  a TouchArea3D can also move it (`position`, `visible`, ...); a TouchArea2D has no 3D transform to script.
- **Checker** (`packages/core/src/script/checker.ts`): capability `"touch"`, resolution `touchState` in the syntax tree, and `ScriptUsage.selfTouch` /
  `nodeTouch` so the compiler knows which areas are asked (`touch-area-unused` otherwise).
- **Auto-complete:** the three names after `$Button.` (and bare, on a script attached to a touch area).
- **Codegen:** `gs_touch_state(<node index>, GS_TOUCH_HELD | GS_TOUCH_PRESSED | GS_TOUCH_RELEASED)`.

## Acceptance Criteria
See `STORY.touch-areas.md`. Covered by `packages/core/src/script/script-touch.test.ts` (10 checker tests, 2 auto-complete) and `touch-areas.test.ts` (the C).
