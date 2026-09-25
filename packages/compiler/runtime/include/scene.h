/*
 * The layout of the scene data the runtime draws. The compiler (@goodstuff/compiler,
 * scene-data-writer.ts) generates source/scene_data.c filling in these structures; the runtime
 * (source/main.c) only reads them. Keep this file and the writer in step.
 *
 * Every number is already in the DS's own format, converted at compile time:
 *   matrices    16 x f32 (20.12 fixed), column-major, as the geometry engine reads them
 *   positions   v16 (4.12 fixed), three per vertex, three vertices per triangle
 *   texcoords   t16 (12.4 fixed, in texels), two per vertex
 *   texels      16-bit direct color per pixel (red in the low five bits, bit 15 = opaque)
 *   normals     one packed 10-bit-per-axis word per vertex (what glNormal takes)
 *   colors      RGB15
 *   light dirs  v10 (the direction the light travels, in world space)
 *   samples     signed 16-bit mono PCM; volume 0..127; frequency in Hz
 */
#ifndef GS_SCENE_H
#define GS_SCENE_H

#include <stdint.h>

typedef struct {
	int32_t m[16];
} GsMatrix;

/* One picture, uploaded to texture memory at startup and shared by every mesh that uses it. */
typedef struct {
	uint16_t width;
	uint16_t height;
	uint8_t sizeS;  /* the DS's size class for the width: 8 is 0, 16 is 1, ... 1024 is 7 */
	uint8_t sizeT;  /* and for the height */
	const uint16_t *texels; /* 16-bit direct color, red in the low five bits, bit 15 = opaque; row 0 is the top */
} GsTexture;

/* One sound, shared by every audio player that uses it: mono signed 16-bit samples, 4-byte aligned, a whole number of words. */
typedef struct {
	uint32_t sampleCount;
	uint16_t sampleRate; /* as recorded, in Hz */
	const int16_t *samples;
} GsSound;

/* One AudioStreamPlayer: which sound and how to play it. A player without `autoplay` is not started at once; a script can start it. */
typedef struct {
	uint16_t sound;     /* index into GsScene.sounds */
	uint16_t frequency; /* playback rate in Hz: the sample rate times the pitch, already limited to what the hardware takes */
	uint8_t volume;     /* 0..127 */
	uint8_t loop;
	uint8_t autoplay;
} GsAudioPlayer;

/* One collision shape (a CollisionShape3D), with the node it belongs to; the placement comes from that node. `shape` is a GS_SHAPE_* of gs_collision.h and
   `p` is its size in f32: a box's half extents; a sphere's radius; a capsule's radius and half the straight part's length; a cylinder's radius and half height. */
typedef struct {
	uint8_t shape;
	uint8_t solid; /* 1: a body moved with gs_move_and_collide is stopped by it */
	int32_t p[3];
} GsCollider;

/* Animation (requirements/animation/TASK.compile-and-run-animations.md). A key is a time (seconds) and a value; a vector's X/Y/Z, or a bool or a number in `value[0]`. */
typedef struct {
	int32_t time;
	int32_t value[3];
} GsAnimKey;

#define GS_ANIM_POSITION 0
#define GS_ANIM_ROTATION 1
#define GS_ANIM_SCALE    2
#define GS_ANIM_VISIBLE  3
#define GS_ANIM_VOLUME   4
#define GS_ANIM_PITCH    5

/* One track: a property of a node, and its keys (a run in GsScene.animKeys, sorted by time). */
typedef struct {
	uint8_t property;
	uint16_t node;
	uint16_t keyStart;
	uint16_t keyCount;
} GsAnimTrack;

/* One animation: its length in seconds, whether it loops, and its tracks (a run in GsScene.animTracks). */
typedef struct {
	int32_t length;
	uint8_t loop;
	uint16_t trackStart;
	uint16_t trackCount;
} GsAnimation;

/* One AnimationPlayer: its animations (a run in GsScene.animations), which one starts with the game (an index within the run, or -1), and its speed. */
typedef struct {
	uint16_t animationStart;
	uint16_t animationCount;
	int16_t autoplay;
	int32_t speed;
} GsAnimationPlayer;

/* One mesh source's triangles (for a textured mesh, one table per geometry and texture), shared by every mesh that uses it. */
typedef struct {
	uint16_t triangleCount;
	const int16_t *positions;
	const uint32_t *normals;
	const int16_t *texcoords; /* two t16 (12.4, in texels) per vertex, or 0 when the table isn't textured */
} GsPrimitive;

/*
 * One node of the scene. The table lists every kept node with parents before their children. Scripts change a node's local position,
 * rotation and scale; the runtime recomputes the world transform of the nodes marked `dynamic` (those a script can move, and everything
 * under them) every frame, and uses the baked `world` and `worldScale` for all the others, so a scene no script moves is drawn exactly as
 * the compiler computed it.
 */
typedef struct {
	int16_t parent;      /* index of the parent node, or -1 */
	uint8_t dynamic;     /* 1: the world transform is recomputed every frame */
	uint8_t visible;     /* whether the node itself is visible; it is drawn only if all its ancestors are too */
	int16_t audio;       /* index into GsScene.audioPlayers, or -1 */
	int16_t collider;    /* index into GsScene.colliders, or -1 */
	int16_t animPlayer;  /* index into GsScene.animationPlayers, or -1 */
	int32_t position[3]; /* local, f32 */
	int32_t rotation[3]; /* local, degrees, f32 */
	int32_t scale[3];    /* local, f32 */
	int32_t worldScale[3]; /* baked world scale, f32: applied to positions only (see main.c) */
	GsMatrix world;      /* baked world rotation + translation, no scale */
} GsNode;

typedef struct {
	uint16_t primitive; /* index into GsScene.primitives */
	uint16_t diffuse;   /* RGB15 */
	uint16_t texture;   /* 0 = none, otherwise 1 + an index into GsScene.textures */
	uint16_t node;      /* index into GsScene.nodes: where and how it is drawn */
} GsMesh;

/* The DS only has parallel lights. */
typedef struct {
	uint16_t color;      /* RGB15 */
	int16_t direction[3]; /* v10, as the light points when the scene starts */
	uint16_t node;       /* index into GsScene.nodes: a moving light points along its node's -Z axis */
} GsLight;

typedef struct {
	uint8_t screen; /* 0 = top, 1 = bottom */
	uint8_t fps;    /* 30 or 60 */
	float fovDegrees;
	float nearPlane;
	float farPlane;
	GsMatrix view; /* world -> camera, as the scene starts */
	uint16_t cameraNode; /* index into nodes: a moving camera's view is the inverse of its node's world transform */
	uint16_t nodeCount;
	uint16_t primitiveCount;
	uint16_t meshCount;
	uint16_t lightCount;
	uint16_t textureCount;
	uint16_t soundCount;
	uint16_t audioPlayerCount;
	uint16_t colliderCount;
	uint16_t animationPlayerCount;
	uint16_t animationCount;
	uint16_t animTrackCount;
	uint16_t animKeyCount;
	const GsNode *nodes;
	const GsPrimitive *primitives;
	const GsMesh *meshes;
	const GsLight *lights;
	const GsTexture *textures;
	const GsSound *sounds;
	const GsAudioPlayer *audioPlayers;
	const GsCollider *colliders;
	const GsAnimationPlayer *animationPlayers;
	const GsAnimation *animations;
	const GsAnimTrack *animTracks;
	const GsAnimKey *animKeys;
} GsScene;

extern const GsScene gs_scene;

#endif
