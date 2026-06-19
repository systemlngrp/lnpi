function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
}

function isItemMasterSyncDebug_(config) {
  return config && (config.tabName === 'PHP ITEM MASTER' || config.tabName === 'PLATE ITEM MASTER');
}

function logItemMasterSync_(config, message, details) {
  if (!isItemMasterSyncDebug_(config)) return;
  if (typeof details === 'undefined') {
    Logger.log('[%s] %s', config.tabName, message);
    return;
  }

  let serializedDetails = '';
  try {
    serializedDetails = JSON.stringify(details);
  } catch (error) {
    serializedDetails = String(details);
  }
  Logger.log('[%s] %s | %s', config.tabName, message, serializedDetails);
}

function logItemMasterSyncError_(config, message, error, details) {
  if (!isItemMasterSyncDebug_(config)) return;
  const payload = {
    ...(details || {}),
    errorMessage: error && error.message ? String(error.message) : String(error || ''),
    stack: error && error.stack ? String(error.stack) : '',
  };
  logItemMasterSync_(config, message, payload);
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
  const hostingerSyncIndex = getHeaderIndexByCandidates_(headers, getHeaderCandidates_(config.hostingerSyncHeader));

  if (hostingerSyncIndex === -1) {
    throw new Error(`Column "${config.hostingerSyncHeader}" not found in sheet.`);
  }

  const allRowsToSync = [];
  const allRowIndicesToUpdate = [];
  const idHeader = getSyncIdHeader_(config);
  const nameMap = new Map();
  const duplicateRowIndices = [];
  const skippedMissingSyncKeyRows = [];

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

    if (!hasMeaningfulSyncData_(mapped, config)) {
      continue;
    }

    const rowKey = resolveSyncRowKey_(mapped, config, idHeader);
    if (!rowKey) {
      const missingSummary = {
        rowIndex: i + 1,
        idHeader: idHeader,
        itemId: getSyncIdValue_(mapped, config),
        itemName: String(mapped['Item Name'] || '').trim(),
        company: String(mapped['Company'] || '').trim(),
      };
      skippedMissingSyncKeyRows.push(missingSummary);
      logItemMasterSync_(config, 'Skipping row during full sync because sync key is blank', missingSummary);
      continue;
    }

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
    if (skippedMissingSyncKeyRows.length > 0) {
      const previewRows = skippedMissingSyncKeyRows.slice(0, 5);
      const message = `No valid rows to sync for ${config.tabName}. Missing ${idHeader} in ${skippedMissingSyncKeyRows.length} row(s).`;
      logItemMasterSync_(config, 'Aborting full sync because all candidate rows are missing sync keys', {
        missingCount: skippedMissingSyncKeyRows.length,
        previewRows: previewRows,
      });
      throw new Error(message + ' Fill the Item Id column first.');
    }

    Logger.log('No rows pending sync for %s.', config.tabName);
    logItemMasterSync_(config, 'No rows pending sync', { skipAlreadySynced: skipAlreadySynced });
    return { ok: true, message: 'No rows pending sync.', processedRows: 0 };
  }

  logItemMasterSync_(config, 'Prepared full sync rows', {
    totalRowsToSync: allRowsToSync.length,
    firstRowIndex: allRowIndicesToUpdate[0] || null,
    lastRowIndex: allRowIndicesToUpdate[allRowIndicesToUpdate.length - 1] || null,
    duplicateRowsDeleted: duplicateRowIndices.length,
    apiUrl: config.apiUrl,
    spreadsheetId: config.spreadsheetId,
  });
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

    logItemMasterSync_(config, 'Sending full-sync batch', {
      batchStart: i,
      batchSize: rowsToSync.length,
      rowIndexes: rowIndicesToUpdate,
      itemIds: rowsToSync.map((row) => getSyncIdValue_(row, config)).filter((value) => value !== ''),
      apiUrl: config.apiUrl,
    });

    try {
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
        logItemMasterSync_(config, 'HTTP error during full-sync batch', {
          responseCode: responseCode,
          responseText: responseText,
          rowIndexes: rowIndicesToUpdate,
          itemIds: rowsToSync.map((row) => getSyncIdValue_(row, config)).filter((value) => value !== ''),
          apiUrl: config.apiUrl,
        });
        throw new Error(`Sync failed for ${config.tabName} at row ${rowIndicesToUpdate[0]}: ${responseText}`);
      }

      const parsedResponse = parseSyncResponse_(responseText, config.tabName);
      logItemMasterSync_(config, 'Received full-sync response', {
        responseCode: responseCode,
        responseText: responseText,
        processedRows: parsedResponse.processedRows,
        processedIds: parsedResponse.processedIds,
        inserted: parsedResponse.inserted,
        updated: parsedResponse.updated,
        removed: parsedResponse.removed,
        invalidRows: parsedResponse.invalidRows,
        duplicateIds: parsedResponse.duplicateIds,
      });
      const successfulRowIndices = getSuccessfulRowIndices_(rowsToSync, rowIndicesToUpdate, parsedResponse, config);
      if (successfulRowIndices.length === 0) {
        throw new Error(`Sync returned no accepted rows for ${config.tabName}.`);
      }

      successfulRowIndices.forEach((rowIndex) => {
        try {
          sheet.getRange(rowIndex, hostingerSyncIndex + 1).setValue(syncTimestamp);
        } catch (err) {
          Logger.log('Failed to update timestamp for row %s: %s', rowIndex, err);
          logItemMasterSyncError_(config, 'Failed updating sheet timestamp', err, {
            rowIndex: rowIndex,
            syncTimestamp: syncTimestamp,
          });
        }
      });

      SpreadsheetApp.flush();
      totalProcessed += successfulRowIndices.length;
      lastResult = parsedResponse;
    } catch (error) {
      logItemMasterSyncError_(config, 'Exception during full-sync batch', error, {
        rowIndexes: rowIndicesToUpdate,
        itemIds: rowsToSync.map((row) => getSyncIdValue_(row, config)).filter((value) => value !== ''),
        apiUrl: config.apiUrl,
      });
      throw error;
    }
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
  const config = getAllSheetSyncConfigs_().find((entry) => entry.tabName === sheetName);
  if (config) {
    handleSheetEdit_(e, config, false);
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

  getAllSheetSyncConfigs_().forEach((config) => {
    queueFullSync_(config);
    scheduleFlush_(config);
  });
}

function performFlush_(config, idHeader) {
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(config.tabName);
  if (!sheet) return;

  const properties = PropertiesService.getScriptProperties();
  const runFullSync = properties.getProperty(config.pendingFullSyncPropertyKey) === 'true';
  const pendingRows = getPendingRows_(config);

  if (runFullSync) {
    let result;
    if (config.tabName === NPD_SYNC_CONFIG.tabName) {
      result = forceFullNpdSync();
    } else if (config.tabName === COMPANY_SYNC_CONFIG.tabName) {
      result = forceFullCompanySync();
    } else if (typeof PHP_ITEM_MASTER_SYNC_CONFIG !== 'undefined' && config.tabName === PHP_ITEM_MASTER_SYNC_CONFIG.tabName) {
      result = forceFullPhpItemMasterSync();
    } else if (typeof PLATE_ITEM_MASTER_SYNC_CONFIG !== 'undefined' && config.tabName === PLATE_ITEM_MASTER_SYNC_CONFIG.tabName) {
      result = forceFullPlateItemMasterSync();
    } else {
      throw new Error(`No full sync handler found for ${config.tabName}`);
    }
    clearPendingQueue_(config);
    deleteFlushTriggers_(config);
    return result;
  }

  if (!pendingRows.length) {
    logItemMasterSync_(config, 'No pending queued rows to flush');
    deleteFlushTriggers_(config);
    return { ok: true, processedRows: 0 };
  }

  logItemMasterSync_(config, 'Flushing queued rows', {
    pendingCount: pendingRows.length,
    itemIds: pendingRows.map((row) => getSyncIdValue_(row, config)).filter((value) => value !== ''),
    apiUrl: config.apiUrl,
  });
  const syncTimestamp = formatDate_(new Date());

  try {
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

    const responseText = response.getContentText();
    const responseCode = response.getResponseCode();

    if (responseCode >= 400) {
      logItemMasterSync_(config, 'HTTP error during queued flush', {
        responseCode: responseCode,
        responseText: responseText,
        itemIds: pendingRows.map((row) => getSyncIdValue_(row, config)).filter((value) => value !== ''),
        apiUrl: config.apiUrl,
      });
      throw new Error(`Batch sync failed for ${config.tabName}: ${responseText}`);
    }

    const parsedResponse = parseSyncResponse_(responseText, config.tabName);
    logItemMasterSync_(config, 'Received queued flush response', {
      responseCode: responseCode,
      responseText: responseText,
      processedRows: parsedResponse.processedRows,
      processedIds: parsedResponse.processedIds,
      inserted: parsedResponse.inserted,
      updated: parsedResponse.updated,
      removed: parsedResponse.removed,
      invalidRows: parsedResponse.invalidRows,
      duplicateIds: parsedResponse.duplicateIds,
    });
    const acceptedIds = getAcceptedSyncIds_(parsedResponse, pendingRows, config);
    if (!acceptedIds.length) {
      throw new Error(`Sync returned no accepted rows for ${config.tabName}.`);
    }

    const acceptedRows = pendingRows.filter((row) => acceptedIds.indexOf(getSyncIdValue_(row, config)) !== -1);
    updateTimestamps_(sheet, acceptedRows, idHeader, config.hostingerSyncHeader, syncTimestamp);

    if (config.tabName === NPD_SYNC_CONFIG.tabName) {
      syncNpdRatesFromHostinger();
    }

    clearPendingQueue_(config);
    deleteFlushTriggers_(config);
    return parsedResponse;
  } catch (error) {
    logItemMasterSyncError_(config, 'Exception during queued flush', error, {
      itemIds: pendingRows.map((row) => getSyncIdValue_(row, config)).filter((value) => value !== ''),
      apiUrl: config.apiUrl,
    });
    throw error;
  }
}

function getSyncIdHeader_(config) {
  return String(config.idHeader || config.npdIdHeader || '').trim();
}

function getHeaderCandidates_(header) {
  const base = String(header || '').trim();
  if (!base) return [];

  const compact = base.replace(/\s+/g, '');
  const upper = base.toUpperCase();
  const lower = base.toLowerCase();
  const title = base.replace(/\b\w/g, (char) => char.toUpperCase());
  return [...new Set([
    base,
    upper,
    lower,
    title,
    compact,
    compact.toUpperCase(),
    compact.toLowerCase(),
  ])];
}

function getSyncIdCandidates_(config) {
  const primary = getSyncIdHeader_(config);
  const candidates = getHeaderCandidates_(primary);

  if (primary === 'Item Id') {
    candidates.push('Item ID', 'ItemID', 'ItemId');
  }
  if (primary === 'php_id') {
    candidates.push('php id', 'PHP ID', 'phpId', 'PHPID');
  }
  if (primary === 'plateid') {
    candidates.push('plate id', 'Plate ID', 'plateId', 'PLATEID');
  }
  if (primary === 'NPD ID') {
    candidates.push('NPD Id', 'Npd ID', 'Npd Id', 'NPDID');
  }
  if (primary === 'Id') {
    candidates.push('ID', 'id');
  }

  return [...new Set(candidates.map((value) => String(value || '').trim()).filter((value) => value !== ''))];
}

function getRowValueByCandidates_(row, candidates) {
  if (!row || !Array.isArray(candidates)) return '';
  for (const candidate of candidates) {
    const directValue = String(row[candidate] || '').trim();
    if (directValue) return directValue;
  }

  const normalizedEntries = Object.keys(row).map((key) => ({
    key,
    normalized: String(key || '').trim().toLowerCase().replace(/\s+/g, ''),
  }));
  for (const candidate of candidates) {
    const normalizedCandidate = String(candidate || '').trim().toLowerCase().replace(/\s+/g, '');
    const match = normalizedEntries.find((entry) => entry.normalized === normalizedCandidate);
    if (match) {
      const matchedValue = String(row[match.key] || '').trim();
      if (matchedValue) return matchedValue;
    }
  }

  return '';
}

function getHeaderIndexByCandidates_(headers, candidates) {
  const normalizedHeaders = headers.map((header) => String(header || '').trim());
  for (const candidate of candidates || []) {
    const directIndex = normalizedHeaders.indexOf(candidate);
    if (directIndex !== -1) return directIndex;
  }

  const compactHeaders = normalizedHeaders.map((header) => header.toLowerCase().replace(/\s+/g, ''));
  for (const candidate of candidates || []) {
    const compactCandidate = String(candidate || '').trim().toLowerCase().replace(/\s+/g, '');
    const matchIndex = compactHeaders.indexOf(compactCandidate);
    if (matchIndex !== -1) return matchIndex;
  }

  return -1;
}

function getSyncIdValue_(row, config) {
  return getRowValueByCandidates_(row, getSyncIdCandidates_(config));
}

function parseSyncResponse_(responseText, tabName) {
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Invalid sync response for ${tabName}: ${responseText}`);
  }

  if (!parsed || parsed.ok !== true) {
    throw new Error(`Sync did not complete successfully for ${tabName}: ${responseText}`);
  }

  return parsed;
}

function resolveSyncRowKey_(row, config, idHeader) {
  const strictId = getSyncIdValue_(row, config);
  if (strictId) return strictId;

  if (config && config.tabName === 'Companies') {
    return String(row['Id'] || row['id'] || row['ID'] || row['Company'] || row['Company Name'] || row['name'] || '').trim();
  }

  return '';
}

function hasMeaningfulSyncData_(row, config) {
  if (!row) return false;
  if (getSyncIdValue_(row, config)) return true;

  const itemName = String(row['Item Name'] || '').trim();
  const company = String(row['Company'] || '').trim();
  const approvalTimestamp = String(row['Approval Timestamp'] || '').trim();
  const approvalEmail = String(row['Approval Email'] || '').trim();
  const boxType = String(row['BOX TYPE'] || '').trim();
  const syncInItemMaster = String(row['SYNC IN ITEM MASTER'] || '').trim();
  const hostingerSync = String(row[config.hostingerSyncHeader] || '').trim();

  return Boolean(itemName || company || approvalTimestamp || approvalEmail || boxType || syncInItemMaster || hostingerSync);
}

function getAcceptedSyncIds_(responsePayload, rowsToSync, config) {
  const explicitIds = Array.isArray(responsePayload.processedIds)
    ? responsePayload.processedIds.map((value) => String(value || '').trim()).filter((value) => value !== '')
    : [];
  if (explicitIds.length) {
    return explicitIds;
  }

  const processedCount = Number(responsePayload && responsePayload.processedRows);
  if (!Number.isFinite(processedCount) || processedCount <= 0 || !Array.isArray(rowsToSync)) {
    return [];
  }

  const invalidRowNumbers = new Set(
    Array.isArray(responsePayload.invalidRows)
      ? responsePayload.invalidRows.map((entry) => Number(entry && entry.rowNumber)).filter((value) => Number.isFinite(value))
      : []
  );

  const fallbackIds = rowsToSync
    .map((row, index) => ({
      rowNumber: index + 2,
      idValue: getSyncIdValue_(row, config),
    }))
    .filter((entry) => entry.idValue && !invalidRowNumbers.has(entry.rowNumber))
    .map((entry) => entry.idValue);

  return fallbackIds.slice(0, processedCount > 0 ? processedCount : fallbackIds.length);
}

function getSuccessfulRowIndices_(rowsToSync, rowIndicesToUpdate, responsePayload, config) {
  const acceptedIds = getAcceptedSyncIds_(responsePayload, rowsToSync, config);
  const idHeader = getSyncIdHeader_(config);
  if (!acceptedIds.length || !idHeader) {
    return [];
  }

  const acceptedSet = new Set(acceptedIds);
  return rowIndicesToUpdate.filter((rowIndex, index) => {
    const row = rowsToSync[index] || {};
    const rowId = getSyncIdValue_(row, config);
    return acceptedSet.has(rowId);
  });
}

function updateTimestamps_(sheet, pendingRows, idHeader, syncHeader, timestamp) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const idIndex = getHeaderIndexByCandidates_(headers, getSyncIdCandidates_({ idHeader: idHeader }));
  const syncIndex = getHeaderIndexByCandidates_(headers, getHeaderCandidates_(syncHeader));

  if (idIndex !== -1 && syncIndex !== -1) {
    const sheetData = sheet.getDataRange().getDisplayValues();
    pendingRows.forEach((row) => {
      const idValue = getSyncIdValue_(row, { idHeader: idHeader });
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

  const canonicalIdValue = getSyncIdValue_(payload, config);
  if (canonicalIdValue) {
    payload[getSyncIdHeader_(config)] = canonicalIdValue;
  }

  const canonicalHostingerSync = getRowValueByCandidates_(payload, getHeaderCandidates_(config.hostingerSyncHeader));
  if (canonicalHostingerSync) {
    payload[config.hostingerSyncHeader] = canonicalHostingerSync;
  }

  if (skipIfSynced) {
    const hostingerSyncValue = String(payload[config.hostingerSyncHeader] || '').trim();
    if (hostingerSyncValue !== '') return null;
  }

  const idValue = getSyncIdValue_(payload, config);
  if (!idValue) return null;

  return payload;
}

function queuePendingRow_(rowPayload, config) {
  const idValue = getSyncIdValue_(rowPayload, config);
  if (!idValue) return;

  logItemMasterSync_(config, 'Queueing row for sync', {
    itemId: idValue,
    itemName: String(rowPayload['Item Name'] || '').trim(),
    hostingerSync: String(rowPayload[config.hostingerSyncHeader] || '').trim(),
    approvalTimestamp: String(rowPayload['Approval Timestamp'] || '').trim(),
    approvalEmail: String(rowPayload['Approval Email'] || '').trim(),
  });

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

function getAllSheetSyncConfigs_() {
  const configs = [NPD_SYNC_CONFIG, COMPANY_SYNC_CONFIG];
  if (typeof PHP_ITEM_MASTER_SYNC_CONFIG !== 'undefined') {
    configs.push(PHP_ITEM_MASTER_SYNC_CONFIG);
  }
  if (typeof PLATE_ITEM_MASTER_SYNC_CONFIG !== 'undefined') {
    configs.push(PLATE_ITEM_MASTER_SYNC_CONFIG);
  }
  return configs;
}

function installRateSyncTrigger() {
  deleteRateSyncTriggers_();
  ScriptApp.newTrigger(NPD_SYNC_CONFIG.rateSyncTriggerHandler)
    .timeBased()
    .everyMinutes(NPD_SYNC_CONFIG.rateSyncIntervalMinutes)
    .create();
}

function onOpen() {
  const menu = SpreadsheetApp.getUi()
    .createMenu('LNPI Sync')
    .addItem('Sync NPD to LNPI', 'syncNpdSheetToHostinger')
    .addItem('Sync Companies to LNPI', 'syncCompaniesSheetToHostinger');

  if (typeof syncPhpItemMasterSheetToHostinger === 'function') {
    menu.addItem('Sync PHP Item Master to LNPI', 'syncPhpItemMasterSheetToHostinger');
  }
  if (typeof syncPlateItemMasterSheetToHostinger === 'function') {
    menu.addItem('Sync Plate Item Master to LNPI', 'syncPlateItemMasterSheetToHostinger');
  }

  menu
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


