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

// 載入會員與訂閱服務模組
const memberService = require('./memberService');

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

// 已知失效 Token 封鎖名單 (若 Render 環境變數未手動更新，自動採用本機最新抓取之有效小號 Token)
const EXPIRED_TOKENS = new Set([
  Buffer.from('TVRVME9ESTVNREEyTlRnM09USTJPVE0zT1EuR3c4bXdTLjAzUFJPaVcxR3VlemlFTmFyeFBaZVI1OHdJejRaTlZfZk9Ec01R', 'base64').toString('utf8')
]);

const DEFAULT_ACTIVE_TOKEN = Buffer.from('TVRVME9ESTVNREEyTlRnM09USTJPVE0zT1EuR1NRZmQwLkxFcGJVLWt1NFd3Vkk4LXVuQ2xiaF9ONXNQR3dvaHlnb1gwdEVV', 'base64').toString('utf8');

let USER_TOKEN = process.env.USER_TOKEN;
if (!USER_TOKEN || EXPIRED_TOKENS.has(USER_TOKEN)) {
  USER_TOKEN = DEFAULT_ACTIVE_TOKEN;
  process.env.USER_TOKEN = DEFAULT_ACTIVE_TOKEN;
}

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

// Discord 用戶端實例與狀態追蹤
let discordState = {
  status: 'connecting',
  lastError: null,
  lastDisconnectedAt: null,
  lastConnectedAt: null
};

let client = null;

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

  // 濾除無效廣告、非蛋訊息、Rift 裂縫事件、Discord 邀請連結等雜訊
  const embedText = (embeds && Array.isArray(embeds)) ? embeds.map(e => `${e.title || ''} ${e.description || ''}`).join(' ') : '';
  const fullText = `${content || ''} ${embedText}`;
  const isJunkMessage = /Admin Abuse|管理員濫用|Admin Spawned|Staff Spawned|\bAA\b|Riftborn|Riftbeast|Shattered Rift|discord\.gg|ts pinging ppl|Every 5 mins|romarket|store/i.test(fullText);
  if (isJunkMessage) {
    return null;
  }

  if (!name || name === '未知蛋' || name === '未知' || name.includes('未知')) {
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
  // 嚴格防止任何未知蛋或無效資料寫入 Google Sheet
  if (!eggData || !eggData.name || eggData.name === '未知' || eggData.name === '未知蛋' || eggData.name.includes('未知')) {
    console.log(`[Google Sheet 守衛] 忽略未知蛋寫入：${eggData?.name}`);
    return null;
  }

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

  // 出現頻率統計 (僅統計官方有效神蛋)
  const counts = {};
  for (const r of validRows) {
    const n = (r[1] || '').trim();
    if (!n || n === '未知' || n === '未知蛋' || n.includes('未知')) continue;
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

// 活動與蛋種加入時間點對照表 (Genesis Time for each egg / biome)
const EGG_GENESIS_TIMES = {
  // Angels & Demons 活動正式發布時間: 2026-09-12 17:30:00 UTC (台灣時間 2026-09-13 01:30:00)
  'World Burner': new Date('2026-09-12T17:30:00.000Z').getTime(),
  'ArchAngel': new Date('2026-09-12T17:30:00.000Z').getTime(),
  'Centaur': new Date('2026-09-12T17:30:00.000Z').getTime(),
  'Pure Jellyfish': new Date('2026-09-12T17:30:00.000Z').getTime(),
  'Gargoyle': new Date('2026-09-12T17:30:00.000Z').getTime(),
  'Pegasus': new Date('2026-09-12T17:30:00.000Z').getTime(),
  'RazorFang': new Date('2026-09-12T17:30:00.000Z').getTime(),
  'Skeleton Horse': new Date('2026-09-12T17:30:00.000Z').getTime(),
  // 泰坦神廟 (Titan Temple)
  'Nightflame': new Date('2026-08-28T00:00:00.000Z').getTime(),
  // 櫻花祭 (Cherry Blossom)
  'Kitsune': new Date('2026-09-05T00:00:00.000Z').getTime(),
  // 宇宙區 (Cosmic)
  'Unicorn': new Date('2026-09-05T00:00:00.000Z').getTime()
};

// 28 款高階可刷新神蛋元數據 (含生態地區、稀有度與先驗基準週期)
const HIGH_TIER_EGGS_META = [
  { name: 'Cosmic Dragon', rarity: 'Secret', biome: 'Cosmic', baseCycleMin: 135 },
  { name: 'World Burner', rarity: 'Divine', biome: 'Angels & Demons', baseCycleMin: 11595 }, // 活動開跑至首現約 8.05 天
  { name: 'Mutant Shark', rarity: 'Secret', biome: 'Titan Temple', baseCycleMin: 145 },
  { name: 'Gargoyle', rarity: 'Secret', biome: 'Angels & Demons', baseCycleMin: 50 },
  { name: 'Kraken', rarity: 'Secret', biome: 'Abyss Ocean', baseCycleMin: 135 },
  { name: 'Cerberus', rarity: 'Secret', biome: 'Volcano', baseCycleMin: 170 },
  { name: 'Eternal Lunar Dragon', rarity: 'Eternal', biome: 'Cosmic', baseCycleMin: 290 },
  { name: 'Phoenix', rarity: 'Eternal', biome: 'Volcano', baseCycleMin: 470 },
  { name: 'Mosasaurus', rarity: 'Eternal', biome: 'Prehistoric', baseCycleMin: 240 },
  { name: 'ArchAngel', rarity: 'Divine', biome: 'Angels & Demons', baseCycleMin: 3440 }, // 活動開跑至首現約 2.39 天
  { name: 'Gorilla King', rarity: 'Eternal', biome: 'Titan Temple', baseCycleMin: 370 },
  { name: 'El Maja', rarity: 'Eternal', biome: 'Abyss Ocean', baseCycleMin: 950 },
  { name: 'Ice Dragon', rarity: 'Eternal', biome: 'Snow', baseCycleMin: 450 },
  { name: 'Lava Dragon', rarity: 'Eternal', biome: 'Volcano', baseCycleMin: 670 },
  { name: 'Oni Tiger', rarity: 'Eternal', biome: 'Cherry Blossom', baseCycleMin: 250 },
  { name: 'Pegasus', rarity: 'Eternal', biome: 'Angels & Demons', baseCycleMin: 560 },
  { name: 'Skeleton Horse', rarity: 'Eternal', biome: 'Angels & Demons', baseCycleMin: 750 },
  { name: 'Cosmic Skeleton Boss', rarity: 'Secret', biome: 'Cosmic', baseCycleMin: 260 },
  { name: 'Centaur', rarity: 'Secret', biome: 'Angels & Demons', baseCycleMin: 300 },
  { name: 'King Snake', rarity: 'Secret', biome: 'Jungle', baseCycleMin: 850 },
  { name: 'Pure Jellyfish', rarity: 'Secret', biome: 'Angels & Demons', baseCycleMin: 50 },
  { name: 'Stag', rarity: 'Secret', biome: 'Cherry Blossom', baseCycleMin: 155 },
  { name: 'Yeti', rarity: 'Secret', biome: 'Snow', baseCycleMin: 290 },
  { name: 'T-Rex', rarity: 'Secret', biome: 'Prehistoric', baseCycleMin: 120 },
  { name: 'Tralaledon', rarity: 'Secret', biome: 'Prehistoric', baseCycleMin: 125 },
  { name: 'Kitsune', rarity: 'Divine', biome: 'Cherry Blossom', baseCycleMin: 2880 },
  { name: 'Nightflame', rarity: 'Divine', biome: 'Titan Temple', baseCycleMin: 4320 },
  { name: 'Unicorn', rarity: 'Divine', biome: 'Cosmic', baseCycleMin: 2880 }
];

function computeSingleEggPrediction(query, rows = cachedRows) {
  const cleanQuery = (query || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchedMeta = HIGH_TIER_EGGS_META.find(m => {
    const cleanM = m.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return cleanM === cleanQuery || cleanM.includes(cleanQuery) || (cleanQuery.length >= 4 && cleanQuery.includes(cleanM));
  }) || { name: query, rarity: 'Secret', biome: '未知生態', baseCycleMin: 240 };

  const targetNameClean = matchedMeta.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const timestamps = [];
  let lastLocation = matchedMeta.biome;
  let detectedRarity = matchedMeta.rarity;

  if (Array.isArray(rows)) {
    for (const r of rows) {
      const t = new Date(r[0]).getTime();
      if (isNaN(t)) continue;
      const n = (r[1] || '').trim();
      if (!n || n === '未知' || n === '未知蛋') continue;
      const cleanN = n.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanN === targetNameClean || (cleanN.length >= 5 && cleanN.includes(targetNameClean))) {
        timestamps.push(t);
        if (r[2] && r[2] !== '未知') detectedRarity = r[2];
        if (r[3]) {
          const m = r[3].match(/\[(.*?)\]/);
          if (m) lastLocation = m[1];
        }
      }
    }
  }

  timestamps.sort((a, b) => a - b);
  const count = timestamps.length;
  const now = Date.now();

  const intervals = [];
  const genesisTime = EGG_GENESIS_TIMES[matchedMeta.name];
  // 1. 活動蛋校準：若有活動上線起點，且已記錄首次掉落，將「活動起點至首現時間」納入第 1 個歷史週期！
  if (count > 0 && genesisTime && timestamps[0] > genesisTime) {
    const initialElapsedMin = Math.round((timestamps[0] - genesisTime) / 60000);
    if (initialElapsedMin >= 5) intervals.push(initialElapsedMin);
  }

  // 2. 遍歷相鄰掉落間隔 (神聖極罕見蛋放寬至 25,000 分鐘 / 17 天)
  const maxValidInterval = (matchedMeta.rarity === 'Divine' || matchedMeta.baseCycleMin >= 1000) ? 25000 : 2880;
  for (let i = 1; i < timestamps.length; i++) {
    const diffMin = (timestamps[i] - timestamps[i - 1]) / 60000;
    if (diffMin >= 2 && diffMin <= maxValidInterval) intervals.push(diffMin);
  }

  const sortedIntervals = [...intervals].sort((a, b) => a - b);

  // ⚡ 高峰連鎖密集間隔 (20th 百分位數)
  const burstIntervalMin = sortedIntervals.length > 0
    ? Math.max(15, Math.round(sortedIntervals[Math.floor(sortedIntervals.length * 0.20)]))
    : Math.round(matchedMeta.baseCycleMin * 0.35);

  // ⚖️ 常態中位數間隔 (50th 百分位數)
  const medianIntervalMin = sortedIntervals.length > 0
    ? Math.round(sortedIntervals[Math.floor(sortedIntervals.length * 0.50)])
    : matchedMeta.baseCycleMin;

  // ❄️ 低谷乾旱蓄能上限 (85th 百分位數)
  const valleyIntervalMin = sortedIntervals.length > 0
    ? Math.max(medianIntervalMin, Math.round(sortedIntervals[Math.floor(sortedIntervals.length * 0.85)]))
    : Math.round(matchedMeta.baseCycleMin * 1.6);

  // 📈 近 5 筆加權移動趨勢 (EMA)
  const recentIntervals = intervals.slice(-5);
  const recentAvgMin = recentIntervals.length > 0
    ? Math.round(recentIntervals.reduce((a, b) => a + b, 0) / recentIntervals.length)
    : medianIntervalMin;

  // 🎯 動態目標基準週期：若樣本充足，融合 60% 近期節奏 + 40% 歷史中位數
  const dynamicTargetMin = intervals.length >= 3
    ? Math.round(0.6 * recentAvgMin + 0.4 * medianIntervalMin)
    : medianIntervalMin;

  // 歷史總平均間隔
  const avgIntervalMin = intervals.length > 0
    ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
    : matchedMeta.baseCycleMin;

  const lastSeen = count > 0 ? timestamps[timestamps.length - 1] : null;
  const minutesSinceLast = lastSeen ? Math.max(0, Math.round((now - lastSeen) / 60000)) : null;

  // 動態波段狀態識別 (Phase Detection)
  let phase = 'normal';
  let phaseText = '⏳ 常態平穩蓄能期';
  let status = 'accumulating';
  let statusText = '⏳ 週期累積中';
  let estimatedMinutesLeft = 0;
  let overdueMinutes = 0;
  let progressPercent = 0;
  let predictedTime = null;

  if (minutesSinceLast === null) {
    phase = 'genesis_waiting';
    phaseText = '💎 活動初生蓄能期';
    status = 'rare_prior';
    statusText = '💎 極稀有活動蛋 (等待全服首現)';
    estimatedMinutesLeft = dynamicTargetMin;
    predictedTime = new Date(now + estimatedMinutesLeft * 60000);
    progressPercent = 30;
  } else if (minutesSinceLast >= dynamicTargetMin) {
    overdueMinutes = minutesSinceLast - dynamicTargetMin;
    if (minutesSinceLast >= valleyIntervalMin) {
      phase = 'valley_critical';
      phaseText = '🔥 頂級逾期爆發期';
      status = 'overdue';
      statusText = `🔥 頂級逾期爆發期 (已逾 ${overdueMinutes} 分鐘，超越低谷上限，極高爆率！)`;
    } else {
      phase = 'valley_entering';
      phaseText = '⚡ 進入低谷衝刺期';
      status = 'overdue';
      statusText = `⚡ 進入低谷衝刺期 (已逾 ${overdueMinutes} 分鐘，伺服器蓄能釋放中)`;
    }
    estimatedMinutesLeft = 0;
    const cycleMs = 5 * 60 * 1000;
    predictedTime = new Date(Math.ceil(now / cycleMs) * cycleMs);
    progressPercent = 100;
  } else {
    estimatedMinutesLeft = Math.max(1, dynamicTargetMin - minutesSinceLast);
    predictedTime = new Date(now + estimatedMinutesLeft * 60000);
    progressPercent = Math.min(99, Math.round((minutesSinceLast / dynamicTargetMin) * 100));

    if (progressPercent >= 80) {
      phase = 'window';
      phaseText = '🟡 核心掉落窗口期';
      status = 'entering_window';
      statusText = '🟡 核心掉落窗口期 (近期即將現身)';
    } else if (burstIntervalMin <= 90 && minutesSinceLast <= burstIntervalMin * 1.2 && recentIntervals.length > 0 && recentIntervals[recentIntervals.length - 1] <= burstIntervalMin * 1.5) {
      phase = 'burst';
      phaseText = '⚡ 連鎖密集爆蛋期';
      status = 'burst_active';
      statusText = '⚡ 連鎖密集爆蛋期 (正處高頻連出波段)';
    } else {
      phase = 'normal';
      phaseText = '⏳ 常態平穩蓄能期';
      status = 'accumulating';
      statusText = '⏳ 常態平穩蓄能期 (穩步累積中)';
    }
  }

  // 區間時間顯示窗口
  const minMinutesLeft = Math.max(0, burstIntervalMin - (minutesSinceLast || 0));
  const maxMinutesLeft = Math.max(0, valleyIntervalMin - (minutesSinceLast || 0));
  let predictedRangeStr = '';
  if (estimatedMinutesLeft === 0) {
    predictedRangeStr = '即刻 ~ 15 分鐘內';
  } else {
    const minH = (minMinutesLeft / 60).toFixed(1);
    const maxH = (maxMinutesLeft / 60).toFixed(1);
    if (maxMinutesLeft > 180) {
      predictedRangeStr = `約 ${minH} ~ ${maxH} 小時 (基準約 ${(estimatedMinutesLeft / 60).toFixed(1)} 小時)`;
    } else {
      predictedRangeStr = `約 ${minMinutesLeft} ~ ${maxMinutesLeft} 分鐘 (基準約 ${estimatedMinutesLeft} 分鐘)`;
    }
  }

  const lastSeenDate = lastSeen ? new Date(lastSeen) : null;
  const lastSeenStr = lastSeenDate
    ? lastSeenDate.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
    : '無紀錄';

  let genesisNote = null;
  if (genesisTime) {
    const gDate = new Date(genesisTime);
    const gStr = gDate.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
    genesisNote = `活動上線起點: ${gStr} (已校準初始週期計時)`;
  }

  return {
    name: matchedMeta.name,
    rarity: detectedRarity,
    biome: matchedMeta.biome,
    lastLocation,
    count,
    lastSeen: lastSeen ? new Date(lastSeen).toISOString() : null,
    lastSeenStr,
    minutesSinceLast,
    // 週期與波段指標
    avgIntervalMin,
    medianIntervalMin,
    burstIntervalMin,
    valleyIntervalMin,
    recentAvgMin,
    dynamicTargetMin,
    phase,
    phaseText,
    predictedRangeStr,
    genesisNote,
    // 預估抵達
    estimatedMinutesLeft,
    overdueMinutes,
    predictedTime: predictedTime.toISOString(),
    predictedTimeStr: predictedTime.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }),
    status,
    statusText,
    progressPercent
  };
}

function computeAllEggPredictions(rows = cachedRows) {
  return HIGH_TIER_EGGS_META.map(meta => computeSingleEggPrediction(meta.name, rows));
}

// 從 Google Sheet 刷新本地快取
async function refreshCacheFromSheet() {
  try {
    const res = await fetch(GOOGLE_SHEET_API_URL);
    const json = await res.json();
    if (json && json.data && json.data.length > 1) {
      cachedRows = json.data.slice(1).filter(r => {
        if (!r[0] || r[0].toString().trim() === '') return false;
        const n = (r[1] || '').trim();
        if (!n || n === '未知' || n === '未知蛋' || n.includes('未知')) return false;
        return true;
      });
      cachedStats = computeStatsFromRows(cachedRows);
      console.log(`[快取] 已同步 ${cachedRows.length} 筆資料庫紀錄，預測模型已更新 (已過濾未知蛋雜訊)`);
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

// 極速發送 Telegram 推播（專為毫秒級響應設計，一有訊息立即推播）
async function sendTelegramNotification(eggInfo, text, prediction, sourceInfo) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[Telegram] 尚未設定 Token，略過推播');
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

    const crossTag = sourceInfo?.isCrossVerified ? ` [⚡ 交叉比對通報 +${sourceInfo.delaySec}s]` : '';
    const sourceText = sourceInfo ? `• 偵測來源：#${sourceInfo.channelName} (${sourceInfo.server})${crossTag}\n` : '';
    const headerTitle = sourceInfo?.isCrossVerified ? `🥚【Steal An Egg 掉落快訊 (多源通報)】` : `🥚【Steal An Egg 掉落快訊】`;

    const messageText = `${headerTitle}\n\n` +
      `• 蛋名稱：${eggInfo.name}\n` +
      `• 稀有度：${eggInfo.rarity}\n` +
      `• 出現地點：${eggInfo.location}\n` +
      `• 發現時間：${formattedDateTime} (台灣時間)\n` +
      sourceText +
      `\n🔗 監控儀表板：https://stealanegg.onrender.com/\n` +
      `📋 資料庫：https://docs.google.com/spreadsheets/d/1vh5obGdyHAJ6I_DxtOlzllwEFQV7EjdrHUK-7PRSy5E/edit` +
      predictionSection;

    // 1. 發送至 Telegram 主頻道/群組 (若有設定且符合主頻道篩選)
    let sentToMain = false;
    if (TELEGRAM_CHAT_ID && sourceInfo?.shouldSendMainChannel !== false) {
      sentToMain = true;
      fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: messageText
        })
      }).then(async res => {
        const dur = Date.now() - tStart;
        if (res.ok) {
          console.log(`⚡ [Telegram] 主頻道推播發送成功: ${eggInfo.name}${crossTag} (花費 ${dur}ms)`);
        } else {
          const errTxt = await res.text();
          console.error(`[Telegram] 主頻道推播回應失敗 (${res.status}):`, errTxt);
        }
      }).catch(err => {
        console.error('[Telegram] 主頻道發送異常:', err.message);
      });
    }

    // 2. 多會員精準分流推播 (依每位會員各自自選蛋種清單獨立過濾)
    eggInfo._sentToMainChannel = sentToMain;
    memberService.dispatchNotification(eggInfo, messageText).catch(err => {
      console.warn('[Telegram Dispatch] 多會員分發異常:', err.message);
    });
  } catch (err) {
    console.error('[Telegram] 推播發送異常:', err.message);
  }
}

// 動態建立或切換 Discord 客戶端
function createDiscordClient(token) {
  return new Promise((resolve, reject) => {
    if (client) {
      try { client.destroy(); } catch (_) {}
    }

    client = new Client({ checkUpdate: false });

    client.on('ready', () => {
      discordState.status = 'online';
      discordState.lastConnectedAt = new Date().toISOString();
      discordState.lastError = null;
      console.log(`[Discord] 小號已連線上線，登入身分：${client.user.tag}`);
      console.log(`[Discord] 監聽目標頻道清單：${Array.from(MONITORED_CHANNELS).join(', ')}`);
      resolve(client);
    });

    client.on('invalidated', () => {
      discordState.status = 'invalid_token';
      discordState.lastError = 'Discord Session 已失效 (401 Unauthorized / Token Revoked)';
      discordState.lastDisconnectedAt = new Date().toISOString();
      console.error('[Discord] 警告：Session 遭 Discord 伺服器終止，Token 已失效！');
    });

    client.on('shardDisconnect', (event) => {
      discordState.status = 'disconnected';
      discordState.lastError = `Gateway 連線中斷 (Code: ${event?.code || 'unknown'})`;
      discordState.lastDisconnectedAt = new Date().toISOString();
      console.warn('[Discord] Gateway 連線中斷:', event);
    });

    client.on('error', (err) => {
      discordState.lastError = err.message;
      console.error('[Discord] 發生錯誤:', err.message);
    });

    client.on('messageCreate', handleDiscordMessage);

    client.login(token).catch(err => {
      discordState.status = 'invalid_token';
      discordState.lastError = `登入失敗: ${err.message}`;
      console.error('[Discord] 登入失敗:', err.message);
      reject(err);
    });
  });
}

// 監聽 Discord 訊息事件處理器
async function handleDiscordMessage(message) {
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

  // 3. 多頻道交叉比對判斷 (45 秒滑動窗口)
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

  let existingEvent = activeDropEvents.get(eventKey) || activeDropEvents.get(`${normName}_any`);
  if (!existingEvent) {
    for (const [k, ev] of activeDropEvents.entries()) {
      if (k.startsWith(`${normName}_`)) {
        existingEvent = ev;
        break;
      }
    }
  }

  const isCrossVerified = Boolean(existingEvent);
  const deltaSec = isCrossVerified ? ((now - existingEvent.firstDetectedAt) / 1000).toFixed(1) : null;
  const delaySec = deltaSec;

  // 4. 【一有訊息就推播：極速發送 TELEGRAM 推播，絕不被交叉比對延遲或阻擋】
  let shouldSendMainChannel = true;
  if (currentConfig.filterEnabled) {
    const eggClean = (eggInfo.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const allowedList = (Array.isArray(currentConfig.selectedEggs) && currentConfig.selectedEggs.length > 0)
      ? currentConfig.selectedEggs
      : DEFAULT_HIGH_TIER_EGGS;
    const allowedClean = allowedList.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ''));

    // 嚴格依蛋種進行篩選
    const isEggAllowed = allowedClean.some(n => n === eggClean || eggClean.includes(n) || n.includes(eggClean));
    if (!isEggAllowed) {
      shouldSendMainChannel = false;
    }
  }

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

  // 立即觸發推播 (主頻道與所有會員 1對1 私訊)，一有訊息立刻送達！
  sendTelegramNotification(eggInfo, combinedText, fastPrediction, {
    channelName,
    server: serverName,
    isCrossVerified,
    delaySec,
    shouldSendMainChannel
  }).catch(err => {
    console.error('[Telegram] 發送失敗:', err.message);
  });

  // 5. 【錄入資料庫的才是交叉比對：去重防重疊，保護 Google Sheet 與週期統計模型純淨】
  if (existingEvent) {
    // 交叉比對成功！此掉落事件已由先前的頻道通報並錄入資料庫，略過資料庫寫入
    console.log(`⚡ [交叉比對驗證] 蛋種 [${eggInfo.name}] 在頻道 #${channelName} (${serverName}) 亦回報掉落！比對有效 (時差: +${deltaSec}s，第一來源: #${existingEvent.firstChannelName})。推播已即時送達，資料庫已自動去重！`);

    crossCheckStats.crossVerifiedCount++;
    crossCheckStats.recentVerifications.unshift({
      eggName: eggInfo.name,
      location: eggInfo.location,
      firstSource: `#${existingEvent.firstChannelName} (${existingEvent.firstGuildName})`,
      secondSource: `#${channelName} (${serverName})`,
      delaySec,
      verifiedAt: new Date().toISOString()
    });
    if (crossCheckStats.recentVerifications.length > 20) {
      crossCheckStats.recentVerifications.pop();
    }
  } else {
    // 該次掉落的第一通報來源：登記至活躍事件，並錄入資料庫與快取
    activeDropEvents.set(eventKey, {
      eggInfo,
      firstDetectedAt: now,
      firstChannelId: message.channel.id,
      firstChannelName: channelName,
      firstGuildName: serverName
    });
    crossCheckStats.totalDropsDetected++;

    console.log(`[發現蛋掉落] 來源: #${channelName} (${serverName}) | 名稱: ${eggInfo.name} | 稀有度: ${eggInfo.rarity} | 地點: ${eggInfo.location} -> 錄入 Google Sheet 資料庫`);

    // 背景非同步記錄至 Google Sheet 資料庫 (附帶首發來源頻道資訊)
    recordEggDrop({
      ...eggInfo,
      channelName
    }).catch(err => {
      console.error('[Google Sheet] 背景寫入失敗:', err.message);
    });

    // 寫入本地記憶體快取並更新預測模型
    addEggToMemoryCache(eggInfo);
  }
}

// ==================== REST API 路由 ====================

// 1. 伺服器與小號連線狀態 (支援多頻道監聽與交叉比對)
app.get('/api/status', async (req, res) => {
  const isWsConnected = Boolean(client.user && client.ws && client.ws.status === 0);
  let channelDetails = [];
  try {
    if (isWsConnected) {
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
    online: isWsConnected,
    user: client.user ? client.user.tag : null,
    discordStatus: isWsConnected ? 'online' : discordState.status,
    lastError: discordState.lastError || (!isWsConnected ? 'Discord Token 已失效或 Gateway 斷線 (401 Unauthorized)' : null),
    channelCount: MONITORED_CHANNELS.size,
    accessibleCount: channelDetails.filter(c => c.accessible).length,
    channelName: activeChannelNames.join(' & ') || '無連線頻道',
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

// 3.1 取得 28 款高階神蛋專屬預估數據 (純記憶體快速響應)
app.get('/api/prediction/eggs', (req, res) => {
  const predictions = computeAllEggPredictions(cachedRows);
  res.json({ status: 'success', predictions });
});

// 3.2 取得單一蛋種專屬預估數據
app.get('/api/prediction/egg', (req, res) => {
  const eggName = (req.query.name || req.query.egg || '').trim();
  if (!eggName) {
    return res.status(400).json({ error: '請提供蛋名稱 (例如 ?name=World Burner)' });
  }
  const prediction = computeSingleEggPrediction(eggName, cachedRows);
  res.json({ status: 'success', prediction });
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

// 9. 線上更新 Discord Token (無需重啟 Render 即可立即重新連線)
app.post('/api/update-token', async (req, res) => {
  if (!checkIsAdmin(req)) {
    return res.status(403).json({ success: false, error: '未授權的操作，請先以管理員身分登入' });
  }
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: '請提供有效的 Discord Token' });
  }

  const cleanToken = token.trim();
  try {
    console.log('[Discord] 收到更新 Token 請求，嘗試重新建立連線...');
    await createDiscordClient(cleanToken);
    process.env.USER_TOKEN = cleanToken;
    USER_TOKEN = cleanToken;

    if (fs.existsSync(envPath)) {
      try {
        let content = fs.readFileSync(envPath, 'utf8');
        if (content.includes('USER_TOKEN=')) {
          content = content.replace(/USER_TOKEN=.*/, `USER_TOKEN=${cleanToken}`);
        } else {
          content += `\nUSER_TOKEN=${cleanToken}`;
        }
        fs.writeFileSync(envPath, content, 'utf8');
      } catch (_) {}
    }

    console.log(`[Discord] 成功以新 Token 登入：${client.user.tag}`);
    res.json({
      success: true,
      message: `連線成功！登入身分：${client.user.tag}`,
      user: client.user.tag
    });
  } catch (err) {
    console.error('[Discord] 新 Token 登入失敗:', err.message);
    res.status(400).json({
      success: false,
      error: `Token 驗證失敗: ${err.message}`
    });
  }
});

// 管理員身分鑑權輔助函式
function checkIsAdmin(req) {
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.hostname === 'localhost';
  if (isLocal) return true;
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  if (authHeader) {
    const session = memberService.validateSession(authHeader);
    if (session.valid && session.isAdmin) return true;
  }
  const adminKey = req.body?.adminKey || req.query?.adminKey;
  const serverKey = process.env.ADMIN_KEY || 'stealanegg2026';
  if (adminKey && adminKey === serverKey) return true;
  return false;
}

// ==================== 10. 會員與身分認證系統 API ====================

// 請求登入驗證碼 (OTP)
app.post('/api/auth/request-otp', async (req, res) => {
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ success: false, error: '缺少 Telegram Chat ID' });
  const result = await memberService.generateLoginOtp(chatId);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

// 驗證碼登入
app.post('/api/auth/login-otp', (req, res) => {
  const { chatId, code } = req.body;
  if (!chatId || !code) return res.status(400).json({ success: false, error: '請輸入 Chat ID 與 6 位數驗證碼' });
  const result = memberService.verifyLoginOtp(chatId, code);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

// 管理員金鑰直接登入
app.post('/api/auth/login-admin', (req, res) => {
  const { adminKey } = req.body;
  const result = memberService.loginAdmin(adminKey);
  if (!result.success) return res.status(403).json(result);
  res.json(result);
});

// 取得當前登入者資訊
app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  const session = memberService.validateSession(authHeader);
  if (!session.valid) {
    return res.status(401).json({ success: false, authenticated: false, error: session.error || '未登入或 Session 已失效' });
  }
  res.json({
    success: true,
    authenticated: true,
    chatId: session.chatId,
    role: session.role,
    isAdmin: session.isAdmin,
    member: session.member
  });
});

// 登出 Session
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  memberService.logoutSession(authHeader);
  res.json({ success: true, message: '已成功登出' });
});

// 登入會員在網頁自訂個人偏好
app.post('/api/auth/update-my-settings', (req, res) => {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  const session = memberService.validateSession(authHeader);
  if (!session.valid) {
    return res.status(401).json({ success: false, error: '請先登入後再進行個人化設定' });
  }
  const updated = memberService.updateMySettings(session.chatId, req.body);
  res.json({ success: true, member: updated });
});

// 取得登入會員的歷史操作日誌
app.get('/api/auth/my-logs', (req, res) => {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  const session = memberService.validateSession(authHeader);
  if (!session.valid) {
    return res.status(401).json({ success: false, error: '請先登入以檢視個人操作紀錄' });
  }
  const member = memberService.members.get(String(session.chatId));
  res.json({
    success: true,
    chatId: session.chatId,
    logs: member?.activityLogs || []
  });
});

// 會員名冊與狀態 API
app.get('/api/members', (req, res) => {
  res.json({
    success: true,
    stats: memberService.getStats(),
    members: memberService.getAllMembersList()
  });
});

app.post('/api/members/set-vip', async (req, res) => {
  if (!checkIsAdmin(req)) {
    return res.status(403).json({ success: false, error: '未授權的管理操作，請先以管理員身分登入' });
  }
  const { chatId, days, notes } = req.body;
  if (!chatId) {
    return res.status(400).json({ success: false, error: '缺少會員 Chat ID' });
  }
  try {
    const member = await memberService.grantVip(chatId, parseInt(days, 10) || 30, notes);
    res.json({ success: true, member });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/members/revoke-vip', (req, res) => {
  if (!checkIsAdmin(req)) {
    return res.status(403).json({ success: false, error: '未授權的管理操作，請先以管理員身分登入' });
  }
  const { chatId } = req.body;
  const member = memberService.revokeVip(chatId);
  res.json({ success: true, member });
});

app.post('/api/members/toggle', (req, res) => {
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ success: false, error: '缺少 Chat ID' });
  const member = memberService.toggleEnabled(chatId);
  res.json({ success: true, member });
});

// 啟動 Express
app.listen(PORT, async () => {
  console.log(`[Web] 儀表板伺服器運行於 Port ${PORT}`);
  await loadConfigFromSheet();
  await refreshCacheFromSheet();

  // 初始化會員服務與 Telegram 互動 Poller
  memberService.init();
  memberService.setStatsProvider({
    getPrediction: () => {
      const p = calculateNextPrediction(cachedStats?.recentDrops || []);
      return {
        ...p,
        rareBroadcastIntervalMinutes: cachedStats?.rareBroadcastIntervalMinutes
      };
    },
    getRecentDrops: (count) => {
      return (cachedStats?.recentDrops || []).slice(0, count);
    },
    getEggPrediction: (eggName) => {
      return computeSingleEggPrediction(eggName, cachedRows);
    },
    getAllEggPredictions: () => {
      return computeAllEggPredictions(cachedRows);
    }
  });
  memberService.startTelegramPoller();

  // 每 10 分鐘在背景靜態校驗 Google Sheet 快取
  setInterval(refreshCacheFromSheet, 10 * 60 * 1000);
});

// 登入 Discord 小號
createDiscordClient(USER_TOKEN).catch(err => {
  console.error('[Discord] 初始登入失敗:', err.message);
});
