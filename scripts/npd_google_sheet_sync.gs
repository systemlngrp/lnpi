const NPD_SYNC_CONFIG = {
  apiUrl: 'https://darkred-lobster-409686.hostingersite.com/api/npd-sync',
  secret: 'REPLACE_WITH_NPD_SYNC_SECRET',
  tabName: 'NPD',
  spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
  npdIdHeader: 'NPD ID',
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
  const rows = values.slice(1).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));
  const payloadRows = rows.map((row) => {
    const mapped = {};
    headers.forEach((header, index) => {
      mapped[header] = row[index] ?? '';
    });
    return mapped;
  });

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
      syncTimestamp: new Date().toISOString(),
      rows: payloadRows,
    }),
  });

  const responseText = response.getContentText();
  Logger.log('NPD sync response code: %s', response.getResponseCode());
  Logger.log('NPD sync response body: %s', responseText);

  if (response.getResponseCode() >= 400) {
    throw new Error(`NPD sync failed: ${responseText}`);
  }

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
      syncTimestamp: new Date().toISOString(),
      rows: pendingRows,
    }),
  });

  const responseText = response.getContentText();
  Logger.log('NPD batch sync response code: %s', response.getResponseCode());
  Logger.log('NPD batch sync response body: %s', responseText);

  if (response.getResponseCode() >= 400) {
    throw new Error(`NPD batch sync failed: ${responseText}`);
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
