import { getAnimationPlayer } from "../animation";
import { getSpriteAnimations } from "../sprite-animation";
import { flattenSceneTree, type SceneNode } from "../scene-node";
import { checkScript, type ScriptCheckResult, type ScriptSceneContext } from "./checker";
import type { ScriptDiagnostic } from "./lexer";

/** What the checker wants to know about a node a script is attached to. */
export function attachedInfo(node: SceneNode): ScriptSceneContext["attached"][number] {
  return {
    name: node.name,
    kind: node.kind,
    hasShape: flattenSceneTree(node).some((n) => n.kind === "CollisionShape3D"),
    animations:
      node.kind === "AnimationPlayer"
        ? getAnimationPlayer(node).animations.map((animation) => animation.name)
        : node.kind === "AnimatedSprite2D" || node.kind === "MeshInstance3D"
          ? getSpriteAnimations(node).animations.map((animation) => animation.name)
          : undefined
  };
}

export interface ScriptNodeCheck {
  node: SceneNode;
  result: ScriptCheckResult;
}

/**
 * Checks a script once **for each node it is attached to**, each time with that node as the scope of `$Name` (children first, see `ScriptSceneContext.scope`),
 * so several copies of a node (a duplicated block with its own touch area under it) each run the script against their own children. The problems are the
 * union of every check's, without repeats (the same mistake on line 5 is reported once, not once per copy). A script attached to nothing is checked once, unscoped.
 */
export function checkScriptOnNodes(
  source: string,
  root: SceneNode,
  nodes: readonly SceneNode[],
  sceneNames?: readonly string[],
  globals?: ScriptSceneContext["globals"]
): { perNode: ScriptNodeCheck[]; diagnostics: ScriptDiagnostic[] } {
  if (nodes.length === 0) return { perNode: [], diagnostics: checkScript(source, { root, attached: [], sceneNames, globals }).diagnostics };
  const perNode = nodes.map((node) => ({ node, result: checkScript(source, { root, attached: [attachedInfo(node)], scope: node, sceneNames, globals }) }));
  const seen = new Set<string>();
  const diagnostics: ScriptDiagnostic[] = [];
  for (const { result } of perNode) {
    for (const d of result.diagnostics) {
      const key = `${d.severity}:${d.line}:${d.column}:${d.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push(d);
    }
  }
  return { perNode, diagnostics };
}
