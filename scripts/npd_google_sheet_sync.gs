function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
}

function performFullSync_(config, skipAlreadySynced) {
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(config.tabName);
  if (!sheet) {
    throw new Error(`Sheet tab not found: ${config.tabName}`);
  }

  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) {
    throw new Error('Sheet is empty.');
  }

  const headers = values[0].map((header) => String(header || '').trim());
  const hostingerSyncIndex = headers.indexOf(config.hostingerSyncHeader);

  if (hostingerSyncIndex === -1) {
    throw new Error(`Column "${config.hostingerSyncHeader}" not found in sheet.`);
  }

  const allRowsToSync = [];
  const allRowIndicesToUpdate = [];
  const idHeader = getSyncIdHeader_(config);
  const nameMap = new Map();
  const duplicateRowIndices = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const isBlankRow = row.every((cell) => String(cell || '').trim() === '');
    if (isBlankRow) continue;

    const hostingerSyncValue = String(row[hostingerSyncIndex] || '').trim();
    if (skipAlreadySynced && hostingerSyncValue !== '') {
      continue;
    }

    const mapped = {};
    headers.forEach((header, index) => {
      mapped[header] = row[index] ?? '';
    });

    const rowKey = String(
      mapped[idHeader] || mapped['Id'] || mapped['Company'] || mapped['Company Name'] || mapped['name'] || ''
    ).trim();
    if (!rowKey) continue;

    if (nameMap.has(rowKey)) {
      duplicateRowIndices.push(i + 1);
      continue;
    }

    nameMap.set(rowKey, i + 1);
    allRowsToSync.push(mapped);
    allRowIndicesToUpdate.push(i + 1);
  }

  if (duplicateRowIndices.length > 0) {
    duplicateRowIndices.sort((a, b) => b - a);
    duplicateRowIndices.forEach((rowIdx) => {
      try {
        sheet.deleteRow(rowIdx);
      } catch (e) {
        Logger.log('Failed to delete duplicate row %s: %s', rowIdx, e);
      }
    });
  }

  if (allRowsToSync.length === 0) {
    Logger.log('No rows pending sync for %s.', config.tabName);
    return { ok: true, message: 'No rows pending sync.', processedRows: 0 };
  }

  return processBatchSync_(config, spreadsheet, sheet, allRowsToSync, allRowIndicesToUpdate, hostingerSyncIndex);
}

function processBatchSync_(config, spreadsheet, sheet, allRowsToSync, allRowIndicesToUpdate, hostingerSyncIndex) {
  const batchSize = 100;
  let totalProcessed = 0;
  let lastResult = null;

  for (let i = 0; i < allRowsToSync.length; i += batchSize) {
    const rowsToSync = allRowsToSync.slice(i, i + batchSize);
    const rowIndicesToUpdate = allRowIndicesToUpdate.slice(i, i + batchSize);
    const syncTimestamp = formatDate_(new Date());

    const response = UrlFetchApp.fetch(config.apiUrl, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: {
        'x-npd-sync-secret': config.secret,
      },
      payload: JSON.stringify({
        spreadsheetId: config.spreadsheetId,
        spreadsheetName: spreadsheet.getName(),
        tabName: sheet.getName(),
        syncMode: 'full_batch_chunk',
        syncTimestamp: syncTimestamp,
        rows: rowsToSync,
      }),
    });

    const responseText = response.getContentText();
    const responseCode = response.getResponseCode();

    if (responseCode >= 400) {
      Logger.log('Sync failed for %s: %s', config.tabName, responseText);
      throw new Error(`Sync failed for ${config.tabName} at row ${rowIndicesToUpdate[0]}: ${responseText}`);
    }

    rowIndicesToUpdate.forEach((rowIndex) => {
      try {
        sheet.getRange(rowIndex, hostingerSyncIndex + 1).setValue(syncTimestamp);
      } catch (err) {
        Logger.log('Failed to update timestamp for row %s: %s', rowIndex, err);
      }
    });

    SpreadsheetApp.flush();
    totalProcessed += rowsToSync.length;
    lastResult = JSON.parse(responseText);
  }

  return {
    ...lastResult,
    totalProcessed: totalProcessed,
    message: `Successfully synced ${totalProcessed} rows to ${config.tabName}.`
  };
}

function onNpdSheetEdit(e) {
  if (!e || !e.range) {
    return;
  }

  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();

  if (sheetName === NPD_SYNC_CONFIG.tabName) {
    handleSheetEdit_(e, NPD_SYNC_CONFIG, false);
  } else if (sheetName === COMPANY_SYNC_CONFIG.tabName) {
    handleSheetEdit_(e, COMPANY_SYNC_CONFIG, false);
  }
}

function handleSheetEdit_(e, config, skipIfSynced) {
  const sheet = e.range.getSheet();
  const rowIndex = e.range.getRow();

  if (rowIndex <= 1) {
    queueFullSync_(config);
    scheduleFlush_(config);
    return;
  }

  const rowPayload = buildRowPayload_(sheet, rowIndex, config, skipIfSynced);
  if (!rowPayload) {
    return;
  }

  queuePendingRow_(rowPayload, config);
  scheduleFlush_(config);
}

function onNpdSheetChange(e) {
  const changeType = e && e.changeType ? String(e.changeType) : 'UNKNOWN';
  if (changeType === 'EDIT') {
    return;
  }

  queueFullSync_(NPD_SYNC_CONFIG);
  scheduleFlush_(NPD_SYNC_CONFIG);

  queueFullSync_(COMPANY_SYNC_CONFIG);
  scheduleFlush_(COMPANY_SYNC_CONFIG);
}

function performFlush_(config, idHeader) {
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(config.tabName);
  if (!sheet) return;

  const properties = PropertiesService.getScriptProperties();
  const runFullSync = properties.getProperty(config.pendingFullSyncPropertyKey) === 'true';
  const pendingRows = getPendingRows_(config);

  if (runFullSync) {
    const result = config.tabName === NPD_SYNC_CONFIG.tabName ? forceFullNpdSync() : forceFullCompanySync();
    clearPendingQueue_(config);
    deleteFlushTriggers_(config);
    return result;
  }

  if (!pendingRows.length) {
    deleteFlushTriggers_(config);
    return { ok: true, processedRows: 0 };
  }

  const syncTimestamp = formatDate_(new Date());
  const response = UrlFetchApp.fetch(config.apiUrl, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-npd-sync-secret': config.secret,
    },
    payload: JSON.stringify({
      spreadsheetId: config.spreadsheetId,
      spreadsheetName: spreadsheet.getName(),
      tabName: sheet.getName(),
      syncMode: 'batch',
      syncTimestamp: syncTimestamp,
      rows: pendingRows,
    }),
  });

  if (response.getResponseCode() >= 400) {
    throw new Error(`Batch sync failed for ${config.tabName}: ${response.getContentText()}`);
  }

  updateTimestamps_(sheet, pendingRows, idHeader, config.hostingerSyncHeader, syncTimestamp);

  if (config.tabName === NPD_SYNC_CONFIG.tabName) {
    syncNpdRatesFromHostinger();
  }

  clearPendingQueue_(config);
  deleteFlushTriggers_(config);
  return JSON.parse(response.getContentText());
}

function getSyncIdHeader_(config) {
  return String(config.idHeader || config.npdIdHeader || '').trim();
}

function updateTimestamps_(sheet, pendingRows, idHeader, syncHeader, timestamp) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const idIndex = headers.indexOf(idHeader);
  const syncIndex = headers.indexOf(syncHeader);

  if (idIndex !== -1 && syncIndex !== -1) {
    const sheetData = sheet.getDataRange().getDisplayValues();
    pendingRows.forEach((row) => {
      const idValue = String(row[idHeader] || '').trim();
      if (!idValue) return;

      for (let i = 1; i < sheetData.length; i++) {
        if (String(sheetData[i][idIndex] || '').trim() === idValue) {
          try {
            sheet.getRange(i + 1, syncIndex + 1).setValue(timestamp);
          } catch (err) {
            Logger.log('Error setting timestamp for ID %s: %s', idValue, err);
          }
          break;
        }
      }
    });
    SpreadsheetApp.flush();
  }
}

function buildRowPayload_(sheet, rowIndex, config, skipIfSynced) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const dataRow = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const payload = {};

  headerRow.forEach((header, index) => {
    const normalizedHeader = String(header || '').trim();
    if (!normalizedHeader) return;
    payload[normalizedHeader] = dataRow[index] ?? '';
  });

  if (skipIfSynced) {
    const hostingerSyncValue = String(payload[config.hostingerSyncHeader] || '').trim();
    if (hostingerSyncValue !== '') return null;
  }

  const idValue = String(payload[config.idHeader || config.npdIdHeader] || '').trim();
  if (!idValue) return null;

  return payload;
}

function queuePendingRow_(rowPayload, config) {
  const idValue = String(rowPayload[config.idHeader || config.npdIdHeader] || '').trim();
  if (!idValue) return;

  const properties = PropertiesService.getScriptProperties();
  const current = getPendingRowMap_(config);
  current[idValue] = rowPayload;
  properties.setProperty(config.pendingRowsPropertyKey, JSON.stringify(current));
}

function getPendingRows_(config) {
  return Object.values(getPendingRowMap_(config));
}

function getPendingRowMap_(config) {
  const raw = PropertiesService.getScriptProperties().getProperty(config.pendingRowsPropertyKey);
  if (!raw) return {};
  try {
    return JSON.parse(raw) || {};
  } catch (error) {
    return {};
  }
}

function queueFullSync_(config) {
  PropertiesService.getScriptProperties().setProperty(config.pendingFullSyncPropertyKey, 'true');
}

function clearPendingQueue_(config) {
  const properties = PropertiesService.getScriptProperties();
  properties.deleteProperty(config.pendingRowsPropertyKey);
  properties.deleteProperty(config.pendingFullSyncPropertyKey);
}

function scheduleFlush_(config) {
  deleteFlushTriggers_(config);
  ScriptApp.newTrigger(config.flushTriggerHandler)
    .timeBased()
    .after(config.flushDelayMs)
    .create();
}

function deleteFlushTriggers_(config) {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === config.flushTriggerHandler)
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
}

function installSyncTriggers() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('onNpdSheetChange')
    .forSpreadsheet(spreadsheet)
    .onChange()
    .create();

  ScriptApp.newTrigger('onNpdSheetEdit')
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();

  installRateSyncTrigger();
}

function installRateSyncTrigger() {
  deleteRateSyncTriggers_();
  ScriptApp.newTrigger(NPD_SYNC_CONFIG.rateSyncTriggerHandler)
    .timeBased()
    .everyMinutes(NPD_SYNC_CONFIG.rateSyncIntervalMinutes)
    .create();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LNPI Sync')
    .addItem('Sync NPD to LNPI', 'syncNpdSheetToHostinger')
    .addItem('Sync Companies to LNPI', 'syncCompaniesSheetToHostinger')
    .addItem('Sync Latest Rates', 'syncNpdRatesFromHostinger')
    .addItem('Install Rate Trigger', 'installRateSyncTrigger')
    .addToUi();
}

function deleteRateSyncTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === NPD_SYNC_CONFIG.rateSyncTriggerHandler)
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
}

function findHeaderIndex_(headers, candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    const normalized = String(candidates[i] || '').trim().toLowerCase();
    const index = headers.indexOf(normalized);
    if (index !== -1) return index;
  }
  return -1;
}

function normalizeSheetNumber_(value) {
  if (value == null || value === '') return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : '';
}

function getRateHistorySheet_() {
  const spreadsheet = SpreadsheetApp.openById(NPD_SYNC_CONFIG.spreadsheetId);
  let sheet = spreadsheet.getSheetByName(NPD_SYNC_CONFIG.historyTabName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(NPD_SYNC_CONFIG.historyTabName);
    sheet.hideSheet();
  }

  const headers = ['ERP', 'Last Approved Order No', 'Last Approved Order Date', 'Last Synced Rate', 'Last Sync Time', 'Sync Status', 'Message'];
  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const needsHeaderWrite = headers.some((header, index) => String(currentHeaders[index] || '').trim() !== header);
  if (needsHeaderWrite) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function buildHistoryRow_(erp, orderNo, orderDate, rate, status, message) {
  return {
    erp: String(erp || '').trim(),
    orderNo: String(orderNo || '').trim(),
    orderDate: String(orderDate || '').trim(),
    rate: rate == null ? '' : rate,
    syncTime: formatDate_(new Date()),
    status: String(status || '').trim(),
    message: String(message || '').trim(),
  };
}

function writeRateSyncHistory_(erpKeys, historyRows) {
  const sheet = getRateHistorySheet_();
  const existingValues = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues()
    : [];
  const rowIndexByErp = new Map();

  existingValues.forEach((row, index) => {
    const erp = String(row[0] || '').trim();
    if (erp && !rowIndexByErp.has(erp)) {
      rowIndexByErp.set(erp, index + 2);
    }
  });

  historyRows.forEach((entry) => {
    const rowValues = [[
      entry.erp,
      entry.orderNo,
      entry.orderDate,
      entry.rate,
      entry.syncTime,
      entry.status,
      entry.message,
    ]];

    if (entry.erp && rowIndexByErp.has(entry.erp)) {
      sheet.getRange(rowIndexByErp.get(entry.erp), 1, 1, 7).setValues(rowValues);
      return;
    }

    sheet.appendRow(rowValues[0]);
    if (entry.erp) {
      rowIndexByErp.set(entry.erp, sheet.getLastRow());
    }
  });
}
