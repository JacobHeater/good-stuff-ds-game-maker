---
status: done
component: scripting
related: [SPIKE.scripting-language-approach.md, STORY.write-and-run-scripts.md, TASK.script-language-front-end.md, TASK.script-editor-and-attachment.md, scene-designer/STORY.workspace-tabs-and-screen-filter.md, persistence/TASK.embed-scripts-in-project-file.md, compiler/TASK.compile-scripts-to-c.md, compiler/TASK.runtime-node-table-and-script-services.md]
---

# Epic: Scripting

## Context
Godot pairs its scene editor with a scripting layer attached to nodes, giving them behavior beyond static placement. Until now a
Good Stuff project was a static arrangement of nodes: it could draw a scene and play sounds when the game started, but nothing
could respond to input or change over time. The `Script` workspace tab was reserved for this and empty.

## Narrative
A DS game needs behavior: a player that responds to the D-pad, an enemy that moves, a sound that plays when a button is pressed.
The approach is decided (`SPIKE.scripting-language-approach.md`): a small GDScript-like language, **compiled to C** and built into
the ROM, with scripts embedded in the project and edited in the Script tab. It runs on the DS, not in the editor.

The first slice (`STORY.write-and-run-scripts.md`) covers per-frame updates, buttons and touch, moving/rotating/scaling/showing
nodes, and playing sounds. It is delivered by:
- the language and its checker, shared by the editor and the compiler (`TASK.script-language-front-end.md`);
- storing scripts in the project file (`persistence/TASK.embed-scripts-in-project-file.md`);
- compiling scripts to C (`compiler/TASK.compile-scripts-to-c.md`) and the runtime that supports them: a node table with
  per-frame transforms, input, and sound control (`compiler/TASK.runtime-node-table-and-script-services.md`);
- the Script tab and attaching scripts to nodes (`TASK.script-editor-and-attachment.md`).

Out of the first slice (each a future ticket): signals and custom events, arrays and dictionaries, classes and inheritance,
instancing scenes at runtime, collision physics (asking whether two collision shapes overlap is built: `collision/EPIC.collision-shapes.md`), reading and writing text or save data, a debugger, and an in-editor preview.

## Acceptance Criteria (narrative)
The Epic is done when a user can write a script in the editor, attach it to a node, press Play, and see and hear the game do what the
script says on the emulator, with mistakes reported in the editor before any build starts.

## Outcome
The first slice is built and verified end to end: write a script in the Script tab, attach it from the Inspector, Export ROM (or Play),
and the ROM on melonDS moves, rotates, scales and shows nodes and plays sounds from per-frame code and from buttons and touch.
Mistakes show as underlines and a Problems list before any build, and a script error stops the export naming script, line and column.
Still out (each a future ticket): see the list above, plus a Scene-tree marker for nodes with scripts and vectors as values.
