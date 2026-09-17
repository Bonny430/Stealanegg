const fs = require('fs');
const path = require('path');

async function fetchEggs() {
  console.log('Fetching eggs from Steal An Egg Wiki...');
  let html = '';
  
  // Try reading from cache if available, or fetch
  const cachePath = path.resolve('C:/Users/bonny/.gemini/antigravity/brain/b9fa3748-9ca4-4e64-ad58-a6c7ec0b036e/.system_generated/steps/726/content.md');
  if (fs.existsSync(cachePath)) {
    html = fs.readFileSync(cachePath, 'utf-8');
  } else {
    const res = await fetch('https://stealanegg.fandom.com/wiki/Eggs');
    html = await res.text();
  }

  const cardRegex = /<div class="sae-egg-card\s+sae-egg-rarity-([^"]+)"[\s\S]*?<img[^>]+(?:src|data-src)="([^">]+)"[\s\S]*?<div class="sae-egg-name">([^<]+)<\/div>[\s\S]*?<div class="sae-egg-rarity-label[^"]*">([^<]+)<\/div>/g;

  let m;
  const eggsMap = new Map();
  while ((m = cardRegex.exec(html)) !== null) {
    const rarityKey = m[1].trim();
    // Clean up wikia revision URL to standard CDN url
    let imageUrl = m[2].trim();
    if (imageUrl.includes('/revision/latest')) {
      imageUrl = imageUrl.split('/revision/latest')[0] + '/revision/latest';
    }
    const name = m[3].trim();
    const rarity = m[4].trim();

    eggsMap.set(name.toLowerCase(), {
      name,
      rarity,
      rarityKey,
      imageUrl
    });
  }

  const eggsList = Array.from(eggsMap.values());
  console.log(`Extracted ${eggsList.length} unique eggs.`);

  const outPath = path.join(__dirname, '../data/eggs.json');
  fs.writeFileSync(outPath, JSON.stringify(eggsList, null, 2), 'utf-8');
  console.log(`Saved egg catalog to ${outPath}`);
  return eggsList;
}

fetchEggs().catch(console.error);
