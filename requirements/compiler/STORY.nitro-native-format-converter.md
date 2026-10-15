---
status: done
component: compiler
related: [STORY.compile-2d-scene-to-nds-rom.md, STORY.compile-3d-scene-to-nds-rom.md, scene-designer/STORY.import-sprite-image.md, scene-designer/STORY.rigged-models.md, audio/STORY.import-sound-and-audio-player.md, audio/STORY.compressed-sound.md]
---

# Story: a Converter tab on the startup screen, PNG/OBJ/WAV/GLB to and from real Nintendo native formats

## Context
Owner: "lets add a tab on the main menu where you press create project the tabs are Project and the NEW Converter
Tab it can convert PNGs .obj or .wav to Nintendo Game Formats not third party formats." Follow-up decisions with
the owner: the target formats are **NSBTX** (textures), **NSBMD** (models), and **STRM** (streamed audio) -- the
actual container formats Nintendo's own Nitro SDK tools produce for retail DS games, not this project's own
internal `DsScene`/`Gs*` data (which the ROM compiler already emits, and which only this engine's own runtime
reads) and not some other engine's format either. For the model format specifically: asked whether to scope down
given NSBMD's real complexity (it stores the DS geometry engine's own instruction stream, not just a vertex list)
or go for the full thing including bones and animation -- the owner chose **full NSBMD with bones and animation**.

Follow-up owner request, once the forward direction was done: "now allow it to convert those NDS formats to OBJ
GLB WAV and PNG" -- the reverse direction, decoding NSBTX/NSBMD/STRM back to ordinary, widely-supported formats
(and, for a model with a real skeleton, a .glb that keeps the bone hierarchy a plain .obj can't represent at all).

This is a fundamentally different kind of feature from everything else in this codebase: every other "compile"
path in this project targets `runtime2d`/`runtime`, engines this project itself wrote and fully controls, so a
devkitARM compile-and-link check is real, meaningful verification. NSBTX/NSBMD/STRM are externally-defined,
third-party (Nintendo's own) binary formats with no public specification -- only community reverse-engineering,
most of it itself marked "speculative, incomplete, and contains errors" by its own authors. There is no way to
run these files through the actual Nitro SDK or verify them on real hardware from here. That constraint shaped
almost every decision below.

## Decision
- **No project involved, by design.** The Converter is a sibling of "New Project"/"Open Existing Project" on the
  startup screen, not a project feature -- it takes one file and produces one file, with nothing saved, loaded, or
  remembered. This matches the ask literally ("a tab... it can convert PNGs, .obj or .wav") and keeps the whole
  feature decoupled from the project/compiler pipeline entirely.
- **Research from primary sources before writing any binary-format code, not from memory.** GBATEK
  (problemkaputt.de) for the DS GPU's own geometry-engine command set (opcodes, parameter counts, bit layouts) and
  the STRM header; `scurest/nsbmd_docs` (the most detailed, most carefully reverse-engineered NSBMD/NSBTX/NSBCA
  reference available, written by the author of a working, maintained NSBMD parser/exporter) for the container and
  chunk structures. GBATEK's own geometry-engine opcode table was cross-checked against libnds's own
  `nds/arm9/video.h` register addresses (each `GFX_*`/`MATRIX_*` address is `0x04000400 + opcode*4`) and found to
  match exactly -- real, working, hardware-verified code, not another layer of reverse-engineering -- which is the
  one part of this feature with a genuinely non-speculative source.
- **A real, caught-in-the-act correction to the best available rotation-encoding documentation.** NSBCA's animated
  rotations are stored as a `PivotMatrix` (for a rotation around a single X/Y/Z axis) whose off-diagonal entries
  `c`/`d` the reference docs say are derived from the *same* stored value as the diagonal entries they sit next to
  (`c = ±a`, `d = ±b`). Checked directly against a 90-degree rotation (cos=0, sin=1) before writing a single line of
  encoder code: that literal reading produces a matrix with a zero row -- singular, and so *impossible* for any
  real rotation to look like. Cross-deriving instead (`c` from `b`, `d` from `a`) produces a correct, orthogonal,
  determinant-1 matrix at every angle `nsbca.test.ts` checks directly (not just byte layout -- the test computes
  row dot-products and the determinant from the decoded matrix itself). This is flagged in `encodePivotMatrix`'s
  own doc comment as the single most uncertain piece of this whole feature: the correction is mathematically
  well-motivated, but, like the rest of this format, unverified against real hardware or the official SDK.
- **Rigid bones, no weighted vertex skinning.** The DS geometry engine has no hardware skinning; NSBMD's own
  render-command list supports a weighted "skinning equation" command for smoothly-deformed meshes, built from
  `InvBindMatrices`, but this converter never emits it. Every mesh is rigidly attached to exactly one bone, drawn
  with that bone's matrix after a straightforward depth-first walk of the bone tree (compute a bone's world matrix
  from its parent's, one matrix-stack slot per bone, bind a material, draw its meshes, recurse). This is not a
  simplification invented for this story: it is exactly how this project's own glTF rig importer
  (`gltf-import.ts`, `STORY.rigged-models.md`) already treats a DS model -- "every triangle goes to the one bone
  that pulls it hardest" -- because the hardware itself leaves no other option for a real-time DS game. Converting
  a rigged glTF model therefore needed no new skinning logic at all, just a walk of the same bone tree already
  built for the editor's own rigged-model import.
- **A plain `.obj` becomes a single-bone, untextured NSBMD.** A `.obj` file has no skeleton and no bone data at
  all, so "full NSBMD with bones and animation" is a statement about the *encoder's own capability* (it genuinely
  supports a multi-bone hierarchy and keyframe animation, exercised directly by `nsbmd.test.ts`/`nsbca.test.ts`
  with synthetic multi-bone input), not a claim that converting a `.obj` produces one. A `.obj` conversion is
  correctly the trivial case of a fully-capable encoder: one root bone at the origin, holding the whole mesh.
  Real multi-bone, animated NSBMD/NSBCA export *is* reachable in this codebase today, through the rigged-model
  (glTF) pipeline's own data (`riggedModelToNsbmd`/`animationToNsbca` in `nitro-formats/convert.ts`) -- it just
  isn't wired to a Converter-tab button yet, since the owner's request named `.obj`, not `.glb`/`.gltf`.
- **4bpp (15 colors + transparent) NSBTX textures, not a sprite's 255-color independent palette.** The DS 3D GPU's
  "256-Color Palette Texture" format was chosen (not 4bpp) since it is both simple and lossless up to 256 colors,
  matching how this project's own sprites already work; color reduction past that reuses the exact median-cut
  algorithm `createSpriteFromRgba` already uses for a 2D sprite (exported from `imported-sprite.ts` for this
  reuse), rather than a second, parallel quantizer.
- **One STRM block, no loop point.** STRM supports splitting a stream into several DMA-sized blocks, each with its
  own loop metadata; this converter always writes the whole sound as a single block. Correct for straightforward
  playback, with only whole-track (not mid-track) looping precision -- more than enough for converting one file at
  a time, and avoids a second, separate layer of block-splitting logic this feature doesn't need.
- **PNG and OBJ conversion run entirely in the main process** (pick the file, decode/parse, convert, ask where to
  save, write) -- the same shape `assets-ipc.ts`'s existing "Import PNG..."/"Import Model..." round trips already
  use, since `pngjs` and `parseObj` both already run there. **WAV conversion is split**: only the editor window can
  decode WAV/MP3/OGG (`decodeSoundFile`'s `OfflineAudioContext`), so the main process only picks the file (reusing
  the *existing* `assets:pick-sound` channel outright -- no new picker needed), the renderer decodes it and builds
  the STRM bytes itself (`soundToStrm`, a pure function), and a new generic `converter:save-binary-file` channel
  (reusable for any future format this feature grows) writes whatever bytes the renderer hands it.
- **The reverse direction (NSBTX/NSBMD/STRM -> PNG/OBJ/GLB/WAV) runs entirely in the main process, no exceptions.**
  Unlike the forward WAV path, decoding an STRM back to PCM16 is a pure, dependency-free function (`decodeStrm`) --
  it needs no Web Audio API, so `strmToWav` never has to involve the renderer at all.
- **Self round-trip testing, not third-party verification, for the decoders too.** There is still no way to test
  against a real NSBTX/NSBMD/STRM from an actual game, so every decoder is proven by encoding a known input with
  this feature's own (already-tested) encoder, decoding it back, and checking the values match. This caught real
  bugs that forward-only testing had missed entirely -- seven distinct ones across both directions by the end (see
  Notes), the clearest being a genuine encoder bug (not a decoder bug) that only a *paired* decoder could expose:
  `encodeNsbca` wrote every sampled animation value, including rotation, as a 4-byte `u32`, but a sampled
  `RotMatrixIdx` is documented as a 2-byte `u16` -- invisible to every forward-only test, which checked byte
  *counts* and structure but never re-derived actual sampled rotation *values*.
- **OBJ gives up the skeleton; GLB keeps it.** A decoded NSBMD's meshes already store their vertices in their own
  bone's local space (matching how the DS actually draws them), so `write-obj.ts` composes each bone's full world
  matrix by walking the tree parent-to-child and flattens everything to static world-space geometry, since OBJ has
  no concept of bones at all. `write-glb.ts` instead keeps the hierarchy: every bone becomes a plain, empty glTF
  transform node and every mesh becomes a child node with an *identity* transform relative to its bone (not glTF's
  skinning/joints/weights system) -- correct specifically because, like the render-command interpreter already
  established, every mesh here is rigidly bound to exactly one bone with no blended vertices to justify skinning's
  extra complexity. This mirrors how this project's own `gltf-import.ts` already represents a rigged model.
- **GLB's optional animation is a second, separate file picked only if asked for.** An NSBMD alone has no animation
  data (that lives in a sibling NSBCA), and a glTF node hierarchy's rotation needs a quaternion -- NSBCA's own
  rotation representation is a single-axis Euler angle (`decodePivotAngle`'s own inverse of `encodePivotMatrix`),
  converted straight to a quaternion via the standard half-angle axis-angle formula (`singleAxisEulerToQuaternion`
  in `write-glb.ts`), not via a full matrix round-trip, since only one axis is ever nonzero for a track this
  format (or this project's own encoder) can produce.

## Description
- **Core, forward direction** (`packages/core/src/nitro-formats/`): `binary-writer.ts` (a small growable-byte-buffer
  helper with placeholder/patch support for a format's own internal offsets -- and a now-removed `pad()` method,
  cut after it caused a real bug, see Notes); `nitro-dictionary.ts` (the generic named-lookup-table structure every
  Nitro G3D format's model/mesh/material/bone/animation list uses); `gx-commands.ts` (the DS geometry engine's own
  instruction encoding -- the one GBATEK/libnds-cross-checked, non-speculative part); `nsbtx.ts`/`nsbmd.ts`/
  `nsbca.ts`/`strm.ts` (the four format encoders); `convert.ts` (adapters from this project's own types --
  `ImportedMesh`, a rigged model's bone tree, `ImportedSound` -- to each encoder's input shape, including
  `animationToNsbca`'s resampling of this project's sparse, keyframe-at-a-time `AnimationTrack`s into NSBCA's own
  fixed-rate sampled curves).
- **Core, reverse direction** (same folder): `binary-reader.ts` (the `BinaryWriter`/dictionary-writer's mirror image
  for reading); `decode-gx-commands.ts` (unpacks the GX instruction stream back to a vertex/UV/index list, including
  the Mesh-embedded vertex commands this converter's own encoder never emits but a real NSBMD might);
  `decode-nsbtx.ts`/`decode-nsbmd.ts`/`decode-nsbca.ts`/`decode-strm.ts` (the four decoders -- each reads a wider
  range of each format's documented variants than this project's own encoders ever write, for better real-file
  compatibility, and each refuses what it doesn't support with a clear message rather than guessing); `mat4.ts` (a
  minimal column-major 4x4 matrix helper -- `fromTrs`/`multiply`/`applyToPoint` for OBJ's world-space flattening,
  `mat3ToQuaternion` for a bone's bind-pose rotation in GLB); `write-obj.ts`/`write-glb.ts`/`write-wav.ts` (the three
  output writers, each a plain, well-documented format, not Nintendo-specific).
- **IPC** (`apps/desktop/src/main/converter-ipc.ts`; `project-ipc-contract.ts`'s `converter` section on
  `GoodStuffWindowApi`): forward -- `pngToNsbtx`/`objToNsbmd` (pick, convert, ask where to save, write -- one round
  trip each) and `saveBinaryFile` (generic: a suggested name, a file-dialog filter, and bytes already in hand, used
  by the renderer-built STRM). Reverse -- `nsbtxToPng` (saves every texture in a multi-texture file, not just the
  first), `nsbmdToObj`, `nsbmdToGlb` (asks, via a message box, whether to also pick a matching `.nsbca` to fold in
  as an animation), and `strmToWav` -- all four single main-process round trips, like the forward PNG/OBJ path.
- **UI** (`packages/ui/src/startup/`): `StartupView.tsx` gained a tab bar ("Project" / "Converter") on the landing
  screen, above the existing New Project / Open Existing Project buttons; `ConverterPanel.tsx` has one button a
  format in each direction, each reporting its outcome (where the file was saved, or every warning/error) in a
  small log.

## Notes (built and verified)
- Unit tests: `nsbtx.test.ts` (a real BTX0/TEX0 byte-layout walk, a full texel-to-palette-to-RGB15 round trip,
  size-validation and color-reduction cases), `nsbmd.test.ts` (a real BMD0/MDL0 walk including the render command
  list's exact bytes for both a single root bone and a two-bone parent/child tree, the vertex-range auto-scaling
  path, and the texture-pairing dictionary), `nsbca.test.ts` (a real BCA0/JNT0 walk, constant and sampled curves,
  the multi-axis-rotation-dropped warning, PivotMatrix deduplication -- **and** the orthogonality/determinant/
  known-rotation checks that caught and confirmed the PivotMatrix correction above), `strm.test.ts`, `convert.test.ts`
  for the forward direction; `decode-nsbtx.test.ts`, `decode-nsbmd.test.ts`, `decode-nsbca.test.ts`,
  `decode-strm.test.ts`, `write-obj.test.ts`, `write-glb.test.ts` (parsing its own two GLB chunks back out and
  checking node hierarchy, accessor data, and animation sampler values), `binary-reader.test.ts` (the shared
  dictionary-reading primitive, including the real-world "Unknown section length lies" case below) for the reverse
  direction -- all of them encode-then-decode (or decode-then-reparse) round trips against this feature's own paired
  encoder/decoder, since there is still no real NSBTX/STRM to decode from an actual game (NSBMD now has three real
  downloaded files decoded by hand -- see below). Full monorepo suite (1321 tests) and typecheck across every
  touched package pass (the pre-existing `apps/desktop` typecheck failure over `ChildProcess.on/once`, in
  `packages/compiler`, unrelated to this feature, is the same already-known environment issue documented elsewhere
  in this project).
- **Several real structural bugs were caught by this testing, not by code review** -- worth naming, since they show
  why self-round-trip tests mattered more here than for any other feature in this codebase. Forward-direction bugs,
  found while the encoders were first written: (1) a stray `pad()` call silently shifted where NSBTX's palette
  block actually landed relative to where its own header said it was, because block *lengths* need to be a multiple
  of 8 but block *offsets* don't, and `pad()` rounded up the wrong thing; (2) MDL0's own `models` list offsets are
  relative to the whole MDL chunk, not to the dictionary itself, unlike `BoneList`/`MeshList`'s identically-shaped
  but self-relative offsets -- an inconsistency in the format itself, not a mistake to generalize away; (3)
  `MaterialList`'s header offset was off by two bytes; (4) the texture/palette pairing lists were being built as
  pointers to separately-stored structs when the format wants them inline. Bugs found only once a *paired decoder*
  existed, during the reverse-direction work: (5) `decode-strm.ts` double-added the STRM header's own "Wave Data
  Offset" to an already-absolute position (it already points past the "DATA" stamp and size, not to it); (6) a VTX_DIFF
  decode formula error in `decode-gx-commands.ts`, caught by hand re-derivation against GBATEK's own text before any
  test ran against it; (7) the `PivotForm` 9-form position table in `decode-nsbmd.ts` had real transcription errors
  on its first draft, caught by cross-validating forms 0/4/8 against the already-tested encoder and re-deriving the
  rest cell-by-cell from the source diagram; (8) `decode-nsbca.ts` repeated the exact same offset mistake as (5) in
  its own `animAt` computation; (9) **a genuine bug in the forward-direction `nsbca.ts` encoder, not a decoder bug,
  found only because a matching decoder and round-trip test now existed to expose it**: sampled animation curves
  were all written as 4-byte `u32` regardless of channel, but a sampled rotation's `RotMatrixIdx` is a 2-byte `u16`
  -- every forward-only `nsbca.test.ts` test passed throughout, because none of them checked actual decoded sample
  *values* for a sampled rotation curve, only byte counts and structure. Fixed directly in `nsbca.ts`, confirmed by
  all 14 tests across `nsbca.test.ts` and `decode-nsbca.test.ts` passing together with no regression. Every one of
  these was found by a test expecting a specific decoded value and getting a different one, then traced to its root
  cause rather than loosened to pass.
- **Three real, downloaded NSBMD files (not produced by this project) were decoded for the first time**, which
  surfaced bugs no self-round-trip test ever could, since this project's own encoder never produces the byte
  patterns real Nitro SDK tools do: (10) `readDictionary` located a dictionary's `element_size` field by jumping
  past the "Unknown" section using that section's own declared length (nsbmd_docs.txt's `unknown_size`) -- one real
  file declared that length 4 bytes longer than this project's `8 + 4*count` formula predicts (nsbmd_docs.txt itself
  marks the field's meaning with a "?"), which misread `element_size` as a large garbage value and cascaded into
  nonsense offsets for everything the dictionary pointed to. Fixed by deriving `element_size` algebraically from the
  dictionary's own `size` and `count` fields instead (`size = 16 + count*(20 + element_size)`, the same relation
  `dictionarySize` computes forwards) -- both are load-bearing for any reader to find the dictionary at all, so
  they're trustworthy where the Unknown section's declared length isn't. (11) Bone parentage was reconstructed from
  the render command list's matrix-stack load/store slots, deliberately ignoring each bone-multiply command's own
  `parent_idx` parameter, on the strength of nsbmd_docs.txt's claim that parameter "I don't think it's used at all
  at runtime." A real file's stack reconstruction produced nonsense (every non-root bone's "load" slot was still
  unwritten when its command ran), while `parent_idx` gave the exact, correct skeleton -- unused by the hardware
  doesn't mean unreliable as authored data, and this project's own encoder already writes it the same way (a bone's
  real parent, or its own index for a root). Switched to trust `parent_idx` directly. (12) Relatedly, a mesh's bound
  bone was tracked only through bone-multiply commands, treating a bare "Load Matrix from Stack" command (0x03) as a
  no-op -- but a real file used exactly that command to draw a second mesh against an earlier bone's matrix without
  re-walking the multiply chain, a pattern this project's own encoder never emits (it draws each mesh immediately
  after its own bone). Fixed by tracking which bone last stored into each stack slot and updating the "current" bone
  on a stack load too. (13) The materials dictionary was located by assuming it always sits right after wherever the
  palette-pairing dictionary ends, matching this project's own encoder's layout; nsbmd_docs.txt's own `MaterialList`
  struct instead shows it inline right after the list's 4-byte header, which is what a real file actually does.
  Fixed by checking which position's declared entry count matches the Model header's own `num_materials`, so either
  layout now decodes correctly. Covered by `binary-reader.test.ts` (a hand-built dictionary whose declared
  Unknown-section length doesn't match the usual formula) plus manual verification against all three real files
  (hex-dumped and hand-traced against nsbmd_docs.txt's own opcode tables, then run through the actual decoder and
  the full `writeObj`/`writeGlb` pipeline) -- not automated, since the files themselves can't be committed to this
  repo, but this is the first real third-party verification this feature has had in either direction.
- **Not verified:** actually opening any converted file (in either direction) in the real Nitro SDK, a DS emulator,
  or on real hardware, or opening a reverse-converted PNG/OBJ/GLB/WAV in a real third-party tool -- there is no way
  to do either from here. Besides the three real NSBMD files above (decoded correctly, including bone hierarchy,
  mesh/material binding, and a clean `writeObj`/`writeGlb` pass, but never opened in a real viewer), every other
  check here is internal self-consistency (an encoder's output decodes back to the same values; a GLB's own
  JSON+binary chunks parse back to the structure `writeGlb` itself built) rather than "a real tool opened this file
  correctly." Treat the output as a best-effort, carefully-researched conversion, not a guarantee of byte-for-byte
  compatibility with Nintendo's own tools or of universal acceptance by every PNG/OBJ/GLB/WAV reader. **Not built:**
  a `.glb`/`.gltf` input on the Converter tab's forward direction (the real
  multi-bone/animation encode path exists in `convert.ts` and is exercised by its own tests, but isn't wired to a
  button, since the owner's original request named `.obj`); NSBTX's 4x4-compressed or translucent-palette texture
  formats on decode (refused with a clear message); STRM looping/multi-block splitting on either direction; NSBMD
  materials with more than a flat white vertex color on encode, or any lighting/material properties beyond a name
  on decode; weighted vertex skinning in either direction (the format's own `0x09` render command is skipped, not
  decoded, since this project never emits it and the DS hardware has no hardware skinning to justify adding it).
