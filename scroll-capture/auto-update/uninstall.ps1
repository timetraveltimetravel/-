# 스크롤 캡처: 자동 업데이트의 예약 작업을 제거한다.
#
# 실행:  powershell -ExecutionPolicy Bypass -File uninstall.ps1
#
# 이 파일은 UTF-8 (BOM 있음)으로 저장한다. BOM이 없으면 Windows PowerShell 5.1이 한글을 잘못 읽는다.

param(
  [string]$TaskName = 'ScrollCapture-AutoUpdate'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "예약 작업 `"$TaskName`"을 제거했습니다."
} else {
  Write-Output "예약 작업 `"$TaskName`"이 없습니다."
}
