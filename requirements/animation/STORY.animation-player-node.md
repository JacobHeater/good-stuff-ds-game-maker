---
status: done
component: animation
related: [EPIC.animation-player.md, TASK.animation-model-and-persistence.md, TASK.animation-timeline-editor.md, TASK.animation-script-control.md, TASK.compile-and-run-animations.md, scripting/STORY.write-and-run-scripts.md, audio/STORY.import-sound-and-audio-player.md, properties-panel/STORY.inspector-panel.md, scene-designer/TASK.undo-redo-for-scene-edits.md]
---

# Story: An AnimationPlayer that keyframes node properties over time

## Context
See `EPIC.animation-player.md`. There is no animation node yet.

## Decisions (made with the product owner)
- **It animates node properties over time** (not sprite-sheet frames, which need 2D sprites that can't be compiled yet): position, rotation, scale and
  visibility of any 3D node, and the volume and pitch of an audio player.
- **A timeline panel with keyframes** in the editor, not a table in the Inspector: add tracks and keys, scrub, and preview the animation in the viewport.
- **Scripts start and stop it** (`play("name")`, `stop()`), and an animation can also autoplay when the game starts.

Choices I made without asking (say if any is wrong):
- **An AnimationPlayer holds several named animations**, as in Godot. Each animation has a **length** in seconds and a **Loop** setting, and a set of **tracks**.
- **A track animates one property of one node** (chosen by node, not by path: it keeps working when the node is renamed). Its **keys** are
  (time, value) pairs; between two keys the value is a **straight-line (linear) blend**, before the first key it is the first key's value, after the last it is
  the last key's. **Visibility is stepped** (it changes at the key, it doesn't fade). Rotation is in degrees and blends the numbers as they are (0 to 360 is a full
  turn; 350 to 10 goes the long way round, as in the Inspector).
- **What a track can target:** position, rotation, scale and visibility on any node with a 3D transform; volume and pitch on an audio player. A track for a
  property the node doesn't have is an error.
- **Playing:** `play("name")` starts that animation from its beginning at the player's speed (1 = normal; it can be changed, 0.5 is half speed, 2 double).
  A looping animation goes round until stopped; one that doesn't stops on its last frame (`is_playing()` becomes false and the values stay). `stop()` stops it
  where it is. An animation writes only the properties it has tracks for, only while it is playing, and **it wins over a script in the same frame** (animations run
  after scripts). Each player plays one animation at a time (a second `play` replaces the first).
- **Autoplay:** an AnimationPlayer has an **Autoplay** setting (none, or one of its animations) that starts when the game starts.
- **Preview in the editor:** the timeline's play button and scrubbing show the animation in the 3D viewport. They only *show* it: the nodes' saved values are not
  changed, and when the preview ends the scene is as it was.
- **A key stores the value it was given.** "Add key" takes the node's current value for that property (what the Inspector shows) at the playhead's time; the
  key's time and value can then be edited.
- **Deleting a node deletes the tracks that animate it**, in the same undo step.

## Description
- **The node:** `AnimationPlayer` in the Scene > Add Node list (2D and 3D projects, like `AudioStreamPlayer`; it has no place in the scene of its own).
  Its **Inspector**: Autoplay, Speed, and a list of its animations with New / Rename / Delete. A **hint** says an animation does nothing until it autoplays or a
  script plays it (a compile warning says so too).
- **The Animation panel** (a tab of the bottom dock; selecting or adding an AnimationPlayer opens it, and it stays on that player while other nodes are selected, so a
  node's values can be changed between keys): the animation picker, its Length and Loop, and a timeline.
  Tracks are listed on the left (node and property), keys sit on the timeline at their times; a playhead is dragged or clicked to a time; buttons add a track,
  add a key at the playhead, delete the selected key or track; the selected key's time and value are edited in fields; Play/Stop preview the animation.
- **Scripts:** `$Anim.play("open")`, `$Anim.stop()`, `$Anim.is_playing()`, `$Anim.speed_scale` (read and write; named as in Godot, so it doesn't clash with a script's own
  `speed`); `play("open")` alone when the script is attached to the player. The name must be an animation of that player (checked as you type).
- **The ROM:** the animations are built in and the runtime plays them each frame.
- **The project file** stores each player's animations, tracks and keys (`animation` on the node).

## Acceptance Criteria
```gherkin
Scenario: Adding an AnimationPlayer
  When an AnimationPlayer is added
  Then it appears in the Scene tree, and its Inspector lists no animations and says it does nothing yet

Scenario: Making an animation
  Given an AnimationPlayer is selected
  When an animation "slide" of length 2 s is created and a position track for a cube is added
  And keys are added at 0 s (x = -2) and 2 s (x = 2)
  Then the timeline shows the track with two keys, and the animation is saved with the project

Scenario: Previewing
  Given that animation
  When the playhead is moved to 1 s
  Then the viewport shows the cube at x = 0, while its Inspector and saved position are unchanged
  And playing the preview moves the cube from -2 to 2 and back to where it was when it stops

Scenario: Interpolation
  Given a track with keys at 0 s (0) and 2 s (10)
  Then at 0.5 s it is 2.5, at 2 s 10, before 0 s 0 and after 2 s 10
  And a visibility track changes only at its keys

Scenario: Deleting what is animated
  Given a track animates a node
  When the node is deleted
  Then the track goes with it, and one Ctrl+Z brings back both

Scenario: Autoplay on the DS
  Given an animation that moves a cube from x = -2 to x = 2 in 1 s, and Autoplay set to it
  When the ROM runs on the emulator
  Then the cube ends at x = 2, and while it plays it is where the animation says it should be

Scenario: A script starts it
  Given an animation that is not autoplay and a script that calls $Anim.play("slide") when A is pressed
  Then nothing moves until A is pressed, and then the cube moves

Scenario: Looping, stopping and speed
  Given a looping animation
  Then it keeps going round, stop() freezes it, and at speed 2 it goes twice as fast

Scenario: An animation nothing starts is reported
  Given an AnimationPlayer whose animations are neither autoplay nor played by a script
  Then Export ROM warns that it does nothing

Scenario: Mistakes in a script
  When a script calls $Anim.play("nope") for an animation the player doesn't have
  Then it is an error listing the player's animations
```

## Notes (built and verified)
- Delivered by the four tasks in `related`. The whole path was run through the real editor and on the emulator: `tests/prototypes/e2e/animation.mjs` (10 checks) makes two animations on a
  cube through the Animation panel's timeline, previews them in the viewport, and exports; `GSDS_ANIMATION_ROM_PROJECT` then runs that ROM, where the autoplay animation and a
  script-started one do what they were authored to do. The DS's interpolation is compared with the editor's sampling on random tracks (31 checks).
- Still out (see the Epic): sprite-sheet frame animation, easing curves, blending and queues, keyframe events, `animation_finished`, reverse playback, and dragging keys with the mouse.
