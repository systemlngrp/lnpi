const PHP_ITEM_MASTER_SYNC_CONFIG = {
  apiUrl: 'https://darkred-lobster-409686.hostingersite.com/api/npd-sync',
  secret: 'REPLACE_WITH_NPD_SYNC_SECRET',
  tabName: 'PHP ITEM MASTER',
  spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
  idHeader: 'phpid',
  hostingerSyncHeader: 'Hostinger Sync',
  flushDelayMs: 15000,
  pendingRowsPropertyKey: 'PHP_ITEM_MASTER_PENDING_ROWS',
  pendingFullSyncPropertyKey: 'PHP_ITEM_MASTER_PENDING_FULL_SYNC',
  flushTriggerHandler: 'flushQueuedPhpItemMasterSync',
};

function syncPhpItemMasterSheetToHostinger() {
  return forceFullPhpItemMasterSync();
}

function forceFullPhpItemMasterSync() {
  return performFullSync_(PHP_ITEM_MASTER_SYNC_CONFIG, true);
}

function flushQueuedPhpItemMasterSync() {
  return performFlush_(PHP_ITEM_MASTER_SYNC_CONFIG, PHP_ITEM_MASTER_SYNC_CONFIG.idHeader);
}
