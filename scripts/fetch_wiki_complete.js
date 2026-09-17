const https = require('https');
const fs = require('fs');
const path = require('path');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
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

async function getAllEggPages() {
  console.log('Fetching Category:Eggs members...');
  const url = 'https://stealanegg.fandom.com/api.php?action=query&list=categorymembers&cmtitle=Category:Eggs&cmlimit=500&format=json';
  const res = await fetchJson(url);
  const titles = res.query.categorymembers.map(m => m.title);
  console.log(`Found ${titles.length} members in Category:Eggs`);
  return titles;
}

function parseDetailTemplate(wikitext) {
  if (!wikitext) return null;
  // Match {{Detail ... }}
  const detailMatch = wikitext.match(/\{\{Detail([\s\S]*?)\}\}/i);
  if (detailMatch) {
    const content = detailMatch[1];
    const fields = {};
    const lines = content.split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*\|([a-zA-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) {
        fields[m[1].trim()] = m[2].trim();
      }
    }
    return fields;
  }

  // Fallback: parse expanded sae-detail-card markup
  if (wikitext.includes('sae-detail-card')) {
    const getField = (name) => {
      const regex = new RegExp(`\\{\\{\\{${name}\\|([^}]+)\\}\\}\\}`, 'i');
      const m = wikitext.match(regex);
      return m ? m[1].trim() : '';
    };

    const eggImgMatch = wikitext.match(/\[\[File:\{\{\{egg_image\|([^}]+)\}\}\}/i) || wikitext.match(/\[\[File:([^|\]]+Egg\.png)/i);
    const petImgMatch = wikitext.match(/\[\[File:\{\{\{pet_image\|([^}]+)\}\}\}/i) || wikitext.match(/\[\[File:([^|\]]+\.png)/i);

    return {
      pet_name: getField('pet_name'),
      egg_name: getField('egg_name'),
      rarity: getField('rarity') || 'Secret',
      rarity_class: getField('rarity_class') || 'secret',
      biome: getField('biome') || 'Demon',
      mps: getField('mps'),
      reward: getField('reward'),
      grow_time: getField('grow_time'),
      egg_image: eggImgMatch ? eggImgMatch[1].trim() : '',
      pet_image: petImgMatch ? petImgMatch[1].trim() : ''
    };
  }

  return null;
}

async function getImageUrls(filenames) {
  const result = new Map();
  // Batch in chunks of 40
  for (let i = 0; i < filenames.length; i += 40) {
    const chunk = filenames.slice(i, i + 40);
    const titlesParam = chunk.map(f => `File:${f}`).join('|');
    const url = `https://stealanegg.fandom.com/api.php?action=query&titles=${encodeURIComponent(titlesParam)}&prop=imageinfo&iiprop=url&format=json`;
    try {
      const data = await fetchJson(url);
      if (data && data.query && data.query.pages) {
        for (const page of Object.values(data.query.pages)) {
          if (page.imageinfo && page.imageinfo[0]) {
            const rawTitle = page.title.replace(/^File:/, '');
            result.set(rawTitle.toLowerCase(), page.imageinfo[0].url);
          }
        }
      }
    } catch (e) {
      console.error('Error fetching image batch:', e.message);
    }
  }
  return result;
}

async function main() {
  const titles = await getAllEggPages();
  const eggsData = [];
  const imageFiles = new Set();

  console.log('Fetching details for each egg...');
  // Batch fetch wikitext using prop=revisions
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
              const eggName = details.egg_name || details.pet_name || page.title;
              const petName = details.pet_name || page.title;
              const rarity = details.rarity || 'Unknown';
              const biome = details.biome || 'Unknown';
              const eggImage = details.egg_image || `${eggName}.png`;
              const petImage = details.pet_image;

              if (eggImage) imageFiles.add(eggImage);
              if (petImage) imageFiles.add(petImage);

              eggsData.push({
                pageTitle: page.title,
                name: eggName.endsWith(' Egg') ? eggName : `${eggName} Egg`,
                cleanName: eggName.replace(/\s+Egg$/i, '').trim(),
                petName,
                rarity: rarity.charAt(0).toUpperCase() + rarity.slice(1),
                rarityClass: (details.rarity_class || rarity).toLowerCase(),
                biome,
                eggImageFile: eggImage,
                petImageFile: petImage,
                mps: details.mps || '',
                reward: details.reward || '',
                growTime: details.grow_time || ''
              });
            } else {
              // Page in Category:Eggs but no {{Detail}}
              console.log(`No {{Detail}} found on: ${page.title}`);
            }
          }
        }
      }
    } catch (e) {
      console.error(`Error in batch ${i}:`, e.message);
    }
  }

  console.log(`Parsed ${eggsData.length} eggs from Wiki. Resolving image URLs...`);
  const imageMap = await getImageUrls(Array.from(imageFiles));

  for (const egg of eggsData) {
    if (egg.eggImageFile && imageMap.has(egg.eggImageFile.toLowerCase())) {
      egg.imageUrl = imageMap.get(egg.eggImageFile.toLowerCase());
    } else if (egg.petImageFile && imageMap.has(egg.petImageFile.toLowerCase())) {
      egg.imageUrl = imageMap.get(egg.petImageFile.toLowerCase());
    } else {
      egg.imageUrl = null;
    }
  }

  // Sort by rarity
  const rarityRank = {
    'Eternal': 1,
    'Secret': 2,
    'Divine': 3,
    'Cosmic': 4,
    'Mythic': 5,
    'Legendary': 6,
    'Epic': 7,
    'Rare': 8,
    'Uncommon': 9,
    'Common': 10
  };

  eggsData.sort((a, b) => (rarityRank[a.rarity] || 99) - (rarityRank[b.rarity] || 99));

  const outPath = path.join(__dirname, '..', 'data', 'eggs.json');
  fs.writeFileSync(outPath, JSON.stringify(eggsData, null, 2), 'utf8');
  console.log(`Successfully saved ${eggsData.length} eggs to ${outPath}`);

  // Print rarity distribution
  const dist = {};
  eggsData.forEach(e => dist[e.rarity] = (dist[e.rarity] || 0) + 1);
  console.log('Rarity distribution:', dist);
}

main().catch(console.error);
