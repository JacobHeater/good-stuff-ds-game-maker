import { useState } from "react";

import { NewProjectPanel } from "./NewProjectPanel";
import { OpenProjectPanel } from "./OpenProjectPanel";

/**
 * The landing screen shown whenever no project is open. Offers exactly two
 * entry points — New Project and Open Existing Project — and nothing else.
 */
export function StartupView(): JSX.Element {
  const [screen, setScreen] = useState<"landing" | "new-project" | "open-project">("landing");

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-editor-bg text-editor-text">
      {screen === "new-project" ? (
        <NewProjectPanel onBack={() => setScreen("landing")} />
      ) : screen === "open-project" ? (
        <OpenProjectPanel onBack={() => setScreen("landing")} />
      ) : (
        <div className="flex w-80 flex-col items-stretch gap-6">
          <div className="text-center">
            <h1 className="text-xl font-semibold text-editor-accent">Good Stuff DS Game Maker</h1>
            <p className="mt-1 text-xs text-editor-text-muted">Build Nintendo DS games with a modern editor.</p>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setScreen("new-project")}
              className="rounded bg-editor-accent px-4 py-2 text-sm font-semibold text-editor-bg hover:opacity-90"
            >
              New Project
            </button>
            <button
              type="button"
              onClick={() => setScreen("open-project")}
              className="rounded border border-editor-border bg-editor-panel px-4 py-2 text-sm hover:bg-editor-panel-alt"
            >
              Open Existing Project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
