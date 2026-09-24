/*
 * The layout of the scene data the runtime draws. The compiler (@goodstuff/compiler,
 * scene-data-writer.ts) generates source/scene_data.c filling in these structures; the runtime
 * (source/main.c) only reads them. Keep this file and the writer in step.
 *
 * Every number is already in the DS's own format, converted at compile time:
 *   matrices    16 x f32 (20.12 fixed), column-major, as the geometry engine reads them
 *   positions   v16 (4.12 fixed), three per vertex, three vertices per triangle
 *   normals     one packed 10-bit-per-axis word per vertex (what glNormal takes)
 *   colors      RGB15
 *   light dirs  v10 (the direction the light travels, in world space)
 */
#ifndef GS_SCENE_H
#define GS_SCENE_H

#include <stdint.h>

typedef struct {
	int32_t m[16];
} GsMatrix;

/* One primitive's triangles, shared by every mesh that uses it. */
typedef struct {
	uint16_t triangleCount;
	const int16_t *positions;
	const uint32_t *normals;
} GsPrimitive;

typedef struct {
	uint16_t primitive; /* index into GsScene.primitives */
	uint16_t diffuse;   /* RGB15 */
	GsMatrix world;     /* baked world transform: the runtime never composes transforms */
} GsMesh;

/* The DS only has parallel lights. */
typedef struct {
	uint16_t color;      /* RGB15 */
	int16_t direction[3]; /* v10 */
} GsLight;

typedef struct {
	uint8_t screen; /* 0 = top, 1 = bottom */
	uint8_t fps;    /* 30 or 60 */
	float fovDegrees;
	float nearPlane;
	float farPlane;
	GsMatrix view; /* world -> camera */
	uint16_t primitiveCount;
	uint16_t meshCount;
	uint16_t lightCount;
	const GsPrimitive *primitives;
	const GsMesh *meshes;
	const GsLight *lights;
} GsScene;

extern const GsScene gs_scene;

#endif
