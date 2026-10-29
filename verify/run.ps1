# 起一个独立 Edge 实例用于验证，不碰你日常在用的浏览器配置
#   .\verify\run.ps1                 带扩展启动（默认 9333 端口）
#   .\verify\run.ps1 -NoExtension     不带扩展启动，作为对照组
#   .\verify\run.ps1 -Stop            关掉验证实例并清理临时 profile
param(
  [int]$Port = 9333,
  [switch]$NoExtension,
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$profileDir = Join-Path $env:TEMP 'uas-csp-verify-profile'
$extDir = (Resolve-Path (Join-Path $PSScriptRoot '..\extension')).Path

function Get-EdgePath {
  $candidates = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  throw '没找到 Edge / Chrome，请手动指定 --remote-debugging-port 启动浏览器。'
}

function Stop-VerifyBrowser {
  $procs = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like "*$profileDir*" }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  if (Test-Path $profileDir) { Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Host "已停止验证实例并清理 $profileDir"
}

if ($Stop) { Stop-VerifyBrowser; return }

$exe = Get-EdgePath
$args = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$profileDir",
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank'
)
if (-not $NoExtension) {
  $args += "--load-extension=$extDir", "--disable-extensions-except=$extDir"
  Write-Host "扩展目录: $extDir"
} else {
  Write-Host '对照组模式：不加载扩展'
}

Start-Process -FilePath $exe -ArgumentList $args | Out-Null

# 等调试端口就绪
for ($i = 0; $i -lt 30; $i++) {
  try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 2
    Write-Host "浏览器已就绪: http://127.0.0.1:$Port"
    break
  } catch { Start-Sleep -Milliseconds 500 }
}

Write-Host ''
Write-Host "下一步（另开终端）："
Write-Host "  node verify/verify.mjs --port $Port --expect $(if ($NoExtension) { 'broken' } else { 'fixed' })"
Write-Host ''
Write-Host "结束后清理： .\verify\run.ps1 -Stop"
