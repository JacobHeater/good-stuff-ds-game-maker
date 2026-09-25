---
status: done
component: scripting
related: [EPIC.scripting.md, SPIKE.scripting-language-approach.md, TASK.script-language-front-end.md, TASK.script-editor-and-attachment.md, persistence/TASK.embed-scripts-in-project-file.md, compiler/TASK.compile-scripts-to-c.md, compiler/TASK.runtime-node-table-and-script-services.md, audio/STORY.import-sound-and-audio-player.md, run-games-locally/STORY.play-runs-rom-in-emulator.md, TASK.script-autocomplete.md]
---

# Story: Write a script, attach it to a node, and run it on the DS

## Context
The decisions are in `SPIKE.scripting-language-approach.md`: a GDScript-like language compiled to C, scripts embedded in the
project, edited in the Script tab, running only in the ROM. This story is the first slice of that.

## Description
A user can:
- **Create a script** in the Script tab (a name and an empty body with `_ready` and `_process` stubs), write it in a code editor with
  syntax colors, and see mistakes underlined with messages and listed as they type, with no build needed.
- **Attach it to a node** from the Inspector (a Script field on every node: None, or one of the project's scripts, with New Script and
  Edit buttons). A script can be attached to several nodes; each gets its own copy of the script's variables.
- **Press Play or Export ROM**: the scripts are checked (an error stops the build and is listed in the Output log with the script,
  line and column), compiled to C and built into the ROM. In the emulator:
  - `_ready()` runs once for each attached node, at startup, after the scene is set up and Autoplay sounds have started;
  - `_process(delta)` runs every frame, for each attached node, in scene-tree order, before the frame is drawn;
  - a script can read the DS's buttons and the touch screen, change a node's `position`, `rotation`, `scale` and `visible`,
    and `play()`/`stop()` a sound player and change its `volume` and `pitch`.

The language is in `TASK.script-language-front-end.md` (its reference section). In short:

```
var speed = 2.0                       # a variable that keeps its value between frames

func _ready():
    $Music.play()

func _process(delta):
    if Input.is_button_down("left"):
        position.x -= speed * delta
    if Input.is_button_pressed("a"):
        $Jump.play()
    rotation.y += 90.0 * delta        # 90 degrees a second
```

## Acceptance Criteria
```gherkin
Scenario: A script is created, edited and attached
  Given a project is open
  When a script is created in the Script tab and attached to a node from the Inspector
  Then the Inspector's Script field shows its name on that node
  And the script's source is part of the project and is saved with it

Scenario: Mistakes are shown as they are typed
  Given a script with an unknown name, a type mismatch and a missing colon
  Then each is underlined in the editor with its message and listed with its line and column
  And nothing needs to be built to see them

Scenario: A script with an error stops the build
  Given a script with an error is attached to a node
  When the project is exported or played
  Then no ROM is built and the Output log lists each error with the script's name, line and column

Scenario: _process runs every frame
  Given a script that adds to its node's position every frame
  When the ROM runs in the emulator
  Then the node has moved, and keeps moving

Scenario: _ready runs once
  Given a script that sets a variable and a position in _ready
  Then that happens once at startup and not again

Scenario: Scripts read buttons and the touch screen
  Given a script that moves a node while a button is held
  When that button is held in the emulator
  Then the node moves, and does not when it is not held
  And is_button_pressed is true for one frame only
  And touching the screen gives its position

Scenario: Scripts move, rotate, scale and show or hide nodes
  Given scripts that change position, rotation, scale and visibility of nodes, including a parent and its children
  Then the emulator draws the nodes where those values put them, and children follow their parent

Scenario: Scripts can move the camera and lights
  Given a script on a Camera3D or a DirectionalLight3D that changes its position or rotation
  Then the view or the lighting changes in the emulator

Scenario: Scripts play sounds
  Given a sound player with Autoplay off
  When a script calls play() on it
  Then the emulator produces sound, and stop() silences it
  And changing volume and pitch from the script changes what is heard

Scenario: A script can act on another node
  Given a script using $Name for another node
  Then it moves, shows or plays that node, and a name that doesn't exist, or exists twice, is an error

Scenario: Each attached node has its own variables
  Given one script attached to two nodes
  Then each node's copy keeps its own values

Scenario: Nodes no script touches are drawn as before
  Given a project with scripts on some nodes
  Then every other node is drawn exactly where it was without scripting

Scenario: A sound with Autoplay off that a script starts is not warned about
  Given a player with Autoplay off and a script that calls play() on it
  Then no sound-not-started warning is given for it
```

## Notes
- The first slice has one script per node, no signals, no arrays or dictionaries, no classes, no runtime creation of nodes, and no
  in-editor run. See the Epic for what is out.
- A 2D project's scripts can be written and checked, but a 2D project can't be compiled yet (`compiler/STORY.compile-2d-scene-to-nds-rom.md`).
- **Built and verified.** Delivered by the four tasks listed in `related`. The whole path was run through the real UI:
  `tests/prototypes/e2e/script-editor.mjs` writes and attaches a script, sees its mistakes underlined, exports a ROM, and
  `GSDS_SCRIPT_ROM_PROJECT` runs that project in melonDS where it matches the equivalent static scene. Unit tests 430 pass, emulator
  tests 196 pass (the tests that need a project path from an environment variable are skipped unless it is set), and every older E2E still passes.
- Honest limits: the runtime scenarios and input tests have been rerun a few times but two emulator tests have shown a rare timing
  flake under CPU load (a frame-rate title read `[54/60]` once, an autoplay sound test once); both passed on rerun. OGG import has
  never been exercised with a real file.
