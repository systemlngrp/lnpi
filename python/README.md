# Tally MRR Posting

This folder contains a Python script that reads LNPI `material_in` rows with:

- `status = 'Pending Tally'`
- empty `tallyTimestamp`

and posts them into the **currently open Tally company** on `http://localhost:9004`.

## Files

- `D:\lnpi\python\tally_mrr_posting.py`
- `D:\lnpi\python\requirements.txt`

## What the script does

1. Connects to your LNPI MySQL database
2. Reads pending MRR entries from `material_in`
3. Detects the current open Tally company
4. Posts each MRR as:
   - `Purchase` voucher for `Reel`, `Others`, `FG Purchase`, `Rejection In`
   - `Journal` voucher for `Service Return`
5. Marks the MRR as `Completed` and fills `tallyTimestamp`

## MRR types from your system

- `Reel`
- `Others`
- `Rejection In`
- `FG Purchase`
- `Service Return`

## Environment variables

Set these before running if your DB values differ:

- `LNPI_DB_HOST`
- `LNPI_DB_USER`
- `LNPI_DB_PASSWORD`
- `LNPI_DB_NAME`
- `TALLY_URL` (default is `http://localhost:9004`)
- `SUPPLIER_FALLBACK_LEDGER`

## Install

```powershell
cd D:\lnpi\python
pip install -r requirements.txt
```

## Run

```powershell
cd D:\lnpi\python
python tally_mrr_posting.py
```

## Important assumptions

- Tally is running on port `9004`
- The correct company is already open in Tally
- Supplier names in LNPI match ledger names in Tally
- Item names in LNPI match stock item names in Tally
- These ledgers exist in Tally:
  - `Purchase - Reel`
  - `Purchase - Others`
  - `Purchase - FG`
  - `Purchase - Rejection In`
  - `Input CGST`
  - `Input SGST`
  - `Input IGST`
  - `Insurance`
  - `Other Charges`
  - `Round Off`
  - `Service Return Adjustment`

## Recommended next improvements

- Add a DB log table for Tally posting responses
- Create a separate voucher strategy for `Rejection In` if needed
- Validate missing supplier and stock item names before posting
- Move DB config into a `.env` loader if you prefer
