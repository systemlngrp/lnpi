const PLATE_ITEM_MASTER_SYNC_CONFIG = {
  apiUrl: 'https://darkred-lobster-409686.hostingersite.com/api/npd-sync',
  secret: 'REPLACE_WITH_NPD_SYNC_SECRET',
  tabName: 'PLATE ITEM MASTER',
  spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
  idHeader: 'plateid',
  hostingerSyncHeader: 'Hostinger Sync',
  flushDelayMs: 15000,
  pendingRowsPropertyKey: 'PLATE_ITEM_MASTER_PENDING_ROWS',
  pendingFullSyncPropertyKey: 'PLATE_ITEM_MASTER_PENDING_FULL_SYNC',
  flushTriggerHandler: 'flushQueuedPlateItemMasterSync',
};

function syncPlateItemMasterSheetToHostinger() {
  return forceFullPlateItemMasterSync();
}

function forceFullPlateItemMasterSync() {
  return performFullSync_(PLATE_ITEM_MASTER_SYNC_CONFIG, true);
}

function flushQueuedPlateItemMasterSync() {
  return performFlush_(PLATE_ITEM_MASTER_SYNC_CONFIG, PLATE_ITEM_MASTER_SYNC_CONFIG.idHeader);
}
