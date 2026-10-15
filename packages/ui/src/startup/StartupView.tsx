import { useState } from "react";

import { ConverterPanel } from "./ConverterPanel";
import { NewProjectPanel } from "./NewProjectPanel";
import { OpenProjectPanel } from "./OpenProjectPanel";

type Tab = "project" | "converter";

/**
 * The landing screen shown whenever no project is open. The "Project" tab offers the two project entry points (New
 * Project and Open Existing Project); the "Converter" tab (requirements/compiler/STORY.nitro-native-format-
 * converter.md) converts a single file straight to a real Nintendo DS native format, with no project involved.
 */
export function StartupView(): JSX.Element {
  const [screen, setScreen] = useState<"landing" | "new-project" | "open-project">("landing");
  const [tab, setTab] = useState<Tab>("project");

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-editor-bg text-editor-text">
      {screen === "new-project" ? (
        <NewProjectPanel onBack={() => setScreen("landing")} />
      ) : screen === "open-project" ? (
        <OpenProjectPanel onBack={() => setScreen("landing")} />
      ) : (
        <div className={`flex flex-col items-stretch gap-6 ${tab === "converter" ? "w-[28rem]" : "w-80"}`}>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-editor-accent">Good Stuff DS Game Maker</h1>
            <p className="mt-1 text-xs text-editor-text-muted">Build Nintendo DS games with a modern editor.</p>
          </div>

          <div role="tablist" aria-label="Startup" className="flex gap-1 border-b border-editor-border">
            {(["project", "converter"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={tab === option}
                onClick={() => setTab(option)}
                className={`-mb-px rounded-t px-3 py-1.5 text-xs font-semibold capitalize ${
                  tab === option ? "border border-b-0 border-editor-border bg-editor-panel text-editor-text" : "text-editor-text-muted hover:text-editor-text"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          {tab === "project" ? (
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
          ) : (
            <ConverterPanel />
          )}
        </div>
      )}
    </div>
  );
}
