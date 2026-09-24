<#
.SYNOPSIS
  Runs a .nds ROM in melonDS, lets it run for a few seconds, and saves a PNG of the emulator window.

.DESCRIPTION
  Proves that an emulator run can be observed without a person. The process must be
  DPI-aware: on a scaled display, window rectangles from a DPI-unaware process are in
  virtualized coordinates and the capture comes out as the wrong region (it came out
  solid black the first time this was tried).

  Prints the window title, which melonDS uses to report speed, e.g. "[60/60] melonDS 1.1".

.EXAMPLE
  .\capture-melonds.ps1 -Rom C:\msys64\tmp\hello3d\hello3d.nds -Out hello3d.png
#>
param(
  [Parameter(Mandatory)][string]$Rom,
  [Parameter(Mandatory)][string]$Out,
  [int]$WaitSeconds = 6
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class GsWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
"@
[GsWin]::SetProcessDPIAware() | Out-Null

$exe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter melonDS.exe -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $exe) { throw "melonDS.exe not found. Run setup-windows.ps1 first." }

$p = Start-Process -FilePath $exe -ArgumentList "`"$Rom`"" -PassThru
try {
  Start-Sleep -Seconds $WaitSeconds
  $p.Refresh()
  if ($p.HasExited) { throw "melonDS exited early (code $($p.ExitCode))." }
  "title: $($p.MainWindowTitle)"
  # Windows won't always let a background process take the foreground, and a picture of the screen shows
  # whatever is on top. Make the emulator topmost (not activated) so nothing can be in front of it.
  $HWND_TOPMOST = [IntPtr](-1)
  $SWP_NOSIZE_NOMOVE_NOACTIVATE = 0x0001 -bor 0x0002 -bor 0x0010
  [GsWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null   # SW_RESTORE, in case it opened minimized
  [GsWin]::SetWindowPos($p.MainWindowHandle, $HWND_TOPMOST, 0, 0, 0, 0, $SWP_NOSIZE_NOMOVE_NOACTIVATE) | Out-Null
  [GsWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 700
  $r = New-Object GsWin+RECT
  [GsWin]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  "saved: $Out (${w}x${h})"
} finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
