<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# LNPI Ops Portal

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Start the app: `npm run dev`

## Automatic NPD Sheet Sync

The `NPD Items` screen reads only from the app database. To keep it fast, Google Sheet updates should be pushed into the database in the background instead of syncing when the UI opens.

### Required server configuration

- Set `NPD_SYNC_SECRET` on the app server.
- Optionally set `NPD_SYNC_ALLOWED_TAB` if the Sheet tab name should be restricted. Default: `NPD`.
- Restart the server after config changes.

### Google Apps Script setup

The repo includes the Sheet-side automation script at `scripts/npd_google_sheet_sync.gs`.

1. Open the target Google Sheet.
2. Open `Extensions` -> `Apps Script`.
3. Paste or sync the contents of `scripts/npd_google_sheet_sync.gs`.
4. Update:
   - `apiUrl`
   - `secret`
   - `tabName`
5. Run `installNpdSyncTrigger()` once to create the installable triggers.
6. Approve the requested Apps Script permissions.
7. Use `Sync Latest Rates` or the installed 30-minute trigger to refresh the `Rate` column from the latest approved LNPI order by ERP.

### Trigger behavior

- `onNpdSheetEdit(e)` queues changed NPD rows and sends them in a short delayed batch.
- `onNpdSheetChange(e)` queues a full sync when structural sheet changes happen, such as row insert/delete or bulk changes.
- `syncNpdRatesFromHostinger()` updates the sheet `Rate` column from the newest approved LNPI order for the same `ERP`.
- `flushQueuedNpdSync()` sends queued row batches to `/api/npd-sync`.
- `forceFullNpdSync()` sends the whole tab as a recovery sync.

### Recovery / manual re-sync

- Run `forceFullNpdSync()` from Apps Script if the database and Sheet ever drift apart.
- Run `installNpdSyncTrigger()` again if triggers are deleted or the Google account authorization changes.

### Expected sync modes

- `batch`: upsert only the changed rows. Missing DB rows are not removed.
- `full`: send the full Sheet snapshot. Rows missing from the Sheet are marked as removed in the database.
