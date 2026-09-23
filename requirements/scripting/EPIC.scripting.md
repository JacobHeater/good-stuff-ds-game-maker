---
status: proposed
component: scripting
related: [scene-designer/STORY.workspace-tabs-and-screen-filter.md, SPIKE.scripting-language-approach.md]
---

# Epic: Scripting

## Context
Godot pairs its scene editor with a scripting layer (GDScript, or C#/
GDExtension) attached to nodes, giving them behavior beyond static
placement. The Good Stuff DS Game Maker has a `Script` workspace tab
already reserved for this in `WorkspaceToolbar`, but it currently
renders no content at all — nothing about scripting has been designed
or built yet.

## Narrative

A DS game needs behavior, not just a static arrangement of nodes: a
player that responds to input, an enemy that moves, a score that
updates. Godot solves this by attaching script files to nodes in a
language (GDScript) designed for that engine's node/signal model. This
project needs an equivalent, but the right approach isn't obvious yet
given the DS's actual constraints — real DS homebrew typically runs
compiled C/C++ (via devkitPro/libnds), which is a very different
execution environment from an interpreted scripting language layered
on top the way GDScript sits on Godot's C++ core.

Before committing to a scripting UI (an editor, syntax highlighting,
node-to-script attachment, a runtime), the language/execution approach
itself needs deciding — see `SPIKE.scripting-language-approach.md`.
This epic is a placeholder for that decision and the Stories/Tasks that
follow once it's made; no Stories exist under it yet because nothing
has been built.
