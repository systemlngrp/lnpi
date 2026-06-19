const NPD_SYNC_CONFIG = {
  apiUrl: 'https://darkred-lobster-409686.hostingersite.com/api/npd-sync',
  rateApiUrl: 'https://darkred-lobster-409686.hostingersite.com/api/npd-sync/rates',
  secret: 'REPLACE_WITH_NPD_SYNC_SECRET',
  tabName: 'NPD',
  spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
  npdIdHeader: 'NPD ID',
  erpHeader: 'ERP',
  rateHeaders: ['Rate', 'Last Approved Order Rate', 'Last Approved Order rate'],
  itemHeaders: ['9001', '9002', '9003', '9004'],
  npdUpdateTimestampHeader: 'NPD Update Timestamp',
  historyTabName: 'NPD_RATE_SYNC_HISTORY',
  hostingerSyncHeader: 'HOSTINGER SYNC',
  flushDelayMs: 15000,
  pendingRowsPropertyKey: 'NPD_PENDING_ROWS',
  pendingFullSyncPropertyKey: 'NPD_PENDING_FULL_SYNC',
  flushTriggerHandler: 'flushQueuedNpdSync',
  rateSyncTriggerHandler: 'syncNpdRatesFromHostinger',
  rateSyncIntervalMinutes: 30,
};

function syncNpdSheetToHostinger() {
  const result = forceFullNpdSync();
  syncNpdRatesFromHostinger();
  return result;
}

function forceFullNpdSync() {
  return performFullSync_(NPD_SYNC_CONFIG, true);
}

function syncNpdRatesFromHostinger() {
  const spreadsheet = SpreadsheetApp.openById(NPD_SYNC_CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(NPD_SYNC_CONFIG.tabName);
  if (!sheet) {
    throw new Error(`Sheet tab not found: ${NPD_SYNC_CONFIG.tabName}`);
  }

  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) {
    throw new Error('Sheet is empty.');
  }

  const headers = values[0].map((header) => String(header || '').trim().toLowerCase());
  const erpIndex = headers.indexOf(NPD_SYNC_CONFIG.erpHeader.toLowerCase());
  const rateIndex = findHeaderIndex_(headers, NPD_SYNC_CONFIG.rateHeaders);

  if (erpIndex === -1) {
    throw new Error(`Column "${NPD_SYNC_CONFIG.erpHeader}" not found in sheet.`);
  }

  if (rateIndex === -1) {
    throw new Error(`Rate column not found in sheet. Checked: ${NPD_SYNC_CONFIG.rateHeaders.join(', ')}`);
  }

  const response = UrlFetchApp.fetch(NPD_SYNC_CONFIG.rateApiUrl, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'x-npd-sync-secret': NPD_SYNC_CONFIG.secret,
    },
  });

  if (response.getResponseCode() >= 400) {
    const errorMessage = `Rate sync failed: ${response.getContentText()}`;
    writeRateSyncHistory_([], [
      buildHistoryRow_('', '', '', '', 'error', errorMessage)
    ]);
    throw new Error(errorMessage);
  }

  const result = JSON.parse(response.getContentText() || '{}');
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const rateMap = new Map();
  rows.forEach((row) => {
    const erp = String(row.erp || '').trim();
    const rate = normalizeSheetNumber_(row.rate);
    if (erp && rate !== '') {
      rateMap.set(erp, {
        erp: erp,
        rate: rate,
        orderNo: String(row.orderNo || row.order_no || '').trim(),
        orderDate: String(row.orderDate || row.order_date || '').trim(),
        approvedAt: String(row.approvedAt || row.approved_at || '').trim(),
        status: String(row.status || 'approved').trim() || 'approved'
      });
    }
  });

  if (values.length <= 1) {
    writeRateSyncHistory_([], []);
    return { ok: true, updatedRows: 0, fetchedRates: rateMap.size };
  }

  const currentRates = values.slice(1).map((row) => [row[rateIndex] ?? '']);
  const nextRates = [];
  const historyRows = [];
  let changedRows = 0;
  const processedErps = new Set();

  values.slice(1).forEach((row) => {
    const erp = String(row[erpIndex] || '').trim();
    const currentValue = row[rateIndex] ?? '';

    if (!erp) {
      nextRates.push([currentValue]);
      return;
    }

    const latest = rateMap.get(erp);
    if (!latest) {
      nextRates.push([currentValue]);
      if (!processedErps.has(erp)) {
        processedErps.add(erp);
        historyRows.push(buildHistoryRow_(erp, '', '', currentValue, 'no approved order found', ''));
      }
      return;
    }

    const nextValue = latest.rate;
    nextRates.push([nextValue]);
    if (String(currentValue) !== String(nextValue)) {
      changedRows += 1;
    }

    if (!processedErps.has(erp)) {
      processedErps.add(erp);
      const syncStatus = String(currentValue) === String(nextValue) ? 'unchanged' : 'updated';
      historyRows.push(
        buildHistoryRow_(erp, latest.orderNo, latest.approvedAt || latest.orderDate, nextValue, syncStatus, '')
      );
    }
  });

  if (changedRows > 0) {
    sheet.getRange(2, rateIndex + 1, nextRates.length, 1).setValues(nextRates);
  }

  writeRateSyncHistory_(Array.from(processedErps), historyRows);

  SpreadsheetApp.flush();

  return { ok: true, updatedRows: changedRows, fetchedRates: rateMap.size };
}

function flushQueuedNpdSync() {
  return performFlush_(NPD_SYNC_CONFIG, NPD_SYNC_CONFIG.npdIdHeader);
}
