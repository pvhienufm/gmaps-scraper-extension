/**
 * Google Sheets sink for the GMaps Scraper extension.
 *
 * Setup (once, ~5 min):
 *   1. Open the target Google Sheet.
 *   2. Extensions → Apps Script. Delete any boilerplate, paste this whole file.
 *   3. Deploy → New deployment → type "Web app".
 *        - Execute as: Me
 *        - Who has access: Anyone
 *      Deploy, authorise, and copy the /exec Web app URL.
 *   4. Paste that URL into the extension panel's "Google Sheet (Apps Script URL)"
 *      field, then click "Send to Google Sheet".
 *
 * The URL is a shared secret — anyone with it can append rows. Keep it private;
 * redeploy to rotate it.
 *
 * Payload posted by the extension:
 *   { "columns": ["name","rating",...], "rows": [["A","4.5",...], ...], "sheet": "Sheet1" }
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var columns = body.columns || [];
    var rows = body.rows || [];
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = (body.sheet && ss.getSheetByName(body.sheet)) || ss.getSheets()[0];

    // Write a header row once, when the sheet is empty.
    if (sheet.getLastRow() === 0 && columns.length) {
      sheet.appendRow(columns);
    }
    if (rows.length && columns.length) {
      sheet
        .getRange(sheet.getLastRow() + 1, 1, rows.length, columns.length)
        .setValues(rows);
    }
    return json({ ok: true, added: rows.length });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, hint: "POST scraped rows here." });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
