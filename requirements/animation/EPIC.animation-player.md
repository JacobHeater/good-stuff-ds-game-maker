---
status: done
component: animation
related: [STORY.animation-player-node.md, TASK.animation-model-and-persistence.md, TASK.animation-timeline-editor.md, TASK.animation-script-control.md, TASK.compile-and-run-animations.md, scripting/EPIC.scripting.md, collision/EPIC.collision-shapes.md]
---

# Epic: The AnimationPlayer

## Context
Things in a game change over time: a door swings, a platform slides, a coin spins, a warning flashes. Until now the only way to change a node over time was to
write that motion in a script, frame by frame. Godot's answer is the `AnimationPlayer` node: you set up keyframes in the editor, and the node plays them.

## Narrative
The first slice (`STORY.animation-player-node.md`) animates **node properties over time**: a node's position, rotation, scale and visibility (and a sound
player's volume and pitch). Keyframes are set on a timeline in the editor, the result can be previewed in the viewport, the animation is built into the ROM and
plays there, and scripts start and stop it (`$Door.play("open")`). It is delivered by:
- the animation data on the node and its place in the project file (`TASK.animation-model-and-persistence.md`);
- the Animation panel with its timeline, and the preview in the viewport (`TASK.animation-timeline-editor.md`);
- `play`, `stop`, `is_playing` and `speed` in the script language (`TASK.animation-script-control.md`);
- the ROM tables and the runtime that plays them (`TASK.compile-and-run-animations.md`).

Out of the first slice (each a future ticket): sprite-sheet frame animation (2D sprites can't be compiled yet), easing curves other than linear and
stepped, animation blending and queues, calling functions or emitting events from a keyframe, animating properties of scripts or materials, animation
signals (`animation_finished`), and reverse playback.

## Acceptance Criteria (narrative)
The Epic is done when a user can add an AnimationPlayer, keyframe a node's movement on a timeline, see it play in the viewport, export a ROM, and watch the
same motion on the emulator, started by autoplay or by a script.

## Outcome
The first slice is built and verified: an `AnimationPlayer` node keyframes node properties (position, rotation, scale, visibility, and a sound player's volume and pitch) on a
timeline in the Animation panel, previews them in the viewport, saves them in the project, builds them into the ROM and plays them there (autoplay, or started from a script with
`play("name")`). The DS's blend agrees with the editor's to within a couple of fixed-point steps, and a project made entirely through the UI ran correctly in melonDS.
