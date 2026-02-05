/**
 * Google Apps Script - Web App for ADS Transparency Scanner
 *
 * SETUP INSTRUCTIONS:
 * 1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1ID3YHlXuzjBGT4XoPRR9iCrjsVYsGpsGWjvQWmF0JPo/edit
 * 2. Go to Extensions > Apps Script
 * 3. Delete any existing code and paste this entire file
 * 4. Click "Deploy" > "New deployment"
 * 5. Select type: "Web app"
 * 6. Set "Execute as": "Me"
 * 7. Set "Who has access": "Anyone"
 * 8. Click "Deploy"
 * 9. Copy the Web App URL and paste it in the Settings page of the application
 */

/**
 * Handle GET requests - returns domains from CONFIG sheet
 */
function doGet(e) {
  try {
    const action = e.parameter.action || 'getDomains';

    let result;

    switch (action) {
      case 'getDomains':
        result = getDomains();
        break;
      case 'health':
        result = { status: 'ok', timestamp: new Date().toISOString() };
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        error: error.message,
        stack: error.stack
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle POST requests - can be used to save results back to the sheet
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || 'saveResults';

    let result;

    switch (action) {
      case 'saveResults':
        result = saveResults(data.results);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        error: error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Get domains from CONFIG sheet
 * Expects CONFIG sheet to have domains in column A (starting from row 2, row 1 is header)
 */
function getDomains() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName('CONFIG');

  if (!configSheet) {
    return {
      success: false,
      error: 'CONFIG sheet not found. Please create a sheet named "CONFIG"'
    };
  }

  // Get all data from column A (domains) starting from row 2
  const lastRow = configSheet.getLastRow();

  if (lastRow < 2) {
    return {
      success: true,
      domains: [],
      message: 'No domains found in CONFIG sheet'
    };
  }

  const range = configSheet.getRange(2, 1, lastRow - 1, 1);
  const values = range.getValues();

  // Filter out empty rows and extract domain values
  // Clean domains: remove https://, http://, www. and trailing slashes
  const domains = values
    .map(row => row[0])
    .filter(domain => domain && domain.toString().trim() !== '')
    .map(domain => {
      let d = domain.toString().trim();
      d = d.replace(/^https?:\/\//, '');  // Remove http:// or https://
      d = d.replace(/^www\./, '');         // Remove www.
      d = d.replace(/\/+$/, '');           // Remove trailing slashes
      return d;
    });

  return {
    success: true,
    domains: domains,
    count: domains.length,
    timestamp: new Date().toISOString()
  };
}

/**
 * Save scan results to a RESULTS sheet
 * Creates the sheet if it doesn't exist
 */
function saveResults(results) {
  if (!results || !Array.isArray(results)) {
    return { success: false, error: 'Invalid results data' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let resultsSheet = ss.getSheetByName('RESULTS');

  // Define headers - 16 columns total (including Creative ID)
  const headers = [
    'Domain',
    'Publisher Name',
    'Publisher ID',
    'Creative ID',
    'Legal Name',
    'Verified',
    'Location',
    'Total Ads',
    'Region',
    'Ad Formats',
    'Last Seen Date',
    'Shown In Regions',
    'Ad Image/Video URL',
    'Ad Text',
    'Scan Date',
    'Status'
  ];

  // Create RESULTS sheet if it doesn't exist
  if (!resultsSheet) {
    resultsSheet = ss.insertSheet('RESULTS');
    // Add headers
    resultsSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    resultsSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    // Freeze header row
    resultsSheet.setFrozenRows(1);
  }

  // Add results
  const rows = results.map(r => [
    r.domain || '',
    r.publisherName || '',
    r.publisherId || '',
    r.creativeId || '',
    r.publisherLegalName || '',
    r.publisherVerified ? 'Yes' : 'No',
    r.publisherLocation || '',
    r.totalAds || 0,
    r.region || 'anywhere',
    Array.isArray(r.adFormats) ? r.adFormats.join(', ') : (r.adFormats || ''),
    r.lastSeenDate || '',
    r.shownInRegions || '',
    r.adImageUrl || '',
    r.adText || '',
    r.scanDate || new Date().toISOString(),
    r.status || 'completed'
  ]);

  const lastRow = resultsSheet.getLastRow();
  resultsSheet.getRange(lastRow + 1, 1, rows.length, headers.length).setValues(rows);

  return {
    success: true,
    savedCount: rows.length,
    timestamp: new Date().toISOString()
  };
}

/**
 * Test function - run this to verify the script works
 */
function testGetDomains() {
  const result = getDomains();
  Logger.log(JSON.stringify(result, null, 2));
}
