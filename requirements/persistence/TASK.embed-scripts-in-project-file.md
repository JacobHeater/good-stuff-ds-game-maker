---
status: done
component: persistence
related: [scripting/STORY.write-and-run-scripts.md, scripting/TASK.script-editor-and-attachment.md, TASK.embed-imported-sounds-in-project-file.md, EPIC.project-persistence.md]
---

# Task: Embed scripts in the project file

## Context
Models, textures and sounds are embedded in the `.gsds` so a project is one file. Scripts are too
(`scripting/SPIKE.scripting-language-approach.md`). Unlike imported assets, a script is what the user wrote, so it is never
dropped for being unused.

## Description
- `ProjectSnapshot.scripts?: ProjectScript[]`, each `{ id, name, source }`; absent when there are none, so a project that never had one
  is byte-identical to before. `formatVersion` stays 1 (additive; a build from before refuses a project that has scripts).
- `SceneNode.scriptId?: string` names the script attached to a node.
- The JSON schema describes both. The validator checks what the schema can't: script ids are unique, names are non-empty, and every
  `scriptId` names a script in the file.
- `withUpdatedScene` keeps every script (even unattached ones); `duplicateSceneNode` keeps the attachment.

## Acceptance Criteria
```gherkin
Scenario: A project without scripts is unchanged
  Given a project that never had a script
  Then its saved file has no "scripts" key and no "scriptId" on any node

Scenario: Scripts round-trip
  Given a project with two scripts, one attached to two nodes and one unattached
  When it is saved and loaded
  Then the scripts (including line breaks, tabs and non-ASCII text) and the attachments are identical

Scenario: An unattached script is kept on save
  Then withUpdatedScene keeps every script

Scenario: A node naming a missing script is rejected
  Given a node whose scriptId isn't in the file
  Then the file is rejected and the message names the node and the id

Scenario: Bad scripts are rejected
  Given duplicate script ids, an empty name, or a source that isn't a string
  Then the file is rejected with a message naming the script

Scenario: Duplicating a node keeps its script
  Then the copy has the same scriptId
```
- **Built and verified.** `project.scripts` and `SceneNode.scriptId` in the JSON schema and validator, `formatVersion` still 1 (older
  builds reject a file with the new keys, because the schema forbids unknown ones, as with sounds). 6 tests in `project-script-schema.test.ts`; the
  E2E confirms the exact text (tabs, non-ASCII, trailing newline) survives a save and reopen and that an unattached script is kept.
