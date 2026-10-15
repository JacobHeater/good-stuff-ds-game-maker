import { soundToStrm, type ImportedSound } from "@goodstuff/core";
import { useState } from "react";

import { decodeSoundFile } from "../editor/audio/decode-sound";

type LogLine = { text: string; tone: "info" | "warning" | "error" };

type Direction = "png" | "obj" | "wav" | "nsbtx" | "nsbmd-obj" | "nsbmd-glb" | "strm";

/**
 * Converts a file to or from a real Nintendo DS native format -- no project involved
 * (requirements/compiler/STORY.nitro-native-format-converter.md). Every direction but WAV -> STRM runs entirely in
 * the main process (same as this app's own "Import PNG..."/"Import Model..." round trips): even the reverse,
 * decode-only conversions (NSBTX -> PNG, NSBMD -> OBJ/GLB, STRM -> WAV) need no renderer-only decoding, unlike the
 * forward WAV path, which has to decode the audio here (only the editor window can decode WAV/MP3/OGG) and hand
 * the finished bytes to the main process to save.
 */
export function ConverterPanel(): JSX.Element {
  const [busy, setBusy] = useState<Direction | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);

  const report = (lines: LogLine[]): void => setLog(lines);

  /** The shared shape every main-process-only conversion (everything but WAV -> STRM) follows: pick, convert, save, all in one round trip. */
  const runFileConversion = async (which: Direction, convert: () => Promise<{ outcome: string; fileName?: string; savedTo?: string; warnings: string[]; errors: string[] }>): Promise<void> => {
    setBusy(which);
    try {
      const result = await convert();
      if (result.outcome === "canceled") return;
      if (result.outcome === "error") {
        report(result.errors.map((text) => ({ text, tone: "error" as const })));
        return;
      }
      report([{ text: `Saved "${result.fileName}" as ${result.savedTo}`, tone: "info" }, ...result.warnings.map((text) => ({ text, tone: "warning" as const }))]);
    } finally {
      setBusy(null);
    }
  };

  const convertPng = (): Promise<void> => runFileConversion("png", () => window.goodstuff.converter.pngToNsbtx());
  const convertObj = (): Promise<void> => runFileConversion("obj", () => window.goodstuff.converter.objToNsbmd());
  const convertNsbtx = (): Promise<void> => runFileConversion("nsbtx", () => window.goodstuff.converter.nsbtxToPng());
  const convertNsbmdToObj = (): Promise<void> => runFileConversion("nsbmd-obj", () => window.goodstuff.converter.nsbmdToObj());
  const convertNsbmdToGlb = (): Promise<void> => runFileConversion("nsbmd-glb", () => window.goodstuff.converter.nsbmdToGlb());
  const convertStrm = (): Promise<void> => runFileConversion("strm", () => window.goodstuff.converter.strmToWav());

  const convertWav = async (): Promise<void> => {
    setBusy("wav");
    try {
      const picked = await window.goodstuff.assets.pickSound();
      if (picked.outcome === "canceled") return;
      if (picked.outcome !== "ok" || !picked.bytes) {
        report(picked.errors.map((text) => ({ text, tone: "error" as const })));
        return;
      }
      const decoded = await decodeSoundFile(picked.bytes, picked.fileName ?? "Sound", picked.compress ?? true);
      if (!decoded.ok) {
        report(decoded.errors.map((text) => ({ text, tone: "error" as const })));
        return;
      }
      const sound: ImportedSound = { id: "converter", ...decoded.sound };
      const bytes = soundToStrm(sound);
      const suggestedName = `${(picked.fileName ?? "sound").replace(/\.[^.]+$/, "")}.strm`;
      const saved = await window.goodstuff.converter.saveBinaryFile(suggestedName, "STRM audio", ["strm"], bytes);
      if (saved.outcome === "canceled") return;
      if (saved.outcome === "error") {
        report(saved.errors.map((text) => ({ text, tone: "error" as const })));
        return;
      }
      report([{ text: `Saved "${picked.fileName}" as ${saved.filePath}`, tone: "info" }, ...decoded.warnings.map((text) => ({ text, tone: "warning" as const }))]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-editor-text-muted">
        Converts a file straight to a real Nintendo DS format -- NSBTX, NSBMD or STRM, the same containers the official Nitro SDK's own tools
        produce -- with no project involved.
      </p>

      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => void convertPng()} disabled={busy !== null} className="rounded border border-editor-border bg-editor-panel px-4 py-2 text-left text-sm hover:bg-editor-panel-alt disabled:opacity-50">
          <div className="font-semibold">{busy === "png" ? "Converting…" : "Convert PNG to NSBTX…"}</div>
          <div className="text-[11px] text-editor-text-muted">A 256-color paletted DS texture (width and height must each be 8 to 1024, a power of two).</div>
        </button>
        <button type="button" onClick={() => void convertObj()} disabled={busy !== null} className="rounded border border-editor-border bg-editor-panel px-4 py-2 text-left text-sm hover:bg-editor-panel-alt disabled:opacity-50">
          <div className="font-semibold">{busy === "obj" ? "Converting…" : "Convert OBJ to NSBMD…"}</div>
          <div className="text-[11px] text-editor-text-muted">A single-bone, untextured DS model (a .obj has no skeleton to animate).</div>
        </button>
        <button type="button" onClick={() => void convertWav()} disabled={busy !== null} className="rounded border border-editor-border bg-editor-panel px-4 py-2 text-left text-sm hover:bg-editor-panel-alt disabled:opacity-50">
          <div className="font-semibold">{busy === "wav" ? "Converting…" : "Convert WAV to STRM…"}</div>
          <div className="text-[11px] text-editor-text-muted">A streamed DS sound (WAV, MP3 or OGG in; always written as one block, no loop point).</div>
        </button>
      </div>

      <p className="text-xs text-editor-text-muted">Converts a real Nintendo DS format back to something every other tool can open.</p>

      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => void convertNsbtx()} disabled={busy !== null} className="rounded border border-editor-border bg-editor-panel px-4 py-2 text-left text-sm hover:bg-editor-panel-alt disabled:opacity-50">
          <div className="font-semibold">{busy === "nsbtx" ? "Converting…" : "Convert NSBTX to PNG…"}</div>
          <div className="text-[11px] text-editor-text-muted">A plain PNG picture. A file with more than one texture saves the rest alongside it.</div>
        </button>
        <button type="button" onClick={() => void convertNsbmdToObj()} disabled={busy !== null} className="rounded border border-editor-border bg-editor-panel px-4 py-2 text-left text-sm hover:bg-editor-panel-alt disabled:opacity-50">
          <div className="font-semibold">{busy === "nsbmd-obj" ? "Converting…" : "Convert NSBMD to OBJ…"}</div>
          <div className="text-[11px] text-editor-text-muted">A static Wavefront model, flattened to world space (OBJ has no bones).</div>
        </button>
        <button type="button" onClick={() => void convertNsbmdToGlb()} disabled={busy !== null} className="rounded border border-editor-border bg-editor-panel px-4 py-2 text-left text-sm hover:bg-editor-panel-alt disabled:opacity-50">
          <div className="font-semibold">{busy === "nsbmd-glb" ? "Converting…" : "Convert NSBMD to GLB…"}</div>
          <div className="text-[11px] text-editor-text-muted">A self-contained glTF binary, keeping the bone hierarchy; optionally folds in a matching .nsbca animation.</div>
        </button>
        <button type="button" onClick={() => void convertStrm()} disabled={busy !== null} className="rounded border border-editor-border bg-editor-panel px-4 py-2 text-left text-sm hover:bg-editor-panel-alt disabled:opacity-50">
          <div className="font-semibold">{busy === "strm" ? "Converting…" : "Convert STRM to WAV…"}</div>
          <div className="text-[11px] text-editor-text-muted">A plain WAV sound, decoded to PCM16.</div>
        </button>
      </div>

      {log.length > 0 && (
        <div className="flex flex-col gap-1 rounded border border-editor-border bg-editor-panel-alt p-2 text-[11px]" data-testid="converter-log">
          {log.map((line, i) => (
            <div key={i} className={line.tone === "error" ? "text-red-400" : line.tone === "warning" ? "text-amber-400" : "text-editor-text"}>
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
