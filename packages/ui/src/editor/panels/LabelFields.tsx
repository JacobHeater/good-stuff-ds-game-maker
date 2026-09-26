import { getLabel, LABEL_COLORS, LABEL_COLUMNS, LABEL_ROWS, labelCell, MAX_LABEL_CHARS, type SceneNode } from "@goodstuff/core";

import type { LabelChange } from "../state/editor-store";
import { Field, inputClasses } from "./inspector-fields";

/**
 * A Label in the Inspector (requirements/scene-designer/STORY.labels-and-text.md): its text (with {} where a script's value goes) and one of the eight console colors. Its
 * place is the node's position, kept to the 8 x 8 grid the DS's text uses; the 2D viewport draws the same characters in the same cells.
 */
export function LabelField({ node, onChange }: { node: SceneNode; onChange: (change: LabelChange) => void }): JSX.Element {
  const label = getLabel(node);
  const cell = labelCell(node.position);
  return (
    <div className="flex flex-col gap-2.5" data-testid="label-fields">
      <Field label="Text">
        <input type="text" value={label.text} maxLength={MAX_LABEL_CHARS} onChange={(event) => onChange({ text: event.target.value })} className={inputClasses} aria-label="Text" />
      </Field>
      <div>
        <div className="mb-1 text-[11px] text-editor-text-muted">Color</div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Color">
          {LABEL_COLORS.map((color, index) => (
            <button
              key={color.name}
              type="button"
              role="radio"
              aria-checked={label.color === index}
              aria-label={color.name}
              title={color.name}
              onClick={() => onChange({ color: index })}
              style={{ backgroundColor: color.css }}
              className={`h-5 w-5 rounded border ${label.color === index ? "border-editor-accent ring-1 ring-editor-accent" : "border-editor-border"}`}
            />
          ))}
        </div>
      </div>
      <div className="text-[10px] text-editor-text-muted">
        Drawn in the DS's 8 x 8 pixel font: first character at column {cell.column}, row {cell.row} of {LABEL_COLUMNS} x {LABEL_ROWS} (the position is rounded to that grid). Put{" "}
        <span className="font-mono">{"{}"}</span> in the text where a number goes, then set it from a script: <span className="font-mono">$Score.value = 5</span>. A script can also
        change the whole text: <span className="font-mono">$Label.text = "Game Over"</span>.
      </div>
    </div>
  );
}
