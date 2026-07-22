# Portable Hostinger Backup

This folder contains a portable Windows backup setup for the Hostinger MySQL database.

## Files

- `hostinger-backup-portable.ps1` - runs `mysqldump` using embedded DB credentials.
- `hostinger-backup.config.psd1` - controls backup folder, retention days, and optional `mysqldump.exe` path.
- `install-hostinger-backup-task.ps1` - creates or updates the Windows Task Scheduler task.

Keep `hostinger-backup-portable.ps1` private because it contains the database password.

## Manual Run

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\lnpi\scripts\hostinger-backup-portable.ps1" -ConfigPath "D:\lnpi\scripts\hostinger-backup.config.psd1"
```

Override the saved folder when needed:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\lnpi\scripts\hostinger-backup-portable.ps1" -BackupDir "E:\HostingerBackups"
```

If `mysqldump.exe` is not on PATH:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\lnpi\scripts\hostinger-backup-portable.ps1" -MySqlDumpPath "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"
```

## Install Scheduled Task

Run PowerShell as Administrator, then:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\lnpi\scripts\install-hostinger-backup-task.ps1"
```

Default task name: `LNPI Hostinger DB Backup`.
Default schedule: every 60 minutes.

Customize schedule or paths:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\lnpi\scripts\install-hostinger-backup-task.ps1" -RepeatMinutes 30 -BackupDir "E:\HostingerBackups"
```

## Verify

- Confirm a timestamped `.sql` file appears in the configured backup folder.
- Confirm `backup.log` has a success entry.
- Confirm the log does not print the database password.