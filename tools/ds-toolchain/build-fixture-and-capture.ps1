<#
.SYNOPSIS
  Compiles a fixture project (or a .gsds file) to a ROM by hand, runs it in melonDS, and saves a picture.

.DESCRIPTION
  A developer convenience for looking at what the compiler produces, before the app's own build driver
  and Export action exist. It does the same steps the driver will: translate the project to scene_data.c,
  assemble a build directory (the checked-in runtime + that data), run `make` inside MSYS2, and capture an
  emulator run (capture-melonds.ps1).

  Needs `pnpm --filter @goodstuff/compiler cli:build` to have been run.

.EXAMPLE
  .\build-fixture-and-capture.ps1 -Source fixture:primitives -Out primitives.png
#>
param(
  [Parameter(Mandatory)][string]$Source,
  [Parameter(Mandatory)][string]$Out,
  [int]$WaitSeconds = 6
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$cli = Join-Path $repo "packages\compiler\dist\cli.mjs"
if (-not (Test-Path $cli)) { throw "Run: pnpm --filter @goodstuff/compiler cli:build" }

$build = Join-Path $env:TEMP ("gsds-fixture-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force $build | Out-Null
Copy-Item -Recurse -Force (Join-Path $repo "packages\compiler\runtime\*") $build

node $cli scene-data $Source (Join-Path $build "source\scene_data.c")
if ($LASTEXITCODE -ne 0) { throw "translation failed" }

# C:\a\b -> /c/a/b, the form MSYS2 understands.
$msysBuild = "/" + $build.Substring(0, 1).ToLower() + $build.Substring(2).Replace("\", "/")
$makeRom = "/" + $PSScriptRoot.Substring(0, 1).ToLower() + $PSScriptRoot.Substring(2).Replace("\", "/") + "/make-rom.sh"
& C:\msys64\usr\bin\bash.exe -l $makeRom $msysBuild
if ($LASTEXITCODE -ne 0) { throw "make failed" }

$rom = Join-Path $build "gsgame.nds"
"rom: $rom ($((Get-Item $rom).Length) bytes)"
& (Join-Path $PSScriptRoot "capture-melonds.ps1") -Rom $rom -Out $Out -WaitSeconds $WaitSeconds
