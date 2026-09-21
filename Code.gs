/**
 * Steal An Egg - Google Apps Script (Code.gs)
 * 貼至 Google Sheet -> 擴充功能 (Extensions) -> Apps Script 即可完成自動同步與會員管理！
 */

function getOrCreateMembersSheet(ss) {
  var sheet = ss.getSheetByName('Members');
  if (!sheet) {
    sheet = ss.insertSheet('Members');
    var headers = [
      'ChatID', 'Username', 'FirstName', 'Tier', 
      'ExpireAt', 'Enabled', 'FilterType', 'CustomRarities', 
      'CustomEggNames', 'CreatedAt', 'UpdatedAt', 'NotificationsCount', 'Notes'
    ];
    sheet.appendRow(headers);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#2D3748').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var action = e ? e.parameter.action : '';
  
  // 1. 取得全域推播設定
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

  // 2. 取得會員名單
  if (action === 'get_members') {
    var mSheet = getOrCreateMembersSheet(ss);
    var data = mSheet.getDataRange().getValues();
    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', members: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var members = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      members.push({
        chatId: String(row[0]),
        username: row[1] || '',
        firstName: row[2] || '',
        tier: row[3] || 'free',
        expireAt: row[4] ? String(row[4]) : null,
        enabled: row[5] !== false && String(row[5]).toLowerCase() !== 'false',
        filterType: row[6] || 'all',
        customRarities: row[7] ? String(row[7]).split(',').map(function(s){return s.trim();}).filter(Boolean) : [],
        customEggNames: row[8] ? String(row[8]).split(',').map(function(s){return s.trim();}).filter(Boolean) : [],
        createdAt: row[9] ? String(row[9]) : '',
        updatedAt: row[10] ? String(row[10]) : '',
        notificationsCount: Number(row[11]) || 0,
        notes: row[12] || ''
      });
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', members: members }))
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

    // 3. 新增或更新會員 (upsert_member)
    if (postData.action === 'upsert_member' && postData.member) {
      var m = postData.member;
      var mSheet = getOrCreateMembersSheet(ss);
      var data = mSheet.getDataRange().getValues();
      var targetRow = -1;
      var targetChatId = String(m.chatId);

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === targetChatId) {
          targetRow = i + 1;
          break;
        }
      }

      var rowValues = [
        targetChatId,
        m.username || '',
        m.firstName || '',
        m.tier || 'free',
        m.expireAt || '',
        m.enabled !== false,
        m.filterType || 'all',
        Array.isArray(m.customRarities) ? m.customRarities.join(', ') : (m.customRarities || ''),
        Array.isArray(m.customEggNames) ? m.customEggNames.join(', ') : (m.customEggNames || ''),
        m.createdAt || new Date().toISOString(),
        new Date().toISOString(),
        m.notificationsCount || 0,
        m.notes || ''
      ];

      if (targetRow > 0) {
        mSheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
      } else {
        mSheet.appendRow(rowValues);
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', action: 'upsert_member', chatId: targetChatId }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 4. 設定會員 VIP (set_vip)
    if (postData.action === 'set_vip' && postData.chatId) {
      var mSheet = getOrCreateMembersSheet(ss);
      var data = mSheet.getDataRange().getValues();
      var targetRow = -1;
      var targetChatId = String(postData.chatId);

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === targetChatId) {
          targetRow = i + 1;
          break;
        }
      }

      if (targetRow > 0) {
        mSheet.getRange(targetRow, 4).setValue('vip'); // Tier
        mSheet.getRange(targetRow, 5).setValue(postData.expireAt || ''); // ExpireAt
        mSheet.getRange(targetRow, 11).setValue(new Date().toISOString()); // UpdatedAt
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', updated: true, chatId: targetChatId }))
          .setMimeType(ContentService.MimeType.JSON);
      } else {
        // 新建會員為 VIP
        mSheet.appendRow([
          targetChatId,
          postData.username || '',
          postData.firstName || '',
          'vip',
          postData.expireAt || '',
          true,
          'all',
          '',
          '',
          new Date().toISOString(),
          new Date().toISOString(),
          0,
          postData.notes || 'VIP Granted'
        ]);
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', created: true, chatId: targetChatId }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // 5. 單筆寫入掉落紀錄
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
