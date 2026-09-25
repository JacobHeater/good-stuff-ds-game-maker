<#
.SYNOPSIS
  Records how loud a program's audio output is over time: melonDS running a .nds ROM, or any running process tree.

.DESCRIPTION
  The audio counterpart of capture-melonds.ps1. Windows keeps a peak meter for every application's audio session
  (IAudioMeterInformation, the same thing the volume mixer's bars show), so this finds melonDS's session and reads its
  peak level, 0..1, every few milliseconds. That is enough to test what a ROM's sound does without a person listening:
  whether it plays, how loud it is, and when it stops. It does not identify a pitch; a change of pitch shows up as a
  change in how long a non-looping sound lasts.

  With -Rom, launches melonDS with that ROM and measures it (and closes it afterwards). With -RootPid, measures an
  already-running program instead: that process and everything it started (Electron plays its sound from a helper
  process, so the whole tree is watched and the loudest session counts). The editor's audio preview is measured this way.

  Prints one JSON line:
    { "startedAtEpochMs": <wall clock when measuring began>,
      "samples": [[milliseconds since then, peak], ...], "everSawSession": true|false }
  A `peak` of 0 is also recorded while the program has no audio session yet (before it starts making sound).

.EXAMPLE
  .\measure-melonds-audio.ps1 -Rom tone.nds -Seconds 8
  .\measure-melonds-audio.ps1 -RootPid 1234 -Seconds 20
#>
param(
  [string]$Rom,
  [int]$RootPid = 0,
  [int]$Seconds = 8,
  [int]$IntervalMs = 25
)
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace GsAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr audioSessionGuid, int streamFlags, out IntPtr sessionControl);
    int GetSimpleAudioVolume(IntPtr audioSessionGuid, int streamFlags, out IntPtr audioVolume);
    int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl2 session);
  }

  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    // IAudioSessionControl
    int GetState(out int state);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
    int GetGroupingParam(out Guid param);
    int SetGroupingParam(ref Guid param, ref Guid context);
    int RegisterAudioSessionNotification(IntPtr client);
    int UnregisterAudioSessionNotification(IntPtr client);
    // IAudioSessionControl2
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetProcessId(out uint pid);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
  }

  [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    int GetPeakValue(out float peak);
  }

  public static class ProcessTree {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32 {
      public uint dwSize, cntUsage, th32ProcessID;
      public IntPtr th32DefaultHeapID;
      public uint th32ModuleID, cntThreads, th32ParentProcessID;
      public int pcPriClassBase;
      public uint dwFlags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    /// A process and every process it started, directly or not (a snapshot of the whole system, about a millisecond).
    public static uint[] Of(uint root) {
      var parents = new Dictionary<uint, uint>();
      IntPtr snapshot = CreateToolhelp32Snapshot(2, 0); // TH32CS_SNAPPROCESS
      var entry = new PROCESSENTRY32();
      entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
      if (Process32FirstW(snapshot, ref entry)) {
        do { parents[entry.th32ProcessID] = entry.th32ParentProcessID; } while (Process32NextW(snapshot, ref entry));
      }
      CloseHandle(snapshot);
      var tree = new HashSet<uint> { root };
      bool grew = true;
      while (grew) {
        grew = false;
        foreach (var pair in parents) if (tree.Contains(pair.Value) && tree.Add(pair.Key)) grew = true;
      }
      var result = new uint[tree.Count];
      tree.CopyTo(result);
      return result;
    }
  }

  public class SessionMeter {
    IAudioSessionManager2 manager;

    public SessionMeter() {
      var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
      IMMDevice device;
      // eRender = 0, eMultimedia = 1
      Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
      Guid iid = typeof(IAudioSessionManager2).GUID;
      object o;
      Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out o)); // CLSCTX_ALL
      manager = (IAudioSessionManager2)o;
    }

    /// The loudest peak level (0..1) among the audio sessions of the given processes, or -1 when none has a session (yet).
    public float Peak(uint[] processIds) {
      IAudioSessionEnumerator sessions;
      if (manager.GetSessionEnumerator(out sessions) != 0) return -1;
      int count;
      sessions.GetCount(out count);
      float best = -1;
      for (int i = 0; i < count; i++) {
        IAudioSessionControl2 control;
        if (sessions.GetSession(i, out control) != 0) continue;
        uint pid;
        control.GetProcessId(out pid);
        if (Array.IndexOf(processIds, pid) < 0) continue;
        float peak;
        if (((IAudioMeterInformation)control).GetPeakValue(out peak) == 0 && peak > best) best = peak;
      }
      return best;
    }
  }
}
"@

if (-not $Rom -and $RootPid -eq 0) { throw "Give -Rom (to run it in melonDS) or -RootPid (to measure a running program)." }

$launched = $null
if ($Rom) {
  $exe = $env:GSDS_MELONDS_PATH
  if (-not $exe -or -not (Test-Path $exe)) {
    $exe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter melonDS.exe -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $exe) { throw "melonDS.exe not found. Run setup-windows.ps1 first." }
}

$meter = New-Object GsAudio.SessionMeter
$startedAtEpochMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$watch = [System.Diagnostics.Stopwatch]::StartNew()
if ($Rom) { $launched = Start-Process -FilePath $exe -ArgumentList "`"$Rom`"" -PassThru }
$samples = New-Object System.Collections.Generic.List[object]
$sawSession = $false
try {
  while ($watch.Elapsed.TotalSeconds -lt $Seconds) {
    if ($launched -and $launched.HasExited) { throw "melonDS exited early (code $($launched.ExitCode))." }
    # The tree is looked at every time: Chromium starts its audio helper process when the first sound plays.
    $pids = if ($launched) { [uint32[]]@([uint32]$launched.Id) } else { [GsAudio.ProcessTree]::Of([uint32]$RootPid) }
    $peak = $meter.Peak($pids)
    if ($peak -ge 0) { $sawSession = $true } else { $peak = 0 }
    $samples.Add(@([int]$watch.ElapsedMilliseconds, [math]::Round($peak, 5)))
    Start-Sleep -Milliseconds $IntervalMs
  }
} finally {
  if ($launched) { Stop-Process -Id $launched.Id -Force -ErrorAction SilentlyContinue }
}
@{ startedAtEpochMs = $startedAtEpochMs; samples = $samples; everSawSession = $sawSession } | ConvertTo-Json -Compress -Depth 4
