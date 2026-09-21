const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// 支援的稀有度清單供按鈕切換
const ALL_RARITIES = ['Secret', 'Eternal', 'Divine', 'World Burner', 'Mythical', 'Legendary', 'Rare'];
const VIP_DEFAULT_RARITIES = ['Secret', 'Eternal', 'Divine', 'World Burner'];

// 28 種官方自然地圖刷新高階神蛋名冊 (精準追蹤核心)
const HIGH_TIER_EGGS = [
  { name: 'Cosmic Dragon', rarity: 'Secret', biome: 'Cosmic' },
  { name: 'World Burner', rarity: 'Divine', biome: 'Angels & Demons' },
  { name: 'Mutant Shark', rarity: 'Secret', biome: 'Titan Temple' },
  { name: 'Gargoyle', rarity: 'Secret', biome: 'Angels & Demons' },
  { name: 'Kraken', rarity: 'Secret', biome: 'Abyss Ocean' },
  { name: 'Cerberus', rarity: 'Secret', biome: 'Volcano' },
  { name: 'Eternal Lunar Dragon', rarity: 'Eternal', biome: 'Cosmic' },
  { name: 'Phoenix', rarity: 'Eternal', biome: 'Volcano' },
  { name: 'Mosasaurus', rarity: 'Eternal', biome: 'Prehistoric' },
  { name: 'ArchAngel', rarity: 'Divine', biome: 'Angels & Demons' },
  { name: 'Gorilla King', rarity: 'Eternal', biome: 'Titan Temple' },
  { name: 'El Maja', rarity: 'Eternal', biome: 'Abyss Ocean' },
  { name: 'Ice Dragon', rarity: 'Eternal', biome: 'Snow' },
  { name: 'Lava Dragon', rarity: 'Eternal', biome: 'Volcano' },
  { name: 'Oni Tiger', rarity: 'Eternal', biome: 'Cherry Blossom' },
  { name: 'Pegasus', rarity: 'Eternal', biome: 'Angels & Demons' },
  { name: 'Skeleton Horse', rarity: 'Eternal', biome: 'Angels & Demons' },
  { name: 'Cosmic Skeleton Boss', rarity: 'Secret', biome: 'Cosmic' },
  { name: 'Centaur', rarity: 'Secret', biome: 'Angels & Demons' },
  { name: 'King Snake', rarity: 'Secret', biome: 'Jungle' },
  { name: 'Pure Jellyfish', rarity: 'Secret', biome: 'Angels & Demons' },
  { name: 'Stag', rarity: 'Secret', biome: 'Cherry Blossom' },
  { name: 'Yeti', rarity: 'Secret', biome: 'Snow' },
  { name: 'T-Rex', rarity: 'Secret', biome: 'Prehistoric' },
  { name: 'Tralaledon', rarity: 'Secret', biome: 'Prehistoric' },
  { name: 'Kitsune', rarity: 'Divine', biome: 'Cherry Blossom' },
  { name: 'Nightflame', rarity: 'Divine', biome: 'Titan Temple' },
  { name: 'Unicorn', rarity: 'Divine', biome: 'Cosmic' }
];

const TOP_10_EGG_NAMES = [
  'Cosmic Dragon',
  'World Burner',
  'Mutant Shark',
  'Gargoyle',
  'Kraken',
  'Cerberus',
  'Eternal Lunar Dragon',
  'Phoenix',
  'Mosasaurus',
  'ArchAngel'
];

const ALL_HIGH_TIER_NAMES = HIGH_TIER_EGGS.map(e => e.name);

const BIOME_LABELS = {
  'All': '🌐 全部 (28種)',
  'Cosmic': '🪐 宇宙',
  'Titan Temple': '🏛️ 泰坦',
  'Volcano': '🌋 火山',
  'Abyss Ocean': '🌊 深海',
  'Angels & Demons': '👼 天使惡魔',
  'Prehistoric': '🦖 史前',
  'Cherry Blossom': '🌸 櫻花',
  'Snow': '❄️ 冰雪'
};

class MemberService {
  constructor() {
    this.members = new Map();
    this.otpStore = new Map(); // chatId -> { code, expireAt, lastSentAt }
    this.sessions = new Map(); // token -> { token, chatId, role, createdAt, expireAt }
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

  // 初始化並載入會員與 Session
  init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(MEMBERS_FILE)) {
      try {
        const raw = fs.readFileSync(MEMBERS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        for (const [id, m] of Object.entries(parsed)) {
          if (!Array.isArray(m.customEggNames)) {
            m.customEggNames = [...ALL_HIGH_TIER_NAMES];
          }
          if (!Array.isArray(m.activityLogs)) {
            m.activityLogs = [];
          }
          this.members.set(String(id), m);
        }
        console.log(`[MemberService] 已載入 ${this.members.size} 位會員`);
      } catch (err) {
        console.error('[MemberService] 讀取 members.json 失敗:', err.message);
      }
    }

    // 載入持久化 Session
    if (fs.existsSync(SESSIONS_FILE)) {
      try {
        const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const now = Date.now();
        for (const [tok, sess] of Object.entries(parsed)) {
          if (sess.expireAt && new Date(sess.expireAt).getTime() > now) {
            this.sessions.set(tok, sess);
          }
        }
        console.log(`[MemberService] 已恢復 ${this.sessions.size} 個活躍 Session`);
      } catch (err) {
        console.warn('[MemberService] 讀取 sessions.json 失敗:', err.message);
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

  // 儲存 Session 到本地檔案
  saveSessions() {
    try {
      const obj = {};
      const now = Date.now();
      for (const [tok, sess] of this.sessions.entries()) {
        if (sess.expireAt && new Date(sess.expireAt).getTime() > now) {
          obj[tok] = sess;
        }
      }
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      console.warn('[MemberService] 儲存 sessions.json 失敗:', err.message);
    }
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

  // 向 Google Sheet 同步單一會員 (安全守衛：保護蛋掉落試算表不被污染)
  async syncMemberToSheet(member) {
    // 經診斷：Google Apps Script 預設接收端為掉落專用工作表，發送非掉落之會員資料會觸發預設回退寫入「未知」蛋紀錄。
    // 會員資料目前已在伺服器端 data/members.json 保持完整持久化儲存與即時讀寫，此處安全略過以確保大數據純淨。
    return;
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
            if (!Array.isArray(m.customEggNames)) {
              m.customEggNames = [...ALL_HIGH_TIER_NAMES];
            }
            if (!Array.isArray(m.activityLogs)) m.activityLogs = [];
            this.members.set(id, m);
          } else {
            // 合併雲端與本地，以最新更新者為準
            const local = this.members.get(id);
            if (m.updatedAt && (!local.updatedAt || new Date(m.updatedAt) > new Date(local.updatedAt))) {
              this.members.set(id, {
                ...local,
                ...m,
                customEggNames: Array.isArray(m.customEggNames) ? m.customEggNames : local.customEggNames,
                activityLogs: Array.isArray(local.activityLogs) && local.activityLogs.length > 0 ? local.activityLogs : (m.activityLogs || [])
              });
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
        filterType: 'custom', // 預設自選神蛋模式，使自選清單即刻生效
        customRarities: isSuperAdmin ? [...ALL_RARITIES] : [...VIP_DEFAULT_RARITIES],
        customEggNames: [...ALL_HIGH_TIER_NAMES],
        activityLogs: [],
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
      if (!Array.isArray(member.customEggNames)) {
        member.customEggNames = [...ALL_HIGH_TIER_NAMES];
      }
      if (!Array.isArray(member.activityLogs)) {
        member.activityLogs = [];
      }
      member.updatedAt = new Date().toISOString();
    }

    this.saveLocal();
    this.syncMemberToSheet(member).catch(() => {});
    return member;
  }

  // 記錄使用者歷史操作行為 Log (保留最近 50 筆)
  logMemberAction(chatId, action, description, source = 'telegram') {
    const id = String(chatId);
    let member = this.members.get(id);
    if (!member) member = this.registerMember(id);

    if (!Array.isArray(member.activityLogs)) {
      member.activityLogs = [];
    }

    const logEntry = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      action,
      description,
      source
    };

    member.activityLogs.unshift(logEntry);
    if (member.activityLogs.length > 50) {
      member.activityLogs = member.activityLogs.slice(0, 50);
    }

    member.updatedAt = new Date().toISOString();
    this.saveLocal();
    this.syncMemberToSheet(member).catch(() => {});
    return logEntry;
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

    const dateStr = new Date(newExpire).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    this.logMemberAction(id, 'vip_grant', `開通 VIP 尊爵特權 (${days} 天，至 ${dateStr})`, 'system');

    this.saveLocal();
    this.syncMemberToSheet(member).catch(() => {});

    // 發送開通祝賀私訊給用戶
    const msg = `🎉【VIP 尊爵會員開通通知】\n\n` +
      `恭喜您！管理員已為您開通 Steal An Egg VIP 特權！\n` +
      `• 開通天數：${days} 天\n` +
      `• 到期時間：${dateStr} (台灣時間)\n` +
      `• 尊爵特權：\n` +
      `  ✨ 秒級即時接收 Secret、Eternal、Divine 稀有蛋私訊！\n` +
      `  ✨ 支援輸入 /filter 自訂 28 種高階神蛋專屬過濾選單！\n` +
      `  ✨ 支援輸入 /logs 查看個人操作軌跡紀錄！\n\n` +
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
    this.logMemberAction(id, 'vip_revoke', 'VIP 會員身分變更為免費會員', 'system');
    this.saveLocal();
    this.syncMemberToSheet(member).catch(() => {});
    return member;
  }

  // 切換推播開關
  toggleEnabled(chatId, source = 'telegram') {
    const id = String(chatId);
    let member = this.members.get(id);
    if (!member) member = this.registerMember(id);

    member.enabled = !member.enabled;
    member.updatedAt = new Date().toISOString();
    this.logMemberAction(id, 'toggle_enabled', `推播通知狀態切換為【${member.enabled ? '開啟' : '暫停'}】`, source);
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

    // 1. 全部接收模式
    if (member.filterType === 'all') {
      return true;
    }

    // 2. 僅 VIP 稀有蛋模式 (Secret, Eternal, Divine, World Burner)
    if (member.filterType === 'rare_only') {
      const rareRarities = ['Secret', 'Eternal', 'Divine', 'World Burner'];
      return rareRarities.includes(eggInfo.rarity);
    }

    // 3. 自訂精準蛋種模式 (以自選蛋種名冊為核心)
    if (member.filterType === 'custom') {
      const eggNameLower = (eggInfo.name || '').toLowerCase().trim();

      // 若已有自選蛋名清單，以蛋種精準匹配為唯一標準
      if (Array.isArray(member.customEggNames)) {
        if (member.customEggNames.length === 0) return false;
        return member.customEggNames.some(target => {
          const targetLower = target.toLowerCase().trim();
          return eggNameLower.includes(targetLower) || targetLower.includes(eggNameLower);
        });
      }

      // 舊版過渡：若尚未設定蛋名清單，相容稀有度勾選
      if (Array.isArray(member.customRarities) && member.customRarities.includes(eggInfo.rarity)) {
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
      // 避免與公共頻道重複發送至同一 ChatId
      if (eggInfo._sentToMainChannel && process.env.TELEGRAM_CHAT_ID && String(member.chatId) === String(process.env.TELEGRAM_CHAT_ID)) {
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

  // ================= 儀表板登入與 Session 認證模組 =================

  // 1. 產生 6 位數登入驗證碼 (OTP)
  async generateLoginOtp(chatId) {
    const id = String(chatId).trim();
    if (!id || !/^-?\d+$/.test(id)) {
      return { success: false, error: '請輸入有效的 Telegram Chat ID (數字)' };
    }

    // 檢查發送冷卻時間 (30 秒)
    const existing = this.otpStore.get(id);
    const now = Date.now();
    if (existing && existing.lastSentAt && (now - existing.lastSentAt < 30000)) {
      const waitSec = Math.ceil((30000 - (now - existing.lastSentAt)) / 1000);
      return { success: false, error: `發送過於頻繁，請等待 ${waitSec} 秒後再試` };
    }

    // 確保會員存在，若新用戶則自動登記
    let member = this.members.get(id);
    if (!member) {
      member = this.registerMember(id, { notes: '網頁驗證碼登入自動註冊' });
    }

    // 產生 6 位隨機數字
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expireAt = now + 5 * 60 * 1000; // 5 分鐘有效

    this.otpStore.set(id, {
      code,
      expireAt,
      lastSentAt: now
    });

    // 透過 Telegram 機器人發送私訊
    const msg = `🔐 <b>【Steal An Egg 儀表板登入驗證碼】</b>\n\n` +
      `您剛剛在監控儀表板申請了登入驗證碼：\n\n` +
      `👉 <code>${code}</code> 👈\n\n` +
      `• <b>有效時間：</b> 5 分鐘\n` +
      `• <b>安全提醒：</b> 請勿將此驗證碼透露給他人。如非您本人操作，請忽略此訊息。`;

    try {
      const tgRes = await this.sendTelegramMessage(id, msg);
      if (tgRes && tgRes.ok) {
        return { success: true, message: '驗證碼已發送至您的 Telegram 私訊！', expireSeconds: 300 };
      } else {
        return {
          success: false,
          error: '驗證碼發送失敗，請確認您已在 Telegram 私訊過 @Stealanegg3love24bot 並點擊過 /start！'
        };
      }
    } catch (err) {
      return {
        success: false,
        error: `Telegram 發送異常: ${err.message}`
      };
    }
  }

  // 2. 驗證 OTP 並建立 Session
  verifyLoginOtp(chatId, inputCode) {
    const id = String(chatId).trim();
    const code = String(inputCode).trim();

    const otpData = this.otpStore.get(id);
    if (!otpData) {
      return { success: false, error: '尚未發送驗證碼或驗證碼已過期，請重新獲取' };
    }

    if (Date.now() > otpData.expireAt) {
      this.otpStore.delete(id);
      return { success: false, error: '驗證碼已逾時 (超過5分鐘)，請重新獲取' };
    }

    if (otpData.code !== code) {
      return { success: false, error: '驗證碼錯誤，請仔細核對 6 位數字' };
    }

    // 驗證成功，清除 OTP
    this.otpStore.delete(id);

    // 簽發 Session Token
    const token = crypto.randomBytes(32).toString('hex');
    const isSuperAdmin = id === this.superAdminChatId;
    const member = this.members.get(id) || this.registerMember(id);

    const session = {
      token,
      chatId: id,
      role: isSuperAdmin ? 'admin' : (this.isVipActive(member) ? 'vip' : 'member'),
      createdAt: new Date().toISOString(),
      expireAt: new Date(Date.now() + 30 * 86400000).toISOString() // 30 天有效
    };

    this.sessions.set(token, session);
    this.saveSessions();

    this.logMemberAction(id, 'web_login', '從監控儀表板 OTP 驗證碼登入成功', 'web');

    return {
      success: true,
      token,
      member: this.getSanitizedMember(member)
    };
  }

  // 3. 管理員金鑰登入
  loginAdmin(adminKey) {
    const serverKey = process.env.ADMIN_KEY || 'stealanegg2026';
    if (!adminKey || String(adminKey).trim() !== serverKey) {
      return { success: false, error: '管理金鑰錯誤，拒絕登入' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const adminMember = this.members.get(this.superAdminChatId) || this.registerMember(this.superAdminChatId, {
      username: 'admin',
      firstName: 'Super Admin',
      tier: 'admin'
    });

    const session = {
      token,
      chatId: this.superAdminChatId,
      role: 'admin',
      createdAt: new Date().toISOString(),
      expireAt: new Date(Date.now() + 30 * 86400000).toISOString()
    };

    this.sessions.set(token, session);
    this.saveSessions();

    this.logMemberAction(this.superAdminChatId, 'admin_login', '使用 Super Admin 金鑰登入儀表板', 'web');

    return {
      success: true,
      token,
      member: this.getSanitizedMember(adminMember)
    };
  }

  // 4. 校驗 Session Token
  validateSession(token) {
    if (!token) return { valid: false };
    const cleanTok = String(token).trim().replace(/^Bearer\s+/i, '');
    const session = this.sessions.get(cleanTok);
    if (!session) return { valid: false };

    if (session.expireAt && new Date(session.expireAt).getTime() < Date.now()) {
      this.sessions.delete(cleanTok);
      this.saveSessions();
      return { valid: false, error: 'Session 已過期，請重新登入' };
    }

    const member = this.members.get(session.chatId);
    if (!member) return { valid: false };

    // 動態更新當前角色狀態
    const isSuperAdmin = session.chatId === this.superAdminChatId || member.tier === 'admin';
    const isVip = this.isVipActive(member);
    session.role = isSuperAdmin ? 'admin' : (isVip ? 'vip' : 'member');

    return {
      valid: true,
      token: cleanTok,
      chatId: session.chatId,
      role: session.role,
      isAdmin: isSuperAdmin,
      member: this.getSanitizedMember(member)
    };
  }

  // 5. 登出 Session
  logoutSession(token) {
    if (!token) return true;
    const cleanTok = String(token).trim().replace(/^Bearer\s+/i, '');
    this.sessions.delete(cleanTok);
    this.saveSessions();
    return true;
  }

  // 6. 登入會員在網頁自訂個人偏好
  updateMySettings(chatId, { enabled, filterType, customRarities, customEggNames }) {
    const id = String(chatId);
    let member = this.members.get(id);
    if (!member) return null;

    const changes = [];
    if (typeof enabled === 'boolean' && member.enabled !== enabled) {
      member.enabled = enabled;
      changes.push(`推播提醒${enabled ? '開啟' : '暫停'}`);
    }
    if (filterType && member.filterType !== filterType) {
      member.filterType = filterType;
      const typeLabel = filterType === 'all' ? '全部接收' : (filterType === 'rare_only' ? '僅稀有蛋' : '自選蛋種');
      changes.push(`模式設為【${typeLabel}】`);
    }
    if (Array.isArray(customRarities)) {
      member.customRarities = customRarities;
    }
    if (Array.isArray(customEggNames)) {
      member.customEggNames = customEggNames;
      changes.push(`追蹤 ${customEggNames.length} 款蛋`);
    }

    member.updatedAt = new Date().toISOString();
    const desc = changes.length > 0 ? `在網頁更新偏好：${changes.join('、')}` : '在網頁儲存個人推播偏好';
    this.logMemberAction(id, 'web_settings', desc, 'web');

    this.saveLocal();
    this.syncMemberToSheet(member).catch(() => {});
    return this.getSanitizedMember(member);
  }

  // 取得安全的會員公開資料
  getSanitizedMember(m) {
    if (!m) return null;
    return {
      chatId: m.chatId,
      username: m.username,
      firstName: m.firstName,
      tier: m.tier,
      isVip: this.isVipActive(m),
      isAdmin: m.tier === 'admin' || m.chatId === this.superAdminChatId,
      expireAt: m.expireAt,
      enabled: m.enabled !== false,
      filterType: m.filterType || 'all',
      customRarities: m.customRarities || [],
      customEggNames: m.customEggNames || [...ALL_HIGH_TIER_NAMES],
      notificationsCount: m.notificationsCount || 0,
      activityLogs: (m.activityLogs || []).slice(0, 50)
    };
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
      const trackedCount = (member.customEggNames || []).length;

      const welcomeHtml = `👋 <b>您好，${firstName}！歡迎使用 Steal An Egg 蛋掉落監控系統！</b>\n\n` +
        `📋 <b>您的會員帳號資訊：</b>\n` +
        `• <b>會員 ID：</b> <code>${chatId}</code>\n` +
        `• <b>會員等級：</b> ${tierBadge}\n` +
        `• <b>推播狀態：</b> ${alertStatus}\n` +
        `• <b>追蹤蛋種：</b> ${member.filterType === 'all' ? '全部蛋種 (無過濾)' : (member.filterType === 'rare_only' ? '僅 VIP 稀有蛋' : `${trackedCount} / 28 種高階神蛋`)}\n` +
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
            { text: '📜 我的操作紀錄', callback_data: 'menu_logs' }
          ],
          [
            { text: '📊 掉落預測分析', callback_data: 'menu_predict' },
            { text: '🥚 最新 5 筆掉落', callback_data: 'menu_last' }
          ],
          [
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
      this.toggleEnabled(chatId, 'telegram');
      const newStatus = member.enabled ? '🔔 推播已【開啟】！您將會即時接收蛋掉落私訊提醒。' : '🔕 推播已【暫停】！您將不會受到私訊打擾。';
      await this.sendTelegramMessage(chatId, newStatus);
      return;
    }

    // /logs 或 /history 指令 (使用者操作日誌)
    if (text === '/logs' || text === '/history' || text === '/log') {
      await this.sendMemberLogs(chatId);
      return;
    }

    // /filter 指令 (精準蛋種過濾，支援 /filter 與 /filter <關鍵字>)
    if (text.startsWith('/filter')) {
      const query = text.replace(/^\/filter/i, '').trim();
      if (query) {
        await this.sendEggSearchResults(chatId, member, query);
      } else {
        await this.sendEggFilterMenu(chatId, 0, 'All');
      }
      return;
    }

    // /predict 或 /next (支援 /predict <蛋名> 與 /predict 選單)
    if (text.startsWith('/predict') || text.startsWith('/next')) {
      const arg = text.replace(/^\/(?:predict|next)/i, '').trim();
      if (arg) {
        await this.sendSingleEggPrediction(chatId, arg);
      } else {
        await this.sendPredictionInfo(chatId);
      }
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
        `• <code>/filter</code> - 自選想要接收的 28 款高階自然刷新神蛋 (支援地區、分頁與快速範本)\n` +
        `• <code>/filter &lt;關鍵字&gt;</code> - 快速搜尋並勾選特定蛋種 (例：<code>/filter dragon</code>, <code>/filter ocean</code>)\n` +
        `• <code>/logs</code> - 查看您最近的歷史操作日誌 (追蹤調整、範本套用、推播開關)\n` +
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
      this.toggleEnabled(chatId, 'telegram');
      await this.answerCallback(cb.id, member.enabled ? '🔔 已開啟推播' : '🔕 已暫停推播');
      await this.sendMemberCard(chatId, member, messageId);
      return;
    }

    // 3. 打開蛋種過濾設定選單
    if (data === 'menu_filter') {
      await this.answerCallback(cb.id, '載入蛋種過濾選單');
      await this.sendEggFilterMenu(chatId, 0, 'All', messageId);
      return;
    }

    // 4. 查看個人歷史操作紀錄 (Activity Log)
    if (data === 'menu_logs') {
      await this.answerCallback(cb.id, '載入操作紀錄');
      await this.sendMemberLogs(chatId, messageId);
      return;
    }

    // 5. 預測資訊
    if (data === 'menu_predict') {
      await this.answerCallback(cb.id, '計算週期分析中...');
      await this.sendPredictionInfo(chatId, messageId);
      return;
    }

    // 5.1 查看單蛋專屬預測 (egg_pred:<eggName>)
    if (data.startsWith('egg_pred:')) {
      const egg = decodeURIComponent(data.replace('egg_pred:', ''));
      await this.answerCallback(cb.id, `計算 ${egg} 預測中...`);
      await this.sendSingleEggPrediction(chatId, egg, messageId);
      return;
    }

    // 5.2 預測卡片內快速切換追蹤 (egg_toggle_pred:<eggName>)
    if (data.startsWith('egg_toggle_pred:')) {
      const egg = decodeURIComponent(data.replace('egg_toggle_pred:', ''));
      if (!Array.isArray(member.customEggNames)) member.customEggNames = [...ALL_HIGH_TIER_NAMES];
      member.filterType = 'custom';
      const exists = member.customEggNames.includes(egg);
      if (exists) {
        member.customEggNames = member.customEggNames.filter(n => n !== egg);
      } else {
        member.customEggNames.push(egg);
      }
      this.logMemberAction(chatId, 'toggle_egg', `${exists ? '取消' : '新增'}追蹤蛋種：${egg}`, 'telegram');
      this.saveLocal();
      this.syncMemberToSheet(member).catch(() => {});
      await this.answerCallback(cb.id, `${exists ? '⬜ 已取消追蹤' : '✅ 已開啟追蹤'}：${egg}`);
      await this.sendSingleEggPrediction(chatId, egg, messageId);
      return;
    }

    // 5.3 預測清單總表 (menu_pred_all)
    if (data === 'menu_pred_all') {
      await this.answerCallback(cb.id);
      await this.sendPredictionMenu(chatId, messageId);
      return;
    }

    // 6. 最新掉落
    if (data === 'menu_last') {
      await this.answerCallback(cb.id, '讀取歷史掉落...');
      await this.sendLastDrops(chatId);
      return;
    }

    // 7. 切換單顆蛋種勾選 (egg_toggle:<eggName>:<page>:<biome>)
    if (data.startsWith('egg_toggle:')) {
      const parts = data.split(':');
      const eggName = parts[1];
      const page = parseInt(parts[2], 10) || 0;
      const biome = parts[3] || 'All';

      if (!Array.isArray(member.customEggNames)) {
        member.customEggNames = [...ALL_HIGH_TIER_NAMES];
      }
      member.filterType = 'custom';

      const exists = member.customEggNames.includes(eggName);
      if (exists) {
        member.customEggNames = member.customEggNames.filter(n => n !== eggName);
      } else {
        member.customEggNames.push(eggName);
      }

      this.logMemberAction(chatId, 'toggle_egg', `${exists ? '取消' : '新增'}追蹤蛋種：${eggName}`, 'telegram');
      this.saveLocal();
      this.syncMemberToSheet(member).catch(() => {});

      await this.answerCallback(cb.id, `${exists ? '⬜ 已取消' : '✅ 已開啟'}：${eggName}`);
      await this.sendEggFilterMenu(chatId, page, biome, messageId);
      return;
    }

    // 8. 搜尋結果中的蛋種切換 (egg_search_toggle:<eggName>:<query>)
    if (data.startsWith('egg_search_toggle:')) {
      const parts = data.split(':');
      const eggName = parts[1];
      const query = decodeURIComponent(parts[2] || '');

      if (!Array.isArray(member.customEggNames)) {
        member.customEggNames = [...ALL_HIGH_TIER_NAMES];
      }
      member.filterType = 'custom';

      const exists = member.customEggNames.includes(eggName);
      if (exists) {
        member.customEggNames = member.customEggNames.filter(n => n !== eggName);
      } else {
        member.customEggNames.push(eggName);
      }

      this.logMemberAction(chatId, 'toggle_egg', `${exists ? '取消' : '新增'}追蹤蛋種：${eggName}`, 'telegram');
      this.saveLocal();
      this.syncMemberToSheet(member).catch(() => {});

      await this.answerCallback(cb.id, `${exists ? '⬜ 已取消' : '✅ 已開啟'}：${eggName}`);
      await this.sendEggSearchResults(chatId, member, query, messageId);
      return;
    }

    // 9. 蛋種過濾快捷範本 (egg_preset:<preset>:<page>:<biome>)
    if (data.startsWith('egg_preset:')) {
      const parts = data.split(':');
      const preset = parts[1];
      const page = parseInt(parts[2], 10) || 0;
      const biome = parts[3] || 'All';

      member.filterType = 'custom';
      if (preset === 'high28') {
        member.customEggNames = [...ALL_HIGH_TIER_NAMES];
        this.logMemberAction(chatId, 'apply_preset', '套用範本：28種高階神蛋全選', 'telegram');
        await this.answerCallback(cb.id, '⭐ 已全選 28 種高階神蛋！');
      } else if (preset === 'top10') {
        member.customEggNames = [...TOP_10_EGG_NAMES];
        this.logMemberAction(chatId, 'apply_preset', '套用範本：Top 10 神級蛋清單', 'telegram');
        await this.answerCallback(cb.id, '🔥 已勾選 Top 10 神級蛋！');
      } else if (preset === 'clear') {
        member.customEggNames = [];
        this.logMemberAction(chatId, 'apply_preset', '清空所有自選追蹤蛋種', 'telegram');
        await this.answerCallback(cb.id, '🗑️ 已清空追蹤清單');
      }

      this.saveLocal();
      this.syncMemberToSheet(member).catch(() => {});
      await this.sendEggFilterMenu(chatId, page, biome, messageId);
      return;
    }

    // 10. 切換地區分類 (egg_biome:<biome>)
    if (data.startsWith('egg_biome:')) {
      const biome = data.replace('egg_biome:', '');
      await this.answerCallback(cb.id, `切換分區：${BIOME_LABELS[biome] || biome}`);
      await this.sendEggFilterMenu(chatId, 0, biome, messageId);
      return;
    }

    // 11. 切換分頁 (egg_page:<page>:<biome>)
    if (data.startsWith('egg_page:')) {
      const parts = data.split(':');
      const page = parseInt(parts[1], 10) || 0;
      const biome = parts[2] || 'All';
      await this.answerCallback(cb.id);
      await this.sendEggFilterMenu(chatId, page, biome, messageId);
      return;
    }

    // 12. 兼容舊版稀有度切換 (rarity_toggle:<name>)
    if (data.startsWith('rarity_toggle:')) {
      const rarity = data.replace('rarity_toggle:', '');
      member.filterType = 'custom';
      if (!Array.isArray(member.customRarities)) member.customRarities = [];

      if (member.customRarities.includes(rarity)) {
        member.customRarities = member.customRarities.filter(r => r !== rarity);
      } else {
        member.customRarities.push(rarity);
      }

      this.logMemberAction(chatId, 'toggle_rarity', `切換稀有度：${rarity}`, 'telegram');
      this.saveLocal();
      this.syncMemberToSheet(member).catch(() => {});

      await this.answerCallback(cb.id, `已切換 ${rarity}`);
      await this.sendEggFilterMenu(chatId, 0, 'All', messageId);
      return;
    }

    // 13. 關閉選單
    if (data === 'menu_close') {
      await this.answerCallback(cb.id, '選單已關閉');
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
    const trackedCount = (member.customEggNames || []).length;
    const filterText = member.filterType === 'all'
      ? '全部蛋種 (無過濾)'
      : (member.filterType === 'rare_only'
          ? '僅 VIP 稀有蛋'
          : `精選蛋種 (${trackedCount} / 28 種)`);

    const cardHtml = `💳 <b>【Steal An Egg 個人會員中心】</b>\n\n` +
      `• <b>會員暱稱：</b> ${member.firstName} (@${member.username || '未設定'})\n` +
      `• <b>會員編號：</b> <code>${chatId}</code>\n` +
      `• <b>會員身分：</b> ${tierBadge}\n` +
      `• <b>VIP 到期日：</b> ${expireText}\n` +
      `• <b>推播提醒：</b> ${member.enabled !== false ? '🔔 即時接收中' : '🔕 已暫停推播'}\n` +
      `• <b>過濾設定：</b> ${filterText}\n` +
      `• <b>累計快訊：</b> 已接收 ${member.notificationsCount || 0} 則掉落通知\n` +
      `• <b>操作紀錄：</b> 累計 ${(member.activityLogs || []).length} 筆歷史足跡\n\n` +
      (!isVip && !isSuperAdmin ? `💡 <i>提示：VIP 會員享有 1 對 1 私訊推播神級 Secret 蛋與專屬關鍵字通知！請聯繫管理員開通。</i>` : '');

    const keyboard = {
      inline_keyboard: [
        [
          { text: member.enabled !== false ? '🔕 暫停推播' : '🔔 開啟推播', callback_data: 'menu_toggle' },
          { text: '⚙️ 調整蛋種過濾', callback_data: 'menu_filter' }
        ],
        [
          { text: '📜 我的操作紀錄', callback_data: 'menu_logs' },
          { text: '📊 週期預測', callback_data: 'menu_predict' }
        ],
        [
          { text: '🥚 最近掉落', callback_data: 'menu_last' },
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

  // 發送或編輯蛋種過濾選單 (具備地區分類、分頁、與即時勾選)
  async sendEggFilterMenu(chatId, page = 0, biome = 'All', messageId = null) {
    const member = this.members.get(String(chatId)) || this.registerMember(chatId);
    if (!Array.isArray(member.customEggNames)) {
      member.customEggNames = [...ALL_HIGH_TIER_NAMES];
    }
    const selectedEggs = member.customEggNames;

    // 依地區篩選
    const filteredEggs = biome === 'All'
      ? HIGH_TIER_EGGS
      : HIGH_TIER_EGGS.filter(e => e.biome === biome);

    const PAGE_SIZE = 6;
    const totalPages = Math.max(1, Math.ceil(filteredEggs.length / PAGE_SIZE));
    const currentPage = Math.min(Math.max(0, page), totalPages - 1);
    const pageEggs = filteredEggs.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

    const modeBadge = member.filterType === 'all'
      ? '🔔 全部接收 (不限蛋種)'
      : (member.filterType === 'rare_only' ? '👑 僅 VIP 稀有蛋' : '🎯 自選精準蛋種');

    const biomeLabel = BIOME_LABELS[biome] || biome;

    let text = `⚙️ <b>【Telegram 蛋種精準推播設定】</b>\n\n` +
      `• <b>接收模式：</b> ${modeBadge}\n` +
      `• <b>追蹤數量：</b> <b>${selectedEggs.length} / 28 款高階神蛋</b>\n` +
      `• <b>當前分區：</b> <b>${biomeLabel}</b> (共 ${filteredEggs.length} 款，第 ${currentPage + 1}/${totalPages} 頁)\n\n` +
      `👇 <i>點擊下方蛋名按鈕切換【✅ 追蹤 / ⬜ 忽略】：</i>\n` +
      `💡 <i>小撇步：可直接輸入 <code>/filter &lt;關鍵字&gt;</code> 搜尋（例：<code>/filter dragon</code>）</i>`;

    // 1. 範本快捷行
    const presetRow = [
      { text: '⭐ 28種全選', callback_data: `egg_preset:high28:${currentPage}:${biome}` },
      { text: '🔥 Top 10 神蛋', callback_data: `egg_preset:top10:${currentPage}:${biome}` },
      { text: '🗑️ 清空清單', callback_data: `egg_preset:clear:${currentPage}:${biome}` }
    ];

    // 2. 地區快捷分類按鈕 (3 列，每列 3 顆)
    const biomesList = [
      ['All', 'Cosmic', 'Titan Temple'],
      ['Volcano', 'Abyss Ocean', 'Angels & Demons'],
      ['Prehistoric', 'Cherry Blossom', 'Snow']
    ];
    const biomeButtons = biomesList.map(row => {
      return row.map(bKey => {
        const isActive = biome === bKey;
        const shortName = {
          'All': '🌐 全部',
          'Cosmic': '🪐 宇宙',
          'Titan Temple': '🏛️ 泰坦',
          'Volcano': '🌋 火山',
          'Abyss Ocean': '🌊 深海',
          'Angels & Demons': '👼 天使惡魔',
          'Prehistoric': '🦖 史前',
          'Cherry Blossom': '🌸 櫻花',
          'Snow': '❄️ 冰雪'
        }[bKey] || bKey;

        return {
          text: isActive ? `🔘 ${shortName}` : shortName,
          callback_data: `egg_biome:${bKey}`
        };
      });
    });

    // 3. 蛋種網格 (2 列 x 3 行 = 6 顆)
    const eggRows = [];
    for (let i = 0; i < pageEggs.length; i += 2) {
      const e1 = pageEggs[i];
      const e2 = pageEggs[i + 1];
      const is1On = selectedEggs.includes(e1.name);
      const row = [
        { text: `${is1On ? '✅' : '⬜'} ${e1.name}`, callback_data: `egg_toggle:${e1.name}:${currentPage}:${biome}` }
      ];
      if (e2) {
        const is2On = selectedEggs.includes(e2.name);
        row.push({
          text: `${is2On ? '✅' : '⬜'} ${e2.name}`,
          callback_data: `egg_toggle:${e2.name}:${currentPage}:${biome}`
        });
      }
      eggRows.push(row);
    }

    // 4. 分頁控制行
    const prevPage = (currentPage - 1 + totalPages) % totalPages;
    const nextPage = (currentPage + 1) % totalPages;
    const navRow = [
      { text: '◀️ 上一頁', callback_data: `egg_page:${prevPage}:${biome}` },
      { text: `📄 ${currentPage + 1} / ${totalPages}`, callback_data: `egg_page:${currentPage}:${biome}` },
      { text: '下一頁 ▶️', callback_data: `egg_page:${nextPage}:${biome}` }
    ];

    // 5. 底部動作行
    const footerRow = [
      { text: '📜 我的操作紀錄', callback_data: 'menu_logs' },
      { text: '👤 會員中心', callback_data: 'menu_me' },
      { text: '❌ 關閉', callback_data: 'menu_close' }
    ];

    const keyboard = {
      inline_keyboard: [
        presetRow,
        ...biomeButtons,
        ...eggRows,
        navRow,
        footerRow
      ]
    };

    if (messageId) {
      await this.editMessageText(chatId, messageId, text, { reply_markup: keyboard });
    } else {
      await this.sendTelegramMessage(chatId, text, { reply_markup: keyboard });
    }
  }

  // 關鍵字搜尋蛋種結果視圖
  async sendEggSearchResults(chatId, member, query, messageId = null) {
    const qLower = query.toLowerCase();
    const matched = HIGH_TIER_EGGS.filter(e =>
      e.name.toLowerCase().includes(qLower) ||
      e.rarity.toLowerCase().includes(qLower) ||
      e.biome.toLowerCase().includes(qLower)
    );

    let text = `🔍 <b>【蛋種搜尋結果】關鍵字：「${query}」</b>\n\n`;
    if (matched.length === 0) {
      text += `找不到符合名稱、稀有度或地區的高階蛋。\n建議搜尋：<code>dragon</code>, <code>cosmic</code>, <code>ocean</code>, <code>volcano</code>\n\n` +
        `點擊下方按鈕瀏覽完整清單：`;
      const keyboard = {
        inline_keyboard: [
          [{ text: '⚙️ 返回完整蛋種選單', callback_data: 'menu_filter' }],
          [{ text: '❌ 關閉', callback_data: 'menu_close' }]
        ]
      };
      if (messageId) {
        return this.editMessageText(chatId, messageId, text, { reply_markup: keyboard });
      }
      return this.sendTelegramMessage(chatId, text, { reply_markup: keyboard });
    }

    text += `找到 <b>${matched.length}</b> 款相符高階神蛋，點擊切換勾選：\n`;
    const selected = member.customEggNames || [];

    const eggButtons = [];
    for (let i = 0; i < matched.length; i += 2) {
      const e1 = matched[i];
      const e2 = matched[i + 1];
      const is1On = selected.includes(e1.name);
      const row = [
        { text: `${is1On ? '✅' : '⬜'} ${e1.name}`, callback_data: `egg_search_toggle:${e1.name}:${encodeURIComponent(query)}` }
      ];
      if (e2) {
        const is2On = selected.includes(e2.name);
        row.push({ text: `${is2On ? '✅' : '⬜'} ${e2.name}`, callback_data: `egg_search_toggle:${e2.name}:${encodeURIComponent(query)}` });
      }
      eggButtons.push(row);
    }

    const keyboard = {
      inline_keyboard: [
        ...eggButtons,
        [
          { text: '⚙️ 返回完整選單', callback_data: 'menu_filter' },
          { text: '📜 我的操作紀錄', callback_data: 'menu_logs' }
        ],
        [
          { text: '❌ 關閉', callback_data: 'menu_close' }
        ]
      ]
    };

    if (messageId) {
      await this.editMessageText(chatId, messageId, text, { reply_markup: keyboard });
    } else {
      await this.sendTelegramMessage(chatId, text, { reply_markup: keyboard });
    }
  }

  // 檢視個人操作歷史日誌 (Activity Log)
  async sendMemberLogs(chatId, messageId = null) {
    const member = this.members.get(String(chatId)) || this.registerMember(chatId);
    const logs = member.activityLogs || [];

    let text = `📜 <b>【個人歷史操作日誌】</b>\n` +
      `帳號：<code>${chatId}</code> (${member.firstName})\n\n`;

    if (logs.length === 0) {
      text += `<i>目前尚無任何操作紀錄。\n當您調整蛋種勾選、套用範本、切換推播或於網頁登入時，系統將自動為您保存足跡！</i>\n\n`;
    } else {
      text += `<b>最近 ${Math.min(logs.length, 10)} 筆操作明細：</b>\n\n`;
      const recent = logs.slice(0, 10);
      recent.forEach((log, idx) => {
        const time = new Date(log.timestamp).toLocaleString('zh-TW', {
          timeZone: 'Asia/Taipei',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });
        const sourceIcon = log.source === 'web' ? '🌐 [網頁]' : (log.source === 'system' ? '⚙️ [系統]' : '📱 [TG]');
        text += `${idx + 1}. <b>${time}</b> ${sourceIcon}\n   ${log.description}\n\n`;
      });
      text += `💡 <i>系統保存最新 50 筆紀錄。網頁儀表板個人設定亦可即時查看！</i>`;
    }

    const keyboard = {
      inline_keyboard: [
        [
          { text: '⚙️ 調整蛋種設定', callback_data: 'menu_filter' },
          { text: '👤 會員中心', callback_data: 'menu_me' }
        ],
        [
          { text: '❌ 關閉', callback_data: 'menu_close' }
        ]
      ]
    };

    if (messageId) {
      await this.editMessageText(chatId, messageId, text, { reply_markup: keyboard });
    } else {
      await this.sendTelegramMessage(chatId, text, { reply_markup: keyboard });
    }
  }

  // 兼容舊版呼叫
  async sendFilterKeyboard(chatId, member, messageId = null) {
    return this.sendEggFilterMenu(chatId, 0, 'All', messageId);
  }

  // 查詢週期預測 (全域 5 分鐘 + 熱門神蛋預測快捷鍵)
  async sendPredictionInfo(chatId, messageId = null) {
    let p = null;
    if (this.statsProvider && typeof this.statsProvider.getPrediction === 'function') {
      p = this.statsProvider.getPrediction();
    }

    const nextTimeStr = p ? p.predictedTimeStr : '計算中';
    const minutesLeft = p ? p.minutesLeft : 5;
    const avgInt = p ? (p.rareBroadcastIntervalMinutes || '8.5') : '8.5';

    const predText = `📊 <b>【Steal An Egg 週期與掉落預測】</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `• <b>伺服器出蛋規律：</b> 每 5 分鐘固定一輪 (xx:00, xx:05, xx:10...)\n` +
      `• <b>下次伺服器出蛋：</b> <b>${nextTimeStr}</b> (約 <b>${minutesLeft}</b> 分鐘後)\n` +
      `• <b>稀有蛋平均間隔：</b> 約 <b>${avgInt}</b> 分鐘 (每 1~2 輪出蛋)\n\n` +
      `🎯 <b>【單蛋專屬掉落預測】：</b>\n` +
      `點擊下方神蛋直接查看<b>粗估多久後出現、距上次多久、是否逾期爆蛋</b>，或直接輸入 <code>/predict &lt;蛋名&gt;</code> (例: <code>/predict World Burner</code>, <code>/predict 鯊魚</code>)：`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🔥 World Burner', callback_data: 'egg_pred:World Burner' },
          { text: '🪐 Cosmic Dragon', callback_data: 'egg_pred:Cosmic Dragon' }
        ],
        [
          { text: '🦈 Mutant Shark', callback_data: 'egg_pred:Mutant Shark' },
          { text: '👼 ArchAngel', callback_data: 'egg_pred:ArchAngel' }
        ],
        [
          { text: '🐙 Kraken', callback_data: 'egg_pred:Kraken' },
          { text: '🗿 Gargoyle', callback_data: 'egg_pred:Gargoyle' }
        ],
        [
          { text: '🦅 Phoenix', callback_data: 'egg_pred:Phoenix' },
          { text: '🦖 Mosasaurus', callback_data: 'egg_pred:Mosasaurus' }
        ],
        [
          { text: '👑 Gorilla King', callback_data: 'egg_pred:Gorilla King' },
          { text: '🌸 Kitsune', callback_data: 'egg_pred:Kitsune' }
        ],
        [
          { text: '📋 28 款高階神蛋完整預測選單', callback_data: 'menu_pred_all' }
        ],
        [
          { text: '🌐 開啟儀表板動態雷達', url: 'https://stealanegg.onrender.com/' }
        ]
      ]
    };

    if (messageId) {
      await this.editMessageText(chatId, messageId, predText, { reply_markup: keyboard });
    } else {
      await this.sendTelegramMessage(chatId, predText, { reply_markup: keyboard });
    }
  }

  // 查詢單蛋專屬預測
  async sendSingleEggPrediction(chatId, query, messageId = null) {
    if (!this.statsProvider || typeof this.statsProvider.getEggPrediction !== 'function') {
      await this.sendTelegramMessage(chatId, '📊 預測系統正在讀取最新歷史紀錄，請稍候片刻再試！');
      return;
    }

    const p = this.statsProvider.getEggPrediction(query);
    if (!p) {
      await this.sendTelegramMessage(chatId, `❌ 找不到與「${query}」相符的高階神蛋，請確認名稱（例：<code>/predict Cosmic</code>, <code>/predict World Burner</code>）。`);
      return;
    }

    const member = this.members.get(String(chatId));
    const isTracked = member && Array.isArray(member.customEggNames) && member.customEggNames.includes(p.name);

    const barLen = 10;
    const filled = Math.min(barLen, Math.max(0, Math.round((p.progressPercent / 100) * barLen)));
    const progressBarStr = '█'.repeat(filled) + '░'.repeat(barLen - filled);

    let estDesc = '';
    if (p.estimatedMinutesLeft === 0) {
      estDesc = `🔥 <b>【已超逾動態預期週期！】</b>\n👉 逾期約 <b>${p.overdueMinutes}</b> 分鐘，已進入<b>超高爆蛋警戒窗口</b>，預計在即刻 ~ 15 分鐘內現身！`;
    } else if (p.status === 'rare_prior') {
      estDesc = `💎 <b>【超稀有活動神聖蛋】</b>\n👉 歷史出現頻率極低，活動基準週期約 <b>${Math.round(p.avgIntervalMin / 60)} 小時</b>。隨機性高，每輪 5 分鐘皆有極小爆率！`;
    } else {
      estDesc = `👉 <b>粗估約剩餘 ${p.estimatedMinutesLeft} 分鐘</b> (預計約 <b>${p.predictedTimeStr}</b> 左右)\n👉 <b>動態預估窗口：</b> ${p.predictedRangeStr || `約 ${p.estimatedMinutesLeft} 分鐘`}`;
    }

    const genesisPart = p.genesisNote ? `🌟 <b>活動起點：</b> ${p.genesisNote}\n` : '';

    const text = `🔮 <b>【${p.name} 專屬掉落預測分析】</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `🌟 <b>稀有度：</b> ${p.rarity} | 🗺️ <b>生態地區：</b> ${p.biome}\n` +
      genesisPart +
      `📊 <b>歷史總掉落：</b> <b>${p.count}</b> 次 (跨伺服器監測統計)\n` +
      `🕒 <b>上次現身時間：</b> ${p.minutesSinceLast !== null ? `<b>${p.minutesSinceLast}</b> 分鐘前 (${p.lastSeenStr} @ ${p.lastLocation})` : '近期無紀錄 (極品神蛋)'}\n\n` +
      `⚡ <b>【高峰 / 常態 / 低谷三軌週期】：</b>\n` +
      `• ⚡ <b>高峰連鎖期：</b> 約 <b>${p.burstIntervalMin || Math.round(p.avgIntervalMin * 0.35)}</b> 分鐘 (密集連出波段)\n` +
      `• ⚖️ <b>常態中位數：</b> 約 <b>${p.medianIntervalMin || p.avgIntervalMin}</b> 分鐘\n` +
      `• ❄️ <b>低谷蓄能上限：</b> 約 <b>${p.valleyIntervalMin || Math.round(p.avgIntervalMin * 1.6)}</b> 分鐘 (乾旱延遲上限)\n` +
      `• 📈 <b>近 5 筆節奏 (EMA)：</b> 約 <b>${p.recentAvgMin || p.avgIntervalMin}</b> 分鐘 (權重 60%)\n\n` +
      `⏳ <b>【下次出蛋時間預估】：</b>\n` +
      `${estDesc}\n\n` +
      `📈 <b>週期累積進度：</b> <code>[${progressBarStr}] ${p.progressPercent}%</code>\n` +
      `🏷️ <b>當前波段：</b> <b>${p.phaseText || p.statusText}</b>\n\n` +
      `🔔 <b>推播追蹤：</b> ${isTracked ? '✅ 已加入您的自訂推播名單' : '⬜ 未加入推播名單 (點擊下方即可一鍵追蹤)'}`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: isTracked ? '🔕 從推播取消此蛋' : '🔔 接收此蛋即時推播', callback_data: `egg_toggle_pred:${encodeURIComponent(p.name)}` },
          { text: '🔄 刷新預測', callback_data: `egg_pred:${encodeURIComponent(p.name)}` }
        ],
        [
          { text: '📋 查看 28 款神蛋選單', callback_data: 'menu_pred_all' },
          { text: '📊 全域 5 分鐘倒數', callback_data: 'menu_predict' }
        ]
      ]
    };

    if (messageId) {
      await this.editMessageText(chatId, messageId, text, { reply_markup: keyboard });
    } else {
      await this.sendTelegramMessage(chatId, text, { reply_markup: keyboard });
    }
  }

  // 28 款高階神蛋預測總表選單
  async sendPredictionMenu(chatId, messageId = null) {
    const text = `🎯 <b>【28 款高階神蛋掉落預測清單】</b>\n\n` +
      `點擊下方任意蛋種，即可查看其歷史平均週期、距上次出現時間與粗估下次掉落倒數：`;

    const rows = [];
    for (let i = 0; i < ALL_HIGH_TIER_NAMES.length; i += 2) {
      const egg1 = ALL_HIGH_TIER_NAMES[i];
      const egg2 = ALL_HIGH_TIER_NAMES[i + 1];
      const row = [{ text: egg1, callback_data: `egg_pred:${encodeURIComponent(egg1)}` }];
      if (egg2) {
        row.push({ text: egg2, callback_data: `egg_pred:${encodeURIComponent(egg2)}` });
      }
      rows.push(row);
    }
    rows.push([
      { text: '◀️ 返回全域 5 分鐘預測', callback_data: 'menu_predict' },
      { text: '⚙️ 蛋種推播過濾', callback_data: 'menu_filter' }
    ]);

    const keyboard = { inline_keyboard: rows };
    if (messageId) {
      await this.editMessageText(chatId, messageId, text, { reply_markup: keyboard });
    } else {
      await this.sendTelegramMessage(chatId, text, { reply_markup: keyboard });
    }
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
