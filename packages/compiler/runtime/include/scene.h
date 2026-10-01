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
 *   sound data  mono, as GsSound.format says (16-bit PCM or the DS's own IMA-ADPCM); volume 0..127; frequency in Hz
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

/* One sound, shared by every audio player that uses it: `data` is `byteCount` bytes, 4-byte aligned, a whole number of
   words, exactly as the DS sound hardware takes them for `format` -- a libnds SoundFormat (SoundFormat_16Bit = 1, plain
   mono signed 16-bit samples; SoundFormat_ADPCM = 2, the DS's own compressed IMA-ADPCM stream, about a quarter the size). */
typedef struct {
	uint32_t byteCount;
	uint16_t sampleRate; /* as recorded, in Hz */
	uint8_t format;
	const void *data;
} GsSound;

/* One named clip of an AudioStreamPlayer (GsAudioPlayer.clipStart/clipCount below): its own sound and playback settings,
   playable with play("name"), independent of the player's own (possibly absent) sound. */
typedef struct {
	uint16_t sound;     /* index into GsScene.sounds */
	uint16_t frequency; /* playback rate in Hz: the sample rate times the pitch, already limited to what the hardware takes */
	uint8_t volume;     /* 0..127 */
	uint8_t loop;
} GsAudioClip;

/* One AudioStreamPlayer: which sound and how to play it. A player without `autoplay` is not started at once; a script can start it. */
typedef struct {
	int16_t sound;      /* index into GsScene.sounds, or -1 for a player with no sound of its own (named clips only -- plain play() does nothing on one of these) */
	uint16_t frequency; /* playback rate in Hz: the sample rate times the pitch, already limited to what the hardware takes */
	uint8_t volume;     /* 0..127 */
	uint8_t loop;
	uint8_t autoplay;   /* never true when sound is -1 */
	uint16_t clipStart; /* index into GsScene.audioClips: this player's own named clips are clipStart .. clipStart + clipCount */
	uint8_t clipCount;  /* at most MAX_EXTRA_AUDIO_CLIPS (9) */
} GsAudioPlayer;

/* One collision shape (a CollisionShape3D), with the node it belongs to; the placement comes from that node. `shape` is a GS_SHAPE_* of gs_collision.h and
   `p` is its size in f32: a box's half extents; a sphere's radius; a capsule's radius and half the straight part's length; a cylinder's radius and half
   height; a convex hull's own bounding radius in its local space (p[1] and p[2] unused), so it can be bounded exactly like a sphere before its points
   are ever looked at. `hullStart`/`hullCount` (GS_SHAPE_HULL only) are the shape's own points, a run of GsScene.hullPoints (3 int32 per point). */
typedef struct {
	uint8_t shape;
	uint8_t solid; /* 1: a body moved with gs_move_and_collide is stopped by it */
	int32_t p[3];
	uint16_t hullStart;
	uint16_t hullCount;
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

/*
 * A touch area (a TouchArea2D or TouchArea3D), with the node it belongs to. `shape` is a GS_TOUCH_* below. A rectangle is on the touch screen: `rect` is its left,
 * top, width and height in screen pixels. A box or sphere is a volume in the 3D scene, placed and scaled by its node (the world matrix and scale in the node table):
 * `p` is f32, a box's half extents or a sphere's radius in p[0]. A touch on the screen is turned into a ray from the camera (see gs_update_touch).
 */
#define GS_TOUCH_RECT   0
#define GS_TOUCH_BOX    1
#define GS_TOUCH_SPHERE 2
typedef struct {
	uint16_t node;
	uint8_t shape;
	int16_t rect[4];
	int32_t p[3];
} GsTouchArea;

/*
 * Sprites on the 2D screen (the sub engine; the 3D engine is the main one). Identical to the types of the 2D runtime's scene2d.h. Each image takes one of the sub engine's
 * 16 extended palettes, in order, and the screen's sprite list is in hardware order (the first is drawn over the others).
 */
typedef struct {
	uint16_t width;  /* one frame: one of the DS's sprite sizes */
	uint16_t height;
	uint16_t frameCount; /* 1 for a picture, more for a sprite sheet: the frames share the palette */
	const uint16_t *palette; /* 256 RGB15 entries, entry 0 transparent, 4-byte aligned */
	const uint8_t *tiles;    /* frameCount frames of width * height bytes, palette indices in the order the sprite engine reads them (8 x 8 tiles), 4-byte aligned */
} GsSpriteImage;

/* One animation of an AnimatedSprite2D: frames of its sheet in order. `step` is animation frames per game frame in 20.12 (4096 = one every game frame). */
typedef struct {
	const uint16_t *frames;
	uint16_t length;
	uint8_t loop;
	uint32_t step;
} GsSpriteAnimation;

typedef struct {
	int16_t x; /* top-left corner in screen pixels as the sprite starts (with a rotation matrix: of the doubled box the picture is drawn in) */
	int16_t y;
	uint16_t image; /* index into the images */
	int16_t node;   /* index into the node table: its position (x, y pixels), rotation (third slot, degrees clockwise), scale (x, y) and visibility are the sprite's; -1: none */
	uint8_t dynamic; /* 1: a script can change it, so it follows its node every frame */
	int8_t affine;  /* the rotation matrix (0..31) it is drawn with, or -1 */
	int32_t rotation; /* as it starts: degrees clockwise, f32 */
	int32_t scaleX;   /* and the scale on each axis, f32 (negative flips) */
	int32_t scaleY;
	int16_t animation;         /* an AnimatedSprite2D: the animation (index into the screen's animations) that plays when the scene starts, or -1 for none (it shows frame 0) */
	uint16_t animationFirst;   /* and its own animations are this many entries of the table from the first... */
	uint16_t animationCount;   /* ...this many of them, in the order a script's play("name") counts them */
} GsSprite;

/* One Label: text on the screen's 8 x 8 grid (column 0..31, row 0..23), in a console color (0 black, 1 red ... 7 white), with `{}` in the text standing for the label's value. */
typedef struct {
	uint8_t column;
	uint8_t row;
	uint8_t color;
	uint8_t visible; /* whether it shows when the scene starts */
	int16_t node;    /* index into the node table: its visibility is the node's; -1: none (no script can reach it) */
	const char *text;
} GsLabel;

typedef struct {
	uint16_t imageCount;
	uint16_t spriteCount;
	const GsSpriteImage *images;
	const GsSprite *sprites;
	uint16_t animationCount;
	const GsSpriteAnimation *animations;
	uint16_t labelCount;
	const GsLabel *labels;
} GsScreen2D;

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
	int16_t touch;       /* index into GsScene.touchAreas, or -1 */
	int32_t position[3]; /* local, f32 */
	int32_t rotation[3]; /* local, degrees, f32 */
	int32_t scale[3];    /* local, f32 */
	int32_t worldScale[3]; /* baked world scale, f32: applied to positions only (see main.c) */
	GsMatrix world;      /* baked world rotation + translation, no scale */
} GsNode;

/* A GsMesh.cull: which side(s) of its triangles main.c's draw_mesh actually draws (the geometry engine's own cull modes). */
#define GS_CULL_NONE  0 /* both sides -- the default: forgiving of a model whose winding wasn't checked on the way in */
#define GS_CULL_BACK  1 /* only the side a correctly-wound triangle's winding faces outward from */
#define GS_CULL_FRONT 2 /* only the other side (seen from inside, or a winding that turned out backward) */

typedef struct {
	uint16_t primitive; /* index into GsScene.primitives */
	uint16_t diffuse;   /* RGB15 */
	uint16_t texture;   /* 0 = none, otherwise 1 + an index into GsScene.textures */
	uint16_t node;      /* index into GsScene.nodes: where and how it is drawn */
	/* A model with several poses that has frame animations: its poses' primitives are frameCount entries of GsScene.meshFrames from frameStart (the first is `primitive`), `animation` is the animation
	   (an index into GsScene.meshAnimations) that plays at the start or -1, and its own animations are animationCount entries from animationFirst. frameCount 0: not animated. */
	uint16_t frameStart;
	uint16_t frameCount;
	int16_t animation;
	uint16_t animationFirst;
	uint16_t animationCount;
	uint8_t unlit; /* 1: ignores the scene's lights, always shown at `diffuse`'s full brightness */
	uint8_t cull;  /* a GS_CULL_* above */
	uint8_t alpha; /* the geometry engine's polygon alpha, 0 (invisible) to 31 (fully opaque, the default) */
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
	float tanHalfFov; /* tan(fovDegrees / 2), for turning a touched point into a ray */
	GsMatrix view; /* world -> camera, as the scene starts */
	uint16_t cameraNode; /* index into nodes: a moving camera's view is the inverse of its node's world transform */
	uint16_t nodeCount;
	uint16_t primitiveCount;
	uint16_t meshCount;
	uint16_t lightCount;
	uint16_t textureCount;
	uint16_t soundCount;
	uint16_t audioPlayerCount;
	uint16_t audioClipCount;
	uint16_t colliderCount;
	uint16_t hullPointCount; /* total across every GS_SHAPE_HULL collider (each takes hullCount of them) */
	uint16_t animationPlayerCount;
	uint16_t animationCount;
	uint16_t animTrackCount;
	uint16_t animKeyCount;
	uint16_t touchAreaCount;
	const GsNode *nodes;
	const GsPrimitive *primitives;
	const GsMesh *meshes;
	const GsLight *lights;
	const GsTexture *textures;
	const GsSound *sounds;
	const GsAudioPlayer *audioPlayers;
	const GsAudioClip *audioClips;
	const GsCollider *colliders;
	const int32_t *hullPoints; /* flat, 3 per point (x, y, z), f32 (20.12), in each hull collider's own local space */
	const GsAnimationPlayer *animationPlayers;
	const GsAnimation *animations;
	const GsAnimTrack *animTracks;
	const GsAnimKey *animKeys;
	const GsTouchArea *touchAreas;
	GsScreen2D sprites2D; /* with sprites, VRAM bank D holds their tiles and textures use banks A to C */
	uint16_t meshAnimationCount;
	const uint16_t *meshFrames;
	const GsSpriteAnimation *meshAnimations;
} GsScene;

/*
 * A project can have several scenes; the runtime shows one at a time. `gs_scene` is the one it is showing (the code reads it as if it were the only scene). The generated scene_table.c
 * lists them, the starting scene first, and starts `gs_scene_current` on the first. Switching is main.c's `enter_scene`.
 */
extern const GsScene *gs_scene_current;
#define gs_scene (*gs_scene_current)
extern const GsScene *const gs_scene_table[];
extern const uint16_t gs_scene_table_count;

#endif
