---
status: done
component: animation
related: [STORY.animation-player-node.md, TASK.animation-model-and-persistence.md, properties-panel/STORY.inspector-panel.md, scene-designer/STORY.3d-editing-viewport-native-resolution.md, scene-designer/TASK.undo-redo-for-scene-edits.md]
---

# Task: Edit animations in the Animation panel and preview them in the viewport

## Description
**Inspector** of an AnimationPlayer: **Autoplay** (None or one of its animations), **Speed**, the list of its animations with **New Animation**, **Rename** (a
name field) and **Delete** (with a confirmation), and a hint that an animation does nothing until it autoplays or a script plays it.

**The Animation panel** (a fourth tab of the bottom dock, `Animation`; selecting or adding an AnimationPlayer shows it on that player, and it **stays on that player while
other nodes are selected**, so a node can be selected and its values changed between one key and the next; selecting another node ends a running preview):
- the animation picker, **Length** (seconds) and **Loop**;
- the track list on the left: each row names the node and the property (`Player: position`), with a delete button; **Add Track** picks a node from the scene and a
  property it has (a mesh or group: position, rotation, scale, visible; an audio player also volume and pitch);
- a timeline on the right, in seconds, with a key marker for each key on each track's row and a **playhead**: clicking or dragging the ruler moves it;
- **Add Key** puts a key on the selected track at the playhead's time with the node's current value for that property (the Inspector's value); clicking a marker
  selects a key; the selected key's **time** and **value** (X/Y/Z, a number or a checkbox) are edited in fields below; **Delete Key**;
- **Play** and **Stop** for the preview, which runs the animation at its speed from the playhead (looping if it loops) and stops at the end otherwise.

**Preview in the viewport:** while the playhead is moved or the preview plays, the 3D viewport shows every animated node with the animation's value at that time.
This is display only: the nodes' saved values, the Inspector's fields and the undo history are unchanged, and when the preview stops the viewport shows the scene
as it is. Selecting another node or leaving the AnimationPlayer ends it.

**Edits** (new animation, rename, delete, length, loop, add or delete a track, add, move or delete a key, edit a key's value, autoplay, speed) are undoable
steps; typing in a number field is one step per pause. **Deleting a node** removes the tracks that target it (one undo brings both back).

## Acceptance Criteria
```gherkin
Scenario: Animations of a player
  Given an AnimationPlayer
  When New Animation is used twice
  Then it has animations "Animation" and "Animation2", the panel shows the selected one, and renaming, deleting (after confirming) and undo all work

Scenario: Tracks and keys
  Given an animation and a cube at x = -2
  When a position track for the cube is added, a key is added at 0 s, the cube is moved to x = 2 in the Inspector, and a key is added at 2 s
  Then the track has keys (-2 at 0 s) and (2 at 2 s), shown as two markers at the right places

Scenario: Editing a key
  Given a selected key
  When its time is changed to 1 s and its value to 5
  Then it moves on the timeline and keeps its place in the order

Scenario: Scrubbing previews without changing anything
  Given that animation
  When the playhead is put at 1 s
  Then the viewport shows the cube halfway, the Inspector still shows its own position, and the project has no new unsaved change

Scenario: Playing the preview
  When Play is used
  Then the playhead moves at the animation's speed and the cube moves with it, and Stop leaves the scene as it was

Scenario: Deleting an animated node
  Given a track for a node
  When the node is deleted
  Then the track is gone; Ctrl+Z restores the node and the track

Scenario: The panel stays on its player
  Given the panel is on an AnimationPlayer
  When another node is selected and its value changed in the Inspector
  Then the panel is still on the player, and Add Key takes the node's new value

Scenario: Nothing to edit
  When no AnimationPlayer has been selected in the project
  Then the Animation tab says to select an AnimationPlayer
```

## Notes (built and verified)
- **State:** the `ANIM_*` actions in the editor store (20 tests in `animation-edits.test.ts`), with the timeline's own selection and the preview in `animationUi`
  (never saved, never an undo step). A key is found by its time; a new key at a time that already has one takes the new value; the length can't go below the last key; renaming
  refuses a name another animation has. Deleting a node removes the tracks that target it in the same step (`withoutTracksFor`).
- **UI:** `panels/AnimationPlayerField.tsx` (Inspector: Autoplay, Speed, the animation list, New, Name, Delete with confirmation) and `panels/AnimationPanel.tsx` (the
  timeline: animation picker, Length, Loop, Play/Stop/End Preview, Add Track, Add Key, Delete Key/Track, a ruler you click or drag, key markers, the key's time and value
  fields). The preview is drawn by `Viewport3D.tsx` from `sampleAnimation`, in place of the nodes' own values.
- **Through the real app:** `tests/prototypes/e2e/animation.mjs` (10 checks): adding a player, New Animation and renaming (a name another animation has is refused), a position
  track and keys made on the timeline (a key takes the node's current value; its time is editable), the viewport read from screenshots at 0, 1 and 2 s (the cube is left, middle,
  right and the Inspector still shows its own position), Play running and ending by itself, undo/redo, a rotation track made the same way, a script's `play("nope")` error listing the
  animations, deleting an animated node and undoing it, save and reopen, and an export.
- Found by that test, fixed: adding an AnimationPlayer didn't open the panel (it doesn't go through selection), and a panel tied to the selection closed as soon as the cube was
  selected to change its value; it now follows the last AnimationPlayer selected.
- **Not done:** dragging key markers with the mouse (change a key's time in its field), copy/paste of keys, zooming the timeline, an undo step for the preview (it is not an edit).
