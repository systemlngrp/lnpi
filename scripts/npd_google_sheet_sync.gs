const NPD_SYNC_CONFIG = {
  apiUrl: 'https://darkred-lobster-409686.hostingersite.com/api/npd-sync',
  secret: 'REPLACE_WITH_NPD_SYNC_SECRET',
  tabName: 'NPD',
  spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
  npdIdHeader: 'NPD ID',
  hostingerSyncHeader: 'HOSTINGER SYNC',
  flushDelayMs: 15000,
  pendingRowsPropertyKey: 'NPD_PENDING_ROWS',
  pendingFullSyncPropertyKey: 'NPD_PENDING_FULL_SYNC',
  flushTriggerHandler: 'flushQueuedNpdSync',
};

function syncNpdSheetToHostinger() {
  return forceFullNpdSync();
}

function forceFullNpdSync() {
  const spreadsheet = SpreadsheetApp.openById(NPD_SYNC_CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(NPD_SYNC_CONFIG.tabName);
  if (!sheet) {
    throw new Error(`Sheet tab not found: ${NPD_SYNC_CONFIG.tabName}`);
  }

  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) {
    throw new Error('Sheet is empty.');
  }

  const headers = values[0].map((header) => String(header || '').trim());
  const hostingerSyncIndex = headers.indexOf(NPD_SYNC_CONFIG.hostingerSyncHeader);

  if (hostingerSyncIndex === -1) {
    throw new Error(`Column "${NPD_SYNC_CONFIG.hostingerSyncHeader}" not found in sheet.`);
  }

  const syncTimestamp = new Date().toISOString();
  const rowsToSync = [];
  const rowIndicesToUpdate = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const isBlankRow = row.every((cell) => String(cell || '').trim() === '');
    if (isBlankRow) continue;

    const hostingerSyncValue = String(row[hostingerSyncIndex] || '').trim();
    if (hostingerSyncValue === '') {
      const mapped = {};
      headers.forEach((header, index) => {
        mapped[header] = row[index] ?? '';
      });
      rowsToSync.push(mapped);
      rowIndicesToUpdate.push(i + 1); // 1-based index
    }
  }

  if (rowsToSync.length === 0) {
    Logger.log('No rows pending sync (all have timestamps or are empty).');
    return { ok: true, message: 'No rows pending sync.', processedRows: 0 };
  }

  const response = UrlFetchApp.fetch(NPD_SYNC_CONFIG.apiUrl, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-npd-sync-secret': NPD_SYNC_CONFIG.secret,
    },
    payload: JSON.stringify({
      spreadsheetId: NPD_SYNC_CONFIG.spreadsheetId,
      spreadsheetName: spreadsheet.getName(),
      tabName: sheet.getName(),
      syncMode: 'full',
      syncTimestamp: syncTimestamp,
      rows: rowsToSync,
    }),
  });

  const responseText = response.getContentText();
  Logger.log('NPD sync response code: %s', response.getResponseCode());
  Logger.log('NPD sync response body: %s', responseText);

  if (response.getResponseCode() >= 400) {
    throw new Error(`NPD sync failed: ${responseText}`);
  }

  // Update timestamps in the sheet
  rowIndicesToUpdate.forEach((rowIndex) => {
    sheet.getRange(rowIndex, hostingerSyncIndex + 1).setValue(syncTimestamp);
  });

  return JSON.parse(responseText);
}

function onNpdSheetEdit(e) {
  if (!e || !e.range) {
    scheduleNpdFlush_();
    return;
  }

  const sheet = e.range.getSheet();
  if (!sheet || sheet.getName() !== NPD_SYNC_CONFIG.tabName) {
    return;
  }

  const rowIndex = e.range.getRow();
  if (rowIndex <= 1) {
    queueFullNpdSync_();
    scheduleNpdFlush_();
    return;
  }

  const rowPayload = buildSheetRowPayload_(sheet, rowIndex);
  if (!rowPayload) {
    return;
  }

  queuePendingNpdRow_(rowPayload);
  scheduleNpdFlush_();
}

function onNpdSheetChange(e) {
  const spreadsheet = SpreadsheetApp.openById(NPD_SYNC_CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(NPD_SYNC_CONFIG.tabName);
  if (!sheet) {
    return;
  }

  const changeType = e && e.changeType ? String(e.changeType) : 'UNKNOWN';
  if (changeType === 'EDIT') {
    return;
  }

  queueFullNpdSync_();
  scheduleNpdFlush_();
}

function installNpdSyncTrigger() {
  const spreadsheet = SpreadsheetApp.openById(NPD_SYNC_CONFIG.spreadsheetId);
  ScriptApp.getProjectTriggers()
    .filter((trigger) => ['onNpdSheetChange', 'onNpdSheetEdit', NPD_SYNC_CONFIG.flushTriggerHandler].includes(trigger.getHandlerFunction()))
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('onNpdSheetChange')
    .forSpreadsheet(spreadsheet)
    .onChange()
    .create();

  ScriptApp.newTrigger('onNpdSheetEdit')
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();
}

function flushQueuedNpdSync() {
  const spreadsheet = SpreadsheetApp.openById(NPD_SYNC_CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(NPD_SYNC_CONFIG.tabName);
  if (!sheet) {
    throw new Error(`Sheet tab not found: ${NPD_SYNC_CONFIG.tabName}`);
  }

  const properties = PropertiesService.getScriptProperties();
  const runFullSync = properties.getProperty(NPD_SYNC_CONFIG.pendingFullSyncPropertyKey) === 'true';
  const pendingRows = getPendingNpdRows_();

  if (runFullSync) {
    const result = forceFullNpdSync();
    clearPendingNpdQueue_();
    deleteFlushTriggers_();
    return result;
  }

  if (!pendingRows.length) {
    deleteFlushTriggers_();
    return { ok: true, syncMode: 'batch', processedRows: 0, message: 'No pending NPD rows.' };
  }

  const syncTimestamp = new Date().toISOString();
  const response = UrlFetchApp.fetch(NPD_SYNC_CONFIG.apiUrl, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-npd-sync-secret': NPD_SYNC_CONFIG.secret,
    },
    payload: JSON.stringify({
      spreadsheetId: NPD_SYNC_CONFIG.spreadsheetId,
      spreadsheetName: spreadsheet.getName(),
      tabName: sheet.getName(),
      syncMode: 'batch',
      syncTimestamp: syncTimestamp,
      rows: pendingRows,
    }),
  });

  const responseText = response.getContentText();
  Logger.log('NPD batch sync response code: %s', response.getResponseCode());
  Logger.log('NPD batch sync response body: %s', responseText);

  if (response.getResponseCode() >= 400) {
    throw new Error(`NPD batch sync failed: ${responseText}`);
  }

  // Update timestamps for successfully synced batch rows
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const npdIdIndex = headers.indexOf(NPD_SYNC_CONFIG.npdIdHeader);
  const hostingerSyncIndex = headers.indexOf(NPD_SYNC_CONFIG.hostingerSyncHeader);

  if (npdIdIndex !== -1 && hostingerSyncIndex !== -1) {
    const sheetData = sheet.getDataRange().getDisplayValues();
    pendingRows.forEach((row) => {
      const npdId = String(row[NPD_SYNC_CONFIG.npdIdHeader] || '').trim();
      if (!npdId) return;

      for (let i = 1; i < sheetData.length; i++) {
        if (String(sheetData[i][npdIdIndex] || '').trim() === npdId) {
          sheet.getRange(i + 1, hostingerSyncIndex + 1).setValue(syncTimestamp);
          break;
        }
      }
    });
  }

  clearPendingNpdQueue_();
  deleteFlushTriggers_();
  return JSON.parse(responseText);
}

function buildSheetRowPayload_(sheet, rowIndex) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const dataRow = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const payload = {};

  headerRow.forEach(function(header, index) {
    const normalizedHeader = String(header || '').trim();
    if (!normalizedHeader) return;
    payload[normalizedHeader] = dataRow[index] ?? '';
  });

  // Only sync if Hostinger Sync is blank
  const hostingerSyncValue = String(payload[NPD_SYNC_CONFIG.hostingerSyncHeader] || '').trim();
  if (hostingerSyncValue !== '') {
    Logger.log('Skipping row %s because it is already synced (HOSTINGER SYNC is not blank).', rowIndex);
    return null;
  }

  const npdId = String(payload[NPD_SYNC_CONFIG.npdIdHeader] || '').trim();
  if (!npdId) {
    Logger.log('Skipping row %s because %s is blank.', rowIndex, NPD_SYNC_CONFIG.npdIdHeader);
    return null;
  }

  return payload;
}

function queuePendingNpdRow_(rowPayload) {
  const npdId = String(rowPayload[NPD_SYNC_CONFIG.npdIdHeader] || '').trim();
  if (!npdId) return;

  const properties = PropertiesService.getScriptProperties();
  const current = getPendingNpdRowMap_();
  current[npdId] = rowPayload;
  properties.setProperty(NPD_SYNC_CONFIG.pendingRowsPropertyKey, JSON.stringify(current));
}

function getPendingNpdRows_() {
  return Object.values(getPendingNpdRowMap_());
}

function getPendingNpdRowMap_() {
  const raw = PropertiesService.getScriptProperties().getProperty(NPD_SYNC_CONFIG.pendingRowsPropertyKey);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    Logger.log('Failed to parse pending NPD rows: %s', error);
    return {};
  }
}

function queueFullNpdSync_() {
  PropertiesService.getScriptProperties().setProperty(NPD_SYNC_CONFIG.pendingFullSyncPropertyKey, 'true');
}

function clearPendingNpdQueue_() {
  const properties = PropertiesService.getScriptProperties();
  properties.deleteProperty(NPD_SYNC_CONFIG.pendingRowsPropertyKey);
  properties.deleteProperty(NPD_SYNC_CONFIG.pendingFullSyncPropertyKey);
}

function scheduleNpdFlush_() {
  deleteFlushTriggers_();
  ScriptApp.newTrigger(NPD_SYNC_CONFIG.flushTriggerHandler)
    .timeBased()
    .after(NPD_SYNC_CONFIG.flushDelayMs)
    .create();
}

function deleteFlushTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === NPD_SYNC_CONFIG.flushTriggerHandler)
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
}
