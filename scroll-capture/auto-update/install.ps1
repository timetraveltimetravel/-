# 스크롤 캡처: 자동 업데이트의 예약 작업을 등록한다.
# 예약 작업은 정해진 간격으로 pull.ps1을 실행한다. 관리자 권한은 필요하지 않다.
#
# 실행:  powershell -ExecutionPolicy Bypass -File install.ps1
# 제거:  powershell -ExecutionPolicy Bypass -File uninstall.ps1
#
# 이 파일은 UTF-8 (BOM 있음)으로 저장한다. BOM이 없으면 Windows PowerShell 5.1이 한글을 잘못 읽는다.

param(
  [string]$TaskName = 'ScrollCapture-AutoUpdate',
  [ValidateRange(5, 1440)]
  [int]$IntervalMinutes = 60
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$script = Join-Path $PSScriptRoot 'pull.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $script

if (Test-Path -LiteralPath $conhost) {
  # conhost --headless는 창을 보여주지 않고 실행한다.
  $action = New-ScheduledTaskAction -Execute $conhost -Argument ('--headless "{0}" {1}' -f $powershell, $arguments)
} else {
  $action = New-ScheduledTaskAction -Execute $powershell -Argument "-WindowStyle Hidden $arguments"
}

# 1분 후에 처음 실행하고, 그 다음에 정해진 간격으로 계속 실행한다.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description '스크롤 캡처 확장 프로그램의 새 버전을 git으로 받는다.' -Force | Out-Null

Write-Output "예약 작업 `"$TaskName`"을 등록했습니다. 간격: ${IntervalMinutes}분."
Write-Output "실행하는 파일: $script"
Write-Output "기록 파일: $(Join-Path $PSScriptRoot 'update.log')"
