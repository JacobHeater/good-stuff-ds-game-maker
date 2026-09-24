<#
.SYNOPSIS
  Installs what's needed to build a Nintendo DS ROM and run it in an emulator, on Windows, without admin rights.

.DESCRIPTION
  1. melonDS        - via winget (portable, per-user).
  2. MSYS2          - the base archive extracted to C:\msys64. devkitPro's own Windows installer is a
                      GUI wizard with no unattended mode; devkitPro documents using its pacman
                      repositories inside an existing MSYS2 instead, which is scriptable.
  3. devkitPro NDS  - devkitARM + libnds + ndstool etc. via pacman, plus `make`.
  Each step is skipped if already done, so this is safe to re-run.

  Result: melonDS via winget, and the toolchain at C:\msys64\opt\devkitpro (that is /opt/devkitpro
  inside MSYS2). DEVKITPRO is an MSYS-side path; it is not set on the Windows side.
#>
$ErrorActionPreference = "Stop"
$Msys = "C:\msys64"
$MsysBash = "$Msys\usr\bin\bash.exe"
$Gcc = "$Msys\opt\devkitpro\devkitARM\bin\arm-none-eabi-gcc.exe"

function ToMsysPath([string]$winPath) { "/" + $winPath.Substring(0, 1).ToLower() + $winPath.Substring(2).Replace("\", "/") }

# --- 1. melonDS
$melon = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter melonDS.exe -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty FullName
if ($melon) { "melonDS: already installed ($melon)" }
else {
  "melonDS: installing via winget"
  winget install --id melonDS.melonDS --exact --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget failed to install melonDS (exit $LASTEXITCODE)" }
}

# --- 2. MSYS2
if (Test-Path $MsysBash) { "MSYS2: already present ($Msys)" }
else {
  "MSYS2: downloading the base archive"
  $index = (Invoke-WebRequest "https://repo.msys2.org/distrib/x86_64/" -UseBasicParsing).Content
  $name = [regex]::Matches($index, 'msys2-base-x86_64-\d+\.sfx\.exe"') | ForEach-Object { $_.Value.TrimEnd('"') } | Sort-Object | Select-Object -Last 1
  if (-not $name) { throw "Could not find an MSYS2 base archive at repo.msys2.org" }
  $sfx = Join-Path $env:TEMP $name
  Invoke-WebRequest "https://repo.msys2.org/distrib/x86_64/$name" -OutFile $sfx -UseBasicParsing
  "MSYS2: extracting $name to C:\"
  & $sfx -y -oC:\ | Out-Null
  if (-not (Test-Path $MsysBash)) { throw "MSYS2 extraction failed" }
}

# --- 3. devkitPro NDS toolset (+ make)
if (Test-Path $Gcc) { "devkitPro: already installed ($Gcc)" }
else {
  "devkitPro: installing nds-dev via pacman (this downloads a few hundred MB)"
  & $MsysBash -l (ToMsysPath (Join-Path $PSScriptRoot "dkp-setup.sh"))
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Gcc)) { throw "devkitPro install failed" }
}

""
"Done. To prove it works:"
"  $MsysBash -l $(ToMsysPath (Join-Path $PSScriptRoot 'build-example.sh'))"
"  powershell -File `"$PSScriptRoot\capture-melonds.ps1`" -Rom C:\msys64\tmp\hello3d\hello3d.nds -Out hello3d.png"
