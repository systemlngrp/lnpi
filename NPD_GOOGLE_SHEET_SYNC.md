# NPD Google Sheet Sync

## Server setup

Add these values to your server `.env`:

```env
NPD_SYNC_SECRET=replace-with-a-long-random-secret
NPD_SYNC_ALLOWED_TAB=NPD
```

The app now exposes:

- `POST /api/npd-sync`
- `GET /api/npd-sync/rates`

Authentication for both endpoints uses the `x-npd-sync-secret` header.

## Payload shape

```json
{
  "spreadsheetId": "optional",
  "spreadsheetName": "optional",
  "tabName": "NPD",
  "syncTimestamp": "2026-06-05T13:30:00.000Z",
  "rows": [
    {
      "NPD ID": "ab3aab95",
      "Item Name": "Dummy 1",
      "ERP": "1"
    }
  ]
}
```

## Behavior

- Upserts `npd` rows by `npd.npdId`
- Skips rows with blank `NPD ID`
- Marks missing previously synced Google Sheet rows as `syncStatus = removed`
- Keeps removed rows in MySQL for history
- Filters removed rows out of active `npd` reads
- Supports reverse sync of `Rate` only from Hostinger app to Google Sheet by matching `NPD ID`

## Apps Script setup

Use `D:\lnpi\scripts\npd_google_sheet_sync.gs`.

1. Open the Google Sheet.
2. Go to `Extensions` -> `Apps Script`.
3. Paste the script contents.
4. Set `apiUrl`, `rateApiUrl`, `secret`, and `tabName`.
5. Run `installSyncTriggers()` once to create the installable triggers.
6. Run `syncNpdSheetToHostinger()` once for the initial push sync.
7. Run `syncNpdRatesFromHostinger()` any time you want to pull latest app `Rate` values into the sheet.

## Notes

- Row sync is Google Sheets -> Hostinger app -> MySQL.
- Reverse sync is rate-only: Hostinger app -> Google Sheet `Rate` column.
- The server uses `syncSource = google_sheets` internally so soft-removals only affect sheet-owned NPD rows.
