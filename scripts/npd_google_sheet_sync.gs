const NPD_SYNC_CONFIG = {
  apiUrl: 'https://darkred-lobster-409686.hostingersite.com/api/npd-sync',
  rateApiUrl: 'https://darkred-lobster-409686.hostingersite.com/api/npd-sync/rates',
  secret: 'REPLACE_WITH_NPD_SYNC_SECRET',
  tabName: 'NPD',
  spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
  npdIdHeader: 'NPD ID',
  rateHeader: 'Last Approved Order rate',
  lastOrderRateHeader: 'Last Order rate',
  legacyRateHeader: 'Rate',
  hostingerSyncHeader: 'HOSTINGER SYNC',
  flushDelayMs: 15000,
  pendingRowsPropertyKey: 'NPD_PENDING_ROWS',
  pendingFullSyncPropertyKey: 'NPD_PENDING_FULL_SYNC',
  flushTriggerHandler: 'flushQueuedNpdSync',
};

const COMPANY_SYNC_CONFIG = {
  apiUrl: 'https://darkred-lobster-409686.hostingersite.com/api/npd-sync',
  secret: 'REPLACE_WITH_NPD_SYNC_SECRET',
  tabName: 'Companies',
  spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
  idHeader: 'Id',
  hostingerSyncHeader: 'NPD Hostinger Sync',
  flushDelayMs: 15000,
  pendingRowsPropertyKey: 'COMPANY_PENDING_ROWS',
  pendingFullSyncPropertyKey: 'COMPANY_PENDING_FULL_SYNC',
  flushTriggerHandler: 'flushQueuedCompanySync',
};

function syncNpdSheetToHostinger() {
  const result = forceFullNpdSync();
  syncNpdRatesFromHostinger();
  return result;
}

function syncCompaniesSheetToHostinger() {
  return forceFullCompanySync();
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
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
  const idIndex = headers.indexOf(NPD_SYNC_CONFIG.npdIdHeader.toLowerCase());
  const approvedRateIndex = headers.indexOf(NPD_SYNC_CONFIG.rateHeader.toLowerCase());
  const orderRateIndex = headers.indexOf(NPD_SYNC_CONFIG.lastOrderRateHeader.toLowerCase());
  const legacyRateIndex = headers.indexOf(NPD_SYNC_CONFIG.legacyRateHeader.toLowerCase());

  if (idIndex === -1) {
    throw new Error(`Column "${NPD_SYNC_CONFIG.npdIdHeader}" not found in sheet.`);
  }

  const response = UrlFetchApp.fetch(NPD_SYNC_CONFIG.rateApiUrl, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'x-npd-sync-secret': NPD_SYNC_CONFIG.secret,
    },
  });

  if (response.getResponseCode() >= 400) {
    throw new Error(`Rate sync failed: ${response.getContentText()}`);
  }

  const result = JSON.parse(response.getContentText() || '{}');
  const rows = Array.isArray(result.rows) ? result.rows : [];
  
  const rateMap = new Map();
  rows.forEach((row) => {
    const npdId = String(row.npdId || '').trim();
    if (npdId) {
      rateMap.set(npdId, {
        rate: row.rate,
        orderRate: row.orderRate
      });
    }
  });

  if (values.length <= 1) {
    return { ok: true, updatedRows: 0, fetchedRates: rateMap.size };
  }

  // Helper to update a column if it exists
  const updateColumn = (index, fieldName) => {
    if (index === -1) return;
    
    const nextValues = values.slice(1).map((row) => {
      const npdId = String(row[idIndex] || '').trim();
      if (!npdId || !rateMap.has(npdId)) {
        return [row[index] ?? ''];
      }
      const data = rateMap.get(npdId);
      const val = data[fieldName];
      return [val == null || val === '' ? '' : val];
    });

    sheet.getRange(2, index + 1, nextValues.length, 1).setValues(nextValues);
  };

  updateColumn(approvedRateIndex, 'rate');
  updateColumn(legacyRateIndex, 'rate');
  updateColumn(orderRateIndex, 'orderRate');

  SpreadsheetApp.flush();

  return { ok: true, updatedRows: values.length - 1, fetchedRates: rateMap.size };
}

function forceFullCompanySync() {
  return performFullSync_(COMPANY_SYNC_CONFIG, false);
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
      mapped[idHeader] || mapped["Id"] || mapped["Company"] || mapped["Company Name"] || mapped["name"] || ''
    ).trim();
    if (!rowKey) continue;

    if (nameMap.has(rowKey)) {
      duplicateRowIndices.push(i + 1); // sheet row index (1-based)
      continue;
    }
    nameMap.set(rowKey, i + 1);
    allRowsToSync.push(mapped);
    allRowIndicesToUpdate.push(i + 1);
  }

  // Delete duplicate rows from bottom to top to avoid shifting indices
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
    handleSheetEdit_(e, NPD_SYNC_CONFIG, true);
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

function flushQueuedNpdSync() {
  return performFlush_(NPD_SYNC_CONFIG, NPD_SYNC_CONFIG.npdIdHeader);
}

function flushQueuedCompanySync() {
  return performFlush_(COMPANY_SYNC_CONFIG, COMPANY_SYNC_CONFIG.idHeader);
}

function performFlush_(config, idHeader) {
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(config.tabName);
  if (!sheet) return;

  const properties = PropertiesService.getScriptProperties();
  const runFullSync = properties.getProperty(config.pendingFullSyncPropertyKey) === 'true';
  const pendingRows = getPendingRows_(config);

  if (runFullSync) {
    const result = (config.tabName === 'NPD') ? forceFullNpdSync() : forceFullCompanySync();
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

  if (config.tabName === 'NPD') {
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

  headerRow.forEach(function(header, index) {
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
}
