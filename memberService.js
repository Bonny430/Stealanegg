const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');

// 支援的稀有度清單供按鈕切換
const ALL_RARITIES = ['Secret', 'Eternal', 'Divine', 'World Burner', 'Mythical', 'Legendary', 'Rare'];
const VIP_DEFAULT_RARITIES = ['Secret', 'Eternal', 'Divine', 'World Burner'];

class MemberService {
  constructor() {
    this.members = new Map();
    this.superAdminChatId = process.env.TELEGRAM_CHAT_ID ? String(process.env.TELEGRAM_CHAT_ID) : '8670104462';
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.sheetApiUrl = process.env.GOOGLE_SHEET_API_URL || 'https://script.google.com/macros/s/AKfycbxuLJ-ngjNo0JnQi9qmNBveGHW7KnnJRDfKW7WUEDXHmbB2949IWJmle8OiHp15InvB/exec';
    this.isPolling = false;
    this.pollOffset = 0;
    this.statsProvider = null; // 供查詢預測與最新掉落的鉤子
  }

  setStatsProvider(provider) {
    this.statsProvider = provider;
  }

  // 初始化並載入會員
  init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(MEMBERS_FILE)) {
      try {
        const raw = fs.readFileSync(MEMBERS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        for (const [id, m] of Object.entries(parsed)) {
          this.members.set(String(id), m);
        }
        console.log(`[MemberService] 已載入 ${this.members.size} 位會員`);
      } catch (err) {
        console.error('[MemberService] 讀取 members.json 失敗:', err.message);
      }
    }

    // 確保 Super Admin 存在
    if (this.superAdminChatId && !this.members.has(this.superAdminChatId)) {
      this.registerMember(this.superAdminChatId, {
        username: 'admin',
        firstName: 'Super Admin',
        tier: 'admin',
        expireAt: '2099-12-31T23:59:59.999Z',
        notes: '系統主管理員'
      });
    }

    // 啟動時嘗試非同步向 Google Sheet 同步
    this.syncFromSheet().catch(err => {
      console.warn('[MemberService] Google Sheet 同步略過或稍後重試:', err.message);
    });
  }

  // 儲存到本地檔案
  saveLocal() {
    try {
      const obj = {};
      for (const [id, m] of this.members.entries()) {
        obj[id] = m;
      }
      fs.writeFileSync(MEMBERS_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      console.error('[MemberService] 儲存 members.json 失敗:', err.message);
    }
  }

  // 向 Google Sheet 同步單一會員
  async syncMemberToSheet(member) {
    if (!this.sheetApiUrl) return;
    try {
      await fetch(this.sheetApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_member',
          member: {
            ...member,
            customRarities: member.customRarities || [],
            customEggNames: member.customEggNames || []
          }
        })
      });
    } catch (err) {
      console.warn('[MemberService] 同步至 Google Sheet 失敗:', err.message);
    }
  }

  // 從 Google Sheet 載入會員
  async syncFromSheet() {
    if (!this.sheetApiUrl) return;
    try {
      const res = await fetch(`${this.sheetApiUrl}?action=get_members`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.status === 'success' && Array.isArray(data.members)) {
        for (const m of data.members) {
          if (!m.chatId) continue;
          const id = String(m.chatId);
          if (!this.members.has(id)) {
            this.members.set(id, m);
          } else {
            // 合併雲端與本地，以最新更新者為準
            const local = this.members.get(id);
            if (m.updatedAt && (!local.updatedAt || new Date(m.updatedAt) > new Date(local.updatedAt))) {
              this.members.set(id, { ...local, ...m });
            }
          }
        }
        this.saveLocal();
        console.log(`[MemberService] 成功從 Google Sheet 同步會員名單，目前總計 ${this.members.size} 位`);
      }
    } catch (err) {
      // 忽略暫時性網路問題
    }
  }

  // 註冊或更新會員
  registerMember(chatId, details = {}) {
    const id = String(chatId);
    let member = this.members.get(id);

    const isSuperAdmin = id === this.superAdminChatId;

    if (!member) {
      member = {
        chatId: id,
        username: details.username || '',
        firstName: details.firstName || 'User',
        tier: isSuperAdmin ? 'admin' : (details.tier || 'free'),
        expireAt: isSuperAdmin ? '2099-12-31T23:59:59.999Z' : (details.expireAt || null),
        enabled: true,
        filterType: 'all', // 'all' | 'rare_only' | 'custom'
        customRarities: isSuperAdmin ? [...ALL_RARITIES] : [...VIP_DEFAULT_RARITIES],
        customEggNames: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        notificationsCount: 0,
        notes: details.notes || (isSuperAdmin ? '系統管理員' : 'Telegram 自助註冊會員')
      };
      this.members.set(id, member);
      console.log(`[MemberService] 🆕 新會員註冊成功: ${member.firstName} (@${member.username || '無'}) ID:${id}`);
    } else {
      // 更新基本資料
      if (details.username) member.username = details.username;
      if (details.firstName) member.firstName = details.firstName;
      if (isSuperAdmin) {
        member.tier = 'admin';
        member.expireAt = '2099-12-31T23:59:59.999Z';
      }
      member.updatedAt = new Date().toISOString();
    }

    this.saveLocal();
    this.syncMemberToSheet(member).catch(() => {});
    return member;
  }

  // 檢查是否具備有效 VIP / 管理員權限
  isVipActive(member) {
    if (!member) return false;
    if (member.tier === 'admin' || member.chatId === this.superAdminChatId) return true;
    if (member.tier === 'vip') {
      if (!member.expireAt) return true;
      const expireTime = new Date(member.expireAt).getTime();
      if (expireTime > Date.now()) return true;
      // 已過期 -> 自動降級
      member.tier = 'free';
      member.notes = (member.notes || '') + ' [VIP 已到期自動轉為免費]';
      member.updatedAt = new Date().toISOString();
      this.saveLocal();
      this.syncMemberToSheet(member).catch(() => {});
      return false;
    }
    return false;
  }

  // 管理員開通 VIP
  async grantVip(chatId, days = 30, notes = '') {
    const id = String(chatId);
    let member = this.members.get(id);
    if (!member) {
      member = this.registerMember(id, { notes: '直接開通 VIP' });
    }

    const currentExpire = member.expireAt ? new Date(member.expireAt).getTime() : 0;
    const baseTime = currentExpire > Date.now() ? currentExpire : Date.now();
    const newExpire = new Date(baseTime + days * 86400000).toISOString();

    member.tier = 'vip';
    member.expireAt = newExpire;
    member.updatedAt = new Date().toISOString();
    if (notes) member.notes = notes;

    this.saveLocal();
    this.syncMemberToSheet(member).catch(() => {});

    // 發送開通祝賀私訊給用戶
    const dateStr = new Date(newExpire).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    const msg = `🎉【VIP 尊爵會員開通通知】\n\n` +
      `恭喜您！管理員已為您開通 Steal An Egg VIP 特權！\n` +
      `• 開通天數：${days} 天\n` +
      `• 到期時間：${dateStr} (台灣時間)\n` +
      `• 尊爵特權：\n` +
      `  ✨ 秒級即時接收 Secret、Eternal、Divine 稀有蛋私訊！\n` +
      `  ✨ 支援輸入 /filter 自訂您專屬的蛋種過濾選單！\n\n` +
      `感謝您的支持，祝您每次都能搶到心儀的神級蛋！🥚🔥`;

    await this.sendTelegramMessage(id, msg).catch(() => {});
    return member;
  }

  // 取消或降級 VIP
  revokeVip(chatId) {
    const id = String(chatId);
    const member = this.members.get(id);
    if (!member) return null;
    if (id === this.superAdminChatId) return member; // 禁止取消主管理員

    member.tier = 'free';
    member.expireAt = null;
    member.updatedAt = new Date().toISOString();
    this.saveLocal();
    this.syncMemberToSheet(member).catch(() => {});
    return member;
  }

  // 切換推播開關
  toggleEnabled(chatId) {
    const id = String(chatId);
    let member = this.members.get(id);
    if (!member) member = this.registerMember(id);

    member.enabled = !member.enabled;
    member.updatedAt = new Date().toISOString();
    this.saveLocal();
    this.syncMemberToSheet(member).catch(() => {});
    return member;
  }

  // 設定過濾條件
  updateFilter(chatId, { filterType, customRarities, customEggNames }) {
    const id = String(chatId);
    let member = this.members.get(id);
    if (!member) member = this.registerMember(id);

    if (filterType) member.filterType = filterType;
    if (Array.isArray(customRarities)) member.customRarities = customRarities;
    if (Array.isArray(customEggNames)) member.customEggNames = customEggNames;

    member.updatedAt = new Date().toISOString();
    this.saveLocal();
    this.syncMemberToSheet(member).catch(() => {});
    return member;
  }

  // 判斷該會員是否該收到此蛋的推播通知
  shouldNotify(member, eggInfo) {
    if (!member || member.enabled === false) return false;

    const isVip = this.isVipActive(member);

    // 1. 全部接收模式
    if (member.filterType === 'all') {
      return true;
    }

    // 2. 僅 VIP 稀有蛋模式 (Secret, Eternal, Divine, World Burner)
    if (member.filterType === 'rare_only') {
      const rareRarities = ['Secret', 'Eternal', 'Divine', 'World Burner'];
      return rareRarities.includes(eggInfo.rarity);
    }

    // 3. 自訂條件模式
    if (member.filterType === 'custom') {
      if (Array.isArray(member.customRarities) && member.customRarities.includes(eggInfo.rarity)) {
        return true;
      }
      if (Array.isArray(member.customEggNames) && member.customEggNames.some(name => eggInfo.name.toLowerCase().includes(name.toLowerCase()))) {
        return true;
      }
      return false;
    }

    return true;
  }

  // 多用戶分發推播通知
  async dispatchNotification(eggInfo, baseMessageText) {
    if (!this.botToken) return { sentCount: 0 };

    const eligibleMembers = [];
    for (const member of this.members.values()) {
      // 避免與預設公共頻道重複
      if (String(member.chatId) === String(this.superAdminChatId)) {
        continue;
      }
      if (this.shouldNotify(member, eggInfo)) {
        eligibleMembers.push(member);
      }
    }

    let sentCount = 0;
    for (const m of eligibleMembers) {
      try {
        const isVip = this.isVipActive(m);
        const vipBadge = isVip ? '👑【VIP 專屬推播】' : '🥚【會員掉落快訊】';
        const personalMsg = `${vipBadge}\n\n` + baseMessageText;

        await this.sendTelegramMessage(m.chatId, personalMsg);
        m.notificationsCount = (m.notificationsCount || 0) + 1;
        sentCount++;

        // 避免觸發 Telegram 頻率限制 (每秒 30 則)
        if (eligibleMembers.length > 5) {
          await new Promise(r => setTimeout(r, 40));
        }
      } catch (err) {
        console.warn(`[MemberService] 推送至會員 ${m.chatId} 失敗:`, err.message);
      }
    }

    if (sentCount > 0) {
      this.saveLocal();
    }
    return { sentCount, totalEligible: eligibleMembers.length };
  }

  // 取得統計資訊
  getStats() {
    let vipCount = 0;
    let enabledCount = 0;
    for (const m of this.members.values()) {
      if (this.isVipActive(m)) vipCount++;
      if (m.enabled !== false) enabledCount++;
    }
    return {
      totalMembers: this.members.size,
      activeVips: vipCount,
      activeAlerts: enabledCount
    };
  }

  // 取得清單 (提供儀表板 API)
  getAllMembersList() {
    return Array.from(this.members.values()).map(m => ({
      chatId: m.chatId,
      username: m.username,
      firstName: m.firstName,
      tier: m.tier,
      isVip: this.isVipActive(m),
      expireAt: m.expireAt,
      enabled: m.enabled !== false,
      filterType: m.filterType,
      customRarities: m.customRarities,
      notificationsCount: m.notificationsCount || 0,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      notes: m.notes
    }));
  }

  // ================= Telegram API 調用封裝 =================

  async sendTelegramMessage(chatId, text, extra = {}) {
    if (!this.botToken) return null;
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...extra
      })
    });
    return res.json();
  }

  async editMessageText(chatId, messageId, text, extra = {}) {
    if (!this.botToken) return null;
    const url = `https://api.telegram.org/bot${this.botToken}/editMessageText`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        ...extra
      })
    });
    return res.json();
  }

  async answerCallback(callbackQueryId, text = '') {
    if (!this.botToken) return null;
    const url = `https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text
      })
    }).then(r => r.json()).catch(() => {});
  }

  // ================= Telegram 雙向 Polling 引擎 =================

  startTelegramPoller() {
    if (this.isPolling || !this.botToken) return;
    this.isPolling = true;
    console.log('[Telegram Bot] 啟動雙向互動 Polling 監聽器...');

    const poll = async () => {
      while (this.isPolling) {
        try {
          const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.pollOffset}&timeout=20`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (data.ok && Array.isArray(data.result)) {
              for (const update of data.result) {
                this.pollOffset = update.update_id + 1;
                await this.handleUpdate(update);
              }
            }
          } else if (res.status === 409) {
            console.warn('[Telegram Bot] 409 Conflict: 可能有其他實例正在 Polling，稍後重試...');
            await new Promise(r => setTimeout(r, 10000));
          } else {
            await new Promise(r => setTimeout(r, 3000));
          }
        } catch (err) {
          // 網路錯誤短暫休眠
          await new Promise(r => setTimeout(r, 4000));
        }
      }
    };

    poll();
  }

  // 處理 Telegram 傳入事件
  async handleUpdate(update) {
    try {
      // 1. 一般文字訊息
      if (update.message && update.message.text) {
        await this.handleMessage(update.message);
      }
      // 2. 按鈕回調 (Inline Keyboard Callback)
      else if (update.callback_query) {
        await this.handleCallback(update.callback_query);
      }
    } catch (err) {
      console.error('[Telegram Bot] 處理 Update 異常:', err.message);
    }
  }

  // 處理訊息指令
  async handleMessage(msg) {
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    const user = msg.from || {};
    const firstName = user.first_name || '玩家';
    const username = user.username || '';

    // 自動註冊或更新
    const member = this.registerMember(chatId, { username, firstName });
    const isSuperAdmin = member.tier === 'admin' || chatId === this.superAdminChatId;
    const isVip = this.isVipActive(member);

    // /start 指令
    if (text.startsWith('/start')) {
      const tierBadge = isSuperAdmin ? '👑 系統主管理員' : (isVip ? '🌟 VIP 尊爵會員' : '⚪ 一般免費會員');
      const expireStr = isSuperAdmin ? '永久有效' : (member.expireAt ? new Date(member.expireAt).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) : '未開通 (免費方案)');
      const alertStatus = member.enabled !== false ? '🔔 即時接收中' : '🔕 已暫停推播';

      const welcomeHtml = `👋 <b>您好，${firstName}！歡迎使用 Steal An Egg 蛋掉落監控系統！</b>\n\n` +
        `📋 <b>您的會員帳號資訊：</b>\n` +
        `• <b>會員 ID：</b> <code>${chatId}</code>\n` +
        `• <b>會員等級：</b> ${tierBadge}\n` +
        `• <b>推播狀態：</b> ${alertStatus}\n` +
        `• <b>VIP 到期日：</b> ${expireStr}\n\n` +
        `⚡ <b>點擊下方快捷按鈕開始體驗：</b>`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '👤 我的會員狀態', callback_data: 'menu_me' },
            { text: '⚙️ 蛋種過濾設定', callback_data: 'menu_filter' }
          ],
          [
            { text: member.enabled !== false ? '🔕 暫停推播' : '🔔 開啟推播', callback_data: 'menu_toggle' },
            { text: '📊 掉落預測分析', callback_data: 'menu_predict' }
          ],
          [
            { text: '🥚 最新 5 筆掉落紀錄', callback_data: 'menu_last' },
            { text: '🌐 開啟監控儀表板', url: 'https://stealanegg.onrender.com/' }
          ]
        ]
      };

      await this.sendTelegramMessage(chatId, welcomeHtml, { reply_markup: keyboard });
      return;
    }

    // /me 或 /status 指令
    if (text === '/me' || text === '/status') {
      await this.sendMemberCard(chatId, member);
      return;
    }

    // /toggle 指令
    if (text === '/toggle') {
      this.toggleEnabled(chatId);
      const newStatus = member.enabled ? '🔔 推播已【開啟】！您將會即時接收蛋掉落私訊提醒。' : '🔕 推播已【暫停】！您將不會受到私訊打擾。';
      await this.sendTelegramMessage(chatId, newStatus);
      return;
    }

    // /filter 指令
    if (text === '/filter') {
      await this.sendFilterKeyboard(chatId, member);
      return;
    }

    // /predict 或 /next
    if (text === '/predict' || text === '/next') {
      await this.sendPredictionInfo(chatId);
      return;
    }

    // /last
    if (text === '/last') {
      await this.sendLastDrops(chatId);
      return;
    }

    // /help
    if (text === '/help') {
      const helpText = `📖 <b>Steal An Egg 機器人操作指南</b>\n\n` +
        `• <code>/start</code> - 重啟歡迎選單與帳號註冊\n` +
        `• <code>/me</code> - 檢視個人會員卡、VIP 到期日與推播設定\n` +
        `• <code>/filter</code> - 自選想要接收的蛋種稀有度 (Secret/Eternal/Divine)\n` +
        `• <code>/toggle</code> - 一鍵開啟 / 暫停推播通知\n` +
        `• <code>/predict</code> - 查看下一輪出蛋時間預測與平均週期\n` +
        `• <code>/last</code> - 查看最近 5 顆掉落的稀有蛋紀錄\n\n` +
        (isSuperAdmin ? `👑 <b>管理員專用指令：</b>\n• <code>/setvip &lt;ChatID&gt; &lt;天數&gt;</code> - 開通/延長會員 VIP\n• <code>/users</code> - 檢視所有在線會員名單\n• <code>/broadcast &lt;訊息&gt;</code> - 向全體會員群發廣播\n` : '');
      await this.sendTelegramMessage(chatId, helpText);
      return;
    }

    // ================= 管理員指令 =================
    if (isSuperAdmin) {
      if (text.startsWith('/setvip')) {
        const parts = text.split(/\s+/);
        if (parts.length >= 3) {
          const targetId = parts[1];
          const days = parseInt(parts[2], 10);
          if (isNaN(days) || days <= 0) {
            await this.sendTelegramMessage(chatId, '❌ 天數格式不正確，範例：<code>/setvip 12345678 30</code>');
            return;
          }
          const updated = await this.grantVip(targetId, days, `由管理員 @${username || chatId} 指令手動開通`);
          await this.sendTelegramMessage(chatId, `✅ <b>VIP 開通成功！</b>\n• 對象：<code>${targetId}</code> (${updated.firstName})\n• 天數：${days} 天\n• 新到期日：${new Date(updated.expireAt).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
        } else {
          await this.sendTelegramMessage(chatId, '❌ 指令格式：<code>/setvip &lt;會員ChatID&gt; &lt;天數&gt;</code>\n例如：<code>/setvip 8670104462 30</code>');
        }
        return;
      }

      if (text.startsWith('/removevip')) {
        const parts = text.split(/\s+/);
        if (parts.length >= 2) {
          const targetId = parts[1];
          this.revokeVip(targetId);
          await this.sendTelegramMessage(chatId, `✅ 已將會員 <code>${targetId}</code> 降級為免費會員。`);
        } else {
          await this.sendTelegramMessage(chatId, '❌ 指令格式：<code>/removevip &lt;會員ChatID&gt;</code>');
        }
        return;
      }

      if (text === '/users' || text === '/members') {
        const stats = this.getStats();
        let listText = `👥 <b>系統會員統計總覽</b>\n\n` +
          `• <b>總會員數：</b> ${stats.totalMembers} 人\n` +
          `• <b>活躍 VIP 數：</b> ${stats.activeVips} 人\n` +
          `• <b>推播接收中：</b> ${stats.activeAlerts} 人\n\n` +
          `<b>最近 10 位會員名冊：</b>\n`;

        const recent = Array.from(this.members.values()).slice(-10);
        recent.forEach((m, idx) => {
          const isV = this.isVipActive(m);
          const badge = m.tier === 'admin' ? '👑' : (isV ? '🌟' : '⚪');
          listText += `${idx + 1}. ${badge} <b>${m.firstName}</b> (<code>${m.chatId}</code>) - ${m.tier.toUpperCase()} [${m.enabled ? '🔔' : '🔕'}]\n`;
        });

        await this.sendTelegramMessage(chatId, listText);
        return;
      }

      if (text.startsWith('/broadcast')) {
        const broadcastMsg = text.replace('/broadcast', '').trim();
        if (!broadcastMsg) {
          await this.sendTelegramMessage(chatId, '❌ 請提供廣播內容，例如：<code>/broadcast 系統維護完成通知</code>');
          return;
        }

        let sent = 0;
        for (const m of this.members.values()) {
          try {
            await this.sendTelegramMessage(m.chatId, `📢 <b>【系統全域公告】</b>\n\n${broadcastMsg}\n\n<i>— Steal An Egg 官方管理團隊</i>`);
            sent++;
            await new Promise(r => setTimeout(r, 40));
          } catch (_) {}
        }
        await this.sendTelegramMessage(chatId, `✅ 廣播發送完畢，成功送達 ${sent} 位會員。`);
        return;
      }
    }
  }

  // 處理 Inline 按鈕點擊事件
  async handleCallback(cb) {
    const chatId = String(cb.message.chat.id);
    const messageId = cb.message.message_id;
    const data = cb.data || '';
    const member = this.registerMember(chatId);

    // 1. 查看會員卡
    if (data === 'menu_me') {
      await this.answerCallback(cb.id, '載入會員卡');
      await this.sendMemberCard(chatId, member, messageId);
      return;
    }

    // 2. 切換推播開關
    if (data === 'menu_toggle') {
      this.toggleEnabled(chatId);
      await this.answerCallback(cb.id, member.enabled ? '🔔 已開啟推播' : '🔕 已暫停推播');
      await this.sendMemberCard(chatId, member, messageId);
      return;
    }

    // 3. 打開過濾設定選單
    if (data === 'menu_filter') {
      await this.answerCallback(cb.id, '過濾選單');
      await this.sendFilterKeyboard(chatId, member, messageId);
      return;
    }

    // 4. 預測資訊
    if (data === 'menu_predict') {
      await this.answerCallback(cb.id, '計算週期分析中...');
      await this.sendPredictionInfo(chatId);
      return;
    }

    // 5. 最新掉落
    if (data === 'menu_last') {
      await this.answerCallback(cb.id, '讀取歷史掉落...');
      await this.sendLastDrops(chatId);
      return;
    }

    // 6. 切換單一稀有度勾選狀態 (cb_rarity:<name>)
    if (data.startsWith('rarity_toggle:')) {
      const rarity = data.replace('rarity_toggle:', '');
      member.filterType = 'custom';
      if (!Array.isArray(member.customRarities)) member.customRarities = [];

      if (member.customRarities.includes(rarity)) {
        member.customRarities = member.customRarities.filter(r => r !== rarity);
      } else {
        member.customRarities.push(rarity);
      }

      this.saveLocal();
      this.syncMemberToSheet(member).catch(() => {});

      await this.answerCallback(cb.id, `已切換 ${rarity}`);
      await this.sendFilterKeyboard(chatId, member, messageId);
      return;
    }

    // 7. 過濾快捷範本
    if (data === 'preset_all') {
      member.filterType = 'all';
      this.saveLocal();
      this.syncMemberToSheet(member).catch(() => {});
      await this.answerCallback(cb.id, '已設定接收全部蛋種');
      await this.sendFilterKeyboard(chatId, member, messageId);
      return;
    }

    if (data === 'preset_rare') {
      member.filterType = 'rare_only';
      member.customRarities = [...VIP_DEFAULT_RARITIES];
      this.saveLocal();
      this.syncMemberToSheet(member).catch(() => {});
      await this.answerCallback(cb.id, '已設定僅接收稀有蛋 (Secret / Eternal / Divine)');
      await this.sendFilterKeyboard(chatId, member, messageId);
      return;
    }

    if (data === 'menu_close') {
      await this.answerCallback(cb.id, '選單已關閉');
      // 可以只更新訊息為已關閉
      await this.editMessageText(chatId, messageId, '<i>(選單已收合，隨時輸入 /start 或 /me 重新開啟)</i>', { reply_markup: { inline_keyboard: [] } });
      return;
    }
  }

  // 發送或編輯會員卡片
  async sendMemberCard(chatId, member, messageId = null) {
    const isSuperAdmin = member.tier === 'admin' || chatId === this.superAdminChatId;
    const isVip = this.isVipActive(member);
    const tierBadge = isSuperAdmin ? '👑 系統主管理員 (Admin)' : (isVip ? '🌟 VIP 尊爵會員' : '⚪ 一般免費會員 (Free)');
    const expireText = isSuperAdmin ? '永久有效' : (member.expireAt ? new Date(member.expireAt).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) : '未開通 (免費方案)');
    const filterText = member.filterType === 'all' ? '全部蛋種 (無過濾)' : (member.filterType === 'rare_only' ? '僅 VIP 稀有蛋' : `自訂 (${(member.customRarities || []).join(', ') || '尚未挑選'})`);

    const cardHtml = `💳 <b>【Steal An Egg 個人會員中心】</b>\n\n` +
      `• <b>會員暱稱：</b> ${member.firstName} (@${member.username || '未設定'})\n` +
      `• <b>會員編號：</b> <code>${chatId}</code>\n` +
      `• <b>會員身分：</b> ${tierBadge}\n` +
      `• <b>VIP 到期日：</b> ${expireText}\n` +
      `• <b>推播提醒：</b> ${member.enabled !== false ? '🔔 即時接收中' : '🔕 已暫停推播'}\n` +
      `• <b>過濾設定：</b> ${filterText}\n` +
      `• <b>累計快訊：</b> 已接收 ${member.notificationsCount || 0} 則掉落通知\n\n` +
      (!isVip && !isSuperAdmin ? `💡 <i>提示：VIP 會員享有 1 對 1 私訊推播神級 Secret 蛋與專屬關鍵字通知！請聯繫管理員開通。</i>` : '');

    const keyboard = {
      inline_keyboard: [
        [
          { text: member.enabled !== false ? '🔕 暫停推播' : '🔔 開啟推播', callback_data: 'menu_toggle' },
          { text: '⚙️ 調整蛋種過濾', callback_data: 'menu_filter' }
        ],
        [
          { text: '📊 週期預測', callback_data: 'menu_predict' },
          { text: '🥚 最近掉落', callback_data: 'menu_last' }
        ],
        [
          { text: '🌐 開啟監控儀表板', url: 'https://stealanegg.onrender.com/' }
        ]
      ]
    };

    if (messageId) {
      await this.editMessageText(chatId, messageId, cardHtml, { reply_markup: keyboard });
    } else {
      await this.sendTelegramMessage(chatId, cardHtml, { reply_markup: keyboard });
    }
  }

  // 發送或編輯過濾按鈕選單
  async sendFilterKeyboard(chatId, member, messageId = null) {
    const selected = member.customRarities || [];
    const currentMode = member.filterType || 'all';

    let filterDesc = `⚙️ <b>【自訂蛋種推播過濾設定】</b>\n\n` +
      `當前接收模式：<b>${currentMode === 'all' ? '🔔 全部接收 (包含所有蛋)' : (currentMode === 'rare_only' ? '👑 僅 VIP 稀有蛋' : '🎯 自訂勾選清單')}</b>\n\n` +
      `點擊下方按鈕即可切換想要即時接收的稀有度：`;

    const rarityButtons = [];
    for (let i = 0; i < ALL_RARITIES.length; i += 2) {
      const r1 = ALL_RARITIES[i];
      const r2 = ALL_RARITIES[i + 1];
      const isR1On = currentMode === 'all' || (currentMode === 'rare_only' && VIP_DEFAULT_RARITIES.includes(r1)) || (currentMode === 'custom' && selected.includes(r1));
      
      const row = [
        { text: `${isR1On ? '✅' : '⬜'} ${r1}`, callback_data: `rarity_toggle:${r1}` }
      ];
      if (r2) {
        const isR2On = currentMode === 'all' || (currentMode === 'rare_only' && VIP_DEFAULT_RARITIES.includes(r2)) || (currentMode === 'custom' && selected.includes(r2));
        row.push({ text: `${isR2On ? '✅' : '⬜'} ${r2}`, callback_data: `rarity_toggle:${r2}` });
      }
      rarityButtons.push(row);
    }

    const presetButtons = [
      [
        { text: currentMode === 'all' ? '🔘 全部接收' : '🔔 全部接收', callback_data: 'preset_all' },
        { text: currentMode === 'rare_only' ? '🔘 僅 VIP 稀有蛋' : '👑 僅 VIP 稀有蛋', callback_data: 'preset_rare' }
      ],
      [
        { text: '⬅️ 返回會員卡', callback_data: 'menu_me' },
        { text: '❌ 關閉選單', callback_data: 'menu_close' }
      ]
    ];

    const keyboard = {
      inline_keyboard: [...rarityButtons, ...presetButtons]
    };

    if (messageId) {
      await this.editMessageText(chatId, messageId, filterDesc, { reply_markup: keyboard });
    } else {
      await this.sendTelegramMessage(chatId, filterDesc, { reply_markup: keyboard });
    }
  }

  // 查詢週期預測
  async sendPredictionInfo(chatId) {
    if (this.statsProvider && typeof this.statsProvider.getPrediction === 'function') {
      const p = this.statsProvider.getPrediction();
      if (p) {
        const predText = `📊 <b>【Steal An Egg 週期與掉落預測】</b>\n\n` +
          `• <b>伺服器出蛋規律：</b> 每 5 分鐘固定一輪 (xx:00, xx:05, xx:10...)\n` +
          `• <b>預估下次出蛋：</b> <b>${p.predictedTimeStr}</b> (約 <b>${p.minutesLeft}</b> 分鐘後)\n` +
          `• <b>稀有蛋平均間隔：</b> 約 <b>${p.rareBroadcastIntervalMinutes || '9.4'}</b> 分鐘\n` +
          `• <b>出蛋率分析：</b> 稀有蛋約每 1~2 輪伺服器週期產出一顆\n\n` +
          `🔗 <i>即時動態雷達：https://stealanegg.onrender.com/</i>`;
        await this.sendTelegramMessage(chatId, predText);
        return;
      }
    }
    await this.sendTelegramMessage(chatId, '📊 伺服器正在校驗最新週期數據，請稍候片刻再試！');
  }

  // 查詢最新 5 顆蛋
  async sendLastDrops(chatId) {
    if (this.statsProvider && typeof this.statsProvider.getRecentDrops === 'function') {
      const drops = this.statsProvider.getRecentDrops(5);
      if (drops && drops.length > 0) {
        let msg = `🥚 <b>【最新 5 筆稀有蛋掉落紀錄】</b>\n\n`;
        drops.forEach((d, idx) => {
          const time = new Date(d.timestamp).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
          msg += `${idx + 1}. <b>${d.name}</b> (${d.rarity})\n   📍 地點：${d.location || '未知'} | ⏰ ${time}\n`;
        });
        msg += `\n📋 完整歷史請見 Google Sheet 或網頁儀表板`;
        await this.sendTelegramMessage(chatId, msg);
        return;
      }
    }
    await this.sendTelegramMessage(chatId, '🥚 目前本地快取尚無近期掉落資料。');
  }
}

module.exports = new MemberService();
