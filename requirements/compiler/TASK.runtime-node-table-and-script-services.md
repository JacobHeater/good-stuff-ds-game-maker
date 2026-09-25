---
status: done
component: compiler
related: [scripting/STORY.write-and-run-scripts.md, TASK.compile-scripts-to-c.md, TASK.ds-runtime-c-template.md, TASK.compile-sounds.md, BUG.rom-lighting-breaks-on-scaled-meshes.md]
---

# Task: The runtime's node table, dynamic transforms and script services

## Context
The runtime was deliberately free of scene logic: every transform was baked into a constant matrix by the compiler, and there was no
hierarchy at run time (`TASK.ds-runtime-c-template.md`). Scripts move nodes, so the runtime now needs to know the tree, but only as
much as it takes to do that.

## Description
- **Node table.** The compiler emits every node it keeps, in tree order (a parent before its children): its parent, kind, local
  position / rotation (degrees) / scale as 20.12 numbers, initial visibility, its baked world matrix (rotation and translation) and cumulative
  scale, whether it is *dynamic*, and its audio player index (or none). Meshes, the camera and the lights refer to their node instead of
  carrying a matrix.
- **Dynamic nodes.** A node is dynamic when a script writes its `position`, `rotation` or `scale`, and so are its descendants. Every other node
  keeps its baked matrix untouched, so a scene no script moves is drawn exactly as before (the emulator tests for lighting and silhouettes
  are the check on that). Each frame, after the scripts run, the runtime recomputes the dynamic nodes' world transforms, parents first:
  rotation from the Euler angles (XYZ order, matching the editor and the compiler), scale as the component-wise product down the chain
  (the same rotation-and-scale-kept-apart model the lighting fix introduced; a non-uniformly scaled parent with a rotated child is
  approximated, not sheared), position through the parent's rotation and scale. Trigonometry is libnds's lookup table (12-bit fraction).
- **Visibility** is a per-node flag; a node draws only if it and all its ancestors are visible. A hidden subtree is dropped at compile time
  unless it contains a node a script attaches to or refers to with `$Name`, in which case it is kept (initially hidden).
- **Camera and lights.** A dynamic camera's view matrix is the inverse of its world rotation and translation, each frame; a dynamic light's
  direction is its world -Z axis each frame. The first four visible lights are the ones set, each frame.
- **Input.** Each frame `scanKeys()` runs before scripts; scripts read held / pressed / released for the twelve buttons, and the touch
  state and position (`touchRead`).
- **Sound.** Audio players get mutable runtime state (channel, volume, pitch). `play()` starts the sound with the player's current volume,
  pitch and loop (restarting it), `stop()` silences it, and setting volume or pitch changes a playing sound at once (`soundSetVolume`,
  `soundSetFreq`). Autoplay uses the same path.
- **Frame order.** Start-up: set up, start Autoplay sounds, run every `_ready`. Each frame: read input, run every `_process`, update
  dynamic nodes, set camera and lights, draw. `delta` is 1/60 s (1/30 s at 30 FPS) as a 20.12 number.
- The runtime keeps no per-frame allocation; state arrays are allocated once at start-up.

## Acceptance Criteria
```gherkin
Scenario: A scene without moving nodes renders as before
  Given the existing fixtures with no scripts
  Then the emulator tests for silhouettes, textures and lighting pass unchanged

Scenario: A script can move a mesh
  Given a script adding to a cube's position.x every frame
  When the ROM is captured twice a moment apart
  Then the cube is in a different place, further along, each time

Scenario: A script can rotate and scale a mesh
  Given scripts that set a plane's rotation and scale
  Then its silhouette in the emulator matches a reference render of the same values

Scenario: Children follow their parent
  Given a parent moved and rotated by a script, and a static child under it
  Then the child is drawn where the parent's transform puts it, as the editor would

Scenario: Visibility
  Given a hidden cube that a script shows when a button is held
  Then it is not drawn until then, and hiding a parent hides its children

Scenario: The camera and lights can be scripted
  Given a script rotating the camera and one rotating a directional light
  Then the view and the shading change as they would in a reference render

Scenario: Buttons and touch reach scripts
  Given a script that moves a node while a button is held and on touch
  When those inputs are sent to the emulator
  Then the node moves only then, and pressed is true for one frame

Scenario: Sound from scripts
  Given a player with Autoplay off
  Then a script's play() is heard, stop() silences it, and volume and pitch changes are heard, measured on the emulator's audio

Scenario: Per-frame cost
  Given dynamic nodes with a full 2048-triangle scene
  Then the emulator still reports 60 of 60 frames
```
- **Built and verified on the emulator.** The runtime draws from a node table (parent, dynamic, visible, audio, local transform, baked
  world matrix); nodes a script writes, and their descendants, are recomposed every frame. Every earlier silhouette, texture and
  lighting test still passes on it. New tests, all in real melonDS: `script-runtime.rom.test.ts` (12 movement/rotation/scale/
  visibility scenarios compared with a three.js render of the equivalent static scene, a script-driven light, and a full 2048-triangle
  scene still at 60 of 60 frames), `script-input.rom.test.ts` (4: keys and touch injected into melonDS; `pressed` is true for one
  frame), `script-sound.rom.test.ts` (8, measured on the emulator's audio meter).
- Known limits: a non-uniformly scaled node under a rotated parent is drawn with the scale applied component-wise (no shear, as the
  DS matrix stack can't express one); `soundKill` on a channel that has since been reused by another sound can cut that one off
  (the runtime doesn't yet track channel ownership).
- Input injection needs melonDS keys bound, and this machine's config has none, so `tools/ds-toolchain/melonds-input.ps1` runs a
  temporary copy of melonDS with its own config (A=X, B=Z, X=S, Y=A, L=Q, R=W, Start=Enter, Select=Backspace, arrows).
