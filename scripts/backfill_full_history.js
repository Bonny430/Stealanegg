const fs = require('fs');
const path = require('path');
const { Client } = require('discord.js-selfbot-v13');

// 自動讀取本地 .env (若存在)
const envPath = path.join(__dirname, '..', '.env');
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

const GOOGLE_SHEET_API_URL = process.env.GOOGLE_SHEET_API_URL || 'https://script.google.com/macros/s/AKfycbxuLJ-ngjNo0JnQi9qmNBveGHW7KnnJRDfKW7WUEDXHmbB2949IWJmle8OiHp15InvB/exec';
const USER_TOKEN = process.env.USER_TOKEN;
const SOURCE_CHANNEL_ID = process.env.SOURCE_CHANNEL_ID || '1533067560134906007';

// 讀取官方 Wiki 蛋圖鑑
const catalogPath = path.join(__dirname, '..', 'data', 'eggs.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

// 建立別名與標準化查詢字典
const wikiMap = new Map();
catalog.forEach(e => {
  const norm = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  wikiMap.set(norm(e.name), e);
  wikiMap.set(norm(e.cleanName), e);
  wikiMap.set(norm(e.petName), e);
});

// 手動補充 Discord 特殊簡寫或專有名詞別名
const ALIASES = {
  'trex': 'T-Rex Egg',
  't-rex': 'T-Rex Egg',
  'snakeking': 'King Snake Egg',
  'elgranmaja': 'El Maja Egg',
  'razorfang': 'RazorFang Egg'
};

function normalizeEgg(rawName, detectedRarity, detectedBiome) {
  if (!rawName) return null;
  const norm = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');

  let matched = wikiMap.get(norm);
  if (!matched && ALIASES[norm]) {
    matched = wikiMap.get(ALIASES[norm].toLowerCase().replace(/[^a-z0-9]/g, ''));
  }

  // 找不到時進行模糊子字串檢索
  if (!matched) {
    for (const [key, egg] of wikiMap.entries()) {
      if (key.length > 3 && (norm.includes(key) || key.includes(norm))) {
        matched = egg;
        break;
      }
    }
  }

  if (matched) {
    return {
      name: matched.cleanName,
      fullName: matched.name,
      rarity: matched.rarity || detectedRarity,
      biome: matched.biome !== 'Unknown' ? matched.biome : detectedBiome,
      imageUrl: matched.imageUrl
    };
  }

  return {
    name: rawName,
    fullName: `${rawName} Egg`,
    rarity: detectedRarity || 'Secret',
    biome: detectedBiome || '未知地點',
    imageUrl: null
  };
}

const client = new Client({ checkUpdate: false });

client.on('ready', async () => {
  console.log(`[Discord] 小號登入成功：${client.user.tag}`);

  try {
    const ch = await client.channels.fetch(SOURCE_CHANNEL_ID);
    console.log(`[Discord] 成功連接頻道：#${ch.name} (${ch.id})`);

    // 1. 抓取頻道所有歷史訊息 (直到頻道起點)
    console.log('[同步] 開始自 Discord 抓取完整歷史訊息...');
    const allDiscordMessages = [];
    let lastId = null;

    while (true) {
      const opts = { limit: 100 };
      if (lastId) opts.before = lastId;

      const batch = await ch.messages.fetch(opts);
      if (!batch || batch.size === 0) break;

      for (const [id, msg] of batch) {
        lastId = id;
        allDiscordMessages.push(msg);
      }

      console.log(`  已獲取 ${allDiscordMessages.length} 則訊息... (最舊時間: ${batch.last().createdAt.toISOString()})`);
      if (batch.size < 100) break;
      await new Promise(r => setTimeout(r, 600));
    }

    console.log(`[Discord] 歷史訊息抓取完畢，總計 ${allDiscordMessages.length} 則！`);

    // 2. 解析每則訊息，過濾 AA 並標準化蛋資料
    const validDrops = [];
    let aaFilteredCount = 0;

    for (const msg of allDiscordMessages) {
      const rawContent = msg.content || '';
      const embedTitle = msg.embeds[0]?.title || '';
      const embedDesc = msg.embeds[0]?.description || '';
      const combined = `${rawContent} ${embedTitle} ${embedDesc}`;

      // 嚴格過濾 AA (管理員濫用)
      const isAA = /Admin Abuse|管理員濫用|Admin Spawned|Staff Spawned|\bAA\b/i.test(combined);
      if (isAA) {
        aaFilteredCount++;
        continue;
      }

      let detectedName = null;
      let detectedRarity = 'Unknown';
      let detectedBiome = '未知地點';

      if (embedTitle) {
        const cleanTitle = embedTitle.replace(/<:[^:]+:\d+>/g, '').trim();
        const rMatch = cleanTitle.match(/(Secret|Divine|Eternal|Cosmic|Mythic|Legendary|Epic|Rare|Uncommon|Common)/i);
        if (rMatch) detectedRarity = rMatch[1];
      }

      if (embedDesc) {
        const eggMatch = embedDesc.match(/\*\*Egg:\*\*\s*([^\n\r]+)/i);
        if (eggMatch) detectedName = eggMatch[1].trim();

        const locMatch = embedDesc.match(/\*\*Location:\*\*\s*([^\n\r]+)/i);
        if (locMatch) detectedBiome = locMatch[1].trim();
      }

      if (!detectedName && rawContent) {
        const m = rawContent.match(/<@&\d+>\s*(.*?)\s+spawned in\s+(.*?)!/i);
        if (m) {
          detectedName = m[1].trim();
          detectedBiome = m[2].trim();
        }
      }

      if (detectedName && detectedName !== 'Unknown') {
        const normalized = normalizeEgg(detectedName, detectedRarity, detectedBiome);
        validDrops.push({
          timestamp: new Date(msg.createdAt).toISOString(),
          timeMs: new Date(msg.createdAt).getTime(),
          name: normalized.name,
          rarity: normalized.rarity,
          location: normalized.biome,
          rawText: `[${normalized.biome}] ${combined.slice(0, 180)}`
        });
      }
    }

    console.log(`[資料整理] 篩選出 ${validDrops.length} 筆有效掉落，過濾 AA 訊息 ${aaFilteredCount} 則`);

    // 3. 讀取 Google Sheet 既有資料庫，以時間戳去重
    console.log('[Google Sheet] 正在比對試算表既有紀錄...');
    const sheetRes = await fetch(GOOGLE_SHEET_API_URL);
    const sheetJson = await sheetRes.json();
    const existingRows = sheetJson.data || [];
    const existingTimes = new Set(
      existingRows.slice(1)
        .map(r => new Date(r[0]).getTime())
        .filter(t => !isNaN(t))
    );

    console.log(`[Google Sheet] 既有紀錄共 ${existingTimes.size} 筆`);

    // 找出所有尚未寫入 Sheet 的掉落
    const newDropsToInsert = validDrops.filter(drop => {
      // 容許 3 秒誤差
      const exists = Array.from(existingTimes).some(t => Math.abs(t - drop.timeMs) < 3000);
      return !exists;
    });

    console.log(`[Google Sheet] 比對完畢，共有 ${newDropsToInsert.length} 筆全新紀錄需要回填匯入！`);

    if (newDropsToInsert.length === 0) {
      console.log('🎉 試算表已是最新完整資料，無需額外回填！');
      process.exit(0);
    }

    // 依時間正序排列（從最早掉落至最新掉落依序追加）
    newDropsToInsert.sort((a, b) => a.timeMs - b.timeMs);

    // 分批次匯入 Google Sheet (每批 150 筆)
    const BATCH_SIZE = 150;
    let insertedTotal = 0;

    for (let i = 0; i < newDropsToInsert.length; i += BATCH_SIZE) {
      const chunk = newDropsToInsert.slice(i, i + BATCH_SIZE);
      const batchPayload = {
        action: 'batch_record',
        rows: chunk.map(d => ({
          timestamp: d.timestamp,
          name: d.name,
          rarity: d.rarity,
          rawText: d.rawText
        }))
      };

      console.log(`  [上傳] 正在寫入第 ${i + 1} ~ ${i + chunk.length} 筆...`);
      const uploadRes = await fetch(GOOGLE_SHEET_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchPayload)
      });
      const uploadResult = await uploadRes.json();
      insertedTotal += chunk.length;
      console.log(`  [成功] 寫入回傳:`, uploadResult);

      // 避免 Apps Script API rate limit，批次間暫停 1 秒
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n==============================================`);
    console.log(`🎉 歷史資料回填圓滿完成！`);
    console.log(`總計新匯入: ${insertedTotal} 筆資料`);
    console.log(`目前資料庫總量預計: ${existingTimes.size + insertedTotal} 筆有效掉落紀錄`);
    console.log(`==============================================\n`);

  } catch (err) {
    console.error('[異常錯誤]:', err);
  } finally {
    process.exit(0);
  }
});

client.login(USER_TOKEN);
