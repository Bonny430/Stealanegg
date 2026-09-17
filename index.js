const { Client } = require('discord.js-selfbot-v13');
const express = require('express');

// 建立簡易 Web 伺服器供 Render 存活監測
const app = express();
const port = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Selfbot is active and running!'));
app.listen(port, () => console.log(`Web 伺服器運行於 Port ${port}`));

const client = new Client({
  checkUpdate: false
});

client.on('ready', () => {
  console.log(`小號已上線，登入身分：${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // 檢查是否為目標頻道
  if (!process.env.SOURCE_CHANNEL_ID || message.channel.id !== process.env.SOURCE_CHANNEL_ID) {
    return;
  }

  // 取得訊息文字或 Embed 內容（注意：不要忽略 Bot 訊息，因為通知常由官方機器人發出）
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

  console.log(`[監聽到新訊息]:\n${text}`);

  // 1. 轉發到 Telegram
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: `🔔 官方蛋通知：\n\n${text}`
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

  // 2. 轉發到自己的 Discord Webhook（若有設定）
  if (process.env.TARGET_WEBHOOK_URL) {
    try {
      const response = await fetch(process.env.TARGET_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          username: 'Egg Alert'
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
