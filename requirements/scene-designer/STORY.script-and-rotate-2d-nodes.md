---
status: done
component: scene-designer
related: [STORY.sprites-on-the-2d-screen-of-a-3d-project.md, STORY.import-sprite-image.md, scripting/STORY.write-and-run-scripts.md, touch/STORY.touch-areas.md]
---

# Story: Script, rotate and scale the sprites on a 3D project's 2D screen

## Context
The sprites on the 2D screen of a 3D project were static (`STORY.sprites-on-the-2d-screen-of-a-3d-project.md`). A HUD, a cursor that follows the stylus or a spinning
pickup needs scripts that move, turn, scale, show and hide them.

## Decisions (made with the product owner)
- **Scope: the 2D screen of a 3D project.** That is where the script runtime runs. A 2D project's ROM still runs no scripts.
- **Properties: position, rotation, scale and visible, plus Inspector fields.** A Sprite2D gets a Rotation and a Scale X/Y in the Inspector; the 2D viewport draws them and the
  ROM starts a sprite that way.

Choices I made without asking (say if any is wrong):
- **Rotation is in degrees, clockwise on the screen** (Godot's 2D, where y points down), about the sprite's center, which is its `position`.
- **Scale is a factor per axis** between 1/16 and 8, its sign kept (a negative value flips the picture); a script's out-of-range value is held to that, and 0 counts as 1/16.
- **In a script**, on a Sprite2D: `position.x` / `position.y` (screen pixels), `rotation` (one number, degrees), `scale.x` / `scale.y`, `visible`; `+=` and the like work.
  `position.z`, `scale.z` and `rotation.x` are errors. A whole vector copy (`$A.position = $B.position`) works between two 2D nodes, and between two 3D nodes, not across.
- **Hardware:** a rotating or scaled sprite uses one of the sub engine's **32 rotation matrices** and is drawn in a box twice its size (so a turned corner isn't clipped),
  centered on the picture. More than 32 on the screen is an error (`too-many-rotating-sprites`).
- **A sprite gets a matrix if it starts rotated or scaled, or a script writes its position, rotation or scale** (the compiler does not tell a move from a turn). A sprite that
  no script reaches and that starts upright is drawn exactly as before. A sprite a script reaches (is attached to, or names) is followed every frame; one that starts hidden is kept
  so a script can show it; one that is off the screen is kept when it can turn or a script can move it.

## Description
- Model: `SceneNode.transform2D?: { rotation?, scale?: {x?, y?} }` (`core/src/sprite-transform.ts`: defaults, limits, `getSpriteTransform`); the schema accepts it (scale -8..8).
- Script language: the checker treats a Sprite2D's members as above (`isSpriteTarget`, `spriteMember`); rotation resolves to the third rotation slot of the node's state, so the
  generated C is the ordinary `gs_node_state[n].rotation[2]`. A member of a number (`rotation.x`) is now an error instead of silently unknown.
- Compiler: a sprite's node holds x, y, the angle and the scale in the node table (`DsNode`); `DsSprite` gains `node`, `dynamic`, `affine` and its starting rotation and scale
  (`collectSprites` with `SpriteLiveness`; the writer's 3D form of `GsSprite`).
- Runtime (`gs_sprites.c`): each frame the sprites a script can change follow their node: position, visibility and (with a matrix) angle and scale through `oamRotateScale`,
  then `oamUpdate` right after the vertical blank.
- Editor: Inspector `SpriteTransformField` (Rotation, Scale X, Scale Y; typing is one undo step per pause), store action `SET_SPRITE_TRANSFORM`, the 2D viewport draws the picture
  turned and scaled about its center, and auto-complete offers the sprite's members.

## Acceptance Criteria
```gherkin
Scenario: A script turns and moves a sprite
  Given a script attached to a Sprite2D with "rotation += 90.0 * delta" and "position.x += 10.0 * delta"
  Then it checks with no errors, and the compiled sprite is followed every frame with a rotation matrix

Scenario: The Inspector sets the starting rotation and scale, and the viewport shows them
  When the Rotation is set to 45 and Scale X to -2
  Then the picture is drawn turned and mirrored about its center, one undo step per typed value

Scenario: The ROM draws what the editor shows
  Given sprites rotated 90 and 30 degrees, stretched, and mirrored
  Then the emulator's picture matches a reference painted from the same numbers

Scenario: The hardware limit is reported
  Given 33 sprites that rotate or scale on one screen
  Then the build is refused, saying the DS has 32 rotation matrices
```

## Verification
Unit tests: `script/script-sprite.test.ts` (7) and `sprite-transform.test.ts` (core), the schema test (persistence), `sprite-scripts.test.ts` (compiler, 9) and the store tests in
`sprite-edits.test.ts`. One emulator test, `testing/sprites-3d.rom.test.ts` ("rotated and scaled sprites"): 90 degrees clockwise, 30 degrees, stretched and mirrored sprites match the
painted reference at 0.9855, which also confirms the rotation direction. **Not run:** a script moving a sprite on the emulator, the real-app Inspector fields, and the older emulator
and E2E suites after these runtime changes.

## Not built
Scripts on the sprites of a **2D project** (needs a script runtime in the 2D ROM), animating sprite rotation with the animation player, rotating a TouchArea2D or a Label, a pivot other than
the center, and rotation of sprites on the 3D screen.
