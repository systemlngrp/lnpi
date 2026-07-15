param(
  [string]$ProjectRoot = "D:\lnpi",
  [string]$BackupDir = "D:\lnpi\backups",
  [int]$RetentionDays = 30,
  [string]$MySqlDumpPath = ""
)

$ErrorActionPreference = "Stop"

function Write-BackupLog {
  param([string]$Message, [string]$Level = "INFO")

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$timestamp] [$Level] $Message"
  Add-Content -LiteralPath $script:LogFile -Value $line
  Write-Host $line
}

function Read-DotEnv {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Environment file not found: $Path"
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $equalsIndex = $line.IndexOf("=")
    if ($equalsIndex -lt 1) {
      return
    }

    $key = $line.Substring(0, $equalsIndex).Trim()
    $value = $line.Substring($equalsIndex + 1).Trim()
    $value = $value -replace '^["'']|["'']$', ""
    $values[$key] = $value
  }

  return $values
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

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$script:LogFile = Join-Path $BackupDir "backup.log"

try {
  $envPath = Join-Path $ProjectRoot ".env"
  $envValues = Read-DotEnv -Path $envPath

  $dbHost = $envValues["DB_HOST"]
  $dbUser = $envValues["DB_USER"]
  $dbPassword = $envValues["DB_PASSWORD"]
  $dbName = $envValues["DB_NAME"]
  $dbPort = $envValues["DB_PORT"]
  if (-not $dbPort) {
    $dbPort = "3306"
  }

  $missing = @()
  if (-not $dbHost) { $missing += "DB_HOST" }
  if (-not $dbUser) { $missing += "DB_USER" }
  if (-not $dbName) { $missing += "DB_NAME" }
  if ($missing.Count -gt 0) {
    throw "Missing required .env values: $($missing -join ', ')"
  }

  $mysqldump = Resolve-MySqlDump -ExplicitPath $MySqlDumpPath
  $safeDbName = $dbName -replace '[\\/:*?"<>|]', "_"
  $stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
  $backupFile = Join-Path $BackupDir "$safeDbName`_$stamp.sql"

  Write-BackupLog "Starting backup for database '$dbName' from '${dbHost}:${dbPort}'."

  $env:MYSQL_PWD = $dbPassword
  $args = @(
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

  & $mysqldump @args
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

  $cutoff = (Get-Date).AddDays(-1 * $RetentionDays)
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
  Write-BackupLog $_.Exception.Message "ERROR"
  exit 1
}
