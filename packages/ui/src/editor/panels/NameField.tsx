import type { SceneNode } from "@goodstuff/core";
import { useEffect, useRef, useState } from "react";

import { inputClasses } from "./inspector-fields";

/**
 * A node's name at the top of the Inspector (requirements/properties-panel/STORY.rename-a-node.md). It keeps its own text while it has focus, so
 * clearing the field to type a new name doesn't rename the node to nothing; each non-empty text is applied as it is typed, and leaving the field shows
 * the node's actual name again. Says so when another node has the same name, since a script's `$Name` can't tell such nodes apart.
 */
export function NameField({ node, sameNameCount, onRename }: { node: SceneNode; sameNameCount: number; onRename: (name: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(node.name);
  const input = useRef<HTMLInputElement>(null);
  // An undo, or a rename from elsewhere, changes the name from outside; show it unless the field is being typed in.
  useEffect(() => {
    if (document.activeElement !== input.current) setDraft(node.name);
  }, [node.name]);
  return (
    <div className="flex flex-col gap-1">
      <input
        ref={input}
        type="text"
        value={draft}
        aria-label="Name"
        onChange={(event) => {
          setDraft(event.target.value);
          if (event.target.value.trim() !== "") onRename(event.target.value);
        }}
        onBlur={() => setDraft(node.name)}
        className={`${inputClasses} text-sm font-semibold`}
      />
      {sameNameCount > 0 && (
        <div className="text-[10px] text-yellow-400" data-testid="name-shared">
          {sameNameCount === 1 ? "Another node has this name" : `${sameNameCount} other nodes have this name`}: a script's $Name can't tell them apart. Rename one.
        </div>
      )}
    </div>
  );
}
