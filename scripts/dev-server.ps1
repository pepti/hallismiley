<#
  Detached local dev server with a max uptime.

  Runs `node server/server.js` as an independent, hidden background process that
  is NOT a child of whatever launched it (terminal, npm, or Claude), so it keeps
  serving after that parent exits. Stop it any time with `npm run dev:down`.

  AUTO-STOP CAVEAT: this script sets DEV_MAX_UPTIME_MS, but the server only
  self-terminates if server/server.js honours that variable. The HalliProjects
  base does not ship that support yet — until it does, the server runs until
  stopped explicitly. start / stop / restart / status all work regardless.

  State and logs are keyed off the project directory name, so several scaffolded
  projects can each run their own dev server without colliding.

  Usage (either directly or via the npm scripts):
    npm run dev:up        # start
    npm run dev:down      # stop now
    npm run dev:status    # is it running? when would it auto-stop?
    powershell -File scripts/dev-server.ps1 -Action start -Hours 8 -Port 8080

  The port defaults to PORT from .env (falling back to 3000) so the bind check
  and the stop step always target the port the app really listens on.
#>
[CmdletBinding()]
param(
  [ValidateSet('start', 'stop', 'restart', 'status')]
  [string]$Action = 'start',
  [double]$Hours = 12,
  [int]$Port = 0,          # 0 = read PORT from .env (see below)
  [switch]$Sweep
)

$ErrorActionPreference = 'Stop'
$ProjectDir  = Split-Path -Parent $PSScriptRoot           # scripts/ -> project root

# The port has to match the one the app actually binds, which comes from PORT
# in .env. Hard-coding a different default made `dev:up` report "server did not
# bind" on a server that had started perfectly, and made `dev:down` a silent
# no-op that left the old build serving — which is a genuinely confusing bug to
# chase, because the site keeps answering with stale code.
if ($Port -le 0) {
  $envFile = Join-Path $ProjectDir '.env'
  if (Test-Path $envFile) {
    $portLine = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
    if ($portLine) { $Port = [int]$portLine.Matches[0].Groups[1].Value }
  }
  if ($Port -le 0) { $Port = 3000 }   # server/server.js default
}
$ProjectName = Split-Path -Leaf $ProjectDir
$StateFile   = Join-Path $env:TEMP "$ProjectName-dev.json"
$OutLog      = Join-Path $env:TEMP "$ProjectName-dev.out.log"
$ErrLog      = Join-Path $env:TEMP "$ProjectName-dev.err.log"
$script:StartFailed = $false

function Get-PortPids {
  try {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch { @() }
}

function Stop-DevServer {
  # 1) tree-kill the pid we recorded at start
  if (Test-Path $StateFile) {
    try {
      $st = Get-Content $StateFile -Raw | ConvertFrom-Json
      if ($st.pid) { & taskkill /F /T /PID $st.pid 2>$null | Out-Null }
    } catch {}
  }
  # 2) kill whatever still holds the port
  foreach ($procId in Get-PortPids) {
    try { Stop-Process -Id $procId -Force -ErrorAction Stop } catch {}
  }
  # 3) optional sweep for a stray `npm run dev` that is not on the port and was
  #    not started by us. Node's command line is relative ("server/server.js"),
  #    so this CANNOT be scoped to one project — it kills every node running a
  #    server/server.js on this machine. Off by default so it can't take down a
  #    sibling scaffolded project; pass -Sweep when you know you want it.
  if ($Sweep) {
    try {
      Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction Stop |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'server[\\/]server\.js' } |
        ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
    } catch {}
  }
  if (Test-Path $StateFile) { Remove-Item $StateFile -Force -ErrorAction SilentlyContinue }
}

function Start-DevServer {
  Stop-DevServer
  # Make sure the port is actually free before we bind it again (max ~5s).
  for ($i = 0; $i -lt 10; $i++) { if (-not (Get-PortPids)) { break }; Start-Sleep -Milliseconds 500 }

  $env:DEV_MAX_UPTIME_MS = [string][int64]($Hours * 3600 * 1000)
  foreach ($f in @($OutLog, $ErrLog)) { if (Test-Path $f) { Remove-Item $f -Force } }

  # Plain `node` (not nodemon) so the auto-stop is a clean, single-process exit.
  $p = Start-Process -FilePath 'node' -ArgumentList 'server/server.js' `
        -WorkingDirectory $ProjectDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog

  $startedAt = Get-Date
  $stopAt    = $startedAt.AddHours($Hours)
  [ordered]@{
    pid = $p.Id; startedAt = $startedAt.ToString('o'); stopAt = $stopAt.ToString('o')
    hours = $Hours; port = $Port; outLog = $OutLog; errLog = $ErrLog
  } | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8

  $ok = $false
  for ($i = 0; $i -lt 50; $i++) { Start-Sleep -Milliseconds 500; if (Get-PortPids) { $ok = $true; break } }

  if ($ok) {
    "Dev server started (pid $($p.Id)) -> http://localhost:$Port"
    "Requested auto-stop at $($stopAt.ToString('yyyy-MM-dd HH:mm')) (~$Hours h) - honoured only if server.js reads DEV_MAX_UPTIME_MS."
    "Stop it any time: npm run dev:down"
  } else {
    $script:StartFailed = $true
    "ERROR: server did not bind port $Port within 25s. Last errors:"
    if (Test-Path $ErrLog) { Get-Content $ErrLog -Tail 25 }
  }
}

function Get-DevStatus {
  $listening = [bool](Get-PortPids)
  "Listening on ${Port}: $listening"
  if (Test-Path $StateFile) {
    $st     = Get-Content $StateFile -Raw | ConvertFrom-Json
    $stopAt = [datetime]$st.stopAt
    $remain = [math]::Round(($stopAt - (Get-Date)).TotalHours, 1)
    "  pid:      $($st.pid)"
    "  started:  $($st.startedAt)"
    "  stops at: $($st.stopAt)  (in $remain h, if DEV_MAX_UPTIME_MS is supported)"
    "  log:      $($st.outLog)"
  } else {
    "  (no state file - not started via dev:up)"
  }
}

switch ($Action) {
  'start'   { Start-DevServer }
  'stop'    { Stop-DevServer; "Dev server stopped." }
  'restart' { Stop-DevServer; Start-DevServer }
  'status'  { Get-DevStatus }
}

# Explicit exit code so a stray native exit code (e.g. taskkill finding nothing
# to kill) can't make `npm run dev:up` look like it failed when it didn't.
if ($script:StartFailed) { exit 1 }
exit 0
