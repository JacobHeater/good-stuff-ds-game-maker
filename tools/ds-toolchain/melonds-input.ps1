<#
.SYNOPSIS
  Runs a .nds ROM in melonDS, presses DS buttons or touches the touch screen with real keyboard and mouse input, and saves a picture.

.DESCRIPTION
  The input counterpart of capture-melonds.ps1, for testing what a game does when a button is pressed. It sends genuine keyboard events
  (keybd_event) and mouse events to the emulator window, using melonDS's default key bindings:

    A = X    B = Z    X = S    Y = A    L = Q    R = W    Start = Enter    Select = Backspace    D-pad = arrow keys

  These are bound in a private, temporary copy of melonDS (its exe and its config, copied to a temp folder and deleted afterwards), so the real
  emulator's settings are never touched. (A fresh melonDS has *no* keyboard bindings at all, and this machine's config has every button
  unbound; without binding them, no key press could reach the game.) Touching the screen is a mouse click on the bottom screen.

  The sequence: launch, wait for the game to start (-BootSeconds), then
    1. tap every key in -Tap once (held down for -TapMs), waiting a little after each;
    2. press and keep pressed every key in -Hold, and/or press the mouse at -Click (absolute screen pixels), wait -HoldSeconds;
    3. save a picture of the window while they are still down, then release everything.
  With no input at all it just waits -HoldSeconds and takes the picture.

  Prints "window: LEFT TOP WIDTH HEIGHT" (screen pixels) and "saved: <path>". The picture is taken with the process DPI-aware, like capture-melonds.ps1.

.EXAMPLE
  .\melonds-input.ps1 -Rom game.nds -Out held.png -Hold left -HoldSeconds 1.5
  .\melonds-input.ps1 -Rom game.nds -Out tap.png -Tap a -HoldSeconds 1
  .\melonds-input.ps1 -Rom game.nds -Out touch.png -Click "900,700" -HoldSeconds 1
#>
param(
  [Parameter(Mandatory)][string]$Rom,
  [Parameter(Mandatory)][string]$Out,
  [double]$BootSeconds = 4,
  [string[]]$Hold = @(),
  [string[]]$Tap = @(),
  [int]$TapMs = 100,
  [string]$Click = "",
  [double]$HoldSeconds = 1.5
)
$ErrorActionPreference = "Stop"
# `-Tap a,a` from another program arrives as one string "a,a"; take it apart.
$Tap = @($Tap | ForEach-Object { $_ -split "," } | Where-Object { $_ })
$Hold = @($Hold | ForEach-Object { $_ -split "," } | Where-Object { $_ })
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class GsInput {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
}
"@
[GsInput]::SetProcessDPIAware() | Out-Null

# melonDS's default keyboard bindings (virtual-key codes).
$keys = @{
  a = 0x58; b = 0x5A; x = 0x53; y = 0x41; l = 0x51; r = 0x57; start = 0x0D; select = 0x08
  up = 0x26; down = 0x28; left = 0x25; right = 0x27
}
$extended = @("up", "down", "left", "right")
function Send-Key([string]$name, [bool]$down) {
  if (-not $keys.ContainsKey($name)) { throw "Unknown button '$name'. Known: $($keys.Keys -join ', ')" }
  $vk = [byte]$keys[$name]
  $flags = 0
  if ($extended -contains $name) { $flags = $flags -bor 1 }   # KEYEVENTF_EXTENDEDKEY
  if (-not $down) { $flags = $flags -bor 2 }                    # KEYEVENTF_KEYUP
  [GsInput]::keybd_event($vk, [byte][GsInput]::MapVirtualKey([uint32]$vk, 0), [uint32]$flags, [UIntPtr]::Zero)
}

$exe = $env:GSDS_MELONDS_PATH
if (-not $exe -or -not (Test-Path $exe)) {
  $exe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter melonDS.exe -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $exe) { throw "melonDS.exe not found. Run setup-windows.ps1 first." }

# A temporary copy of the emulator, with the DS buttons bound to the keys in $keys. melonDS keeps its config in melonDS.toml next to the exe.
$temp = Join-Path $env:TEMP ("gsds-melonds-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temp | Out-Null
Copy-Item $exe (Join-Path $temp "melonDS.exe")
$sourceConfig = Join-Path (Split-Path $exe) "melonDS.toml"
$lines = if (Test-Path $sourceConfig) { [System.Collections.Generic.List[string]](Get-Content $sourceConfig) } else { New-Object 'System.Collections.Generic.List[string]' }
# Qt key codes: letters are their capital's code; the special keys are 0x01000000 + n.
$qt = @{
  A = 0x58; B = 0x5A; X = 0x53; Y = 0x41; L = 0x51; R = 0x57; Start = 0x01000004; Select = 0x01000003
  Up = 0x01000013; Down = 0x01000015; Left = 0x01000012; Right = 0x01000014
}
$sectionStart = $lines.IndexOf("[Instance0.Keyboard]")
if ($sectionStart -lt 0) {
  $lines.Add("")
  $lines.Add("[Instance0.Keyboard]")
  foreach ($k in $qt.Keys) { $lines.Add("$k = $($qt[$k])") }
} else {
  $i = $sectionStart + 1
  $seen = @{}
  while ($i -lt $lines.Count -and -not $lines[$i].StartsWith("[")) {
    if ($lines[$i] -match "^(\w+)\s*=") {
      $key = $Matches[1]
      if ($qt.ContainsKey($key)) { $lines[$i] = "$key = $($qt[$key])"; $seen[$key] = $true }
    }
    $i++
  }
  foreach ($k in $qt.Keys) { if (-not $seen.ContainsKey($k)) { $lines.Insert($sectionStart + 1, "$k = $($qt[$k])") } }
}
Set-Content -Path (Join-Path $temp "melonDS.toml") -Value $lines -Encoding UTF8
$exe = Join-Path $temp "melonDS.exe"

$p = Start-Process -FilePath $exe -ArgumentList "`"$Rom`"" -PassThru
try {
  Start-Sleep -Milliseconds ([int]($BootSeconds * 1000))
  $p.Refresh()
  if ($p.HasExited) { throw "melonDS exited early (code $($p.ExitCode))." }
  # The keyboard goes to the foreground window, so make sure that is the emulator (and nothing can be in front of it for the picture).
  $handle = $p.MainWindowHandle
  [GsInput]::ShowWindow($handle, 9) | Out-Null
  [GsInput]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010) | Out-Null
  [GsInput]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 700

  # Windows won't always let a background process take the foreground, and keys only reach the foreground window. A mouse click always
  # focuses the window it is on, so click on the top screen (which ignores the mouse: only the bottom screen is touch) before any key.
  if ($Tap.Count -gt 0 -or $Hold.Count -gt 0) {
    $fr = New-Object GsInput+RECT
    [GsInput]::GetWindowRect($handle, [ref]$fr) | Out-Null
    $fx = [int](($fr.Left + $fr.Right) / 2)
    $fy = [int]($fr.Top + ($fr.Bottom - $fr.Top) * 0.22)
    [GsInput]::SetCursorPos($fx, $fy) | Out-Null
    Start-Sleep -Milliseconds 150
    [GsInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [GsInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 400
  }

  foreach ($name in $Tap) {
    Send-Key $name $true
    Start-Sleep -Milliseconds $TapMs
    Send-Key $name $false
    Start-Sleep -Milliseconds 400
  }
  foreach ($name in $Hold) { Send-Key $name $true }
  if ($Click -ne "") {
    $xy = $Click.Split(",")
    [GsInput]::SetCursorPos([int]$xy[0], [int]$xy[1]) | Out-Null
    Start-Sleep -Milliseconds 150
    [GsInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)   # left button down
  }
  Start-Sleep -Milliseconds ([int]($HoldSeconds * 1000))

  $r = New-Object GsInput+RECT
  [GsInput]::GetWindowRect($handle, [ref]$r) | Out-Null
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  "window: $($r.Left) $($r.Top) $w $h"
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  "saved: $Out (${w}x${h})"

  if ($Click -ne "") { [GsInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }   # left button up
  foreach ($name in $Hold) { Send-Key $name $false }
} finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 300
  Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}
