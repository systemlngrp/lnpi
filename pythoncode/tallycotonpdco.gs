function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Companies");
  var data = sheet.getDataRange().getValues();

  var headers = data[0];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    result.push(row);
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}


/***** CONFIG *****/
const SHEET_NAME = "Companies";

/*
Companies Sheet Columns:

A = Company
B = Address
C = District
D = State
E = GST NO
F = Email
G = Contact Person
H = Contact Number
I = Id
J = PIN
K = NPD Hostinger Sync
L = Sales Person
M = GST Type
N = PAN No
*/

const COL_COMPANY            = 1;
const COL_ADDRESS            = 2;
const COL_DISTRICT           = 3;
const COL_STATE              = 4;
const COL_GST_NO             = 5;
const COL_EMAIL              = 6;
const COL_CONTACT_PERSON     = 7;
const COL_CONTACT_NUMBER     = 8;
const COL_ID                 = 9;
const COL_PIN                = 10;
const COL_NPD_HOSTINGER_SYNC = 11;
const COL_SALES_PERSON       = 12;
const COL_GST_TYPE           = 13;
const COL_PAN_NO             = 14;

// Colors
const COLOR_UPDATED = "#085877"; // Sky Blue - updated from Tally
const COLOR_SAME    = "#41cc0a"; // Green - already same
const COLOR_SKIPPED = "#FFF2CC"; // Yellow - Tally blank, existing kept


function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.action !== "syncCompanies") {
      return jsonResponse({
        success: false,
        message: "Invalid action"
      });
    }

    const records = body.records || [];
    const onlyBlankUpdates = body.onlyBlankUpdates !== false;

    const result = syncCompaniesFromPython(records, onlyBlankUpdates);

    return jsonResponse({
      success: true,
      message: "Company sync completed",
      result: result
    });

  } catch (err) {
    return jsonResponse({
      success: false,
      message: err.message,
      stack: err.stack
    });
  }
}


function syncCompaniesFromPython(records, onlyBlankUpdates) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);

  if (!sh) {
    throw new Error("Sheet not found: " + SHEET_NAME);
  }

  const lastRow = sh.getLastRow();

  if (lastRow < 2) {
    throw new Error("No company data found in Companies sheet");
  }

  const headerRange = sh.getRange(1, 1, 1, COL_PAN_NO);
  const bodyRange = sh.getRange(2, 1, lastRow - 1, COL_PAN_NO);
  const data = bodyRange.getValues();
  const backgrounds = bodyRange.getBackgrounds();

  const companyMap = {};

  for (let r = 0; r < data.length; r++) {
    const companyName = normalizeCompanyKey(data[r][COL_COMPANY - 1]);

    if (companyName) {
      companyMap[companyName] = r;
    }
  }

  let checked = 0;
  let matched = 0;
  let notFound = 0;
  let cellsUpdated = 0;
  let cellsSame = 0;
  let cellsSkippedBlank = 0;
  const unmatchedCompanies = [];

  records.forEach(record => {
    checked++;

    const company = normalizeCompanyKey(record.company);
    const hasMatch = Object.prototype.hasOwnProperty.call(companyMap, company);

    if (!company || !hasMatch) {
      notFound++;
      unmatchedCompanies.push(String(record.company || ""));
      return;
    }

    matched++;

    const rowIndex = companyMap[company];

    let result;

    result = updateCellSafe(data, backgrounds, rowIndex, COL_ADDRESS, record.address, onlyBlankUpdates);
    cellsUpdated += result.updated;
    cellsSame += result.same;
    cellsSkippedBlank += result.skipped;

    result = updateCellSafe(data, backgrounds, rowIndex, COL_DISTRICT, record.district, onlyBlankUpdates);
    cellsUpdated += result.updated;
    cellsSame += result.same;
    cellsSkippedBlank += result.skipped;

    result = updateCellSafe(data, backgrounds, rowIndex, COL_STATE, record.state, onlyBlankUpdates);
    cellsUpdated += result.updated;
    cellsSame += result.same;
    cellsSkippedBlank += result.skipped;

    result = updateCellSafe(data, backgrounds, rowIndex, COL_GST_NO, record.gstNo, false);
    cellsUpdated += result.updated;
    cellsSame += result.same;
    cellsSkippedBlank += result.skipped;

    result = updateCellSafe(data, backgrounds, rowIndex, COL_EMAIL, record.email, onlyBlankUpdates);
    cellsUpdated += result.updated;
    cellsSame += result.same;
    cellsSkippedBlank += result.skipped;

    result = updateCellSafe(data, backgrounds, rowIndex, COL_CONTACT_PERSON, record.contactPerson, onlyBlankUpdates);
    cellsUpdated += result.updated;
    cellsSame += result.same;
    cellsSkippedBlank += result.skipped;

    result = updateCellSafe(data, backgrounds, rowIndex, COL_CONTACT_NUMBER, record.contactNumber, onlyBlankUpdates);
    cellsUpdated += result.updated;
    cellsSame += result.same;
    cellsSkippedBlank += result.skipped;

    result = updateCellSafe(data, backgrounds, rowIndex, COL_ID, record.id, onlyBlankUpdates);
    cellsUpdated += result.updated;
    cellsSame += result.same;
    cellsSkippedBlank += result.skipped;

    result = updateCellSafe(data, backgrounds, rowIndex, COL_PIN, record.pinCode, onlyBlankUpdates);
    cellsUpdated += result.updated;
    cellsSame += result.same;
    cellsSkippedBlank += result.skipped;

    result = updateCellSafe(data, backgrounds, rowIndex, COL_GST_TYPE, record.gstType, false);
    cellsUpdated += result.updated;
    cellsSame += result.same;
    cellsSkippedBlank += result.skipped;

    result = updateCellSafe(data, backgrounds, rowIndex, COL_PAN_NO, record.panNo, onlyBlankUpdates);
    cellsUpdated += result.updated;
    cellsSame += result.same;
    cellsSkippedBlank += result.skipped;

    // Not updating these from Tally unless required:
    // K = NPD Hostinger Sync
    // L = Sales Person
  });

  bodyRange.setValues(data);
  bodyRange.setBackgrounds(backgrounds);

  return {
    totalRecordsReceived: records.length,
    checked: checked,
    matched: matched,
    notFound: notFound,
    unmatchedCompanies: unmatchedCompanies,
    cellsUpdated: cellsUpdated,
    cellsSame: cellsSame,
    cellsSkippedBlank: cellsSkippedBlank
  };
}


function updateCellSafe(data, backgrounds, rowIndex, colNo, newValue, onlyBlankUpdates) {
  newValue = cleanValue(newValue);

  const colIndex = colNo - 1;
  const oldValue = cleanValue(data[rowIndex][colIndex]);

  // Tally value blank, so do not overwrite existing value
  if (!newValue) {
    if (oldValue) {
      backgrounds[rowIndex][colIndex] = COLOR_SKIPPED;
      return {
        updated: 0,
        same: 0,
        skipped: 1
      };
    }

    return {
      updated: 0,
      same: 0,
      skipped: 0
    };
  }

  if (onlyBlankUpdates && oldValue) {
    if (normalize(oldValue) === normalize(newValue)) {
      backgrounds[rowIndex][colIndex] = COLOR_SAME;
      return {
        updated: 0,
        same: 1,
        skipped: 0
      };
    }

    backgrounds[rowIndex][colIndex] = COLOR_SKIPPED;
    return {
      updated: 0,
      same: 0,
      skipped: 1
    };
  }

  // Same value
  if (normalize(oldValue) === normalize(newValue)) {
    backgrounds[rowIndex][colIndex] = COLOR_SAME;
    return {
      updated: 0,
      same: 1,
      skipped: 0
    };
  }

  // Different value, update from Tally
  data[rowIndex][colIndex] = newValue;
  backgrounds[rowIndex][colIndex] = COLOR_UPDATED;

  return {
    updated: 1,
    same: 0,
    skipped: 0
  };
}


function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeCompanyKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}


function cleanValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}


function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
