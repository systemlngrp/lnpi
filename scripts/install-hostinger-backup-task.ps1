param(
  [string]$TaskName = "LNPI Hostinger DB Backup",
  [int]$RepeatMinutes = 60,
  [string]$ScriptPath = "",
  [string]$ConfigPath = "",
  [string]$BackupDir = "",
  [string]$MySqlDumpPath = "",
  [switch]$RunWhetherLoggedOnOrNot
)

$ErrorActionPreference = "Stop"

if (-not $ScriptPath) {
  $ScriptPath = Join-Path $PSScriptRoot "hostinger-backup-portable.ps1"
}
if (-not $ConfigPath) {
  $ConfigPath = Join-Path $PSScriptRoot "hostinger-backup.config.psd1"
}

$ScriptPath = (Resolve-Path -LiteralPath $ScriptPath).Path
if (Test-Path -LiteralPath $ConfigPath) {
  $ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
}

$argumentParts = @(
  "-NoProfile",
  "-ExecutionPolicy Bypass",
  "-File `"$ScriptPath`"",
  "-ConfigPath `"$ConfigPath`""
)
if ($BackupDir) {
  $argumentParts += "-BackupDir `"$BackupDir`""
}
if ($MySqlDumpPath) {
  $argumentParts += "-MySqlDumpPath `"$MySqlDumpPath`""
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($argumentParts -join " ")
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $RepeatMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

if ($RunWhetherLoggedOnOrNot) {
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Password -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
} else {
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
}

Write-Host "Scheduled task created/updated: $TaskName"
Write-Host "Action: powershell.exe $($argumentParts -join ' ')"
Write-Host "Repeat interval: every $RepeatMinutes minute(s)"