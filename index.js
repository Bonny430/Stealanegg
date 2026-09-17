const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const path = require('path');
const fs = require('fs');

// 自動讀取本地 .env (若存在，本機測試用；Render 上由環境變數提供)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of envLines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

// 環境變數設定
const PORT = process.env.PORT || 10000;
const OFFICIAL_CHANNEL_ID = '1533067560134906007'; // 官方 Steal An Egg #◜🥚・egg-notifier 頻道
const MONITORED_CHANNELS = new Set([OFFICIAL_CHANNEL_ID, process.env.SOURCE_CHANNEL_ID].filter(Boolean));
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GOOGLE_SHEET_API_URL = process.env.GOOGLE_SHEET_API_URL || 'https://script.google.com/macros/s/AKfycbxuLJ-ngjNo0JnQi9qmNBveGHW7KnnJRDfKW7WUEDXHmbB2949IWJmle8OiHp15InvB/exec';
const USER_TOKEN = process.env.USER_TOKEN;

// 重複推播防護 (30 秒視窗)
const recentProcessedEggs = new Map();

// 記憶體中推播設定快取
let currentConfig = {
  filterEnabled: true,
  allowedRarities: ['Secret', 'Divine', 'Eternal', 'Cosmic', 'Mythic', 'Legendary', 'Epic', 'Rare', 'Common', 'Uncommon'],
  ignoredEggs: []
};

// 同步狀態
let syncStatus = {
  isSyncing: false,
  totalFetched: 0,
  newRecorded: 0,
  lastError: null
};

// 載入蛋圖鑑快取
const EGGS_PATH = path.join(__dirname, 'data', 'eggs.json');
let eggsCatalog = [];
try {
  if (fs.existsSync(EGGS_PATH)) {
    eggsCatalog = JSON.parse(fs.readFileSync(EGGS_PATH, 'utf8'));
  }
} catch (e) {
  console.error('讀取蛋圖鑑失敗:', e.message);
}

// 建立 Express 伺服器
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Discord 用戶端實例
const client = new Client({ checkUpdate: false });

client.on('ready', () => {
  console.log(`[Discord] 小號已連線上線，登入身分：${client.user.tag}`);
  console.log(`[Discord] 監聽目標頻道清單：${Array.from(MONITORED_CHANNELS).join(', ')}`);
});

// 啟動時從 Google Sheet 載入推播過濾設定
async function loadConfigFromSheet() {
  try {
    const res = await fetch(`${GOOGLE_SHEET_API_URL}?action=get_config`);
    const json = await res.json();
    if (json && json.status === 'success' && json.config) {
      currentConfig = Object.assign(currentConfig, json.config);
      console.log('已從 Google Sheet 載入最新推播過濾設定');
    }
  } catch (err) {
    console.warn('載入 Google Sheet 設定異常，採用預設值:', err.message);
  }
}

// 蛋資訊解析函數 (經過 SenZ V2 實測驗證)
function extractEggInfo(embeds, content, createdAt) {
  let name = '未知蛋';
  let rarity = '未知';
  let location = '未知地點';
  let imageUrl = null;

  if (embeds && embeds.length > 0) {
    for (const embed of embeds) {
      // 1. 稀有度解析 (從 Embed Title，例如 <:Secret:...> Secret Egg Spawned!!)
      if (embed.title) {
        const cleanTitle = embed.title.replace(/<:[^:]+:\d+>/g, '').trim();
        const rMatch = cleanTitle.match(/(Secret|Divine|Eternal|Cosmic|Mythic|Legendary|Epic|Rare|Uncommon|Common)/i);
        if (rMatch) rarity = rMatch[1];
      }

      // 2. 蛋名稱與地點解析 (從 Embed Description)
      if (embed.description) {
        const desc = embed.description;
        const eggMatch = desc.match(/\*\*Egg:\*\*\s*([^\n\r]+)/i);
        if (eggMatch) name = eggMatch[1].trim();

        const locMatch = desc.match(/\*\*Location:\*\*\s*([^\n\r]+)/i);
        if (locMatch) location = locMatch[1].trim();

        // 提取 Discord 自訂 Emoji 作為高畫質蛋圖
        const emojiMatch = desc.match(/<:([a-zA-Z0-9_]+):(\d+)>/);
        if (emojiMatch) {
          imageUrl = `https://cdn.discordapp.com/emojis/${emojiMatch[2]}.png`;
        }
      }

      // 備用：從 fields 解析
      if (embed.fields && embed.fields.length > 0) {
        for (const f of embed.fields) {
          const fn = f.name.toLowerCase();
          const fv = f.value.replace(/[*_~`]/g, '').trim();
          if (fn.includes('egg') || fn.includes('name') || fn.includes('蛋')) name = fv;
          if (fn.includes('rarity') || fn.includes('稀有')) rarity = fv;
          if (fn.includes('location') || fn.includes('地點')) location = fv;
        }
      }

      if (!imageUrl && embed.thumbnail && embed.thumbnail.url) {
        imageUrl = embed.thumbnail.url;
      }
    }
  }

  // 備用：從純文字 content 解析 (例如: -# <@&...> Cosmic Skeleton Boss spawned in Cosmic!)
  if (name === '未知蛋' && content) {
    const textMatch = content.match(/<@&\d+>\s*(.*?)\s+spawned in\s+(.*?)!/i);
    if (textMatch) {
      name = textMatch[1].trim();
      if (location === '未知地點') location = textMatch[2].trim();
    }
  }

  // 若尚未有蛋圖，從蛋圖鑑 catalog 檢索
  if (!imageUrl) {
    const cleanKey = name.toLowerCase().replace(/egg/g, '').trim();
    const found = eggsCatalog.find(e => {
      const w = e.name.toLowerCase().replace(/egg/g, '').trim();
      return w === cleanKey || w.includes(cleanKey) || cleanKey.includes(w);
    });
    if (found && found.imageUrl) {
      imageUrl = found.imageUrl;
    }
  }

  return {
    timestamp: createdAt ? new Date(createdAt).toISOString() : new Date().toISOString(),
    name,
    rarity,
    location,
    imageUrl
  };
}

// 記錄單筆蛋掉落至 Google Sheet
async function recordEggDrop(eggData) {
  try {
    const res = await fetch(GOOGLE_SHEET_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: eggData.timestamp,
        name: eggData.name,
        rarity: eggData.rarity,
        rawText: `[${eggData.location}] ${eggData.rawText || ''}`
      })
    });
    const result = await res.json();
    console.log('[Google Sheet] 寫入紀錄成功:', eggData.name);
    return result;
  } catch (err) {
    console.error('[Google Sheet] 寫入失敗:', err.message);
    return null;
  }
}

// 資料分析與預測算法
async function analyzeAndPredict() {
  try {
    const res = await fetch(GOOGLE_SHEET_API_URL);
    const json = await res.json();
    if (!json || !json.data || json.data.length <= 1) {
      return { totalRecords: 0, statusText: '資料庫尚無足夠紀錄' };
    }

    const rows = json.data.slice(1).filter(r => r[0] && r[0].toString().trim() !== '');
    if (rows.length === 0) return { totalRecords: 0, statusText: '資料庫為空' };

    if (rows.length < 2) {
      return {
        totalRecords: rows.length,
        statusText: '資料累積中 (需至少 2 筆紀錄以計算平均重生週期)'
      };
    }

    // 解析時間戳記並排序
    const timestamps = rows
      .map(r => new Date(r[0]).getTime())
      .filter(t => !isNaN(t))
      .sort((a, b) => a - b);

    if (timestamps.length < 2) {
      return { totalRecords: rows.length, statusText: '時間戳記解析不足' };
    }

    // 計算相鄰蛋掉落的時間間隔（單位：分鐘）
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      const diffMin = (timestamps[i] - timestamps[i - 1]) / (1000 * 60);
      // 排除異常超長間隔（超過 12 小時可能為離線）
      if (diffMin > 0 && diffMin <= 720) {
        intervals.push(diffMin);
      }
    }

    if (intervals.length === 0) {
      return { totalRecords: rows.length, statusText: '間隔計算中' };
    }

    // 平均週期
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // 近期 5 筆平均
    const recentSlice = intervals.slice(-5);
    const recentAvg = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;

    // 預測下次掉落時間（最新紀錄時間 + 近期平均間隔）
    const lastTimestamp = timestamps[timestamps.length - 1];
    const nextTimestamp = lastTimestamp + Math.round(recentAvg * 60 * 1000);
    const predictedDate = new Date(nextTimestamp);
    const predictedTimeStr = predictedDate.toLocaleTimeString('zh-TW', { hour12: false });
    const minutesLeft = Math.max(0, Math.round((nextTimestamp - Date.now()) / (1000 * 60)));

    // 出現頻率統計
    const counts = {};
    for (const r of rows) {
      const n = (r[1] || '未知蛋').trim();
      counts[n] = (counts[n] || 0) + 1;
    }
    const topEggs = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    return {
      totalRecords: rows.length,
      avgIntervalMinutes: Math.round(avgInterval),
      recentAvgMinutes: Math.round(recentAvg),
      nextTimestamp,
      predictedTimeStr,
      minutesLeft,
      topEggs
    };
  } catch (err) {
    console.error('數據分析異常:', err.message);
    return null;
  }
}

// 發送 Telegram 推播
async function sendTelegramNotification(eggInfo, text, prediction) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  try {
    let predictionSection = '';
    if (prediction) {
      if (prediction.statusText) {
        predictionSection = `\n\n📊 【預測資訊】\n• 目前筆數：${prediction.totalRecords} 筆\n• 狀態：${prediction.statusText}`;
      } else {
        predictionSection = `\n\n📊 【週期預測分析】\n• 總歷史掉落：已累計 ${prediction.totalRecords} 次\n• 平均重生間隔：約 ${prediction.avgIntervalMinutes} 分鐘（近期平均：${prediction.recentAvgMinutes} 分鐘）\n• 預估下次掉落：約 ${prediction.predictedTimeStr} (約 ${prediction.minutesLeft} 分鐘後)`;
      }
    }

    const messageText = `🥚【Steal An Egg 掉落快訊】\n\n` +
      `• 蛋名稱：${eggInfo.name}\n` +
      `• 稀有度：${eggInfo.rarity}\n` +
      `• 出現地點：${eggInfo.location}\n` +
      `• 發現時間：${new Date(eggInfo.timestamp).toLocaleTimeString('zh-TW', { hour12: false })}\n\n` +
      `🔗 監控儀表板：https://stealanegg.onrender.com/\n` +
      `📋 資料庫：https://docs.google.com/spreadsheets/d/1vh5obGdyHAJ6I_DxtOlzllwEFQV7EjdrHUK-7PRSy5E/edit` +
      predictionSection;

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: messageText
      })
    });
    console.log('[Telegram] 推播發送成功:', eggInfo.name);
  } catch (err) {
    console.error('[Telegram] 發送異常:', err.message);
  }
}

// 監聽 Discord 訊息事件
client.on('messageCreate', async (message) => {
  // 僅監聽指定的蛋掉落頻道清單 (包含官方 #egg-notifier 及轉發頻道)
  if (!MONITORED_CHANNELS.has(message.channel.id)) {
    return;
  }

  const rawContent = message.content || '';
  const embedTitle = message.embeds[0]?.title || '';
  const embedDesc = message.embeds[0]?.description || '';
  const combinedText = `${rawContent} ${embedTitle} ${embedDesc}`;

  // 1. 嚴格過濾 AA (Admin Abuse / 管理員濫用)
  const isAA = /Admin Abuse|管理員濫用|Admin Spawned|Staff Spawned|\bAA\b/i.test(combinedText);
  if (isAA) {
    console.log('[過濾] 偵測到 AA (管理員濫用) 通知，依設定予以忽略');
    return;
  }

  // 2. 解析蛋資訊
  const eggInfo = extractEggInfo(message.embeds, rawContent, message.createdAt);
  eggInfo.rawText = combinedText;

  // 重複推播防護 (若 30 秒內已收到同名蛋，避免官方與轉發雙重觸發)
  const dedupeKey = `${eggInfo.name.toLowerCase()}_${Math.floor(Date.now() / 30000)}`;
  if (recentProcessedEggs.has(dedupeKey)) {
    console.log(`[略過重複通知] ${eggInfo.name} 於 30 秒內已記錄並處理完畢`);
    return;
  }
  recentProcessedEggs.set(dedupeKey, Date.now());

  console.log(`[發現蛋掉落] 名稱: ${eggInfo.name} | 稀有度: ${eggInfo.rarity} | 地點: ${eggInfo.location}`);

  // 3. 無條件記錄至 Google Sheet 資料庫 (確保統計樣本 100% 完整)
  await recordEggDrop(eggInfo);

  // 4. 計算週期預測
  const prediction = await analyzeAndPredict();

  // 5. 檢查推播過濾設定 (若用戶在儀表板設定過濾，依設定決定是否發送 Telegram)
  if (currentConfig.filterEnabled) {
    // 檢查稀有度
    const allowedRaritiesLower = (currentConfig.allowedRarities || []).map(r => r.toLowerCase());
    const isRarityAllowed = allowedRaritiesLower.includes(eggInfo.rarity.toLowerCase());

    // 檢查個別黑名單蛋種
    const ignoredEggsLower = (currentConfig.ignoredEggs || []).map(n => n.toLowerCase());
    const isEggIgnored = ignoredEggsLower.includes(eggInfo.name.toLowerCase()) ||
                         ignoredEggsLower.includes(`${eggInfo.name.toLowerCase()} egg`);

    if (!isRarityAllowed) {
      console.log(`[推播過濾] 稀有度 [${eggInfo.rarity}] 不在推播允許清單中，已靜音`);
      return;
    }

    if (isEggIgnored) {
      console.log(`[推播過濾] 蛋種 [${eggInfo.name}] 在自訂黑名單中，已靜音`);
      return;
    }
  }

  // 6. 通過過濾，發送 Telegram 推播
  await sendTelegramNotification(eggInfo, combinedText, prediction);
});

// ==================== REST API 路由 ====================

// 1. 伺服器與小號連線狀態
app.get('/api/status', async (req, res) => {
  let channelNames = [];
  try {
    if (client.isReady()) {
      for (const chId of MONITORED_CHANNELS) {
        const ch = await client.channels.fetch(chId).catch(() => null);
        if (ch) channelNames.push(ch.name);
      }
    }
  } catch (_) {}

  res.json({
    online: client.isReady(),
    user: client.user ? client.user.tag : null,
    channelId: Array.from(MONITORED_CHANNELS).join(', '),
    channelName: channelNames.join(' & ') || 'egg-notifier',
    uptime: Math.round(process.uptime())
  });
});

// 2. 取得 86 顆蛋圖鑑清單
app.get('/api/eggs', (req, res) => {
  res.json(eggsCatalog);
});

// 3. 取得週期預測與統計數據
app.get('/api/prediction', async (req, res) => {
  const data = await analyzeAndPredict();
  res.json(data || {});
});

// 4. 取得 Google Sheet 最新掉落歷史
app.get('/api/history', async (req, res) => {
  try {
    const response = await fetch(GOOGLE_SHEET_API_URL);
    const json = await response.json();
    if (json && json.data && json.data.length > 1) {
      const rows = json.data.slice(1).reverse().map(r => {
        let loc = '未知地點';
        const raw = r[3] || '';
        const locMatch = raw.match(/\[(.*?)\]/);
        if (locMatch) loc = locMatch[1];
        return {
          timestamp: r[0],
          name: r[1],
          rarity: r[2],
          location: loc,
          details: raw
        };
      });
      return res.json({ rows });
    }
    res.json({ rows: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. 取得推播過濾設定
app.get('/api/config', (req, res) => {
  res.json({ config: currentConfig });
});

// 6. 儲存推播過濾設定 (同時保存至記憶體與 Google Sheet Config 工作表)
app.post('/api/config', async (req, res) => {
  try {
    const newConfig = req.body;
    currentConfig = Object.assign(currentConfig, newConfig);

    // 非同步儲存至 Google Sheet Config tab
    fetch(GOOGLE_SHEET_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_config',
        config: currentConfig
      })
    }).catch(e => console.error('同步設定至 Sheet 異常:', e.message));

    res.json({ status: 'success', config: currentConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. 同步 Discord 歷史訊息回填至 Google Sheet
app.post('/api/sync-history', async (req, res) => {
  if (syncStatus.isSyncing) {
    return res.json({ started: false, message: '同步作業已在進行中' });
  }

  syncStatus.isSyncing = true;
  syncStatus.totalFetched = 0;
  syncStatus.newRecorded = 0;
  syncStatus.lastError = null;

  // 於背景非同步執行歷史抓取
  (async () => {
    try {
      const ch = await client.channels.fetch(OFFICIAL_CHANNEL_ID);
      // 讀取既有 Sheet 資料，避免重複寫入
      const sheetRes = await fetch(GOOGLE_SHEET_API_URL);
      const sheetJson = await sheetRes.json();
      const existingRows = sheetJson.data || [];
      const existingTimestamps = new Set(existingRows.slice(1).map(r => new Date(r[0]).getTime()));

      console.log(`[歷史回填] 開始讀取 #${ch.name} 過去訊息...`);
      const messages = await ch.messages.fetch({ limit: 100 });
      syncStatus.totalFetched = messages.size;

      const newRowsToSave = [];
      for (const [id, msg] of messages) {
        const rawContent = msg.content || '';
        const embedTitle = msg.embeds[0]?.title || '';
        const embedDesc = msg.embeds[0]?.description || '';
        const combined = `${rawContent} ${embedTitle} ${embedDesc}`;

        // 忽略 AA
        const isAA = /Admin Abuse|管理員濫用|Admin Spawned|Staff Spawned|\bAA\b/i.test(combined);
        if (isAA) continue;

        const info = extractEggInfo(msg.embeds, rawContent, msg.createdAt);
        const msgTime = new Date(info.timestamp).getTime();

        // 檢查時間戳是否已在試算表中 (容許 2 秒誤差)
        const alreadyExists = Array.from(existingTimestamps).some(t => Math.abs(t - msgTime) < 3000);
        if (!alreadyExists && info.name !== '未知蛋') {
          newRowsToSave.push({
            timestamp: info.timestamp,
            name: info.name,
            rarity: info.rarity,
            rawText: `[${info.location}] ${combined.slice(0, 200)}`
          });
          existingTimestamps.add(msgTime);
        }
      }

      console.log(`[歷史回填] 篩選出 ${newRowsToSave.length} 筆新掉落紀錄，批量上傳至 Sheet...`);

      if (newRowsToSave.length > 0) {
        // 反轉為時間正序寫入
        newRowsToSave.reverse();

        // 呼叫 Google Apps Script batch_record API
        await fetch(GOOGLE_SHEET_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'batch_record',
            rows: newRowsToSave
          })
        });

        syncStatus.newRecorded = newRowsToSave.length;
        console.log(`[歷史回填] 成功補填 ${newRowsToSave.length} 筆歷史紀錄！`);
      }
    } catch (err) {
      console.error('[歷史回填異常]:', err.message);
      syncStatus.lastError = err.message;
    } finally {
      syncStatus.isSyncing = false;
    }
  })();

  res.json({ started: true, message: '歷史資料同步作業已啟動' });
});

// 8. 取得同步進度
app.get('/api/sync-status', (req, res) => {
  res.json(syncStatus);
});

// 啟動 Express
app.listen(PORT, async () => {
  console.log(`[Web] 儀表板伺服器運行於 Port ${PORT}`);
  await loadConfigFromSheet();
});

// 登入 Discord 小號
client.login(USER_TOKEN).catch(err => {
  console.error('[Discord] 登入失敗:', err.message);
});
