param(
  [string]$ConfigPath = "",
  [string]$BackupDir = "",
  [Nullable[int]]$RetentionDays = $null,
  [string]$MySqlDumpPath = ""
)

$ErrorActionPreference = "Stop"

# Embedded Hostinger database credentials. Keep this file private.
$DbConfig = @{
  Host = '193.203.184.152'
  User = 'u380633007_lnpidata'
  Password = '!Office1@'
  Name = 'u380633007_lnpidata'
  Port = '3306'
}

function Write-BackupLog {
  param([string]$Message, [string]$Level = "INFO")

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$timestamp] [$Level] $Message"
  Add-Content -LiteralPath $script:LogFile -Value $line
  Write-Host $line
}

function Read-BackupConfig {
  param([string]$Path)

  if (-not $Path) {
    $Path = Join-Path $PSScriptRoot "hostinger-backup.config.psd1"
  }

  if (-not (Test-Path -LiteralPath $Path)) {
    return @{}
  }

  $config = Import-PowerShellDataFile -LiteralPath $Path
  if (-not $config) {
    return @{}
  }

  return $config
}

function Resolve-MySqlDump {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    if (Test-Path -LiteralPath $ExplicitPath) {
      return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }
    throw "mysqldump.exe not found at configured path: $ExplicitPath"
  }

  $cmd = Get-Command mysqldump.exe -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $commonPaths = @(
    "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
    "C:\Program Files\MariaDB 11.4\bin\mysqldump.exe",
    "C:\Program Files\MariaDB 10.11\bin\mysqldump.exe"
  )

  foreach ($path in $commonPaths) {
    if (Test-Path -LiteralPath $path) {
      return $path
    }
  }

  throw "mysqldump.exe was not found. Install MySQL Client tools or pass -MySqlDumpPath."
}

try {
  $fileConfig = Read-BackupConfig -Path $ConfigPath

  if (-not $BackupDir) {
    $BackupDir = [string]$fileConfig.BackupDir
  }
  if (-not $BackupDir) {
    $BackupDir = "D:\lnpi\backups"
  }

  if ($null -eq $RetentionDays) {
    if ($null -ne $fileConfig.RetentionDays -and [string]$fileConfig.RetentionDays -ne "") {
      $RetentionDays = [int]$fileConfig.RetentionDays
    } else {
      $RetentionDays = 30
    }
  }

  if (-not $MySqlDumpPath) {
    $MySqlDumpPath = [string]$fileConfig.MySqlDumpPath
  }

  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $script:LogFile = Join-Path $BackupDir "backup.log"

  $dbHost = [string]$DbConfig.Host
  $dbUser = [string]$DbConfig.User
  $dbPassword = [string]$DbConfig.Password
  $dbName = [string]$DbConfig.Name
  $dbPort = [string]$DbConfig.Port
  if (-not $dbPort) {
    $dbPort = "3306"
  }

  $missing = @()
  if (-not $dbHost) { $missing += "DB_HOST" }
  if (-not $dbUser) { $missing += "DB_USER" }
  if (-not $dbPassword) { $missing += "DB_PASSWORD" }
  if (-not $dbName) { $missing += "DB_NAME" }
  if ($missing.Count -gt 0) {
    throw "Missing embedded database values: $($missing -join ', ')"
  }

  $mysqldump = Resolve-MySqlDump -ExplicitPath $MySqlDumpPath
  $safeDbName = $dbName -replace '[\\/:*?"<>|]', "_"
  $stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
  $backupFile = Join-Path $BackupDir "${safeDbName}_$stamp.sql"

  Write-BackupLog "Starting backup for database '$dbName' from '${dbHost}:${dbPort}'."

  $env:MYSQL_PWD = $dbPassword
  $dumpArgs = @(
    "--host=$dbHost",
    "--port=$dbPort",
    "--user=$dbUser",
    "--single-transaction",
    "--routines",
    "--triggers",
    "--events",
    "--column-statistics=0",
    "--default-character-set=utf8mb4",
    "--databases",
    $dbName,
    "--result-file=$backupFile"
  )

  & $mysqldump @dumpArgs
  $exitCode = $LASTEXITCODE
  Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue

  if ($exitCode -ne 0) {
    if (Test-Path -LiteralPath $backupFile) {
      Remove-Item -LiteralPath $backupFile -Force
    }
    throw "mysqldump failed with exit code $exitCode."
  }

  if (-not (Test-Path -LiteralPath $backupFile)) {
    throw "Backup file was not created: $backupFile"
  }

  $backupSize = (Get-Item -LiteralPath $backupFile).Length
  if ($backupSize -le 0) {
    Remove-Item -LiteralPath $backupFile -Force
    throw "Backup file was empty."
  }

  Write-BackupLog "Backup completed: $backupFile ($backupSize bytes)."

  $cutoff = (Get-Date).AddDays(-1 * [int]$RetentionDays)
  $deleted = 0
  Get-ChildItem -LiteralPath $BackupDir -Filter "*.sql" -File |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force
      $deleted += 1
    }

  Write-BackupLog "Retention cleanup completed. Deleted $deleted .sql file(s) older than $RetentionDays day(s)."
  exit 0
} catch {
  Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
  if (-not $script:LogFile) {
    $fallbackDir = if ($BackupDir) { $BackupDir } else { "D:\lnpi\backups" }
    New-Item -ItemType Directory -Force -Path $fallbackDir | Out-Null
    $script:LogFile = Join-Path $fallbackDir "backup.log"
  }
  Write-BackupLog $_.Exception.Message "ERROR"
  exit 1
}