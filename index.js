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

// 多頻道監聽與交叉比對設定
const KNOWN_CHANNELS = {
  '1533067560134906007': { name: '◜🥚・egg-notifier', server: 'Steal An Egg Official A (SenZ V2 官方源)' },
  '1540093905935278161': { name: '﹕🥚﹑egg-notifer', server: 'Steal An Egg Official B (SenZ V2 鏡像分流)' },
  '1541597188163899493': { name: '🖤┃secrets', server: 'Steal an egg Tracker (極速 Webhook ~2秒)' },
  '1541596326008066068': { name: '💜┃eternals', server: 'Steal an egg Tracker (Eternals 專屬)' },
  '1541596390474514512': { name: '🧡┃divines', server: 'Steal an egg Tracker (Divines 專屬)' }
};

const DEFAULT_CHANNEL_IDS = [
  '1533067560134906007',
  '1540093905935278161',
  '1541597188163899493',
  '1541596326008066068',
  '1541596390474514512'
];

const additionalIds = (process.env.ADDITIONAL_CHANNEL_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const MONITORED_CHANNELS = new Set([
  ...DEFAULT_CHANNEL_IDS,
  process.env.SOURCE_CHANNEL_ID,
  ...additionalIds
].filter(Boolean));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GOOGLE_SHEET_API_URL = process.env.GOOGLE_SHEET_API_URL || 'https://script.google.com/macros/s/AKfycbxuLJ-ngjNo0JnQi9qmNBveGHW7KnnJRDfKW7WUEDXHmbB2949IWJmle8OiHp15InvB/exec';
const USER_TOKEN = process.env.USER_TOKEN;

// 多頻道交叉比對與去重防護 (45 秒滑動窗口)
const activeDropEvents = new Map(); // key: eggClean_locKey -> { firstDetectedAt, firstChannelId, firstChannelName, firstGuildName, eggInfo }

const crossCheckStats = {
  totalDropsDetected: 0,
  crossVerifiedCount: 0,
  recentVerifications: []
};

// 28 種官方可刷新高階蛋種清單 (預設勾選)
const DEFAULT_HIGH_TIER_EGGS = [
  'Pure Jellyfish', 'Gargoyle', 'Kraken', 'T-Rex', 'Tralaledon', 'Cosmic Dragon',
  'Mutant Shark', 'Cerberus', 'Stag', 'Mosasaurus', 'Oni Tiger', 'Cosmic Skeleton Boss',
  'Yeti', 'Eternal Lunar Dragon', 'Gorilla King', 'Phoenix', 'Centaur', 'Ice Dragon',
  'Lava Dragon', 'Pegasus', 'Skeleton Horse', 'King Snake', 'Unicorn', 'El Maja',
  'Kitsune', 'ArchAngel', 'Nightflame', 'World Burner'
];

// 記憶體中推播設定快取 (嚴格以「蛋種」為篩選核心，不再以稀有度為準)
let currentConfig = {
  filterEnabled: true,
  selectedEggs: [...DEFAULT_HIGH_TIER_EGGS],
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

// 手動補充 Discord 特殊簡寫或別名
const ALIASES = {
  'trex': 'T-Rex',
  't-rex': 'T-Rex',
  'snakeking': 'King Snake',
  'elgranmaja': 'El Maja',
  'razorfang': 'RazorFang'
};

function normalizeEgg(rawName, detectedRarity, detectedBiome) {
  if (!rawName) return null;
  const norm = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');

  let matched = eggsCatalog.find(e => {
    const k1 = (e.cleanName || e.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    const k2 = (e.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const k3 = (e.petName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return k1 === norm || k2 === norm || k3 === norm;
  });

  if (!matched && ALIASES[norm]) {
    const aliasNorm = ALIASES[norm].toLowerCase().replace(/[^a-z0-9]/g, '');
    matched = eggsCatalog.find(e => {
      const k1 = (e.cleanName || e.name).toLowerCase().replace(/[^a-z0-9]/g, '');
      return k1 === aliasNorm;
    });
  }

  if (matched) {
    return {
      name: matched.cleanName || matched.name,
      rarity: matched.rarity || detectedRarity,
      biome: (matched.biome && matched.biome !== 'Unknown') ? matched.biome : detectedBiome,
      imageUrl: matched.imageUrl
    };
  }

  return {
    name: rawName,
    rarity: detectedRarity || 'Secret',
    biome: detectedBiome || '未知地點',
    imageUrl: null
  };
}

// 蛋資訊解析函數 (支援 SenZ V2 Embed 與 secret hook 等多頻道訊息格式)
function extractEggInfo(embeds, content, createdAt, channelMeta = {}) {
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

  // 3. 從純文字 content 解析 (支援 secret hook: <@&...> Yeti Egg spawned in Snow😟! 與 SenZ 提及文字)
  if ((name === '未知蛋' || !name) && content) {
    const textMatch = content.match(/(?:<@&?\d+>|-#\s*<@&?\d+>|^)\s*(.*?)\s+spawned in\s+(.*?)(?:!|$)/i);
    if (textMatch) {
      let rawEgg = textMatch[1].trim().replace(/\s+egg$/i, '').trim();
      name = rawEgg;

      let rawLoc = textMatch[2].trim().replace(/[^\w\s&'-]/g, '').trim();
      if (rawLoc) location = rawLoc;
    }
  }

  // 濾除無效廣告或空訊息 (例如 RoMarket 商店廣告)
  if (!name || name === '未知蛋' || name.toLowerCase().includes('romarket') || name.toLowerCase().includes('store')) {
    return null;
  }

  // 標準化蛋名稱、稀有度與地點
  const norm = normalizeEgg(name, rarity, location);
  if (norm) {
    name = norm.name;
    rarity = norm.rarity;
    if (location === '未知地點' || !location) location = norm.biome;
    if (!imageUrl && norm.imageUrl) imageUrl = norm.imageUrl;
  }

  return {
    timestamp: createdAt ? new Date(createdAt).toISOString() : new Date().toISOString(),
    name,
    rarity,
    location,
    imageUrl,
    channelId: channelMeta.channelId,
    channelName: channelMeta.channelName,
    guildName: channelMeta.guildName
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

// 本地歷史快取與統計（消除對 Google Sheet 的慢速重複查詢，實現 0ms API 與即時推播）
let cachedRows = [];
let cachedStats = null;

// 計算統計數據與 5 分鐘固定重生模型
function computeStatsFromRows(rows) {
  if (!rows || rows.length === 0) {
    return {
      totalRecords: 0,
      spawnCycleMinutes: 5,
      avgIntervalMinutes: 5,
      recentAvgMinutes: 5,
      rareBroadcastIntervalMinutes: 5,
      statusText: '資料庫尚無紀錄'
    };
  }

  const validRows = rows.filter(r => r[0] && r[0].toString().trim() !== '');
  const timestamps = validRows
    .map(r => new Date(r[0]).getTime())
    .filter(t => !isNaN(t))
    .sort((a, b) => a - b);

  // 伺服器出蛋固定週期：嚴格為 5 分鐘 (xx:00, xx:05, xx:10, xx:15...)
  const now = Date.now();
  const CYCLE_MS = 5 * 60 * 1000;
  let nextTimestamp = Math.ceil(now / CYCLE_MS) * CYCLE_MS;
  if (nextTimestamp - now < 3000) {
    nextTimestamp += CYCLE_MS;
  }
  const predictedDate = new Date(nextTimestamp);
  const predictedTimeStr = predictedDate.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const minutesLeft = Math.max(1, Math.round((nextTimestamp - now) / 60000));

  // 計算高階蛋廣播的間隔統計 (因普通蛋不推播，頻道公告平均間隔約 8~9 分鐘)
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    const diffMin = (timestamps[i] - timestamps[i - 1]) / (1000 * 60);
    if (diffMin > 0 && diffMin <= 120) {
      intervals.push(diffMin);
    }
  }

  const avgInterval = intervals.length > 0
    ? (intervals.reduce((a, b) => a + b, 0) / intervals.length)
    : 5;
  const recentSlice = intervals.slice(-10);
  const recentAvg = recentSlice.length > 0
    ? (recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length)
    : 5;

  // 出現頻率統計
  const counts = {};
  for (const r of validRows) {
    const n = (r[1] || '未知蛋').trim();
    counts[n] = (counts[n] || 0) + 1;
  }
  const topEggs = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => {
      const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matched = eggsCatalog.find(e => (e.cleanName || e.name).toLowerCase().replace(/[^a-z0-9]/g, '') === clean);
      return {
        name,
        count,
        rarity: matched ? matched.rarity : 'Secret'
      };
    });

  return {
    totalRecords: validRows.length,
    spawnCycleMinutes: 5,
    avgIntervalMinutes: 5, // 伺服器固定每 5 分鐘出蛋
    rareBroadcastIntervalMinutes: parseFloat(avgInterval.toFixed(1)),
    recentAvgMinutes: parseFloat(recentAvg.toFixed(1)),
    nextTimestamp,
    predictedTimeStr,
    minutesLeft,
    topEggs
  };
}

// 從 Google Sheet 刷新本地快取
async function refreshCacheFromSheet() {
  try {
    const res = await fetch(GOOGLE_SHEET_API_URL);
    const json = await res.json();
    if (json && json.data && json.data.length > 1) {
      cachedRows = json.data.slice(1).filter(r => r[0] && r[0].toString().trim() !== '');
      cachedStats = computeStatsFromRows(cachedRows);
      console.log(`[快取] 已同步 ${cachedRows.length} 筆資料庫紀錄，預測模型已更新`);
    }
  } catch (err) {
    console.warn('[快取] 載入 Google Sheet 失敗:', err.message);
  }
}

// 快速將新掉落記錄加入記憶體快取
function addEggToMemoryCache(eggInfo) {
  cachedRows.push([
    eggInfo.timestamp,
    eggInfo.name,
    eggInfo.rarity,
    `[${eggInfo.location}] ${eggInfo.rawText || ''}`
  ]);
  cachedStats = computeStatsFromRows(cachedRows);
}

// 格式化台灣時間 (Asia/Taipei)
function formatTaipeiDateTime(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '--:--:--';
  const formatter = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(d).replace(/[\u2009\u202f\u2000-\u200a]/g, ' ').replace(/\//g, '-');
}

// 極速發送 Telegram 推播（專為毫秒級響應設計）
async function sendTelegramNotification(eggInfo, text, prediction, sourceInfo) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] 尚未設定 Token 或 ChatId，略過推播');
    return;
  }

  const tStart = Date.now();
  try {
    const formattedDateTime = formatTaipeiDateTime(eggInfo.timestamp);
    
    let predictionSection = '';
    if (prediction) {
      predictionSection = `\n\n📊 【生蛋週期分析】\n` +
        `• 伺服器週期：每 5 分鐘固定出蛋 (整點 xx:00, xx:05...)\n` +
        `• 預計下次出蛋：${prediction.predictedTimeStr} (約 ${prediction.minutesLeft} 分鐘後)\n` +
        `• 稀有蛋平均間隔：約 ${cachedStats?.rareBroadcastIntervalMinutes || '9.4'} 分鐘 (約 1~2 輪出一次)`;
    }

    const sourceText = sourceInfo ? `• 偵測來源：#${sourceInfo.channelName} (${sourceInfo.server})\n` : '';

    const messageText = `🥚【Steal An Egg 掉落快訊】\n\n` +
      `• 蛋名稱：${eggInfo.name}\n` +
      `• 稀有度：${eggInfo.rarity}\n` +
      `• 出現地點：${eggInfo.location}\n` +
      `• 發現時間：${formattedDateTime} (台灣時間)\n` +
      sourceText +
      `\n🔗 監控儀表板：https://stealanegg.onrender.com/\n` +
      `📋 資料庫：https://docs.google.com/spreadsheets/d/1vh5obGdyHAJ6I_DxtOlzllwEFQV7EjdrHUK-7PRSy5E/edit` +
      predictionSection;

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: messageText
      })
    });
    const dur = Date.now() - tStart;
    if (res.ok) {
      console.log(`⚡ [Telegram] 推播發送成功: ${eggInfo.name} (花費 ${dur}ms)`);
    } else {
      const errTxt = await res.text();
      console.error(`[Telegram] 推播回應失敗 (${res.status}):`, errTxt);
    }
  } catch (err) {
    console.error('[Telegram] 發送異常:', err.message);
  }
}

// 監聽 Discord 訊息事件
client.on('messageCreate', async (message) => {
  // 僅監聽指定的蛋掉落頻道清單 (包含多個伺服器與頻道)
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

  // 取得該頻道名稱與伺服器資訊
  const known = KNOWN_CHANNELS[message.channel.id];
  const channelName = message.channel.name || known?.name || message.channel.id;
  const serverName = message.guild?.name || known?.server || 'Discord';

  // 2. 毫秒級快速解析蛋資訊 (純記憶體處理，耗時 < 1ms)
  const eggInfo = extractEggInfo(message.embeds, rawContent, message.createdAt, {
    channelId: message.channel.id,
    channelName,
    guildName: serverName
  });

  if (!eggInfo) {
    return;
  }
  eggInfo.rawText = combinedText;

  // 3. 多頻道交叉比對與重複防護 (45 秒滑動窗口)
  const now = Date.now();
  for (const [k, ev] of activeDropEvents.entries()) {
    if (now - ev.firstDetectedAt > 45000) {
      activeDropEvents.delete(k);
    }
  }

  const normName = eggInfo.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const locKey = (eggInfo.location && eggInfo.location !== '未知地點')
    ? eggInfo.location.toLowerCase().replace(/[^a-z0-9]/g, '')
    : 'any';
  const eventKey = `${normName}_${locKey}`;

  const existingEvent = activeDropEvents.get(eventKey) || activeDropEvents.get(`${normName}_any`);
  if (existingEvent) {
    // 交叉比對成功！此掉落事件已由先前的頻道通報過
    const deltaSec = ((now - existingEvent.firstDetectedAt) / 1000).toFixed(1);
    console.log(`⚡ [交叉比對驗證] 蛋種 [${eggInfo.name}] 在頻道 #${channelName} (${serverName}) 亦回報掉落！比對有效 (時差: +${deltaSec}s，第一來源: #${existingEvent.firstChannelName})`);

    crossCheckStats.crossVerifiedCount++;
    crossCheckStats.recentVerifications.unshift({
      eggName: eggInfo.name,
      location: eggInfo.location,
      firstSource: `#${existingEvent.firstChannelName} (${existingEvent.firstGuildName})`,
      secondSource: `#${channelName} (${serverName})`,
      delaySec: deltaSec,
      verifiedAt: new Date().toISOString()
    });
    if (crossCheckStats.recentVerifications.length > 20) {
      crossCheckStats.recentVerifications.pop();
    }
    return; // 抑制重複推播
  }

  // 記錄為該次掉落的第一通報來源
  activeDropEvents.set(eventKey, {
    eggInfo,
    firstDetectedAt: now,
    firstChannelId: message.channel.id,
    firstChannelName: channelName,
    firstGuildName: serverName
  });
  crossCheckStats.totalDropsDetected++;

  console.log(`[發現蛋掉落] 來源: #${channelName} (${serverName}) | 名稱: ${eggInfo.name} | 稀有度: ${eggInfo.rarity} | 地點: ${eggInfo.location}`);

  // 4. 【第一優先：極速發送 TELEGRAM 推播，絕不被外部 API 阻塞】
  let shouldSendTelegram = true;
  if (currentConfig.filterEnabled) {
    const eggClean = (eggInfo.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const allowedList = (Array.isArray(currentConfig.selectedEggs) && currentConfig.selectedEggs.length > 0)
      ? currentConfig.selectedEggs
      : DEFAULT_HIGH_TIER_EGGS;
    const allowedClean = allowedList.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ''));

    // 嚴格依蛋種進行篩選（不再依賴稀有度）
    const isEggAllowed = allowedClean.some(n => n === eggClean || eggClean.includes(n) || n.includes(eggClean));
    if (!isEggAllowed) {
      console.log(`[推播過濾] 蛋種 [${eggInfo.name}] 未在推播勾選清單中，已靜音`);
      shouldSendTelegram = false;
    }
  }

  if (shouldSendTelegram) {
    // 純記憶體精準推算 5 分鐘固定伺服器出蛋時間 (< 0.01ms)
    const cycleMs = 5 * 60 * 1000;
    let nextTimestamp = Math.ceil(now / cycleMs) * cycleMs;
    if (nextTimestamp - now < 3000) nextTimestamp += cycleMs;
    const predictedDate = new Date(nextTimestamp);
    const predictedTimeStr = predictedDate.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    const minutesLeft = Math.max(1, Math.round((nextTimestamp - now) / 60000));

    const fastPrediction = {
      predictedTimeStr,
      minutesLeft
    };

    // 立即觸發發送 Telegram，不 await 任何請求，達到極限速度！
    sendTelegramNotification(eggInfo, combinedText, fastPrediction, {
      channelName,
      server: serverName
    }).catch(err => {
      console.error('[Telegram] 發送失敗:', err.message);
    });
  }

  // 5. 【背景非同步：記錄至 Google Sheet 資料庫】
  // 完全在背景非同步執行，不阻礙推播速度
  recordEggDrop(eggInfo).catch(err => {
    console.error('[Google Sheet] 背景寫入失敗:', err.message);
  });

  // 更新本地記憶體快取與統計
  addEggToMemoryCache(eggInfo);
});

// ==================== REST API 路由 ====================

// 1. 伺服器與小號連線狀態 (支援多頻道監聽與交叉比對)
app.get('/api/status', async (req, res) => {
  let channelDetails = [];
  try {
    if (client.isReady()) {
      for (const chId of MONITORED_CHANNELS) {
        const known = KNOWN_CHANNELS[chId];
        const ch = await client.channels.fetch(chId).catch(() => null);
        let accessible = false;
        if (ch) {
          const perms = ch.permissionsFor ? ch.permissionsFor(client.user) : null;
          accessible = perms ? perms.has(['VIEW_CHANNEL', 'READ_MESSAGE_HISTORY']) : ch.viewable;
        }
        channelDetails.push({
          id: chId,
          name: ch ? ch.name : (known ? known.name : chId),
          server: ch && ch.guild ? ch.guild.name : (known ? known.server : '未知伺服器'),
          accessible
        });
      }
    }
  } catch (_) {}

  const activeChannelNames = channelDetails.filter(c => c.accessible).map(c => `#${c.name}`);

  res.json({
    online: client.isReady(),
    user: client.user ? client.user.tag : null,
    channelCount: MONITORED_CHANNELS.size,
    accessibleCount: channelDetails.filter(c => c.accessible).length,
    channelName: activeChannelNames.join(' & ') || 'egg-notifier',
    monitoredChannels: channelDetails,
    crossCheckStats,
    uptime: Math.round(process.uptime())
  });
});

// 2. 取得 86 顆蛋圖鑑清單
app.get('/api/eggs', (req, res) => {
  res.json(eggsCatalog);
});

// 3. 取得週期預測與統計數據 (純記憶體瞬間響應)
app.get('/api/prediction', (req, res) => {
  if (!cachedStats) {
    cachedStats = computeStatsFromRows(cachedRows);
  }
  const now = Date.now();
  const CYCLE_MS = 5 * 60 * 1000;
  let nextTimestamp = Math.ceil(now / CYCLE_MS) * CYCLE_MS;
  if (nextTimestamp - now < 3000) nextTimestamp += CYCLE_MS;
  const predictedDate = new Date(nextTimestamp);
  const predictedTimeStr = predictedDate.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const minutesLeft = Math.max(1, Math.round((nextTimestamp - now) / 60000));

  res.json({
    ...cachedStats,
    nextTimestamp,
    predictedTimeStr,
    minutesLeft
  });
});

// 4. 取得 Google Sheet 最新掉落歷史 (優先讀取記憶體快取，0ms 響應)
app.get('/api/history', async (req, res) => {
  if (cachedRows.length > 0) {
    const rows = cachedRows.slice(-50).reverse().map(r => {
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

  try {
    const response = await fetch(GOOGLE_SHEET_API_URL);
    const json = await response.json();
    if (json && json.data && json.data.length > 1) {
      cachedRows = json.data.slice(1).filter(r => r[0] && r[0].toString().trim() !== '');
      cachedStats = computeStatsFromRows(cachedRows);
      const rows = cachedRows.slice(-50).reverse().map(r => {
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

      console.log(`[歷史回填] 開始讀取 #${ch.name} 完整歷史訊息...`);
      let lastId = null;
      const allMessages = [];

      for (let b = 0; b < 16; b++) {
        const opts = { limit: 100 };
        if (lastId) opts.before = lastId;
        const batch = await ch.messages.fetch(opts);
        if (!batch || batch.size === 0) break;

        for (const [id, msg] of batch) {
          lastId = id;
          allMessages.push(msg);
        }
        syncStatus.totalFetched = allMessages.length;
        if (batch.size < 100) break;
        await new Promise(r => setTimeout(r, 600));
      }

      const newRowsToSave = [];
      for (const msg of allMessages) {
        const rawContent = msg.content || '';
        const embedTitle = msg.embeds[0]?.title || '';
        const embedDesc = msg.embeds[0]?.description || '';
        const combined = `${rawContent} ${embedTitle} ${embedDesc}`;

        // 忽略 AA
        const isAA = /Admin Abuse|管理員濫用|Admin Spawned|Staff Spawned|\bAA\b/i.test(combined);
        if (isAA) continue;

        const info = extractEggInfo(msg.embeds, rawContent, msg.createdAt);
        const msgTime = new Date(info.timestamp).getTime();

        // 檢查時間戳是否已在試算表中 (容許 3 秒誤差)
        const alreadyExists = Array.from(existingTimestamps).some(t => Math.abs(t - msgTime) < 3000);
        if (!alreadyExists && info.name !== '未知蛋') {
          newRowsToSave.push({
            timestamp: info.timestamp,
            name: info.name,
            rarity: info.rarity,
            rawText: `[${info.location}] ${combined.slice(0, 180)}`
          });
          existingTimestamps.add(msgTime);
        }
      }

      console.log(`[歷史回填] 篩選出 ${newRowsToSave.length} 筆新掉落紀錄，批量上傳至 Sheet...`);

      if (newRowsToSave.length > 0) {
        // 反轉為時間正序寫入
        newRowsToSave.reverse();

        const BATCH_SIZE = 150;
        for (let i = 0; i < newRowsToSave.length; i += BATCH_SIZE) {
          const chunk = newRowsToSave.slice(i, i + BATCH_SIZE);
          await fetch(GOOGLE_SHEET_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'batch_record',
              rows: chunk
            })
          });
          syncStatus.newRecorded += chunk.length;
          await new Promise(r => setTimeout(r, 1000));
        }

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
  await refreshCacheFromSheet();

  // 每 10 分鐘在背景靜態校驗 Google Sheet 快取
  setInterval(refreshCacheFromSheet, 10 * 60 * 1000);
});

// 登入 Discord 小號
client.login(USER_TOKEN).catch(err => {
  console.error('[Discord] 登入失敗:', err.message);
});
