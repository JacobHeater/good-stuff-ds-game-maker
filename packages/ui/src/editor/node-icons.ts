import type { SceneNodeKind } from "@goodstuff/core";

/** Small glyph per node kind, standing in for Godot's per-type node icons. */
export const NODE_KIND_ICON: Record<SceneNodeKind, string> = {
  Node2D: "◻",
  Sprite2D: "🖼",
  AnimatedSprite2D: "🎞",
  Camera2D: "🎥",
  TileMap: "🧱",
  Label: "🔤",
  CollisionShape2D: "🛡",
  Area2D: "📦",
  AudioStreamPlayer: "🔊",
  Node3D: "◈",
  MeshInstance3D: "🧊",
  Camera3D: "🎥",
  DirectionalLight3D: "☀",
  OmniLight3D: "💡",
  CollisionShape3D: "🛡"
};
