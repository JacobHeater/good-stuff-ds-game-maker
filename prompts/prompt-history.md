This project tracks context and state in a single `context.md` file in this
folder, instead of one numbered markdown file per prompt.

Instructions for the AI agent:

1. At the start of a session, read `context.md` in this folder to load prior
   context: what's been built, key decisions and why, known gotchas/fixes,
   and open threads.
2. After doing meaningful work in response to a user prompt, update
   `context.md` to reflect the new state. Summarize — don't paste the raw
   prompt or a transcript. Capture what changed, the decision made and why,
   and anything a future session would need to avoid re-deriving or
   re-breaking something already solved.
3. Keep `context.md` a living summary, not a running log. Edit stale
   sections in place rather than only ever appending; it should always read
   as "here is the current state of the project," not "here is everything
   that ever happened." If it starts sprawling, tighten it.

Do not shortcut step 1: read `context.md` in full before acting on a new
request in this project.
