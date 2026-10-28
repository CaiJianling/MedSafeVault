param([string]$FilePath, [string[]]$ArgumentList = @(), [string]$DataDir, [string]$Out, [string[]]$Keys = @(), [string]$PasteText = '', [int]$AfterKeysSec = 6, [int]$TimeoutSec = 60, [int]$SettleSec = 5)
$ErrorActionPreference = 'Stop'
# The shell is only system-DPI aware, so GetWindowRect would report logical
# pixels while CopyFromScreen grabs physical ones and the capture gets cropped.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[void][Dpi]::SetProcessDPIAware()
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WS3 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder t, int c);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$script:hit = @()
function Find-Target {
  $script:hit = @()
  $cb = [WS3+EnumWindowsProc] {
    param($h, $l)
    if ([WS3]::IsWindowVisible($h)) {
      $len = [WS3]::GetWindowTextLength($h)
      if ($len -gt 0) {
        $sb = New-Object System.Text.StringBuilder ($len + 2)
        [void][WS3]::GetWindowText($h, $sb, $sb.Capacity)
        $wid = 0
        [void][WS3]::GetWindowThreadProcessId($h, [ref]$wid)
        if (($sb.ToString() -like '*MedSafeVault*') -and ($pids -contains [int]$wid)) { $script:hit += ,@($h, $sb.ToString()) }
      }
    }
    return $true
  }
  [void][WS3]::EnumWindows($cb, [IntPtr]::Zero)
}
function Grab([string]$path) {
  $r = New-Object WS3+RECT
  [void][WS3]::GetWindowRect($hwnd, [ref]$r)
  [void][WS3]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 600
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "saved: $path (${w}x${h})"
}
$env:MEDSAFE_DATA_DIR = $DataDir
if ($ArgumentList.Count -gt 0) {
  $proc = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru
} else {
  $proc = Start-Process -FilePath $FilePath -PassThru
}
$pids = @($proc.Id) + (Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" | ForEach-Object { $_.ProcessId })
$pids = $pids | Where-Object { $_ }
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 700
  Find-Target
  if ($script:hit.Count -gt 0) { break }
  if ($proc.HasExited) { Write-Output "PROCESS EXITED code=$($proc.ExitCode)"; exit 1 }
}
if ($script:hit.Count -eq 0) { Write-Output 'NO WINDOW within timeout'; exit 1 }
$hwnd = [IntPtr]$script:hit[0][0]
Write-Output ("title: " + $script:hit[0][1])
[void][WS3]::ShowWindow($hwnd, 3)
Start-Sleep -Seconds $SettleSec
Grab ($Out + '.1.png')
if ($PasteText -ne '') {
  Set-Clipboard -Value $PasteText
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Seconds 1
}
foreach ($k in $Keys) {
  if ($k -eq '') { continue }
  [System.Windows.Forms.SendKeys]::SendWait($k)
  Start-Sleep -Seconds 1
}
if ($Keys.Count -gt 0) {
  Start-Sleep -Seconds $AfterKeysSec
  Grab ($Out + '.2.png')
}
Start-Sleep -Seconds 1
& taskkill /PID $proc.Id /T /F | Out-Null
Write-Output 'killed'
