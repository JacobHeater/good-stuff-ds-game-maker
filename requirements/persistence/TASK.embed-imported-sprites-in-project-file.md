---
status: done
component: persistence
related: [EPIC.project-persistence.md, TASK.embed-imported-textures-in-project-file.md, scene-designer/STORY.import-sprite-image.md]
---

# Task: Embed imported sprite images in the project file

## Description
Sprite images travel inside the `.gsds`, already converted, like textures.

- `ProjectSnapshot.sprites?: ImportedSprite[]` and `SceneNode.spriteId?`. `formatVersion` stays 1 (additive; an older build refuses a
  file it doesn't know the keys of). The `sprites` key is absent when there are none, so a project that never imported one is byte-identical
  to before.
- An `ImportedSprite` is `{ id, name, width, height, palette, pixels }`: `pixels` is base64 of one palette index per pixel (row 0 on
  top), `palette` base64 of little-endian RGB15 entries with index 0 the transparent slot.
- The JSON schema has the shapes; `JsonSchemaProjectSnapshotValidator` checks what a schema can't: a size that is one of the DS's sprite
  sizes, valid base64, exactly `width * height` pixel bytes, a palette of 1 to 256 entries that every pixel index fits in, unique ids, and
  that every node's `spriteId` names an image in the file (the message names the sprite).
- `withUpdatedScene` drops images no node uses.

## Acceptance Criteria
```gherkin
Scenario: A project without sprite images is unchanged
Scenario: Saving and reopening keeps the image and the sprite that uses it
Scenario: A sprite naming an image the file lacks is refused, naming the sprite
Scenario: A wrong size, wrong-length pixels, bad base64, an out-of-range palette index or a duplicate id is refused
Scenario: An image no sprite uses is dropped on save
```
Covered by `packages/persistence/src/json/imported-sprite-schema.test.ts` and `imported-sprite.test.ts`.
