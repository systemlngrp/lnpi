# Hostinger DB Hourly Backup

This project can back up the Hostinger MySQL database to local SQL files with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\lnpi\scripts\backup-hostinger-db.ps1
```

The script reads `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and optional `DB_PORT` from `D:\lnpi\.env`.

## Requirements

- Install MySQL Client tools so `mysqldump.exe` is available.
- If `mysqldump.exe` is not on PATH, pass the path explicitly:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\lnpi\scripts\backup-hostinger-db.ps1 -MySqlDumpPath "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe"
```

## Output

- Backup folder: `D:\lnpi\backups`
- File pattern: `DBNAME_yyyy-MM-dd_HH-mm-ss.sql`
- Log file: `D:\lnpi\backups\backup.log`
- Retention: `.sql` files older than 30 days are removed.

## Windows Task Scheduler

Create a task named `LNPI Hostinger DB Hourly Backup`.

- Trigger: daily, repeat every 1 hour indefinitely.
- Action program: `powershell.exe`
- Arguments:

```text
-NoProfile -ExecutionPolicy Bypass -File D:\lnpi\scripts\backup-hostinger-db.ps1
```

Use the Windows user that owns this project. For unattended operation, configure the task to run whether the user is logged in or not.

## Manual Test

Run the script once and confirm:

- A timestamped `.sql` file exists in `D:\lnpi\backups`.
- The file is not empty and contains SQL statements.
- `backup.log` has a success entry.
