import type { SceneNodeKind } from "@goodstuff/core";

import area2DIcon from "./icons/Area2D.png";
import touchArea2DIcon from "./icons/TouchArea2D.png";
import touchArea3DIcon from "./icons/TouchArea3D.png";

/**
 * Drawn icons, by node kind. A kind listed here shows its image (see `NodeIcon`); the others fall back to their glyph in
 * `NODE_KIND_ICON`. To add one, put a 32 x 32 PNG in `icons/` and list it here.
 */
export const NODE_KIND_ICON_IMAGE: Partial<Record<SceneNodeKind, string>> = {
  Area2D: area2DIcon,
  TouchArea2D: touchArea2DIcon,
  TouchArea3D: touchArea3DIcon
};

/** Small glyph per node kind, standing in for Godot's per-type node icons (used where a kind has no drawn icon). */
export const NODE_KIND_ICON: Record<SceneNodeKind, string> = {
  Node2D: "◻",
  Sprite2D: "🖼",
  AnimatedSprite2D: "🎞",
  Camera2D: "🎥",
  TileMap: "🧱",
  Label: "🔤",
  CollisionShape2D: "🛡",
  Area2D: "📦",
  TouchArea2D: "👆",
  AudioStreamPlayer: "🔊",
  AnimationPlayer: "▶",
  Node3D: "◈",
  MeshInstance3D: "🧊",
  Camera3D: "🎥",
  DirectionalLight3D: "☀",
  OmniLight3D: "💡",
  CollisionShape3D: "🛡",
  TouchArea3D: "👆"
};
