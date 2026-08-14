const COMPANY_SYNC_CONFIG = {
  apiUrl: 'https://darkred-lobster-409686.hostingersite.com/api/npd-sync',
  secret: 'REPLACE_WITH_NPD_SYNC_SECRET',
  tabName: 'Companies',
  spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
  idHeader: 'Id',
  hostingerSyncHeader: 'NPD Hostinger Sync',
  syncHeaders: [
    'Company',
    'Address',
    'District',
    'State',
    'GST NO',
    'Email',
    'Contact Person',
    'Contact Number',
    'Id',
    'PIN',
    'NPD Hostinger Sync',
    'Sales Person',
    'GST Type',
    'PAN No',
    'PAYMENT TERMS',
    'OPENING BALANCE',
    'OVERDUES',
    'TARGET',
    'REFF. PERSON',
    'Priority',
    'Followup Frequency',
    'Auto Email',
    'Followup Approval',
  ],
  flushDelayMs: 15000,
  pendingRowsPropertyKey: 'COMPANY_PENDING_ROWS',
  pendingFullSyncPropertyKey: 'COMPANY_PENDING_FULL_SYNC',
  flushTriggerHandler: 'flushQueuedCompanySync',
};

function syncCompaniesSheetToHostinger() {
  return forceFullCompanySync();
}

function forceFullCompanySync() {
  return performFullSync_(COMPANY_SYNC_CONFIG, true);
}

function flushQueuedCompanySync() {
  return performFlush_(COMPANY_SYNC_CONFIG, COMPANY_SYNC_CONFIG.idHeader);
}
