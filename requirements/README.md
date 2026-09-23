# Summary

Think of this folder as a ticketing system like Jira.
This folder defines all the components of the system
and defines the stories, tasks, bugs, epics, etc., that
are necessary to define the functionality of each of the
components of the Good Stuff DS Game Maker (GSDSGM).

## Folder Structure

Each folder represents a component of the GSDSGM. Inside each
folder shall be a set of files in this notation.

- Story => STORY.{brief-description-here}.md
- Task => TASK.{brief-description-here}.md
- Bug => BUG.{brief-description-here}.md
- Epic => EPIC.{brief-description-here}.md
- Spike => SPIKE.{brief-description-here}.md

If you're going to contribute to the functionality of a given
section of the app, you will do by FIRST defining a ticket in
the folder that you are working on. That must be one of the artifacts
submitted _with_ your pull request. Any pull request without
this will be rejected.

If a piece of already-implemented functionality doesn't have a
matching component folder, create the folder (kebab-case, named for
the feature/dock/experience, not necessarily the package name) and
write a ticket documenting the current behavior before moving on.
Missing a folder for shipped functionality is itself a gap to close,
not something to leave undocumented.

## Ticket ID / filename

There is no separate numeric ticket ID. The filename (type + brief
description) is the identifier, and is how other tickets reference it
(e.g. "see `scene-designer/STORY.3d-editing-viewport-native-resolution.md`").
Keep the brief description short and stable — renaming a ticket file
breaks anything that referenced it by name.

## Tracking completion status (do not rename files to do this)

A ticket's status lives **inside the file, in frontmatter** — never in
the filename, and a completed ticket is never moved to a "done"
folder. Renaming or moving a file is a `git mv`, and while Git *can*
follow renames (`git log --follow`), it's a similarity heuristic, not
a guarantee, and plain `git log <path>` (and most tools' default file
history view) silently stops at the rename point. A stable path that's
only ever edited in place has none of that fragility — every default
git/GitHub view just works, forever, for that one file.

Status (and the other header fields) go in YAML frontmatter at the top
of the file, not a bold markdown line, so a script could later build a
status dashboard by parsing frontmatter across every ticket instead of
scraping prose:

```yaml
---
status: proposed | in-progress | done
component: { component-folder-name }
related: [ { other ticket filenames this depends on or informs } ]
---
```

`status` is a lightweight field, not a full board — `proposed` for
not-yet-built, `in-progress` while active, `done` once shipped. A
`done` ticket for already-implemented functionality is still valuable:
it's the record of what was decided and why, so it doesn't get
silently re-litigated or re-broken later.

## Ticket Template

Every ticket (Story, Task, Bug, Spike) follows this shape. Epics use
the same frontmatter but a narrative body instead of Gherkin (see
below).

```markdown
---
status: proposed | in-progress | done
component: { component-folder-name }
related: [ { other ticket filenames, if any } ]
---

# {Story|Task|Bug|Spike}: {Title}

## Context
Why this exists — background, prior decisions, links to relevant code
paths. For retroactively-documented (already-shipped) tickets, this is
where the "why we built it this way" history belongs, especially if
an earlier approach was tried and rejected.

## Description
What needs to be true when this is done (Story/Task/Bug), or what
question needs answering (Spike).

## Acceptance Criteria
\`\`\`gherkin
Scenario: ...
  Given ...
  When ...
  Then ...
\`\`\`

## Notes
Optional: implementation notes, explicitly out-of-scope items, open
questions.
```

## Acceptance Criteria

All acceptance criteria associated with any ticket that
has acceptance criteria, which is all of them, shall be written
in Gherkin syntax, except for Epics, whose ACs shall be written
in narrative format.
