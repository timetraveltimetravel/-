# 스크롤 캡처: 새 버전을 git으로 받는다.
# 예약 작업 "ScrollCapture-AutoUpdate"가 이 파일을 실행한다. 이 파일을 직접 실행할 수도 있다.
# 결과는 이 폴더의 update.log에 기록한다.
#
# 이 파일은 UTF-8 (BOM 있음)으로 저장한다. BOM이 없으면 Windows PowerShell 5.1이 한글을 잘못 읽는다.

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
# git이 로그인 창을 열지 않는다. 저장소는 공개 상태이고, 로그인은 필요하지 않다.
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'

$logPath = Join-Path $PSScriptRoot 'update.log'

# 기록 파일에는 마지막 200줄만 보관한다.
function Write-Log([string]$text) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
  Write-Output $line
  $old = @()
  if (Test-Path -LiteralPath $logPath) {
    $old = @(Get-Content -LiteralPath $logPath -Encoding UTF8 | Select-Object -Last 199)
  }
  Set-Content -LiteralPath $logPath -Value ($old + $line) -Encoding UTF8
}

function Find-Git {
  $command = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @(
    "$env:ProgramFiles\Git\cmd\git.exe",
    "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
    "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
  )
  foreach ($path in $candidates) {
    if ($path -and (Test-Path -LiteralPath $path)) { return $path }
  }
  return $null
}

$git = Find-Git
if (-not $git) {
  Write-Log '실패: git이 없습니다. https://git-scm.com 에서 git을 설치하십시오.'
  exit 1
}

$before = & $git -C $PSScriptRoot rev-parse HEAD 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Log '실패: 이 폴더는 git 저장소가 아닙니다.'
  exit 1
}

# --ff-only: 이 PC에서 바꾼 파일이 있으면 git은 그 파일을 덮어쓰지 않고, 실패를 보고한다.
$output = (& $git -C $PSScriptRoot pull --ff-only --quiet 2>&1 | ForEach-Object { "$_" }) -join ' '
if ($LASTEXITCODE -ne 0) {
  Write-Log "실패: git pull이 실패했습니다. $output"
  exit 1
}

$after = & $git -C $PSScriptRoot rev-parse HEAD
if ($before -eq $after) {
  Write-Log '변경 없음'
  exit 0
}

$version = '?'
try {
  $manifest = Join-Path (Split-Path -Parent $PSScriptRoot) 'manifest.json'
  $version = (Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
} catch {}
Write-Log ('업데이트: {0} -> {1} (버전 {2})' -f $before.Substring(0, 7), $after.Substring(0, 7), $version)
exit 0
