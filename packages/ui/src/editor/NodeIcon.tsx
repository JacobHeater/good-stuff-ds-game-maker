import type { SceneNodeKind } from "@goodstuff/core";

import { NODE_KIND_ICON, NODE_KIND_ICON_IMAGE } from "./node-icons";

/**
 * A node kind's icon: its drawn image when there is one (`NODE_KIND_ICON_IMAGE`), otherwise its glyph. The image is 32 x 32 and is shown
 * at 16 px by default (`className` overrides the size), so it stays sharp on high-density screens.
 */
export function NodeIcon({ kind, className = "h-4 w-4" }: { kind: SceneNodeKind; className?: string }): JSX.Element {
  const image = NODE_KIND_ICON_IMAGE[kind];
  if (image) return <img src={image} alt="" draggable={false} data-node-icon={kind} className={`${className} select-none object-contain`} />;
  return <>{NODE_KIND_ICON[kind]}</>;
}
