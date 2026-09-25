---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, STORY.camera-light-and-material-properties.md, BUG.editor-lighting-differs-from-rom.md, compiler/BUG.rom-lighting-breaks-on-scaled-meshes.md, properties-panel/STORY.inspector-panel.md, TASK.undo-redo-for-scene-edits.md, persistence/EPIC.project-persistence.md]
---

# Story: A light intensity slider

## Context
Every light was full white and full strength. `STORY.camera-light-and-material-properties.md` lists light color and
intensity as missing; this delivers intensity for directional lights (the only lights the DS can draw).

## Description
- The Inspector shows an **Intensity** slider for a `DirectionalLight3D`, from 0% to 100%, starting at 100%.
- **What it means on the DS:** the DS has no light strength, only a light *color*. Intensity is the brightness of a white
  light: the compiler writes the light's color as `round(31 * intensity)` in each channel. So the slider has **31 real
  steps**, not 100, and there is **no brighter than 100%**: full white is the DS's brightest light. Because the DS's
  ambient contribution is multiplied by the light's color too, a dim light dims the ambient as well, and a light at 0%
  contributes nothing (a scene whose only light is at 0% is black, unlike a scene with *no* light, which is unlit).
- The viewport shades with the same value, so what the slider does in the editor is what it does in the ROM.
- The value is saved in the project as `light: { intensity }` on the node (0..1). A light without it (every existing
  project) is at 100%.
- Dragging the slider is **one undo step**; the slider also works from the keyboard.

## Acceptance Criteria
```gherkin
Scenario: The slider is on directional lights only
  Given a DirectionalLight3D is selected
  Then the Inspector shows an Intensity slider at 100%
  And a mesh, a camera and an OmniLight3D show none

Scenario: Intensity changes the light in the viewport
  Given a plane lit straight on by a light
  When the slider is set to 50%
  Then the plane's brightness in the viewport is the DS formula's value for a 50% light
  And at 0% only the lack of any contribution shows (the plane is black)

Scenario: Intensity changes the ROM the same way
  Given the same scene compiled at 100%, 50% and 0%
  Then the emulator's brightness matches the DS formula at each, and the editor's brightness matches the emulator's

Scenario: The value is one of the DS's 31 levels
  Then 50% compiles to a light color of 16 (round(0.5 * 31)), and 100% to 31

Scenario: Existing projects are unaffected
  Given a project saved before this existed
  Then it opens with every light at 100% and compiles as before

Scenario: The value is saved and reopens
  Given a light set to 40%
  When the project is saved, closed and reopened
  Then the slider shows 40%

Scenario: A drag is one undo step
  When the slider is dragged from 100% to 30%
  Then Ctrl+Z restores 100% in one step

Scenario: An out-of-range value can't get in
  Then a file with an intensity below 0 or above 1 is rejected, and the compiler clamps to 0..1 regardless
```

## Notes
- **Built and verified.** 31 new unit tests (the store's intensity edits and undo, schema, the compiler's light color, the DS model),
  the ROM lighting tests (intensity 50% and 0% read the formula in a real ROM), and `lighting-parity.mjs` (9 checks): the slider is
  on directional lights only; Home/End/arrow keys and a real mouse drag work; 50% is DS level 16 and the viewport shows the
  formula's value for it; 0% is black; one Ctrl+Z undoes a whole drag; the value is saved (`{ "intensity": 0.4 }`) and reloads.
- A drag is one undo step because edits of the same light's intensity within a second merge, and pressing or releasing the
  pointer on the slider (or leaving it) ends the gesture, so a drag straight after keyboard changes is its own step.
- The slider shows the DS level ("this is level 16") under it, since the real resolution is 31 steps.
- The slider has 101 positions but the DS has 31 light levels, so neighbouring percentages can compile to the same level.
- Not in this story: light color (hue), per-light shadows (the DS has none), and omni lights.
- A future "light color" property would replace `round(31 * intensity)` white with a real color scaled by intensity.
