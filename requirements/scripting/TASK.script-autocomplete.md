---
status: done
component: scripting
related: [TASK.script-editor-and-attachment.md, TASK.script-language-front-end.md, STORY.write-and-run-scripts.md, animation/TASK.animation-script-control.md, collision/TASK.script-overlaps-check.md]
---

# Task: Auto-complete in the script editor

## Context
The script editor (`TASK.script-editor-and-attachment.md`) colors and checks code but does not help write it. The language is small but its members depend on
what kind of node is meant (`$Music.volume`, `$Door.play("open")`, `$Player.move_and_collide(...)`), so knowing what to type is the hard part.

## Description
A pop-up list of suggestions in the code editor, opened as you type (and with Ctrl+Space), narrowed as you type more, chosen with Up/Down and Enter or Tab,
closed with Escape. The suggestions come from the language and from **this project**, so they change with the scene:

- **A plain word:** the keywords, the built-in functions (inserted with their brackets, the cursor inside), `Input`, `self`, `true`/`false`, this script's own variables
  and functions, the variables and parameters in scope in the function being edited (`delta` in `_process`), and the members of the node the script is attached to
  written without `self.` (`position`, `visible`, `play`, ...), only those that node kind has. At the start of a line, a few whole-statement templates (`func _process(delta):`, `if`, `for`).
- **After `$`:** the names of the nodes in the scene, each with its kind, offered as `$Name` (a name with spaces becomes `$"Name with spaces"`).
- **After a dot:** `Input.` gives its six functions. `$Name.` gives what that kind of node has: every 3D node `position`, `rotation`, `scale`, `visible`; a sound player
  `volume`, `pitch`, `play()`, `stop()`; an AnimationPlayer `play("name")`, `stop()`, `is_playing()`, `speed_scale`; a collision shape `overlaps(other)`; a node with a shape
  under it (a body) `move_and_collide(dx, dy, dz)`, `is_on_floor()`, `is_on_wall()`, `is_on_ceiling()`. `self.` gives the same for the node(s) the script is attached to
  (everything when it is attached to none). After `position.`, `rotation.` or `scale.` (also `$Name.position.`): `x`, `y`, `z`.
- **Inside quotes:** the button names in `Input.is_button_down("`, `is_button_pressed(` and `is_button_released(`; the animation names of the player in `play("`.
- **Nothing** inside a comment, or where nothing sensible could come next (in a string that isn't one of those, after a number, on a declaration's name).

Each suggestion has a one-line description (its signature and what it does). The suggestion logic is plain code in core (`packages/core/src/script/completion.ts`,
unit-tested); the editor only shows it.

## Acceptance Criteria
```gherkin
Scenario: Words
  Given a script being edited and the letters "mo" typed at the start of a statement
  Then move_and_collide is a suggestion if the script's node can move as a body, and nothing else that starts with "mo"

Scenario: Keywords and built-ins
  When "cl" is typed inside a function
  Then clamp is offered, and choosing it types clamp() with the cursor between the brackets

Scenario: Node names
  Given a scene with nodes Player, Music and "Score Text"
  When "$" is typed
  Then the list shows Player, Music and Score Text with their kinds
  And choosing Score Text writes $"Score Text"

Scenario: Members follow the kind
  Given Music is an AudioStreamPlayer and Cube is a MeshInstance3D
  Then "$Music." offers volume, pitch, play and stop and not overlaps
  And "$Cube." offers position, rotation, scale and visible and not volume

Scenario: A body
  Given a node with a collision shape under it
  Then "$Player." also offers move_and_collide, is_on_floor, is_on_wall and is_on_ceiling

Scenario: Vector parts
  When "position." or "$Cube.rotation." is typed
  Then x, y and z are offered

Scenario: Buttons and animation names
  When Input.is_button_down(" is typed
  Then the twelve button names are offered
  And after $Door.play(" the animation names of Door are offered

Scenario: The script's own names
  Given var speed = 2.0 and a function jump() in the script, and a local var height in the function being edited
  Then "sp" offers speed, "ju" offers jump and "he" offers height there, but not in another function

Scenario: Self members follow the attached node
  Given a script attached to a MeshInstance3D
  Then a plain "vis" offers visible and "vol" does not offer volume

Scenario: Quiet places
  Then nothing is offered inside a comment, or in a string that names nothing

Scenario: In the real editor
  When the Script tab is open and "$" is typed
  Then a pop-up lists the scene's nodes; Enter inserts the choice and the script is still checked as usual
```

## Notes (built and verified)
- **Logic in core, display in the editor:** `packages/core/src/script/completion.ts` (`completeScript(source, offset, context, explicit)` returns where the word starts and the
  candidates for that place, or null) is plain code read from the text before the cursor, not from a parse (the script is half written while typing). It uses the same
  `ScriptSceneContext` as the checker. 30 tests in `completion.test.ts`. `CodeEditor.tsx` wraps it as a CodeMirror completion source (`@codemirror/autocomplete`, added to
  `packages/ui`): the editor narrows and ranks the list as letters are typed; core's order (the script's own names first, then the language's) is kept when nothing is
  typed. `ScriptWorkspace.tsx` passes the current scene and the attached nodes each time a list opens, so the list follows renames and new nodes.
- **Keys:** Enter or Tab takes the highlighted suggestion (Tab still indents when no list is open), Escape closes, Ctrl+Space opens it anywhere a suggestion could go.
  After choosing `is_button_down`, `play` (on an AnimationPlayer) or `overlaps` the list opens again for what goes in the brackets.
- **Through the real app:** `tests/prototypes/e2e/script-autocomplete.mjs` (9 checks, real key presses): `$` lists the scene's nodes with their kinds; typing narrows it and Enter
  inserts; `.` after a sound player gives volume, pitch, play, stop; `Input.is_button_down("` reopens with the twelve buttons and the closing quote isn't doubled; a mesh's
  `position.x`, the script's own `speed` and `delta`; a script typed this way has no problems; nothing in a comment or a plain string; Ctrl+Space and Escape; an AnimationPlayer's
  `play("`; and `func _process(delta):` written for you at the left edge. `script-editor.mjs` (14) and `platformer.mjs` (4) still pass.
- **Found by that test:** the editor ignores Enter and Tab for 75 ms after the list changes (so a key press meant for the text isn't taken), so a script that types and presses
  Tab at once gets an indent. Real typing is not affected; the test waits for the list to settle.
- **Not done:** suggestions for a user function's parameter types, or from the value type an expression needs (`position.x = ` still offers everything); the list doesn't
  know which `$Name` are collision shapes when writing `overlaps(`; no hover documentation for words already typed.
