const https = require('https');
const fs = require('fs');
const path = require('path');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StealAnEggNotifier/2.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function parseDetailTemplate(wikitext) {
  if (!wikitext) return null;
  const detailMatch = wikitext.match(/\{\{Detail([\s\S]*?)\}\}/i);
  if (detailMatch) {
    const content = detailMatch[1];
    const fields = {};
    const lines = content.split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*\|([a-zA-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) fields[m[1].trim()] = m[2].trim();
    }
    return fields;
  }
  return null;
}

// 解析最新生態區頁面 (例如 Enchanted Forest) 中的蛋種清單
async function parseZonePages() {
  const zoneEggs = [];
  try {
    const efUrl = 'https://stealanegg.fandom.com/api.php?action=parse&page=Enchanted%20Forest&prop=wikitext&format=json';
    const efData = await fetchJson(efUrl);
    if (efData && efData.parse && efData.parse.wikitext) {
      const wt = efData.parse.wikitext['*'];
      // 正則匹配 <div class="sae-items-card ... data-name="..." data-rarity="..." data-mps="...">...<div class="sae-items-name">PetName</div>
      const cardRegex = /<div class="sae-items-card[^"]*"\s+data-name="([^"]*)"\s+data-rarity="([^"]*)"\s+data-mps="([^"]*)"[^>]*>[\s\S]*?<div class="sae-items-name">([^<]+)<\/div>/gi;
      let match;
      while ((match = cardRegex.exec(wt)) !== null) {
        const petName = match[4].trim();
        const rarity = match[2].trim();
        const mps = match[3].trim();
        zoneEggs.push({
          pageTitle: petName,
          name: `${petName} Egg`,
          cleanName: petName,
          petName: petName,
          rarity: rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase(),
          rarityClass: rarity.toLowerCase(),
          biome: 'Enchanted Forest',
          mps: mps,
          reward: '',
          growTime: '',
          spawnType: ['Divine', 'Eternal', 'Secret'].includes(rarity) ? '🌟 高階自然刷新 (High Tier Spawn)' : '🥚 基礎/中階蛋 (Base Spawn)',
          obtainMethod: 'Enchanted Forest 地圖自然刷新',
          isMapSpawnable: true,
          imageUrl: petName === 'Celestial Sunlion'
            ? 'https://static.wikia.nocookie.net/stealanegg/images/2/21/Enchanted_Lion_V2.png/revision/latest?cb=20261005044445'
            : (petName === 'Starry Fox'
                ? 'https://static.wikia.nocookie.net/stealanegg/images/4/40/Starry_Fox.png/revision/latest?cb=20261006232700'
                : 'https://static.wikia.nocookie.net/stealanegg/images/f/f5/Enchanted_Forest.png/revision/latest?cb=20261005044210')
        });
      }
    }
  } catch (err) {
    console.warn('[WikiSync] 解析 Zone 頁面失敗:', err.message);
  }
  return zoneEggs;
}

async function syncWikiEggs() {
  console.log('[WikiSync] 開始與 Fandom Wiki 進行雙向同步...');
  const eggsPath = path.join(__dirname, '..', 'data', 'eggs.json');
  let currentEggs = [];
  if (fs.existsSync(eggsPath)) {
    try {
      currentEggs = JSON.parse(fs.readFileSync(eggsPath, 'utf8'));
    } catch (_) {}
  }

  const existingMap = new Map();
  currentEggs.forEach(e => {
    const k = (e.cleanName || e.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (k) existingMap.set(k, e);
  });

  const newDiscovered = [];

  // 1. 抓取 Category:Eggs
  try {
    const catUrl = 'https://stealanegg.fandom.com/api.php?action=query&list=categorymembers&cmtitle=Category:Eggs&cmlimit=500&format=json';
    const catRes = await fetchJson(catUrl);
    if (catRes && catRes.query && catRes.query.categorymembers) {
      const titles = catRes.query.categorymembers.map(m => m.title).filter(t => !t.startsWith('Template'));
      
      // 批次抓取 revision content
      for (let i = 0; i < titles.length; i += 30) {
        const batch = titles.slice(i, i + 30);
        const url = `https://stealanegg.fandom.com/api.php?action=query&titles=${encodeURIComponent(batch.join('|'))}&prop=revisions&rvprop=content&format=json`;
        try {
          const json = await fetchJson(url);
          if (json && json.query && json.query.pages) {
            for (const page of Object.values(json.query.pages)) {
              if (page.revisions && page.revisions[0]) {
                const wt = page.revisions[0]['*'];
                const details = parseDetailTemplate(wt);
                if (details) {
                  const eggName = (details.egg_name || details.pet_name || page.title).replace(/\s+Egg$/i, '').trim();
                  const cleanKey = eggName.toLowerCase().replace(/[^a-z0-9]/g, '');
                  const rarity = (details.rarity || 'Secret').trim();
                  const biome = (details.biome || 'Unknown').trim();
                  const mps = (details.mps || '').trim();

                  if (!existingMap.has(cleanKey)) {
                    const newEgg = {
                      pageTitle: page.title,
                      name: `${eggName} Egg`,
                      cleanName: eggName,
                      petName: details.pet_name || eggName,
                      rarity: rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase(),
                      rarityClass: (details.rarity_class || rarity).toLowerCase(),
                      biome: biome,
                      mps: mps,
                      reward: details.reward || '',
                      growTime: details.grow_time || '',
                      spawnType: ['Divine', 'Eternal', 'Secret'].includes(rarity) ? '🌟 高階自然刷新 (High Tier Spawn)' : (biome === 'Event' ? '🎟️ 限時活動/商店 (Event/Shop)' : '🥚 基礎/中階蛋 (Base Spawn)'),
                      obtainMethod: `${biome} 自然刷新`,
                      isMapSpawnable: true,
                      imageUrl: null
                    };
                    existingMap.set(cleanKey, newEgg);
                    currentEggs.push(newEgg);
                    newDiscovered.push(newEgg);
                  } else {
                    // 更新可能變動的屬性
                    const target = existingMap.get(cleanKey);
                    if (mps && !target.mps) target.mps = mps;
                    if (biome && biome !== 'Unknown' && target.biome === 'Unknown') target.biome = biome;
                  }
                }
              }
            }
          }
        } catch (bErr) {
          console.warn('[WikiSync] 批次抓取警告:', bErr.message);
        }
      }
    }
  } catch (cErr) {
    console.warn('[WikiSync] 抓取 Category:Eggs 警告:', cErr.message);
  }

  // 2. 抓取 Zone 頁面 (如 Enchanted Forest)
  const zoneEggs = await parseZonePages();
  for (const ze of zoneEggs) {
    const k = ze.cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!existingMap.has(k)) {
      existingMap.set(k, ze);
      currentEggs.push(ze);
      newDiscovered.push(ze);
    } else {
      const target = existingMap.get(k);
      if (ze.mps) target.mps = ze.mps;
      if (ze.imageUrl && !target.imageUrl) target.imageUrl = ze.imageUrl;
      if (ze.biome && (!target.biome || target.biome === 'Unknown')) target.biome = ze.biome;
    }
  }

  // 3. 排序與寫回檔案
  const rarityRank = {
    'Divine': 1, 'Eternal': 2, 'Secret': 3, 'Cosmic': 4,
    'Mythic': 5, 'Legendary': 6, 'Epic': 7, 'Rare': 8,
    'Uncommon': 9, 'Common': 10
  };
  currentEggs.sort((a, b) => (rarityRank[a.rarity] || 99) - (rarityRank[b.rarity] || 99));

  fs.writeFileSync(eggsPath, JSON.stringify(currentEggs, null, 2), 'utf8');

  // 同步更新 eggs_categorized.json
  const catPath = path.join(__dirname, '..', 'data', 'eggs_categorized.json');
  const categorized = currentEggs.map((e, idx) => ({
    id: idx + 1,
    name: e.cleanName || e.name.replace(/\s+Egg$/i, ''),
    fullName: e.name || `${e.cleanName} Egg`,
    rarity: e.rarity,
    biome: e.biome || 'Unknown',
    spawnType: e.spawnType || '🌟 地圖自然刷新',
    obtainMethod: e.obtainMethod || '地圖自然刷新',
    isMapSpawnable: e.isMapSpawnable !== false,
    imageUrl: e.imageUrl || ''
  }));
  fs.writeFileSync(catPath, JSON.stringify(categorized, null, 2), 'utf8');

  console.log(`[WikiSync] 同步完成！目前庫存共 ${currentEggs.length} 款蛋種，本次新發現 ${newDiscovered.length} 款。`);
  return {
    success: true,
    totalEggs: currentEggs.length,
    newEggsCount: newDiscovered.length,
    newEggNames: newDiscovered.map(e => e.cleanName),
    eggs: currentEggs
  };
}

module.exports = {
  syncWikiEggs
};
