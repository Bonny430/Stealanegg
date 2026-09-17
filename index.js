const { Client } = require('discord.js-selfbot-v13');
const express = require('express');

// 建立簡易 Web 伺服器供 Render 存活監測
const app = express();
const port = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Steal An Egg Bot with Google Sheet & Prediction is active and running!'));
app.listen(port, () => console.log(`Web 伺服器運行於 Port ${port}`));

const client = new Client({
  checkUpdate: false
});

// Google Sheet Web App API 網址（可由環境變數設定，預設為已部署的 Web App）
const GOOGLE_SHEET_API_URL = process.env.GOOGLE_SHEET_API_URL || 'https://script.google.com/macros/s/AKfycbxuLJ-ngjNo0JnQi9qmNBveGHW7KnnJRDfKW7WUEDXHmbB2949IWJmle8OiHp15InvB/exec';

client.on('ready', () => {
  console.log(`小號已上線，登入身分：${client.user.tag}`);
});

// 解析蛋的名稱與稀有度
function extractEggInfo(embeds, text) {
  let name = '未知蛋';
  let rarity = '未知';

  if (embeds && embeds.length > 0) {
    for (const embed of embeds) {
      if (embed.title) {
        const titleClean = embed.title.replace(/[*_~`]/g, '').trim();
        const m = titleClean.match(/([A-Za-z0-9\s]+Egg|[\u4e00-\u9fa5\w]+蛋)/i);
        if (m && m[1]) name = m[1].trim();
        else if (titleClean) name = titleClean;
      }

      if (embed.fields) {
        for (const f of embed.fields) {
          const fn = f.name.toLowerCase();
          const fv = f.value.replace(/[*_~`]/g, '').trim();
          if (fn.includes('name') || fn.includes('蛋') || fn.includes('egg') || fn.includes('type')) {
            name = fv;
          }
          if (fn.includes('rarity') || fn.includes('稀有') || fn.includes('品質') || fn.includes('tier')) {
            rarity = fv;
          }
        }
      }

      if (embed.description) {
        const desc = embed.description.replace(/[*_~`]/g, '');
        const rMatch = desc.match(/(?:Rarity|稀有度|品質)\s*[:：]\s*([^\n\r]+)/i);
        if (rMatch) rarity = rMatch[1].trim();
        const nMatch = desc.match(/(?:Name|蛋名稱|名稱)\s*[:：]\s*([^\n\r]+)/i);
        if (nMatch) name = nMatch[1].trim();
        else {
          const eMatch = desc.match(/([A-Za-z0-9\s]+Egg|[\u4e00-\u9fa5\w]+蛋)/i);
          if (eMatch && name === '未知蛋') name = eMatch[1].trim();
        }
      }
    }
  }

  if (text) {
    const cleanText = text.replace(/[*_~`]/g, '');
    const nMatch = cleanText.match(/(?:Name|蛋名稱|名稱)\s*[:：]\s*([^\n\r]+)/i);
    if (nMatch) name = nMatch[1].trim();
    else if (name === '未知蛋') {
      const eMatch = cleanText.match(/([A-Za-z0-9\s]+Egg|[\u4e00-\u9fa5\w]+蛋)/i);
      if (eMatch) name = eMatch[1].trim();
    }
    const rMatch = cleanText.match(/(?:Rarity|稀有度|品質)\s*[:：]\s*([^\n\r]+)/i);
    if (rMatch) rarity = rMatch[1].trim();
  }

  return { name, rarity };
}

// 記錄蛋資訊至 Google Sheet
async function recordEggDrop(eggData) {
  try {
    const res = await fetch(GOOGLE_SHEET_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eggData)
    });
    const result = await res.json();
    console.log('成功儲存蛋資訊至 Google Sheet:', result);
    return result;
  } catch (err) {
    console.error('寫入 Google Sheet 異常:', err.message);
    return null;
  }
}

// 歷史資料分析與預測模型
async function analyzeAndPredict() {
  try {
    const res = await fetch(GOOGLE_SHEET_API_URL);
    const json = await res.json();
    if (!json || !json.data || json.data.length <= 1) {
      return null;
    }

    // 排除標題列，過濾有效資料列 [時間, 名稱, 稀有度, 詳情]
    const rows = json.data.slice(1).filter(r => r[0] && r[0].toString().trim() !== '');
    if (rows.length === 0) return null;

    if (rows.length < 2) {
      return {
        totalRecords: rows.length,
        statusText: '資料累積中 (需至少 2 筆紀錄以計算平均重生間隔)'
      };
    }

    // 解析時間戳記並排序
    const timestamps = rows
      .map(r => new Date(r[0]).getTime())
      .filter(t => !isNaN(t))
      .sort((a, b) => a - b);

    if (timestamps.length < 2) return null;

    // 計算相鄰蛋掉落的時間間隔（單位：分鐘）
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      const diffMin = (timestamps[i] - timestamps[i - 1]) / (1000 * 60);
      // 排除異常超長時間間隔（如伺服器維護或睡眠超過 12 小時）
      if (diffMin > 0 && diffMin <= 720) {
        intervals.push(diffMin);
      }
    }

    if (intervals.length === 0) return null;

    // 平均重生週期
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // 近期 5 筆間隔平均（更貼近當下活動節奏）
    const recentSlice = intervals.slice(-5);
    const recentAvg = recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;

    // 預測下一次掉落時間（以上一次掉落時間加上平均間隔）
    const lastTime = timestamps[timestamps.length - 1];
    const predictedTime = new Date(lastTime + avgInterval * 60 * 1000);
    const predictedTimeStr = predictedTime.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    const minutesLeft = Math.max(1, Math.round((predictedTime.getTime() - Date.now()) / (1000 * 60)));

    // 統計各蛋種出現次數
    const nameCounts = {};
    for (const r of rows) {
      const n = r[1]?.trim() || '未知蛋';
      nameCounts[n] = (nameCounts[n] || 0) + 1;
    }
    const topEggs = Object.entries(nameCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n, c]) => `${n} (${c}次)`)
      .join('、 ');

    return {
      totalRecords: rows.length,
      avgIntervalMinutes: Math.round(avgInterval),
      recentAvgMinutes: Math.round(recentAvg),
      predictedTimeStr,
      minutesLeft,
      topEggs
    };
  } catch (err) {
    console.error('數據分析與預測執行異常:', err.message);
    return null;
  }
}

client.on('messageCreate', async (message) => {
  // 檢查是否為目標頻道
  if (!process.env.SOURCE_CHANNEL_ID || message.channel.id !== process.env.SOURCE_CHANNEL_ID) {
    return;
  }

  // 取得訊息文字與 Embed 內容
  let text = message.content || '';

  if (message.embeds && message.embeds.length > 0) {
    const embedParts = [];
    for (const embed of message.embeds) {
      if (embed.title) embedParts.push(`**${embed.title}**`);
      if (embed.description) embedParts.push(embed.description);
      if (embed.fields && embed.fields.length > 0) {
        for (const field of embed.fields) {
          embedParts.push(`${field.name}: ${field.value}`);
        }
      }
    }
    const embedText = embedParts.filter(Boolean).join('\n');
    text = text ? `${text}\n\n${embedText}` : embedText;
  }

  if (!text) {
    text = '【收到空訊息或純圖片通知】';
  }

  // 過濾 AA (Admin Abuse / 管理員濫用)
  const isAA = /Admin Abuse|\bAA\b|管理員濫用|Admin Spawned|Staff Spawned/i.test(text);
  if (isAA) {
    console.log('偵測到 AA (管理員濫用) 通知，依設定予以忽略。');
    return;
  }

  console.log(`[監聽到有效蛋通知]:\n${text}`);

  // 1. 提取蛋資訊
  const eggInfo = extractEggInfo(message.embeds, text);
  console.log(`解析結果 -> 名稱: ${eggInfo.name}, 稀有度: ${eggInfo.rarity}`);

  // 2. 寫入 Google Sheet 資料庫
  await recordEggDrop({
    timestamp: new Date().toISOString(),
    name: eggInfo.name,
    rarity: eggInfo.rarity,
    rawText: text
  });

  // 3. 進行資料分析與預測
  const prediction = await analyzeAndPredict();
  let predictionText = '';
  if (prediction) {
    if (prediction.statusText) {
      predictionText = `\n\n📊 【資料分析與預測】\n• 目前筆數：${prediction.totalRecords} 筆\n• 預測狀態：${prediction.statusText}`;
    } else {
      predictionText = `\n\n📊 【資料分析與預測】\n• 歷史總量：已累計 ${prediction.totalRecords} 筆\n• 平均重生間隔：約 ${prediction.avgIntervalMinutes} 分鐘（近期平均：${prediction.recentAvgMinutes} 分鐘）\n• 預測下次掉落：約 ${prediction.predictedTimeStr} (約 ${prediction.minutesLeft} 分鐘後)\n• 常見蛋種：${prediction.topEggs}`;
    }
  }

  const finalNotification = `🔔 官方蛋掉落通知：\n\n${text}${predictionText}`;

  // 4. 轉發到 Telegram
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: finalNotification
          })
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Telegram 轉發回應失敗 (${response.status}):`, errorText);
      } else {
        console.log('成功轉發至 Telegram');
      }
    } catch (err) {
      console.error('Telegram 轉發異常:', err.message);
    }
  }

  // 5. 轉發到 Discord Webhook（若有設定）
  if (process.env.TARGET_WEBHOOK_URL) {
    try {
      const response = await fetch(process.env.TARGET_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: finalNotification,
          username: 'Egg Alert & Predictor'
        })
      });
      if (!response.ok) {
        console.error(`Discord Webhook 轉發回應失敗 (${response.status})`);
      } else {
        console.log('成功轉發至 Discord Webhook');
      }
    } catch (err) {
      console.error('Discord Webhook 轉發異常:', err.message);
    }
  }
});

// 使用小號的 User Token 登入
if (!process.env.USER_TOKEN) {
  console.warn('警告：尚未設定 USER_TOKEN 環境變數，機器人無法登入。請至 Render 設定。');
} else {
  client.login(process.env.USER_TOKEN).catch((err) => {
    console.error('登入失敗，請確認 USER_TOKEN 是否正確:', err.message);
  });
}
