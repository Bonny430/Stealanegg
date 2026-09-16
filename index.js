const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const axios = require('axios');

// 建立一個簡單的 Web 伺服器，讓 Render 能夠正常監聽 Port
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('機器人運作中！Bot is running!'));
app.listen(port, () => console.log(`Web 伺服器已啟動於 Port ${port}`));

// Discord 機器人權限設定
const client = new Client({
        intents: [
                    GatewayIntentBits.Guilds,
                            GatewayIntentBits.GuildMessages,
                                    GatewayIntentBits.MessageContent
        ]
});

// 從環境變數讀取設定 (這些等一下會在 Render 上設定)
const TOKEN = process.env.DISCORD_TOKEN;
const SOURCE_CHANNEL_ID = process.env.SOURCE_CHANNEL_ID;
const TARGET_WEBHOOK_URL = process.env.TARGET_WEBHOOK_URL;

client.once('ready', () => {
        console.log(`機器人已上線，登入身分：${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
        // 忽略機器人自己發送的訊息
            if (message.author.bot) return;

                // 確認是否為我們要監聽的頻道 (Steal an egg 頻道)
                    if (message.channelId === SOURCE_CHANNEL_ID) {
                                console.log(`收到新蛋通知: ${message.content}`);

                                        // 準備要傳送給外部 API / Webhook 的資料格式
                                                const payload = {
                                                                content: message.content,
                                                                            username: message.author.username
                                                };

                                                        // 如果有設定目標 API 或 Webhook 網址，就發送轉發請求
                                                                if (TARGET_WEBHOOK_URL) {
                                                                                try {
                                                                                                    await axios.post(TARGET_WEBHOOK_URL, payload);
                                                                                                                    console.log('成功轉發通知到外部 App！');
                                                                                } catch (error) {
                                                                                                    console.error('轉發失敗:', error.message);
                                                                                }
                                                                }
                    }
});

// 啟動機器人
client.login(TOKEN)                                                      
