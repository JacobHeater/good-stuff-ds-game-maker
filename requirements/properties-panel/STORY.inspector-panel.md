---
status: done
component: properties-panel
related: [scene-designer/EPIC.scene-designer.md, node-list]
---

# Story: Inspector panel

## Context
Godot's Inspector dock edits the properties of whatever node is
currently selected. `InspectorPanel`
(`packages/ui/src/editor/panels/InspectorPanel.tsx`) is that
equivalent, docked on the right side of the editor. Its field set
differs for 2D vs. 3D nodes, since they carry different transform
shapes in the domain model (`SceneNode.position` for 2D,
`SceneNode.transform3D` for 3D).

## Description
Show the selected node's name and kind, a (currently read-only/
disabled) screen selector, its editable transform fields, and a
visibility checkbox. If nothing is selected, show a placeholder
message instead.

- 2D nodes (no `transform3D`): editable Position X / Position Y number
  fields, bound to the node's `position`.
- 3D nodes (`transform3D` present): editable Position, Rotation
  (degrees), and Scale, each as X/Y/Z number field triples. If the
  node also has `mesh` data (i.e. it's a `MeshInstance3D`), show its
  primitive name and triangle count as a read-only line.
- `AudioStreamPlayer` nodes (declared with the 2D kinds but not drawn by either pipeline) show
  the **audio player** instead of Position X / Y, since a sound has no place in the scene:
  the sound, a preview, autoplay, volume, pitch and loop
  (`audio/STORY.import-sound-and-audio-player.md`).

## Acceptance Criteria
```gherkin
Scenario: No selection shows a placeholder
  Given no node is selected
  Then the Inspector shows "No node selected." and no editable fields

Scenario: Selecting a 2D node shows Position X/Y fields
  Given a Sprite2D node is selected
  Then the Inspector shows editable "Position X" and "Position Y" fields
  And it does not show Rotation or Scale fields

Scenario: An AudioStreamPlayer shows the audio player, not a position
  Given an AudioStreamPlayer node is selected
  Then the Inspector shows the audio player (Sound, Play, Autoplay, Volume, Pitch, Loop)
  And no Position X / Position Y fields

Scenario: Editing a 2D position field updates the node
  Given a Sprite2D node is selected with Position X of 10
  When the user changes "Position X" to 20
  Then the node's stored X position becomes 20
  And the 2D viewport marker for that node moves to match

Scenario: Selecting a 3D node shows Position/Rotation/Scale fields
  Given a MeshInstance3D node is selected
  Then the Inspector shows editable Position, Rotation, and Scale fields,
    each with X/Y/Z inputs
  And it shows a Mesh selector for the node's mesh, with each option's triangle count: the four
    primitives, then any models imported into the project
    (`scene-designer/STORY.choose-mesh-primitive.md`, `scene-designer/STORY.import-obj-model.md`)
  And it shows a Texture field (None or a project texture) and an "Import PNG..." button
    (`scene-designer/STORY.mesh-textures.md`)

Scenario: Editing a 3D transform field updates the node
  Given a MeshInstance3D node is selected
  When the user changes its Rotation Y field
  Then the node's stored rotation updates to match
  And the 3D viewport re-renders that node with the new rotation

Scenario: The visibility checkbox mirrors and controls the node's visible flag
  Given a selected node's `visible` flag is true
  Then its visibility checkbox is checked
  When the user unchecks it
  Then the node's `visible` flag becomes false
```

## Notes
- The Screen selector is currently always rendered disabled — there is
  no way to reassign a node to a different screen from the Inspector
  yet. That's an intentional current limitation, not a bug; worth its
  own Task if reassigning screens turns out to be needed often enough
  that dragging between viewport screens isn't sufficient.
