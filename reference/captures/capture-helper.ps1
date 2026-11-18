# Runs USBPcap captures on request, so one administrator prompt covers the whole session.
# It only runs USBPcapCMD.exe, which copies USB traffic into a file and sends nothing.
#
# Requests are files in this folder:
#   START-<name>   contains a filter number: start capturing that filter into <name>.pcap
#   STOP           stop the capture running now
#   QUIT           stop everything and exit
# It writes what it did to capture.log beside it.

$dir = $PSScriptRoot
$exe = 'C:\Program Files\USBPcap\USBPcapCMD.exe'
$log = Join-Path $dir 'capture.log'

function Write-Log([string]$message) {
  Add-Content -Path $log -Value ('{0:HH:mm:ss} {1}' -f (Get-Date), $message)
}

function Start-Capture([int]$filter, [string]$out) {
  $arguments = @('-d', "\\.\USBPcap$filter", '-A', '--inject-descriptors', '-o', "`"$out`"")
  return Start-Process -FilePath $exe -ArgumentList $arguments -PassThru -WindowStyle Hidden
}

function Stop-Capture($process) {
  if ($null -ne $process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit(5000) | Out-Null
  }
}

Write-Log 'helper started'

# Find which filter has the Azeron: three seconds on each.
foreach ($n in 1..4) {
  $out = Join-Path $dir "probe-$n.pcap"
  try {
    $p = Start-Capture $n $out
    Start-Sleep -Seconds 3
    Stop-Capture $p
    Write-Log "probe $n done"
  } catch {
    Write-Log "probe $n failed: $($_.Exception.Message)"
  }
}
Write-Log 'probes done'

$current = $null
$currentName = $null
while ($true) {
  if (Test-Path (Join-Path $dir 'QUIT')) {
    Stop-Capture $current
    Remove-Item (Join-Path $dir 'QUIT') -ErrorAction SilentlyContinue
    Write-Log 'helper stopped'
    break
  }
  $stop = Join-Path $dir 'STOP'
  if (Test-Path $stop) {
    Stop-Capture $current
    Remove-Item $stop -ErrorAction SilentlyContinue
    if ($null -ne $currentName) { Write-Log "stopped $currentName" }
    $current = $null
    $currentName = $null
  }
  $request = Get-ChildItem -Path $dir -Filter 'START-*' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $request -and $null -eq $current) {
    $name = $request.Name.Substring(6)
    $filter = [int](Get-Content -Path $request.FullName -Raw).Trim()
    Remove-Item $request.FullName
    $current = Start-Capture $filter (Join-Path $dir "$name.pcap")
    $currentName = $name
    Write-Log "capturing $name on USBPcap$filter"
  }
  Start-Sleep -Milliseconds 300
}
