# DS toolchain and emulator (Windows)

What's needed to turn a project into a `.nds` and see it run. The compiler
work (`requirements/compiler/`) depends on it. Nothing here is bundled with
the app: the app detects an installed toolchain and emulator, so these scripts
set up a developer machine.

```powershell
powershell -ExecutionPolicy Bypass -File tools\ds-toolchain\setup-windows.ps1
```

No admin rights needed. Safe to re-run; finished steps are skipped.

| Piece | Where it ends up | How |
|---|---|---|
| melonDS 1.1 | `%LOCALAPPDATA%\Microsoft\WinGet\Packages\melonDS.melonDS_*\melonDS.exe` | `winget install melonDS.melonDS` |
| MSYS2 | `C:\msys64` | base archive from repo.msys2.org, extracted |
| devkitARM 16.1.0, libnds, ndstool, grit, mmutil | `C:\msys64\opt\devkitpro` (`/opt/devkitpro` inside MSYS2) | devkitPro's pacman repos inside MSYS2, `pacman -S nds-dev` |
| `make` | inside MSYS2 | `pacman -S make` |

## Why MSYS2 and not devkitPro's installer
devkitPro's Windows installer (`devkitProUpdater`) is a GUI wizard; running it
with `/S` exits 0 and installs nothing. devkitPro documents adding its package
repositories to an existing MSYS2 instead, which is scriptable and needs no
admin rights.

## Things a build driver has to know
- `DEVKITPRO` / `DEVKITARM` are **MSYS-side paths** (`/opt/devkitpro`,
  `/opt/devkitpro/devkitARM`). They are not Windows environment variables, so a
  Windows-side lookup of `DEVKITPRO` finds nothing. Look for `C:\msys64\opt\devkitpro`.
- `source /etc/profile.d/devkit-env.sh` sets those variables but does **not** put
  the compilers on `PATH`. Export `PATH="$DEVKITARM/bin:$DEVKITPRO/tools/bin:$PATH"`.
- Builds run through `C:\msys64\usr\bin\bash.exe -l <script>`. Inside MSYS2, `/tmp` is
  `C:\msys64\tmp`, which is not Git Bash's or Windows' temp directory.
- `make` and the ARM compiler are not on the Windows `PATH`.

## The scripts here
| Script | What it does |
|---|---|
| `setup-windows.ps1` | Installs melonDS, MSYS2 and the devkitPro NDS toolset (idempotent, no admin). |
| `dkp-setup.sh` | The part of setup that runs inside MSYS2 (adds devkitPro's repos, installs `nds-dev` and `make`). |
| `build-example.sh` | Builds libnds's bundled `Simple_Tri` example, to prove the toolchain. |
| `make-rom.sh <msys dir>` | Runs `make` on a directory the way the compiler's build driver does (env vars, `PATH`). |
| `capture-melonds.ps1` | Runs a ROM in melonDS and saves a picture of the emulator window. |
| `measure-melonds-audio.ps1` | The audio counterpart: runs a ROM in melonDS (`-Rom`), or watches a running program and its child processes (`-RootPid`), and prints how loud its audio output is over time, from Windows' per-application peak meter. Used by the sound tests. |
| `melonds-input.ps1` | Runs a ROM in melonDS and sends it real key presses and touches (`-Tap`, `-Hold`, `-Click`), then saves a picture. melonDS has no keys bound on this machine, so it runs a temporary copy of melonDS with its own config (A=X, B=Z, X=S, Y=A, L=Q, R=W, Start=Enter, Select=Backspace, arrows) and leaves the installed one alone. Used by the script input tests. |
| `build-fixture-and-capture.ps1` | Compiles a fixture or `.gsds` project, runs it, and saves a picture: the quickest way to *look* at what the compiler produces. |

`pnpm test:rom` (repo root) does the same build-run-capture automatically and
compares the picture with an independent render; see `requirements/compiler/`.

## Proving it works
```powershell
C:\msys64\usr\bin\bash.exe -l /c/Users/<you>/dev/good-stuff-ds-game-maker/tools/ds-toolchain/build-example.sh
powershell -File tools\ds-toolchain\capture-melonds.ps1 -Rom C:\msys64\tmp\hello3d\hello3d.nds -Out hello3d.png
```
The first builds libnds's bundled `Simple_Tri` example into a 114 KB `.nds`
(devkitARM 16.1.0, ndstool 2.3.1). The second runs it in melonDS and saves a
picture of the emulator window: a rainbow triangle on the top screen, with the
window title `[60/60] melonDS 1.1`.

Verified 2026-09-23 on Windows 11: the ROM boots in melonDS with no BIOS or
firmware files supplied (melonDS runs homebrew without them).

## Capturing an emulator run: what it took
- The capture process must be **DPI-aware**, or on a scaled display it captures the wrong
  region (the first attempt was solid black).
- The emulator window must be **topmost**, or whatever is in front of it gets photographed
  (one run captured a code editor).
- melonDS's window title reports emulator speed (`[60/60] melonDS 1.1`), not how often a ROM
  presents its 3D scene.
