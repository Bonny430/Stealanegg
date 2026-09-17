/**
 * Steal An Egg - Google Apps Script (Code.gs)
 * 貼至 Google Sheet -> 擴充功能 (Extensions) -> Apps Script 即可完成自動同步與表格美化！
 */

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var action = e ? e.parameter.action : '';
  
  if (action === 'get_config') {
    var configSheet = ss.getSheetByName('Config');
    if (configSheet) {
      try {
        var raw = configSheet.getRange('A1').getValue();
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', config: JSON.parse(raw) }))
          .setMimeType(ContentService.MimeType.JSON);
      } catch (err) {}
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', config: null }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // 預設傳回主要掉落紀錄工作表
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var postData = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheets()[0];
    
    // 1. 保存過濾設定
    if (postData.action === 'save_config') {
      var configSheet = ss.getSheetByName('Config') || ss.insertSheet('Config');
      configSheet.getRange('A1').setValue(JSON.stringify(postData.config));
      return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 2. 批量寫入歷史紀錄
    if (postData.action === 'batch_record' && Array.isArray(postData.rows)) {
      postData.rows.forEach(function(r) {
        sheet.appendRow([r.timestamp, r.name, r.rarity, r.rawText]);
      });
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', added: postData.rows.length }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 3. 單筆寫入掉落紀錄
    if (postData.timestamp && postData.name) {
      sheet.appendRow([postData.timestamp, postData.name, postData.rarity || '未知', postData.rawText || '']);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', recorded: postData }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'ignored' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
