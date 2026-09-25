---
status: done
component: animation
related: [STORY.animation-player-node.md, scripting/TASK.script-language-front-end.md, scripting/TASK.script-editor-and-attachment.md, collision/TASK.script-overlaps-check.md]
---

# Task: Controlling an AnimationPlayer from a script

## Description
On an `AnimationPlayer` node (`$Name`, or `self` for a script attached to one):
- `play("name")`: starts that animation from its beginning (a second call restarts it, and replaces any other animation the player is playing). The name is a
  string in quotes and must be an animation of that player; an unknown name is an error that lists the animations it does have.
- `stop()`: stops where it is. `is_playing()` (bool): whether an animation is running. `speed_scale` (float, read and write; 0.05 to 10): the playback speed (the name is
  Godot's, and does not clash with a script's own variable called `speed`).

`play` and `stop` already exist for `AudioStreamPlayer` (`play()` with no arguments); which one is meant follows from the kind of node. Using an animation call
on a sound player, or a sound call on an animation player, is an error saying what the node has. The animation player in the call counts as used for the
compiler's "nothing starts this animation" warning, and every node its tracks animate is kept in the game (even when hidden) and made movable.

## Acceptance Criteria
```gherkin
Scenario: The calls
  Given an AnimationPlayer named Door with an animation "open"
  Then $Door.play("open"), $Door.stop(), $Door.is_playing() and $Door.speed_scale are accepted
  And play("open") alone is accepted in a script attached to Door

Scenario: The name is checked
  When a script calls $Door.play("shut") and Door has "open" and "close"
  Then it is an error saying Door has no animation "shut" and listing open and close

Scenario: Not a string
  When a script calls $Door.play(3) or $Door.play(name)
  Then it is an error saying play needs the animation's name in quotes

Scenario: Sound calls keep working
  Given an AudioStreamPlayer named Music
  Then $Music.play() and $Music.stop() are as before, and $Music.play("x") is an error saying a sound player's play takes nothing

Scenario: Wrong node
  When a script calls $Cube.play("x") on a mesh
  Then it is an error saying a mesh has no play

Scenario: speed_scale is a float property
  Then $Door.speed_scale = 2.0 and var s = $Door.speed_scale are accepted, and $Door.speed_scale = true is an error
```

## Notes (built and verified)
- `checkPlayOrStop` and `checkAnimationCall` in `packages/core/src/script/checker.ts`; the `animCall` resolution (with the animation's place in the player); `speed_scale` as a
  node property; `play`, `stop` on a sound player are unchanged (10 tests in `script-animation.test.ts`, and the older ones still pass). A script not yet attached is taken by its
  arguments (`play("x")` is an animation, `play()` a sound). A script attached to several players needs the name in the same place in each (or it says so).
- The compiler counts a `play("name")` as starting the player (no `animation-not-started` warning) and keeps and makes movable every node the player's tracks animate.
