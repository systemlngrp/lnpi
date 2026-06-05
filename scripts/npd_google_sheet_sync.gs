const NPD_SYNC_CONFIG = {
  apiUrl: 'https://darkred-lobster-409686.hostingersite.com/api/npd-sync',
  secret: 'REPLACE_WITH_NPD_SYNC_SECRET',
  tabName: 'NPD',
  spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
};

function syncNpdSheetToHostinger() {
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

function onNpdSheetChange() {
  return syncNpdSheetToHostinger();
}

function installNpdSyncTrigger() {
  const spreadsheet = SpreadsheetApp.openById(NPD_SYNC_CONFIG.spreadsheetId);
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'onNpdSheetChange')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('onNpdSheetChange')
    .forSpreadsheet(spreadsheet)
    .onChange()
    .create();
}
