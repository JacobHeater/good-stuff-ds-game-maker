import { computeSceneBudget, DS_HARDWARE_PROFILE } from "@goodstuff/core";

import { useEditorStore, type BottomTabId } from "../state/editor-store";
import { AnimationPanel } from "./AnimationPanel";

const TABS: BottomTabId[] = ["Output", "Debugger", "Hardware", "Animation"];

function BudgetBar({ used, limit }: { used: number; limit: number }): JSX.Element {
  const percent = Math.min(100, (used / limit) * 100);
  const over = used > limit;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-editor-panel-alt">
      <div
        className={`h-full ${over ? "bg-red-500" : "bg-editor-accent"}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function HardwareBudgetTab(): JSX.Element {
  const { state } = useEditorStore();
  const budget = computeSceneBudget(state.sceneRoot, state.project?.meshes, state.project?.textures, state.project?.sounds);

  return (
    <div className="grid grid-cols-2 gap-4 p-3 text-xs">
      <div className="flex flex-col gap-2">
        <div className="font-semibold text-editor-text-muted">Sprite (OAM) budget per screen</div>
        {budget.perScreen.map((screen) => (
          <div key={screen.screen} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="uppercase text-editor-text-muted">{screen.screen} screen</span>
              <span>
                {screen.spritesUsed} / {screen.spritesLimit}
              </span>
            </div>
            <BudgetBar used={screen.spritesUsed} limit={screen.spritesLimit} />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="font-semibold text-editor-text-muted">Audio channels</div>
        <div className="flex items-center justify-between">
          <span className="text-editor-text-muted">Players in scene</span>
          <span>
            {budget.audioPlayersUsed} / {budget.audioChannelsLimit}
          </span>
        </div>
        <BudgetBar used={budget.audioPlayersUsed} limit={budget.audioChannelsLimit} />
        <div className="flex items-center justify-between">
          <span className="text-editor-text-muted">Sound memory</span>
          <span>
            {budget.soundBytesUsed} / {budget.soundBytesLimit} bytes
          </span>
        </div>
        <BudgetBar used={budget.soundBytesUsed} limit={budget.soundBytesLimit} />

        <div className="mt-2 font-semibold text-editor-text-muted">3D triangle budget (per frame)</div>
        <div className="flex items-center justify-between">
          <span className="text-editor-text-muted">Triangles in scene</span>
          <span>
            {budget.trianglesUsed} / {budget.trianglesLimit}
          </span>
        </div>
        <BudgetBar used={budget.trianglesUsed} limit={budget.trianglesLimit} />

        <div className="mt-2 font-semibold text-editor-text-muted">Texture memory</div>
        <div className="flex items-center justify-between">
          <span className="text-editor-text-muted">Textures in scene</span>
          <span>
            {budget.textureBytesUsed} / {budget.textureBytesLimit} bytes
          </span>
        </div>
        <BudgetBar used={budget.textureBytesUsed} limit={budget.textureBytesLimit} />

        <div className="mt-2 font-semibold text-editor-text-muted">Fixed hardware ceiling</div>
        <ul className="list-inside list-disc space-y-0.5 text-editor-text-muted">
          <li>
            CPU: {DS_HARDWARE_PROFILE.cpu.main.name} @ {DS_HARDWARE_PROFILE.cpu.main.clockMHz}MHz +{" "}
            {DS_HARDWARE_PROFILE.cpu.coprocessor.name} @ {DS_HARDWARE_PROFILE.cpu.coprocessor.clockMHz}MHz
          </li>
          <li>RAM: {DS_HARDWARE_PROFILE.memory.mainRamBytes / (1024 * 1024)}MB</li>
          <li>VRAM: {Math.round(DS_HARDWARE_PROFILE.memory.videoRamBytes / 1024)}KB</li>
          <li>3D polygon budget: ~{DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame} triangles/frame</li>
          <li>Max texture size: {DS_HARDWARE_PROFILE.graphics3D.maxTextureSizePx}px</li>
          <li>Total scene nodes: {budget.totalNodes}</li>
        </ul>
      </div>
    </div>
  );
}

function OutputTab(): JSX.Element {
  const { state } = useEditorStore();
  return (
    <div className="flex h-full flex-col gap-0.5 overflow-y-auto p-2 font-mono text-[11px] text-editor-text-muted">
      {state.outputLog.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  );
}

function DebuggerTab(): JSX.Element {
  return (
    <div className="p-3 text-xs text-editor-text-muted">
      No active session. Press Play to start a debug session once a runtime is wired up.
    </div>
  );
}

/**
 * The bottom panel, hosting Output / Debugger / Hardware Budget — Godot's
 * bottom panel with an extra DS-specific "Hardware" tab for budget tracking.
 */
export function BottomPanel(): JSX.Element {
  const { state, setBottomTab } = useEditorStore();

  return (
    <div className={`flex ${state.activeBottomTab === "Animation" ? "h-80" : "h-56"} shrink-0 flex-col border-t border-editor-border bg-editor-panel`}>
      <div className="flex shrink-0 items-center gap-1 border-b border-editor-border px-2 py-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setBottomTab(tab)}
            className={`rounded px-2 py-0.5 text-xs ${
              state.activeBottomTab === tab
                ? "bg-editor-accent text-editor-bg"
                : "text-editor-text-muted hover:bg-editor-panel-alt"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.activeBottomTab === "Animation" && <AnimationPanel />}
        {state.activeBottomTab === "Output" && <OutputTab />}
        {state.activeBottomTab === "Debugger" && <DebuggerTab />}
        {state.activeBottomTab === "Hardware" && <HardwareBudgetTab />}
      </div>
    </div>
  );
}
