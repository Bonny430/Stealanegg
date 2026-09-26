// Steal An Egg Dashboard Client
let eggsCatalog = [];

// 28 種官方可刷新高階蛋種清單
const DEFAULT_HIGH_TIER_NAMES = [
  'Pure Jellyfish', 'Gargoyle', 'Kraken', 'T-Rex', 'Tralaledon', 'Cosmic Dragon',
  'Mutant Shark', 'Cerberus', 'Stag', 'Mosasaurus', 'Oni Tiger', 'Cosmic Skeleton Boss',
  'Yeti', 'Eternal Lunar Dragon', 'Gorilla King', 'Phoenix', 'Centaur', 'Ice Dragon',
  'Lava Dragon', 'Pegasus', 'Skeleton Horse', 'King Snake', 'Unicorn', 'El Maja',
  'Kitsune', 'ArchAngel', 'Nightflame', 'World Burner'
];

let userConfig = {
  filterEnabled: true,
  selectedEggs: [...DEFAULT_HIGH_TIER_NAMES],
  ignoredEggs: []
};
let predictionData = null;
let nextSpawnTimestamp = null;
let countdownInterval = null;

const RARITIES_ORDER = ['Eternal', 'Secret', 'Divine', 'Cosmic', 'Mythic', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Common', 'Monster', 'Event'];

// DOM 元素
const botStatusBadge = document.getElementById('botStatusBadge');
const botStatusText = document.getElementById('botStatusText');
const countdownTimer = document.getElementById('countdownTimer');
const predictedTimeText = document.getElementById('predictedTimeText');
const avgInterval = document.getElementById('avgInterval');
const recentAvg = document.getElementById('recentAvg');
const totalRecords = document.getElementById('totalRecords');
const topEggsList = document.getElementById('topEggsList');
const eggActiveCountBadge = document.getElementById('eggActiveCountBadge');
const eggsGrid = document.getElementById('eggsGrid');
const eggSearchInput = document.getElementById('eggSearchInput');
const eggCountBadge = document.getElementById('eggCountBadge');
const masterFilterSwitch = document.getElementById('masterFilterSwitch');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const historyTableBody = document.getElementById('historyTableBody');
const refreshBtn = document.getElementById('refreshBtn');
const syncHistoryBtn = document.getElementById('syncHistoryBtn');
const syncProgress = document.getElementById('syncProgress');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const toast = document.getElementById('toast');
const monitoredChannelsCount = document.getElementById('monitoredChannelsCount');
const crossVerifiedBadge = document.getElementById('crossVerifiedBadge');
const channelsGrid = document.getElementById('channelsGrid');
const latestCrossVerification = document.getElementById('latestCrossVerification');
const latestCrossVerificationText = document.getElementById('latestCrossVerificationText');

// 即時掉落串流 (Live Ticker) & 提示音元素
const liveTickerCard = document.getElementById('liveTickerCard');
const liveStatusDot = document.getElementById('liveStatusDot');
const liveStatusLabel = document.getElementById('liveStatusLabel');
const liveTickerStream = document.getElementById('liveTickerStream');
const toggleSoundBtn = document.getElementById('toggleSoundBtn');
const soundBtnIcon = document.getElementById('soundBtnIcon');
const soundBtnLabel = document.getElementById('soundBtnLabel');
const toggleTickerPauseBtn = document.getElementById('toggleTickerPauseBtn');
const pauseBtnIcon = document.getElementById('pauseBtnIcon');
const pauseBtnLabel = document.getElementById('pauseBtnLabel');

let isTickerPaused = false;
let audioCtx = null;
let soundAlertEnabled = localStorage.getItem('egg_sound_enabled') === 'true';
let lastKnownNewestTimestamp = null;

// Web Audio API 提示音系統 (合成水晶音和弦，零外鏈依賴)
function playDropSound(isHighTier = false) {
  if (!soundAlertEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = isHighTier ? 'triangle' : 'sine';
    if (isHighTier) {
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
      osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.28); // D6
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    } else {
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.15); // E5
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    }
  } catch (err) {
    console.warn('[Audio] 提示音播放失敗:', err.message);
  }
}

function updateSoundBtnUI() {
  if (!toggleSoundBtn) return;
  if (soundAlertEnabled) {
    toggleSoundBtn.classList.add('active');
    if (soundBtnIcon) soundBtnIcon.textContent = '🔔';
    if (soundBtnLabel) soundBtnLabel.textContent = '提示音: 開';
  } else {
    toggleSoundBtn.classList.remove('active');
    if (soundBtnIcon) soundBtnIcon.textContent = '🔇';
    if (soundBtnLabel) soundBtnLabel.textContent = '提示音: 關';
  }
}

function getRelativeTimeAgo(isoStr) {
  if (!isoStr) return '';
  const diffSec = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (isNaN(diffSec) || diffSec < 0) return '剛剛';
  if (diffSec < 60) return `${diffSec}秒前`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  return `${hr}小時前`;
}

function updateLiveTicker(rows) {
  if (!liveTickerStream || isTickerPaused || !Array.isArray(rows) || rows.length === 0) return;
  
  const topRows = rows.slice(0, 8);
  const newestTime = new Date(topRows[0]?.timestamp || topRows[0]?.twTime).getTime();
  
  if (lastKnownNewestTimestamp !== null && newestTime > lastKnownNewestTimestamp) {
    const newestEgg = topRows[0];
    const isHigh = ['divine', 'eternal', 'secret', 'mythic'].includes((newestEgg.rarity || '').toLowerCase());
    playDropSound(isHigh);
    showToast(`⚡ 全服即時出蛋：[${newestEgg.rarity}] ${newestEgg.name} (${newestEgg.biome || '未知'})`, 'info');
  }
  if (!isNaN(newestTime)) {
    lastKnownNewestTimestamp = newestTime;
  }

  liveTickerStream.innerHTML = topRows.map(r => {
    const eggImg = getEggImage(r.name);
    const rar = (r.rarity || '').toLowerCase();
    let glowClass = '';
    if (rar === 'divine') glowClass = 'glow-divine';
    else if (rar === 'eternal') glowClass = 'glow-eternal';
    else if (rar === 'secret') glowClass = 'glow-secret';

    const tAgo = getRelativeTimeAgo(r.timestamp);

    return `
      <div class="ticker-drop-pill ${glowClass}">
        <img src="${eggImg}" class="ticker-egg-img" referrerpolicy="no-referrer" onerror="this.src='https://cdn.discordapp.com/emojis/1547091103537438741.png'">
        <span class="ticker-egg-name">${escapeHtml(r.name)}</span>
        <span class="db-table-badge ${rar}">${r.rarity || 'Normal'}</span>
        <span class="ticker-time-ago">${tAgo}</span>
      </div>
    `;
  }).join('');
}

function initLiveTickerControls() {
  updateSoundBtnUI();

  if (toggleSoundBtn) {
    toggleSoundBtn.onclick = () => {
      soundAlertEnabled = !soundAlertEnabled;
      localStorage.setItem('egg_sound_enabled', String(soundAlertEnabled));
      updateSoundBtnUI();
      if (soundAlertEnabled) {
        playDropSound(true);
        showToast('🔔 出蛋提示音已開啟 (神聖/永恆/秘密出蛋時清脆提醒)', 'success');
      } else {
        showToast('🔇 出蛋提示音已關閉', 'info');
      }
    };
  }

  if (toggleTickerPauseBtn) {
    toggleTickerPauseBtn.onclick = () => {
      isTickerPaused = !isTickerPaused;
      if (isTickerPaused) {
        if (liveStatusDot) liveStatusDot.classList.add('paused');
        if (liveStatusLabel) liveStatusLabel.textContent = 'PAUSED 已暫停';
        if (pauseBtnIcon) pauseBtnIcon.textContent = '▶️';
        if (pauseBtnLabel) pauseBtnLabel.textContent = '繼續';
        showToast('⏸️ 即時串流已暫停更新', 'info');
      } else {
        if (liveStatusDot) liveStatusDot.classList.remove('paused');
        if (liveStatusLabel) liveStatusLabel.textContent = 'LIVE 即時出蛋串流';
        if (pauseBtnIcon) pauseBtnIcon.textContent = '⏸️';
        if (pauseBtnLabel) pauseBtnLabel.textContent = '即時';
        loadHistory(true);
        showToast('▶️ 即時串流已恢復更新', 'success');
      }
    };
  }
}

// 斷線橫幅與 Token 更新 Modal DOM 元素
const offlineAlertBanner = document.getElementById('offlineAlertBanner');
const offlineAlertDesc = document.getElementById('offlineAlertDesc');
const openTokenModalBtn = document.getElementById('openTokenModalBtn');
const tokenModal = document.getElementById('tokenModal');
const closeTokenModalBtn = document.getElementById('closeTokenModalBtn');
const cancelTokenModalBtn = document.getElementById('cancelTokenModalBtn');
const submitTokenBtn = document.getElementById('submitTokenBtn');
const discordTokenInput = document.getElementById('discordTokenInput');
const tokenUpdateError = document.getElementById('tokenUpdateError');

// Toast 提示
function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

// 格式化時間 (Asia/Taipei)
function formatTime(isoStr) {
  if (!isoStr) return '--:--:--';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

function formatDateTime(isoStr) {
  if (!isoStr) return '--';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const timeStr = d.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const dateStr = d.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
  return `${dateStr} ${timeStr}`;
}

// 倒數計時器 (嚴格對齊遊戲 5 分鐘固定重生整點: xx:00, xx:05, xx:10, xx:15...)
function updateCountdown() {
  const now = Date.now();
  const cycleMs = 5 * 60 * 1000;
  let target = Math.ceil(now / cycleMs) * cycleMs;
  // 若剛好在整點的 2 秒內（伺服器正在生成並由 Bot 檢測），提示即將掉落
  if (target - now <= 2000) {
    countdownTimer.textContent = '即將掉落！';
    countdownTimer.style.color = '#10b981';
    return;
  }

  const diffMs = target - now;
  const totalSec = Math.floor(diffMs / 1000);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const mStr = minutes.toString().padStart(2, '0');
  const sStr = seconds.toString().padStart(2, '0');

  countdownTimer.textContent = `${mStr}:${sStr}`;
  countdownTimer.style.color = '';
}

// Modal 控制邏輯
function openTokenModal() {
  if (!tokenModal) return;
  tokenModal.classList.remove('hidden');
  if (discordTokenInput) {
    discordTokenInput.value = '';
    discordTokenInput.focus();
  }
  if (tokenUpdateError) {
    tokenUpdateError.textContent = '';
    tokenUpdateError.classList.add('hidden');
  }
}

function closeTokenModal() {
  if (tokenModal) tokenModal.classList.add('hidden');
}

if (openTokenModalBtn) openTokenModalBtn.onclick = openTokenModal;
if (closeTokenModalBtn) closeTokenModalBtn.onclick = closeTokenModal;
if (cancelTokenModalBtn) cancelTokenModalBtn.onclick = closeTokenModal;

if (submitTokenBtn) {
  submitTokenBtn.onclick = async () => {
    const token = discordTokenInput ? discordTokenInput.value.trim() : '';
    if (!token) {
      if (tokenUpdateError) {
        tokenUpdateError.textContent = '請先貼上有效的 Discord Token！';
        tokenUpdateError.classList.remove('hidden');
      }
      return;
    }

    submitTokenBtn.disabled = true;
    submitTokenBtn.textContent = '驗證連線中...';
    if (tokenUpdateError) tokenUpdateError.classList.add('hidden');

    try {
      const res = await fetch('/api/update-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const result = await res.json();
      if (res.ok && result.success) {
        showToast(`🎉 連線成功！身分：${result.user || 'Discord 小號'}`, 'success');
        closeTokenModal();
        await loadStatus();
      } else {
        if (tokenUpdateError) {
          tokenUpdateError.textContent = result.error || 'Token 驗證失敗，請檢查代碼是否正確';
          tokenUpdateError.classList.remove('hidden');
        }
      }
    } catch (e) {
      if (tokenUpdateError) {
        tokenUpdateError.textContent = `請求失敗: ${e.message}`;
        tokenUpdateError.classList.remove('hidden');
      }
    } finally {
      submitTokenBtn.disabled = false;
      submitTokenBtn.innerHTML = '<span>🚀 驗證並連線</span>';
    }
  };
}

// 載入機器人狀態 (支援多頻道交叉比對)
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.online) {
      botStatusBadge.className = 'status-badge';
      botStatusBadge.style.cursor = 'default';
      botStatusBadge.onclick = null;
      botStatusText.textContent = `多源監聽中 (${data.accessibleCount || data.channelCount} 頻道)`;
      if (offlineAlertBanner) offlineAlertBanner.classList.add('hidden');
    } else {
      botStatusBadge.className = 'status-badge error';
      botStatusBadge.style.cursor = 'pointer';
      botStatusBadge.onclick = openTokenModal;
      botStatusText.textContent = '小號離線 (點此更新 Token)';
      if (offlineAlertBanner) {
        offlineAlertBanner.classList.remove('hidden');
        if (offlineAlertDesc && data.lastError) {
          offlineAlertDesc.textContent = `${data.lastError}，目前無法接收伺服器出蛋通知。請更新 Token 以恢復自動推播。`;
        }
      }
    }

    // 渲染多頻道監控卡片
    if (monitoredChannelsCount) {
      monitoredChannelsCount.textContent = `${data.accessibleCount || 0} / ${data.channelCount || 0} 個頻道運作中`;
    }

    if (crossVerifiedBadge && data.crossCheckStats) {
      crossVerifiedBadge.textContent = `交叉驗證：${data.crossCheckStats.crossVerifiedCount || 0} 次`;
    }

    if (channelsGrid && Array.isArray(data.monitoredChannels)) {
      channelsGrid.innerHTML = data.monitoredChannels.map(c => {
        let tagClass = 'tag-normal';
        let tagText = '備援通報源';
        if (c.id === '1541597188163899493') {
          tagClass = 'tag-speed';
          tagText = '⚡ 極速秒級源 (~2s)';
        } else if (c.id === '1533067560134906007') {
          tagClass = 'tag-official';
          tagText = '👑 SenZ 官方源';
        } else if (c.id === '1540093905935278161') {
          tagClass = 'tag-mirror';
          tagText = '📡 分流鏡像源';
        } else if (c.id === '1541596326008066068' || c.id === '1541596390474514512') {
          tagClass = 'tag-tier';
          tagText = '⭐ 專屬階級源';
        }

        const statusBadge = c.accessible
          ? `<span class="ch-status-pill online"><span class="ch-dot"></span>監聽中</span>`
          : `<span class="ch-status-pill offline">🔒 待權限</span>`;

        return `
          <div class="channel-card ${c.accessible ? 'active' : 'inactive'}">
            <div class="channel-card-top">
              <span class="channel-tag ${tagClass}">${tagText}</span>
              ${statusBadge}
            </div>
            <div class="channel-name">#${c.name}</div>
            <div class="channel-server">${c.server}</div>
          </div>
        `;
      }).join('');
    }

    // 渲染最新交叉驗證事件
    if (latestCrossVerification && latestCrossVerificationText && data.crossCheckStats?.recentVerifications?.length > 0) {
      const latest = data.crossCheckStats.recentVerifications[0];
      latestCrossVerification.classList.remove('hidden');
      latestCrossVerificationText.innerHTML = `
        <strong>⚡ 交叉比對成功：</strong>
        <span class="cross-egg-name">${latest.eggName}</span> (${latest.location})
        — 先由 <code>${latest.firstSource}</code> 回報，隨後由 <code>${latest.secondSource}</code> 交叉確認 (時差 +${latest.delaySec}s)
      `;
    }
  } catch (err) {
    botStatusBadge.className = 'status-badge error';
    botStatusText.textContent = '後端無回應';
    if (offlineAlertBanner) offlineAlertBanner.classList.remove('hidden');
  }
}

// 載入蛋圖鑑
async function loadEggsCatalog() {
  try {
    const res = await fetch('/api/eggs');
    eggsCatalog = await res.json();
    updateSelectedCountBadge();
    renderEggsGrid();
  } catch (err) {
    console.error('載入蛋圖鑑失敗:', err);
  }
}

// 載入過濾設定
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data && data.config) {
      userConfig = Object.assign(userConfig, data.config);
      if (!Array.isArray(userConfig.selectedEggs) || userConfig.selectedEggs.length === 0) {
        userConfig.selectedEggs = [...DEFAULT_HIGH_TIER_NAMES];
      }
      masterFilterSwitch.checked = userConfig.filterEnabled !== false;
      updateSelectedCountBadge();
      renderEggsGrid();
    }
  } catch (err) {
    console.error('載入設定失敗:', err);
  }
}

// 載入分析與預測
async function loadPrediction() {
  try {
    const res = await fetch('/api/prediction');
    const data = await res.json();
    predictionData = data;

    if (data) {
      avgInterval.textContent = `${data.spawnCycleMinutes || 5.0} 分鐘 (固定)`;
      recentAvg.textContent = `約 ${data.recentAvgMinutes || '8.0'} 分鐘`;
      totalRecords.textContent = `${data.totalRecords || 0} 筆`;

      if (data.nextTimestamp) {
        nextSpawnTimestamp = data.nextTimestamp;
        const pDate = new Date(nextSpawnTimestamp);
        predictedTimeText.textContent = `預計下次出蛋：${pDate.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}`;
      } else {
        const now = Date.now();
        const cycleMs = 5 * 60 * 1000;
        const target = Math.ceil(now / cycleMs) * cycleMs;
        const pDate = new Date(target);
        predictedTimeText.textContent = `預計下次出蛋：${pDate.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}`;
      }

      // 渲染常出現蛋種
      if (data.topEggs && data.topEggs.length > 0) {
        topEggsList.innerHTML = data.topEggs.map(item => `
          <div class="top-egg-item">
            <span class="egg-name">🥚 ${item.name}</span>
            <span class="egg-badge rarity-${item.rarity || 'Secret'}">${item.count} 次</span>
          </div>
        `).join('');
      } else {
        topEggsList.innerHTML = `<div class="skeleton-loader">${data.statusText || '尚無足夠統計資料'}</div>`;
      }
    }
  } catch (err) {
    console.error('載入預測異常:', err);
  }
}

// ==================== 單蛋專屬掉落預測器邏輯 ====================
const eggPredictorSelect = document.getElementById('eggPredictorSelect');
const eggQuickPills = document.getElementById('eggQuickPills');
const eggPredictorResult = document.getElementById('eggPredictorResult');

let allEggPredictions = [];
let currentSelectedPredictionEgg = 'World Burner';

// 載入所有 28 款神蛋的預測數據
async function loadEggPredictions() {
  try {
    const res = await fetch('/api/prediction/eggs');
    const data = await res.json();
    if (data.status === 'success' && Array.isArray(data.predictions)) {
      allEggPredictions = data.predictions;
      renderEggPrediction(currentSelectedPredictionEgg);
    }
  } catch (err) {
    console.warn('載入單蛋預測失敗:', err.message);
  }
}

let currentPredRarityFilter = 'all';
let currentPredSearchQuery = '';

// 初始化單蛋預測器 (支援關鍵字搜尋與神聖/永恆/秘密階級即時過濾)
async function initEggPredictor() {
  if (!eggPredictorSelect) return;

  const savedEgg = localStorage.getItem('egg_pred_selected');
  if (savedEgg) {
    currentSelectedPredictionEgg = savedEgg;
  }

  const predSearchInput = document.getElementById('eggPredSearchInput');
  const predRarityPills = document.querySelectorAll('#eggPredRarityPills .pred-rarity-pill');

  function updateEggPredictorList() {
    const q = currentPredSearchQuery.toLowerCase();
    const filteredEggs = HIGH_TIER_EGGS_META.filter(meta => {
      // 1. 稀有度階級篩選
      if (currentPredRarityFilter !== 'all' && meta.rarity.toLowerCase() !== currentPredRarityFilter.toLowerCase()) {
        return false;
      }
      // 2. 關鍵字搜尋 (蛋名稱、生態區、稀有度)
      if (q) {
        const match = meta.name.toLowerCase().includes(q) ||
                      meta.biome.toLowerCase().includes(q) ||
                      meta.rarity.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });

    if (filteredEggs.length > 0) {
      eggPredictorSelect.innerHTML = filteredEggs.map(meta => {
        return `<option value="${meta.name}">[${meta.biome}] ${meta.name} (${meta.rarity})</option>`;
      }).join('');

      // 若目前選定的蛋仍在過濾清單中則保持，否則自動選取過濾結果的第一顆
      const hasCurrent = filteredEggs.some(m => m.name === currentSelectedPredictionEgg);
      if (hasCurrent) {
        eggPredictorSelect.value = currentSelectedPredictionEgg;
      } else {
        currentSelectedPredictionEgg = filteredEggs[0].name;
        eggPredictorSelect.value = currentSelectedPredictionEgg;
        localStorage.setItem('egg_pred_selected', currentSelectedPredictionEgg);
        renderEggPrediction(currentSelectedPredictionEgg);
      }
    } else {
      eggPredictorSelect.innerHTML = `<option value="">無符合搜尋條件的蛋種</option>`;
    }

    // 同步更新下方快速切換熱門標籤 Chips
    if (eggQuickPills) {
      const topPillEggs = filteredEggs.slice(0, 10);
      eggQuickPills.innerHTML = topPillEggs.map(m => {
        const isActive = m.name === currentSelectedPredictionEgg;
        return `<button type="button" class="quick-pill ${isActive ? 'active' : ''}" data-egg="${m.name}">${m.name}</button>`;
      }).join('');

      eggQuickPills.querySelectorAll('.quick-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          const egg = pill.getAttribute('data-egg');
          if (egg) {
            currentSelectedPredictionEgg = egg;
            localStorage.setItem('egg_pred_selected', currentSelectedPredictionEgg);
            eggPredictorSelect.value = egg;
            updateQuickPillsActive(egg);
            renderEggPrediction(egg);
          }
        });
      });
    }
  }

  // 監聽即時搜尋輸入
  if (predSearchInput) {
    predSearchInput.addEventListener('input', (e) => {
      currentPredSearchQuery = e.target.value.trim();
      updateEggPredictorList();
    });
  }

  // 監聽稀有度標籤切換
  predRarityPills.forEach(pill => {
    pill.addEventListener('click', () => {
      predRarityPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentPredRarityFilter = pill.getAttribute('data-rarity') || 'all';
      updateEggPredictorList();
    });
  });

  eggPredictorSelect.addEventListener('change', (e) => {
    if (!e.target.value) return;
    currentSelectedPredictionEgg = e.target.value;
    localStorage.setItem('egg_pred_selected', currentSelectedPredictionEgg);
    updateQuickPillsActive(currentSelectedPredictionEgg);
    renderEggPrediction(currentSelectedPredictionEgg);
  });

  updateEggPredictorList();
  await loadEggPredictions();
}

function updateQuickPillsActive(selectedEgg) {
  if (!eggQuickPills) return;
  eggQuickPills.querySelectorAll('.quick-pill').forEach(pill => {
    if (pill.getAttribute('data-egg') === selectedEgg) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}

function renderEggPrediction(eggName) {
  if (!eggPredictorResult) return;
  const p = allEggPredictions.find(item => item.name === eggName) || {
    name: eggName,
    rarity: 'Secret',
    biome: '未知生態',
    lastLocation: '未知生態',
    count: 0,
    lastSeenStr: '無紀錄',
    minutesSinceLast: null,
    avgIntervalMin: 120,
    estimatedMinutesLeft: 60,
    overdueMinutes: 0,
    predictedTimeStr: '--:--',
    status: 'accumulating',
    statusText: '⏳ 週期累積中',
    progressPercent: 30
  };

  const isTracked = Array.isArray(userConfig.selectedEggs) && userConfig.selectedEggs.includes(p.name);
  const rarityClass = `rarity-${(p.rarity || 'Secret').toLowerCase().replace(/[^a-z]/g, '')}`;
  const isOverdue = p.estimatedMinutesLeft === 0 || p.status === 'overdue';

  let estTimeHtml = '';
  let estSubText = '';

  if (p.estimatedMinutesLeft === 0) {
    estTimeHtml = `<div class="egg-pred-est-time overdue-text">🔥 隨時可能掉落！ (已逾期 ${p.overdueMinutes} 分鐘)</div>`;
    estSubText = `已進入高機率出蛋波段！預估窗口：<b>${p.predictedRangeStr || '即刻 ~ 15 分鐘內'}</b>，伺服器每一輪 5 分鐘刷新皆處於極高爆率！`;
  } else if (p.status === 'rare_prior') {
    estTimeHtml = `<div class="egg-pred-est-time" style="color:#c084fc;">💎 約 ${(p.avgIntervalMin / 60).toFixed(0)} 小時 (極品神聖蛋)</div>`;
    estSubText = `歷史掉落樣本極稀少，依活動發布起點與地圖權重校準基準週期，每輪 5 分鐘皆有極小神蹟爆率！`;
  } else {
    estTimeHtml = `<div class="egg-pred-est-time">⏳ 預估窗口：${p.predictedRangeStr || `約 ${p.estimatedMinutesLeft} 分鐘`}</div>`;
    estSubText = `基準預計時間約 <b>${p.predictedTimeStr}</b> 左右 (距上次現身已過 ${p.minutesSinceLast} 分鐘，當前處於：<b>${p.phaseText || p.statusText}</b>)`;
  }

  const statusClass = `status-${p.status || 'accumulating'}`;

  // 計算 Cycle Timeline 指針與標記數據
  const p25 = p.burstIntervalMin || Math.round(p.avgIntervalMin * 0.35);
  const p50 = p.medianIntervalMin || p.avgIntervalMin;
  const p75 = p.valleyIntervalMin || Math.round(p.avgIntervalMin * 1.6);
  const m = p.minutesSinceLast !== null ? p.minutesSinceLast : 0;

  let timelinePercent = 0;
  if (p.minutesSinceLast === null) {
    timelinePercent = 10;
  } else if (m <= p25) {
    timelinePercent = (m / Math.max(1, p25)) * 25;
  } else if (m <= p50) {
    timelinePercent = 25 + ((m - p25) / Math.max(1, p50 - p25)) * 25;
  } else if (m <= p75) {
    timelinePercent = 50 + ((m - p50) / Math.max(1, p75 - p50)) * 25;
  } else {
    const overdueExtra = m - p75;
    const extraMax = Math.max(30, p75 * 0.5);
    timelinePercent = Math.min(98, 75 + (overdueExtra / extraMax) * 23);
  }
  timelinePercent = Math.max(4, Math.min(96, timelinePercent));

  eggPredictorResult.innerHTML = `
    <div class="egg-pred-top-row">
      <div class="egg-pred-identity">
        <div class="egg-pred-icon">🥚</div>
        <div class="egg-pred-name-group">
          <h3>${p.name}</h3>
          <div class="egg-pred-tags">
            <span class="my-egg-tag ${rarityClass}">${p.rarity}</span>
            <span class="my-egg-tag biome">🗺️ ${p.biome}</span>
            <span class="my-egg-tag" style="background:rgba(99,102,241,0.15); color:#a5b4fc; border:1px solid rgba(99,102,241,0.3);">${p.phaseText || p.statusText}</span>
          </div>
        </div>
      </div>
      <button type="button" id="toggleTrackInPredBtn" class="btn btn-sm ${isTracked ? 'btn-secondary' : 'btn-primary'}" style="font-size:12px;">
        <span>${isTracked ? '🔕 從我的推播取消此蛋' : '🔔 加入我的即時推播清單'}</span>
      </button>
    </div>

    <div class="egg-pred-center-hero">
      <div class="egg-pred-status-banner ${statusClass}">
        <span>${p.phaseText || p.statusText}</span>
      </div>
      ${estTimeHtml}
      <div class="egg-pred-est-sub">${estSubText}</div>

      <!-- 📊 Cycle Timeline Bar (掉落週期波段視覺化) -->
      <div class="cycle-timeline-container">
        <div class="cycle-timeline-header">
          <span class="timeline-title">📊 掉落週期波段視覺化 (Cycle Timeline)</span>
          <span class="timeline-now-badge ${isOverdue ? 'overdue' : ''}">
            ${p.minutesSinceLast !== null ? `距上次: ${p.minutesSinceLast} 分鐘 (${p.phaseText || p.statusText})` : '尚無近期現身紀錄'}
          </span>
        </div>
        <div class="cycle-timeline-track-wrap">
          <div class="cycle-timeline-track">
            <div class="track-segment seg-accumulate" style="width: 25%;" title="蓄積期 (0 ~ P25)"></div>
            <div class="track-segment seg-peak" style="width: 25%;" title="高峰爆發期 (P25 ~ P50)"></div>
            <div class="track-segment seg-median" style="width: 25%;" title="常態窗口期 (P50 ~ P75)"></div>
            <div class="track-segment seg-overdue" style="width: 25%;" title="逾期高爆率期 (> P75)"></div>

            <div class="track-marker" style="left: 25%;">
              <div class="marker-tick"></div>
              <div class="marker-label">P25 高峰<br><b>${p25}m</b></div>
            </div>
            <div class="track-marker" style="left: 50%;">
              <div class="marker-tick"></div>
              <div class="marker-label">P50 中位<br><b>${p50}m</b></div>
            </div>
            <div class="track-marker" style="left: 75%;">
              <div class="marker-tick"></div>
              <div class="marker-label">P75 低谷<br><b>${p75}m</b></div>
            </div>

            <div class="track-now-pointer ${isOverdue ? 'pointer-overdue' : ''}" style="left: ${timelinePercent}%;">
              <div class="pointer-pin">
                <span class="pointer-glow"></span>
                <span class="pointer-text">NOW ${m > 0 ? `(${m}m)` : ''}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="egg-pred-bottom-stats">
      <div class="egg-stat-box">
        <div class="egg-stat-box-label">🕒 上次現身紀錄</div>
        <div class="egg-stat-box-value">
          ${p.minutesSinceLast !== null ? `${p.minutesSinceLast} 分前 (${p.lastSeenStr})` : '近期無紀錄'}
        </div>
        <div style="font-size:11px; color:#64748b; margin-top:2px;">📍 地點: ${p.lastLocation || p.biome}</div>
      </div>
      <div class="egg-stat-box">
        <div class="egg-stat-box-label">⚡ 高峰 / 常態 / 低谷三軌</div>
        <div class="egg-stat-box-value" style="font-size:12px; line-height:1.4;">
          ⚡高峰: ${p.burstIntervalMin || Math.round(p.avgIntervalMin * 0.35)}m<br>
          ⚖️中位: ${p.medianIntervalMin || p.avgIntervalMin}m<br>
          ❄️低谷: ${p.valleyIntervalMin || Math.round(p.avgIntervalMin * 1.6)}m
        </div>
      </div>
      <div class="egg-stat-box">
        <div class="egg-stat-box-label">📈 近期節奏與目標</div>
        <div class="egg-stat-box-value">目標: ${p.dynamicTargetMin || p.avgIntervalMin} 分鐘</div>
        <div style="font-size:11px; color:#64748b; margin-top:2px;">近 5 筆 EMA: 約 ${p.recentAvgMin || p.avgIntervalMin} 分鐘</div>
      </div>
      <div class="egg-stat-box">
        <div class="egg-stat-box-label">📊 總樣本與活動起點</div>
        <div class="egg-stat-box-value">${p.count} 次掉落</div>
        <div style="font-size:11px; color:#94a3b8; margin-top:2px;">${p.genesisNote || '原生常規掉落'}</div>
      </div>
    </div>
  `;

  // 綁定一鍵推播追蹤開關 (Telegram 雙向嚴格同步)
  const toggleBtn = document.getElementById('toggleTrackInPredBtn');
  if (toggleBtn) {
    toggleBtn.onclick = async () => {
      const idx = userConfig.selectedEggs.indexOf(p.name);
      if (idx !== -1) {
        userConfig.selectedEggs.splice(idx, 1);
        showToast(`🔕 已從推播清單移除：${p.name}`, 'info');
      } else {
        userConfig.selectedEggs.push(p.name);
        showToast(`🔔 已加入即時推播清單：${p.name}`, 'success');
      }

      updateSelectedCountBadge();
      renderEggsGrid();
      renderEggPrediction(p.name);

      // 若已登入，直接同步至 Telegram 會員資料庫
      if (currentUser && currentUser.member) {
        try {
          const res = await fetch('/api/auth/update-my-settings', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
              enabled: userConfig.filterEnabled,
              filterType: 'custom',
              customEggNames: userConfig.selectedEggs
            })
          });
          const data = await res.json();
          if (data.success && data.member) {
            currentUser.member = data.member;
          }
        } catch (_) {}
      }
    };
  }
}

// 全服歷史資料庫瀏覽器 (Database Explorer) 狀態
let dbState = {
  search: '',
  rarity: 'all',
  biome: 'all',
  timeRange: 'all', // 'all', '1h', '6h', 'today'
  sort: 'newest',
  page: 1,
  limit: 50,
  totalPages: 1,
  total: 0,
  isLoading: false
};

// 載入全服歷史資料庫與分頁
async function loadHistory(isBackground = false) {
  if (dbState.isLoading && !isBackground) return;
  dbState.isLoading = true;

  const tableBody = document.getElementById('dbTableBody') || historyTableBody;
  if (!tableBody) return;

  if (!isBackground && tableBody.children.length <= 1) {
    tableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 24px; color:#94a3b8;">載入全服歷史紀錄中...</td></tr>`;
  }

  try {
    const params = new URLSearchParams({
      page: dbState.page,
      limit: dbState.limit,
      search: dbState.search,
      rarity: dbState.rarity,
      biome: dbState.biome,
      timeRange: dbState.timeRange || 'all',
      sort: dbState.sort
    });

    const res = await fetch(`/api/history/drops?${params.toString()}`);
    const data = await res.json();

    if (data && data.success && Array.isArray(data.rows)) {
      dbState.total = data.total;
      dbState.totalPages = data.totalPages;

      renderDbTable(data.rows);
      updateDbPagination();
      updateLiveTicker(data.rows);
    } else {
      tableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 24px; color:#64748b;">暫無符合條件的掉落紀錄</td></tr>`;
      updateDbPagination();
    }
  } catch (err) {
    console.error('載入全服歷史資料庫失敗:', err);
    if (!isBackground) {
      tableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 24px; color:#fb7185;">載入歷史失敗: ${err.message}</td></tr>`;
    }
  } finally {
    dbState.isLoading = false;
  }
}

// 渲染歷史資料庫表格列
function renderDbTable(rows) {
  const tableBody = document.getElementById('dbTableBody') || historyTableBody;
  if (!tableBody) return;

  if (!rows || rows.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 24px; color:#64748b;">暫無符合條件的掉落紀錄</td></tr>`;
    return;
  }

  tableBody.innerHTML = rows.map(r => {
    const eggImg = getEggImage(r.name);
    
    // 稀有度 Badge 樣式
    let rarClass = 'common';
    const rarLower = (r.rarity || '').toLowerCase();
    if (rarLower === 'divine') rarClass = 'divine';
    else if (rarLower === 'eternal') rarClass = 'eternal';
    else if (rarLower === 'secret') rarClass = 'secret';

    // Highlight Join Game link if present in rawDetails
    let detailsHtml = escapeHtml(r.details);
    const joinMatch = (r.rawDetails || '').match(/\[Click Here\]\((https:\/\/www\.roblox\.com\/games\/[^\)]+)\)/);
    if (joinMatch) {
      detailsHtml += ` <a href="${joinMatch[1]}" target="_blank" class="btn btn-secondary btn-sm" style="padding:2px 6px; font-size:10px; margin-left:6px; color:#38bdf8; text-decoration:none;">🚀 一鍵入房</a>`;
    }

    return `
      <tr>
        <td style="text-align:center; color:#64748b; font-size:12px;">${r.seq}</td>
        <td style="font-size:12px; color:#94a3b8; white-space:nowrap;">${r.twTime || r.timestamp}</td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <img src="${eggImg}" alt="${r.name}" class="table-egg-img" referrerpolicy="no-referrer" onerror="this.src='https://cdn.discordapp.com/emojis/1547091103537438741.png'">
            <strong>${escapeHtml(r.name)}</strong>
          </div>
        </td>
        <td style="text-align:center;">
          <span class="db-table-badge ${rarClass}">${r.rarity || 'Normal'}</span>
        </td>
        <td>
          <span class="db-biome-tag">📍 ${escapeHtml(r.biome)}</span>
        </td>
        <td style="font-size:12px; color:#cbd5e1;">
          ${detailsHtml}
        </td>
      </tr>
    `;
  }).join('');
}

// 更新分頁控制按鈕與指示數字
function updateDbPagination() {
  const startEl = document.getElementById('dbStartRow');
  const endEl = document.getElementById('dbEndRow');
  const totalEl = document.getElementById('dbTotalCount');
  const currentEl = document.getElementById('dbCurrentPage');
  const totalPagesEl = document.getElementById('dbTotalPages');

  const firstBtn = document.getElementById('dbFirstPageBtn');
  const prevBtn = document.getElementById('dbPrevPageBtn');
  const nextBtn = document.getElementById('dbNextPageBtn');
  const lastBtn = document.getElementById('dbLastPageBtn');

  const start = dbState.total === 0 ? 0 : (dbState.page - 1) * dbState.limit + 1;
  const end = Math.min(dbState.page * dbState.limit, dbState.total);

  if (startEl) startEl.innerText = start.toLocaleString();
  if (endEl) endEl.innerText = end.toLocaleString();
  if (totalEl) totalEl.innerText = dbState.total.toLocaleString();
  if (currentEl) currentEl.innerText = dbState.page;
  if (totalPagesEl) totalPagesEl.innerText = dbState.totalPages;

  if (firstBtn) firstBtn.disabled = (dbState.page <= 1);
  if (prevBtn) prevBtn.disabled = (dbState.page <= 1);
  if (nextBtn) nextBtn.disabled = (dbState.page >= dbState.totalPages);
  if (lastBtn) lastBtn.disabled = (dbState.page >= dbState.totalPages);
}

// 初始化全服歷史資料庫瀏覽器監聽器 (零丟失持久化)
// 初始化全服歷史資料庫瀏覽器監聽器 (零丟失持久化)
function initDbExplorer() {
  const searchInput = document.getElementById('dbSearchInput');
  const searchClearBtn = document.getElementById('dbSearchClearBtn');
  const biomeSelect = document.getElementById('dbBiomeSelect');
  const sortSelect = document.getElementById('dbSortSelect');
  const limitSelect = document.getElementById('dbLimitSelect');
  const refreshBtn = document.getElementById('refreshDbBtn');
  const resetBtn = document.getElementById('dbResetFiltersBtn');
  const timePills = document.querySelectorAll('.time-pill');
  const hotTags = document.querySelectorAll('.db-hot-tag');

  // 從 localStorage 恢復使用者自訂篩選狀態
  const savedSearch = localStorage.getItem('egg_db_search');
  if (savedSearch !== null) {
    dbState.search = savedSearch;
    if (searchInput) {
      searchInput.value = savedSearch;
      if (searchClearBtn) searchClearBtn.classList.toggle('hidden', !savedSearch);
    }
  }

  const savedBiome = localStorage.getItem('egg_db_biome');
  if (savedBiome !== null) {
    dbState.biome = savedBiome;
    if (biomeSelect) biomeSelect.value = savedBiome;
  }

  const savedTime = localStorage.getItem('egg_db_time_range');
  if (savedTime !== null) {
    dbState.timeRange = savedTime;
    timePills.forEach(p => {
      if (p.getAttribute('data-time') === savedTime) p.classList.add('active');
      else p.classList.remove('active');
    });
  }

  const savedSort = localStorage.getItem('egg_db_sort');
  if (savedSort !== null) {
    dbState.sort = savedSort;
    if (sortSelect) sortSelect.value = savedSort;
  }

  const savedLimit = localStorage.getItem('egg_db_limit');
  if (savedLimit !== null) {
    dbState.limit = parseInt(savedLimit) || 50;
    if (limitSelect) limitSelect.value = savedLimit;
  }

  const savedRarity = localStorage.getItem('egg_db_rarity');
  const pills = document.querySelectorAll('.rarity-pill');
  if (savedRarity !== null) {
    dbState.rarity = savedRarity;
    pills.forEach(p => {
      if (p.getAttribute('data-rarity') === savedRarity) p.classList.add('active');
      else p.classList.remove('active');
    });
  }

  // 搜尋防抖與保存
  let searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      if (searchClearBtn) searchClearBtn.classList.toggle('hidden', !e.target.value);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        dbState.search = e.target.value.trim();
        dbState.page = 1;
        localStorage.setItem('egg_db_search', dbState.search);
        loadHistory();
      }, 300);
    });
  }

  // 搜尋清除按鈕
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      searchClearBtn.classList.add('hidden');
      dbState.search = '';
      dbState.page = 1;
      localStorage.removeItem('egg_db_search');
      loadHistory();
    });
  }

  // 生態區下拉切換
  if (biomeSelect) {
    biomeSelect.addEventListener('change', (e) => {
      dbState.biome = e.target.value;
      dbState.page = 1;
      localStorage.setItem('egg_db_biome', dbState.biome);
      loadHistory();
    });
  }

  // 排序下拉切換
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      dbState.sort = e.target.value;
      dbState.page = 1;
      localStorage.setItem('egg_db_sort', dbState.sort);
      loadHistory();
    });
  }

  // 分頁每頁筆數切換
  if (limitSelect) {
    limitSelect.addEventListener('change', (e) => {
      dbState.limit = parseInt(e.target.value) || 50;
      dbState.page = 1;
      localStorage.setItem('egg_db_limit', String(dbState.limit));
      loadHistory();
    });
  }

  // 重新整理按鈕
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadHistory();
      showToast('全服歷史資料庫已刷新', 'info');
    });
  }

  // 稀有度膠囊點擊與保存
  pills.forEach(p => {
    p.addEventListener('click', () => {
      pills.forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      dbState.rarity = p.getAttribute('data-rarity') || 'all';
      dbState.page = 1;
      localStorage.setItem('egg_db_rarity', dbState.rarity);
      loadHistory();
    });
  });

  // 時間區間膠囊點擊與保存
  timePills.forEach(p => {
    p.addEventListener('click', () => {
      timePills.forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      dbState.timeRange = p.getAttribute('data-time') || 'all';
      dbState.page = 1;
      localStorage.setItem('egg_db_time_range', dbState.timeRange);
      loadHistory();
    });
  });

  // 熱門快搜標籤點擊
  hotTags.forEach(tag => {
    tag.addEventListener('click', () => {
      const val = tag.getAttribute('data-tag');
      if (!val) return;
      if (searchInput) {
        searchInput.value = val;
        if (searchClearBtn) searchClearBtn.classList.remove('hidden');
      }
      dbState.search = val;
      dbState.page = 1;
      localStorage.setItem('egg_db_search', val);
      loadHistory();
      showToast(`🔍 已過濾熱門標籤：${val}`, 'info');
    });
  });

  // 重置所有篩選器
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      dbState.search = '';
      dbState.rarity = 'all';
      dbState.biome = 'all';
      dbState.timeRange = 'all';
      dbState.sort = 'newest';
      dbState.page = 1;

      if (searchInput) searchInput.value = '';
      if (searchClearBtn) searchClearBtn.classList.add('hidden');
      if (biomeSelect) biomeSelect.value = 'all';
      if (sortSelect) sortSelect.value = 'newest';

      pills.forEach(p => p.classList.toggle('active', p.getAttribute('data-rarity') === 'all'));
      timePills.forEach(p => p.classList.toggle('active', p.getAttribute('data-time') === 'all'));

      localStorage.removeItem('egg_db_search');
      localStorage.removeItem('egg_db_biome');
      localStorage.removeItem('egg_db_rarity');
      localStorage.removeItem('egg_db_time_range');
      localStorage.removeItem('egg_db_sort');

      loadHistory();
      showToast('🔄 已重置所有歷史資料庫篩選條件！', 'success');
    });
  }

  // 分頁按鈕
  const firstBtn = document.getElementById('dbFirstPageBtn');
  const prevBtn = document.getElementById('dbPrevPageBtn');
  const nextBtn = document.getElementById('dbNextPageBtn');
  const lastBtn = document.getElementById('dbLastPageBtn');

  if (firstBtn) firstBtn.addEventListener('click', () => {
    if (dbState.page > 1) {
      dbState.page = 1;
      loadHistory();
    }
  });

  if (prevBtn) prevBtn.addEventListener('click', () => {
    if (dbState.page > 1) {
      dbState.page--;
      loadHistory();
    }
  });

  if (nextBtn) nextBtn.addEventListener('click', () => {
    if (dbState.page < dbState.totalPages) {
      dbState.page++;
      loadHistory();
    }
  });

  if (lastBtn) lastBtn.addEventListener('click', () => {
    if (dbState.page < dbState.totalPages) {
      dbState.page = dbState.totalPages;
      loadHistory();
    }
  });
}

// 輔助查找蛋圖
function getEggImage(eggName) {
  if (!eggName) return 'https://cdn.discordapp.com/emojis/1547091103537438741.png';
  const clean = eggName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const found = eggsCatalog.find(e => {
    const wClean = (e.cleanName || e.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    const wFull = (e.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return wClean === clean || wFull === clean || wClean.includes(clean) || clean.includes(wClean);
  });
  return (found && found.imageUrl) ? found.imageUrl : 'https://cdn.discordapp.com/emojis/1547091103537438741.png';
}

// 蛋種勾選統計指示
function updateSelectedCountBadge() {
  const count = (userConfig.selectedEggs || []).length;
  if (eggActiveCountBadge) {
    eggActiveCountBadge.textContent = `已勾選 ${count} / ${eggsCatalog.length || 143} 種蛋接收通知`;
  }
}

let selectedSpawnType = localStorage.getItem('egg_catalog_spawn_type') || 'all';
let selectedBiome = localStorage.getItem('egg_catalog_biome') || 'all';
let selectedCatalogRarity = localStorage.getItem('egg_catalog_rarity') || 'all';

// 初始化機制與地區篩選按鈕事件 (零丟失持久化)
function initFilterBars() {
  const spawnChips = document.querySelectorAll('#spawnTypeChips .filter-chip');
  if (selectedSpawnType) {
    spawnChips.forEach(c => {
      if (c.getAttribute('data-spawn-type') === selectedSpawnType) c.classList.add('active');
      else c.classList.remove('active');
    });
  }
  spawnChips.forEach(chip => {
    chip.onclick = () => {
      spawnChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedSpawnType = chip.getAttribute('data-spawn-type') || 'all';
      localStorage.setItem('egg_catalog_spawn_type', selectedSpawnType);
      renderEggsGrid();
    };
  });

  const biomeChips = document.querySelectorAll('#biomeChips .filter-chip');
  if (selectedBiome) {
    biomeChips.forEach(c => {
      if (c.getAttribute('data-biome') === selectedBiome) c.classList.add('active');
      else c.classList.remove('active');
    });
  }
  biomeChips.forEach(chip => {
    chip.onclick = () => {
      biomeChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedBiome = chip.getAttribute('data-biome') || 'all';
      localStorage.setItem('egg_catalog_biome', selectedBiome);
      renderEggsGrid();
    };
  });

  // 稀有度篩選標籤
  const rarityChips = document.querySelectorAll('#catalogRarityChips .filter-chip');
  if (selectedCatalogRarity) {
    rarityChips.forEach(c => {
      if (c.getAttribute('data-rarity') === selectedCatalogRarity) c.classList.add('active');
      else c.classList.remove('active');
    });
  }
  rarityChips.forEach(chip => {
    chip.onclick = () => {
      rarityChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedCatalogRarity = chip.getAttribute('data-rarity') || 'all';
      localStorage.setItem('egg_catalog_rarity', selectedCatalogRarity);
      renderEggsGrid();
    };
  });

  const eggClearBtn = document.getElementById('eggSearchClearBtn');
  if (eggSearchInput) {
    const savedSearch = localStorage.getItem('egg_catalog_search');
    if (savedSearch) {
      eggSearchInput.value = savedSearch;
      if (eggClearBtn) eggClearBtn.classList.remove('hidden');
    }
    eggSearchInput.addEventListener('input', () => {
      if (eggClearBtn) eggClearBtn.classList.toggle('hidden', !eggSearchInput.value);
      localStorage.setItem('egg_catalog_search', eggSearchInput.value);
      renderEggsGrid();
    });
  }

  if (eggClearBtn) {
    eggClearBtn.addEventListener('click', () => {
      if (eggSearchInput) eggSearchInput.value = '';
      eggClearBtn.classList.add('hidden');
      localStorage.removeItem('egg_catalog_search');
      renderEggsGrid();
    });
  }
}

// 渲染蛋清單卡片
function renderEggsGrid() {
  const searchTerm = (eggSearchInput.value || '').trim().toLowerCase();
  const filtered = eggsCatalog.filter(egg => {
    // 1. 搜尋關鍵字比對 (蛋名、別名、地區、刷新機制、獲取途徑)
    const nameMatch = (egg.name || '').toLowerCase().includes(searchTerm) ||
                      (egg.cleanName || '').toLowerCase().includes(searchTerm) ||
                      (egg.biome || '').toLowerCase().includes(searchTerm) ||
                      (egg.spawnType || '').toLowerCase().includes(searchTerm) ||
                      (egg.obtainMethod || '').toLowerCase().includes(searchTerm);
    if (!nameMatch) return false;

    // 2. 刷新機制類型篩選
    if (selectedSpawnType !== 'all') {
      if (selectedSpawnType === 'high' && !egg.spawnType?.includes('高階')) return false;
      if (selectedSpawnType === 'fusion' && !egg.spawnType?.includes('熔煉')) return false;
      if (selectedSpawnType === 'event' && !egg.spawnType?.includes('活動')) return false;
      if (selectedSpawnType === 'base' && !egg.spawnType?.includes('基礎')) return false;
    }

    // 3. 地區生態分類篩選
    if (selectedBiome !== 'all') {
      const b = (egg.biome || '').toLowerCase();
      const targetB = selectedBiome.toLowerCase();
      if (targetB === 'angels & demons') {
        if (!b.includes('angel') && !b.includes('demon')) return false;
      } else if (!b.includes(targetB)) {
        return false;
      }
    }

    // 4. 稀有度分類篩選
    if (selectedCatalogRarity !== 'all') {
      if ((egg.rarity || '').toLowerCase() !== selectedCatalogRarity.toLowerCase()) {
        return false;
      }
    }

    return true;
  });

  eggCountBadge.textContent = `顯示 ${filtered.length} / ${eggsCatalog.length} 顆蛋`;

  if (filtered.length === 0) {
    eggsGrid.innerHTML = `<div class="skeleton-loader">沒有找到符合搜尋條件的蛋</div>`;
    return;
  }

  eggsGrid.innerHTML = filtered.map(egg => {
    const eggName = egg.cleanName || egg.name;
    const clean = eggName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isActive = (userConfig.selectedEggs || []).some(n => {
      const k = n.toLowerCase().replace(/[^a-z0-9]/g, '');
      return k === clean || clean.includes(k) || k.includes(clean);
    });

    return `
      <div class="egg-card ${isActive ? '' : 'muted'}" data-egg-name="${eggName}">
        <div class="egg-img-wrap">
          <img src="${egg.imageUrl || 'https://cdn.discordapp.com/emojis/1547091103537438741.png'}" alt="${egg.name}" referrerpolicy="no-referrer" onerror="this.src='https://cdn.discordapp.com/emojis/1547091103537438741.png'">
        </div>
        <div class="egg-details">
          <div class="egg-title" title="${egg.name}">${egg.cleanName || egg.name}</div>
          <div>
            <span class="rarity-tag rarity-${egg.rarity || 'Common'}">${egg.rarity || '未知'}</span>
            ${egg.biome && egg.biome !== 'Unknown' ? `<span class="biome-tag">📍 ${egg.biome}</span>` : ''}
          </div>
          ${egg.spawnType ? `<div class="spawn-type-info" title="${egg.obtainMethod || ''}">${egg.spawnType}</div>` : ''}
        </div>
        <div class="egg-card-toggle">
          <label class="switch" title="${isActive ? '點擊取消通知' : '點擊接收通知'}">
            <input type="checkbox" class="egg-toggle-input" ${isActive ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
        </div>
      </div>
    `;
  }).join('');

  // 綁定個別蛋開關 (直接增刪 selectedEggs)
  eggsGrid.querySelectorAll('.egg-card').forEach(card => {
    const name = card.getAttribute('data-egg-name');
    const checkbox = card.querySelector('.egg-toggle-input');
    checkbox.onchange = (e) => {
      const checked = e.target.checked;
      const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (checked) {
        if (!userConfig.selectedEggs.some(n => n.toLowerCase().replace(/[^a-z0-9]/g, '') === clean)) {
          userConfig.selectedEggs.push(name);
        }
        card.classList.remove('muted');
      } else {
        userConfig.selectedEggs = userConfig.selectedEggs.filter(n => n.toLowerCase().replace(/[^a-z0-9]/g, '') !== clean);
        card.classList.add('muted');
      }
      updateSelectedCountBadge();
    };
  });
}

// 快速篩選按鈕事件 (針對蛋種勾選)
const selectHighOnlyBtn = document.getElementById('selectHighOnly');
if (selectHighOnlyBtn) {
  selectHighOnlyBtn.onclick = () => {
    userConfig.selectedEggs = [...DEFAULT_HIGH_TIER_NAMES];
    updateSelectedCountBadge();
    renderEggsGrid();
    showToast('⭐ 已勾選 28 種高階可刷新蛋！', 'success');
  };
}

const selectTop10Btn = document.getElementById('selectTop10');
if (selectTop10Btn) {
  selectTop10Btn.onclick = () => {
    const TOP_10 = ['Pure Jellyfish', 'Gargoyle', 'Kraken', 'T-Rex', 'Tralaledon', 'Cosmic Dragon', 'Mutant Shark', 'Cerberus', 'Stag', 'Mosasaurus'];
    userConfig.selectedEggs = [...TOP_10];
    updateSelectedCountBadge();
    renderEggsGrid();
    showToast('🔥 已勾選 Top 10 最常刷新蛋！', 'success');
  };
}

const selectAllEggsBtn = document.getElementById('selectAllEggs');
if (selectAllEggsBtn) {
  selectAllEggsBtn.onclick = () => {
    userConfig.selectedEggs = eggsCatalog.map(e => e.cleanName || e.name);
    updateSelectedCountBadge();
    renderEggsGrid();
    showToast('✅ 已勾選全部 143 種蛋接收通知！', 'success');
  };
}

const clearAllEggsBtn = document.getElementById('clearAllEggs');
if (clearAllEggsBtn) {
  clearAllEggsBtn.onclick = () => {
    userConfig.selectedEggs = [];
    updateSelectedCountBadge();
    renderEggsGrid();
    showToast('❌ 已取消勾選所有蛋（已全部靜音）', 'error');
  };
}

eggSearchInput.oninput = () => {
  renderEggsGrid();
};

// 儲存設定
saveConfigBtn.onclick = async () => {
  userConfig.filterEnabled = masterFilterSwitch.checked;
  saveConfigBtn.disabled = true;
  saveConfigBtn.innerHTML = '<span>⏳ 儲存中...</span>';

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userConfig)
    });
    const result = await res.json();

    // 嚴格雙向同步：若會員已登入，立即更新會員個人推播名單並同步至 Telegram 與 Google Sheet
    if (currentUser && currentUser.member) {
      try {
        const authRes = await fetch('/api/auth/update-my-settings', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            enabled: userConfig.filterEnabled,
            filterType: 'custom',
            customEggNames: userConfig.selectedEggs
          })
        });
        const authData = await authRes.json();
        if (authData.success && authData.member) {
          currentUser.member = authData.member;
        }
      } catch (_) {}
    }

    if (result && result.status === 'success') {
      showToast('🎉 設定已成功儲存並同步至 Telegram！', 'success');
    } else {
      showToast('⚠️ 設定儲存失敗，請檢查網路連線', 'error');
    }
  } catch (err) {
    showToast(`❌ 儲存失敗: ${err.message}`, 'error');
  } finally {
    saveConfigBtn.disabled = false;
    saveConfigBtn.innerHTML = '<span>💾 儲存設定</span>';
  }
};

// 歷史同步按鈕
syncHistoryBtn.onclick = async () => {
  syncHistoryBtn.disabled = true;
  syncProgress.classList.remove('hidden');
  progressBar.style.width = '10%';
  progressText.textContent = '發送同步請求中...';

  try {
    const res = await fetch('/api/sync-history', { method: 'POST' });
    const json = await res.json();

    if (json.started) {
      pollSyncStatus();
    } else {
      showToast(json.message || '無法啟動同步作業', 'error');
      syncHistoryBtn.disabled = false;
    }
  } catch (err) {
    showToast(`啟動同步失敗: ${err.message}`, 'error');
    syncHistoryBtn.disabled = false;
  }
};

function pollSyncStatus() {
  const poll = setInterval(async () => {
    try {
      const res = await fetch('/api/sync-status');
      const status = await res.json();

      if (status.isSyncing) {
        progressBar.style.width = '60%';
        progressText.textContent = `同步中... 已分析 ${status.totalFetched || 0} 則訊息，新增 ${status.newRecorded || 0} 筆蛋資料`;
      } else {
        clearInterval(poll);
        progressBar.style.width = '100%';
        progressText.textContent = `同步完成！新增 ${status.newRecorded || 0} 筆掉落紀錄至 Google Sheet`;
        showToast(`🎉 歷史回填完成！新增 ${status.newRecorded || 0} 筆資料`, 'success');
        syncHistoryBtn.disabled = false;
        setTimeout(() => syncProgress.classList.add('hidden'), 5000);
        // 重新載入歷史與預測
        loadPrediction();
        loadHistory();
      }
    } catch (err) {
      clearInterval(poll);
      syncHistoryBtn.disabled = false;
    }
  }, 2000);
}

// 重新整理按鈕
refreshBtn.onclick = () => {
  loadStatus();
  loadPrediction();
  loadHistory();
  loadMemberStats();
  showToast('🔄 已重新整理最新數據！', 'success');
};

// ==================== 會員與訂閱系統前台邏輯 ====================

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

const statTotalMembers = document.getElementById('statTotalMembers');
const statActiveVips = document.getElementById('statActiveVips');
const statActiveAlerts = document.getElementById('statActiveAlerts');
const toggleAdminPanelBtn = document.getElementById('toggleAdminPanelBtn');
const adminPanelWrapper = document.getElementById('adminPanelWrapper');
const adminKeyInput = document.getElementById('adminKeyInput');
const refreshMembersBtn = document.getElementById('refreshMembersBtn');
const membersTableBody = document.getElementById('membersTableBody');
const vipChatIdInput = document.getElementById('vipChatIdInput');
const vipDaysSelect = document.getElementById('vipDaysSelect');
const vipNotesInput = document.getElementById('vipNotesInput');
const submitGrantVipBtn = document.getElementById('submitGrantVipBtn');

async function loadMemberStats() {
  try {
    const res = await fetch('/api/members');
    const data = await res.json();
    if (data.success && data.stats) {
      if (statTotalMembers) statTotalMembers.textContent = `${data.stats.totalMembers || 0} 人`;
      if (statActiveVips) statActiveVips.textContent = `${data.stats.activeVips || 0} 人`;
      if (statActiveAlerts) statActiveAlerts.textContent = `${data.stats.activeAlerts || 0} 人`;
    }
  } catch (err) {
    console.error('載入會員統計失敗:', err);
  }
}

async function loadMembersList() {
  if (!membersTableBody) return;
  membersTableBody.innerHTML = '<tr><td colspan="8" class="text-center">讀取會員名單中...</td></tr>';
  try {
    const res = await fetch('/api/members');
    const data = await res.json();
    if (!data.success || !Array.isArray(data.members) || data.members.length === 0) {
      membersTableBody.innerHTML = '<tr><td colspan="8" class="text-center">尚未有註冊會員</td></tr>';
      return;
    }

    membersTableBody.innerHTML = data.members.map(m => {
      const tierClass = m.tier === 'admin' ? 'admin' : (m.isVip ? 'vip' : 'free');
      const tierLabel = m.tier === 'admin' ? '👑 Admin' : (m.isVip ? '🌟 VIP' : '⚪ Free');
      const expireStr = m.tier === 'admin' ? '永久' : (m.expireAt ? new Date(m.expireAt).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) : '--');
      const filterStr = m.filterType === 'all' ? '全部蛋種' : (m.filterType === 'rare_only' ? '僅 VIP 蛋' : `自訂 (${(m.customRarities || []).join(', ')})`);

      return `
        <tr>
          <td><code>${m.chatId}</code></td>
          <td><b>${escapeHtml(m.firstName || '')}</b> ${m.username ? `<small style="color:#94a3b8">(@${escapeHtml(m.username)})</small>` : ''}</td>
          <td><span class="tier-badge ${tierClass}">${tierLabel}</span></td>
          <td>${expireStr}</td>
          <td>
            <button class="btn btn-xs ${m.enabled ? 'btn-success' : 'btn-secondary'}" onclick="toggleMemberAlert('${m.chatId}')">
              ${m.enabled ? '🔔 開啟' : '🔕 暫停'}
            </button>
          </td>
          <td><small>${filterStr}</small></td>
          <td>${m.notificationsCount || 0} 則</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-xs btn-primary" onclick="quickGrantVip('${m.chatId}', 30)" title="開通/延長 30 天 VIP">
                +30天
              </button>
              ${m.tier !== 'admin' && m.tier !== 'free' ? `
                <button class="btn btn-xs btn-danger" onclick="revokeMemberVip('${m.chatId}')" title="降級為 Free">
                  降級
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    membersTableBody.innerHTML = `<tr><td colspan="8" class="text-center" style="color:#fb7185">讀取失敗：${err.message}</td></tr>`;
  }
}

window.toggleMemberAlert = async function(chatId) {
  try {
    const res = await fetch('/api/members/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`會員 ${chatId} 推播狀態已變更！`, 'success');
      loadMemberStats();
      loadMembersList();
    }
  } catch (err) {
    showToast('操作失敗: ' + err.message, 'error');
  }
};

window.quickGrantVip = async function(chatId, days = 30) {
  const adminKey = adminKeyInput ? adminKeyInput.value.trim() : '';
  try {
    const res = await fetch('/api/members/set-vip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, days, adminKey, notes: '從網頁後台一鍵開通' })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🎉 成功為會員 ${chatId} 開通 ${days} 天 VIP！`, 'success');
      loadMemberStats();
      loadMembersList();
    } else {
      showToast('開通失敗: ' + (data.error || '未知錯誤'), 'error');
    }
  } catch (err) {
    showToast('操作失敗: ' + err.message, 'error');
  }
};

window.revokeMemberVip = async function(chatId) {
  if (!confirm(`確定要將會員 ${chatId} 降級為免費會員嗎？`)) return;
  const adminKey = adminKeyInput ? adminKeyInput.value.trim() : '';
  try {
    const res = await fetch('/api/members/revoke-vip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, adminKey })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`已將會員 ${chatId} 降級為免費會員`, 'success');
      loadMemberStats();
      loadMembersList();
    } else {
      showToast('降級失敗: ' + (data.error || '未知錯誤'), 'error');
    }
  } catch (err) {
    showToast('操作失敗: ' + err.message, 'error');
  }
};

// 切換後台折疊
if (toggleAdminPanelBtn) {
  toggleAdminPanelBtn.onclick = () => {
    adminPanelWrapper.classList.toggle('hidden');
    if (!adminPanelWrapper.classList.contains('hidden')) {
      loadMembersList();
    }
  };
}

// 刷新名冊
if (refreshMembersBtn) {
  refreshMembersBtn.onclick = () => {
    loadMembersList();
    loadMemberStats();
    showToast('名冊已重新載入', 'success');
  };
}

// 表單提交開通 VIP
if (submitGrantVipBtn) {
  submitGrantVipBtn.onclick = async () => {
    const chatId = vipChatIdInput.value.trim();
    const days = parseInt(vipDaysSelect.value, 10) || 30;
    const notes = vipNotesInput.value.trim();
    const adminKey = adminKeyInput.value.trim();

    if (!chatId) {
      showToast('請輸入會員 Chat ID', 'error');
      return;
    }

    submitGrantVipBtn.disabled = true;
    submitGrantVipBtn.textContent = '處理中...';
    try {
      const res = await fetch('/api/members/set-vip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, days, notes, adminKey })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`🎉 成功為 ${chatId} 開通 ${days} 天 VIP！`, 'success');
        vipChatIdInput.value = '';
        vipNotesInput.value = '';
        loadMemberStats();
        loadMembersList();
      } else {
        showToast('開通失敗: ' + (data.error || '驗證失敗'), 'error');
      }
    } catch (err) {
      showToast('連線失敗: ' + err.message, 'error');
    } finally {
      submitGrantVipBtn.disabled = false;
      submitGrantVipBtn.innerHTML = '<span>✨ 開通 VIP</span>';
    }
  };
}

// ==================== 會員登入與身分認證前台邏輯 ====================

const AUTH_TOKEN_KEY = 'sae_auth_token';
let currentUser = null;

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

function setAuthToken(token) {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// UI 元素綁定
const openLoginModalBtn = document.getElementById('openLoginModalBtn');
const userProfileBadge = document.getElementById('userProfileBadge');
const userDisplayName = document.getElementById('userDisplayName');
const userRoleBadge = document.getElementById('userRoleBadge');
const openMySettingsBtn = document.getElementById('openMySettingsBtn');
const logoutBtn = document.getElementById('logoutBtn');

const loginModal = document.getElementById('loginModal');
const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
const cancelLoginBtn = document.getElementById('cancelLoginBtn');
const tabTelegramBtn = document.getElementById('tabTelegramBtn');
const tabAdminBtn = document.getElementById('tabAdminBtn');
const telegramTabContent = document.getElementById('telegramTabContent');
const adminTabContent = document.getElementById('adminTabContent');

const loginChatIdInput = document.getElementById('loginChatIdInput');
const sendOtpBtn = document.getElementById('sendOtpBtn');
const otpInputGroup = document.getElementById('otpInputGroup');
const loginOtpInput = document.getElementById('loginOtpInput');
const submitOtpLoginBtn = document.getElementById('submitOtpLoginBtn');
const loginErrorMsg = document.getElementById('loginErrorMsg');

const loginAdminKeyInput = document.getElementById('loginAdminKeyInput');
const submitAdminLoginBtn = document.getElementById('submitAdminLoginBtn');
const cancelAdminLoginBtn = document.getElementById('cancelAdminLoginBtn');
const adminLoginErrorMsg = document.getElementById('adminLoginErrorMsg');

// 個人偏好 Modal 元素
const mySettingsModal = document.getElementById('mySettingsModal');
const closeMySettingsModalBtn = document.getElementById('closeMySettingsModalBtn');
const closeMySettingsBtn2 = document.getElementById('closeMySettingsBtn2');
const saveMySettingsBtn = document.getElementById('saveMySettingsBtn');
const myProfileTierBadge = document.getElementById('myProfileTierBadge');
const myProfileExpireText = document.getElementById('myProfileExpireText');
const myProfileChatId = document.getElementById('myProfileChatId');
const myNotifyToggle = document.getElementById('myNotifyToggle');

// 檢查登入狀態
async function checkAuthStatus() {
  const token = getAuthToken();
  if (!token) {
    currentUser = null;
    updateAuthUI();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.member) {
        currentUser = data;
        updateAuthUI();
        return;
      }
    }
  } catch (_) {}

  // 驗證失敗則清除無效 Token
  setAuthToken('');
  currentUser = null;
  updateAuthUI();
}

// 根據登入狀態更新畫面
function updateAuthUI() {
  if (currentUser && currentUser.member) {
    const m = currentUser.member;
    if (openLoginModalBtn) openLoginModalBtn.classList.add('hidden');
    if (userProfileBadge) userProfileBadge.classList.remove('hidden');

    if (userDisplayName) {
      userDisplayName.textContent = m.firstName || m.username || m.chatId;
    }

    if (userRoleBadge) {
      const tierClass = m.tier === 'admin' ? 'admin' : (m.isVip ? 'vip' : 'free');
      const tierText = m.tier === 'admin' ? '👑 Admin' : (m.isVip ? '🌟 VIP' : '⚪ Free');
      userRoleBadge.className = `tier-badge ${tierClass}`;
      userRoleBadge.textContent = tierText;
    }

    // 嚴格雙向同步：將 Telegram 會員自選神蛋即時載入至儀表板主畫面過濾器
    if (Array.isArray(m.customEggNames)) {
      userConfig.selectedEggs = [...m.customEggNames];
      if (typeof m.enabled === 'boolean') {
        userConfig.filterEnabled = m.enabled;
        if (masterFilterSwitch) masterFilterSwitch.checked = m.enabled;
      }
      updateSelectedCountBadge();
      renderEggsGrid();
      if (typeof renderEggPrediction === 'function') {
        renderEggPrediction(currentSelectedPredictionEgg);
      }
    }

    // 若為管理員，自動填入金鑰並解鎖後台
    if (currentUser.isAdmin && adminKeyInput && !adminKeyInput.value) {
      adminKeyInput.value = 'stealanegg2026';
    }
  } else {
    if (openLoginModalBtn) openLoginModalBtn.classList.remove('hidden');
    if (userProfileBadge) userProfileBadge.classList.add('hidden');
  }
}

// 登入彈窗開啟與關閉
if (openLoginModalBtn) {
  openLoginModalBtn.addEventListener('click', () => {
    if (loginModal) loginModal.classList.remove('hidden');
    if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
    if (adminLoginErrorMsg) adminLoginErrorMsg.classList.add('hidden');
    if (loginChatIdInput) loginChatIdInput.focus();
  });
}

function closeLoginModal() {
  if (loginModal) loginModal.classList.add('hidden');
  if (loginOtpInput) loginOtpInput.value = '';
}

if (closeLoginModalBtn) closeLoginModalBtn.onclick = closeLoginModal;
if (cancelLoginBtn) cancelLoginBtn.onclick = closeLoginModal;
if (cancelAdminLoginBtn) cancelAdminLoginBtn.onclick = closeLoginModal;

// 點擊遮罩背景或按 Esc 鍵關閉彈窗
window.addEventListener('click', (e) => {
  if (e.target === loginModal) closeLoginModal();
  if (e.target === tokenModal && tokenModal) tokenModal.classList.add('hidden');
  if (e.target === mySettingsModal) closeMySettingsModal();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLoginModal();
    closeMySettingsModal();
    if (tokenModal) tokenModal.classList.add('hidden');
  }
});

// 登入 Tab 切換
if (tabTelegramBtn && tabAdminBtn) {
  tabTelegramBtn.onclick = () => {
    tabTelegramBtn.classList.add('active');
    tabAdminBtn.classList.remove('active');
    telegramTabContent.classList.remove('hidden');
    adminTabContent.classList.add('hidden');
  };

  tabAdminBtn.onclick = () => {
    tabAdminBtn.classList.add('active');
    tabTelegramBtn.classList.remove('active');
    adminTabContent.classList.remove('hidden');
    telegramTabContent.classList.add('hidden');
    if (loginAdminKeyInput) loginAdminKeyInput.focus();
  };
}

// 發送 OTP
let otpCooldownTimer = null;
if (sendOtpBtn) {
  sendOtpBtn.onclick = async () => {
    const chatId = loginChatIdInput.value.trim();
    if (!chatId) {
      loginErrorMsg.textContent = '請先輸入 Telegram Chat ID';
      loginErrorMsg.classList.remove('hidden');
      return;
    }

    sendOtpBtn.disabled = true;
    sendOtpBtn.textContent = '發送中...';
    loginErrorMsg.classList.add('hidden');

    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId })
      });
      const data = await res.json();
      if (data.success) {
        showToast('✅ 驗證碼已發送至您的 Telegram 私訊！', 'success');
        otpInputGroup.classList.remove('hidden');
        if (submitOtpLoginBtn) submitOtpLoginBtn.disabled = false;
        if (loginOtpInput) loginOtpInput.focus();

        // 倒數計時冷卻 (30秒)
        let cd = 30;
        sendOtpBtn.textContent = `重新發送 (${cd}s)`;
        if (otpCooldownTimer) clearInterval(otpCooldownTimer);
        otpCooldownTimer = setInterval(() => {
          cd--;
          if (cd <= 0) {
            clearInterval(otpCooldownTimer);
            sendOtpBtn.disabled = false;
            sendOtpBtn.textContent = '獲取驗證碼';
          } else {
            sendOtpBtn.textContent = `重新發送 (${cd}s)`;
          }
        }, 1000);
      } else {
        loginErrorMsg.textContent = data.error || '發送失敗，請確認您已在 Telegram 私訊過 @Stealanegg3love24bot 並點擊過 /start';
        loginErrorMsg.classList.remove('hidden');
        sendOtpBtn.disabled = false;
        sendOtpBtn.textContent = '獲取驗證碼';
      }
    } catch (err) {
      loginErrorMsg.textContent = '連線伺服器異常: ' + err.message;
      loginErrorMsg.classList.remove('hidden');
      sendOtpBtn.disabled = false;
      sendOtpBtn.textContent = '獲取驗證碼';
    }
  };
}

// 監聽 OTP 輸入框 (輸入滿 6 碼自動解鎖)
if (loginOtpInput) {
  loginOtpInput.addEventListener('input', () => {
    const val = loginOtpInput.value.trim();
    if (submitOtpLoginBtn) {
      submitOtpLoginBtn.disabled = val.length < 6;
    }
  });
}

// 提交 OTP 登入
if (submitOtpLoginBtn) {
  submitOtpLoginBtn.onclick = async () => {
    const chatId = loginChatIdInput.value.trim();
    const code = loginOtpInput.value.trim();
    if (!chatId || !code) {
      loginErrorMsg.textContent = '請輸入 6 位數驗證碼';
      loginErrorMsg.classList.remove('hidden');
      return;
    }

    submitOtpLoginBtn.disabled = true;
    submitOtpLoginBtn.textContent = '驗證登入中...';
    loginErrorMsg.classList.add('hidden');

    try {
      const res = await fetch('/api/auth/login-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, code })
      });
      const data = await res.json();
      if (data.success && data.token) {
        setAuthToken(data.token);
        currentUser = { authenticated: true, chatId: data.member.chatId, role: data.member.tier, isAdmin: data.member.isAdmin, member: data.member };
        updateAuthUI();
        closeLoginModal();
        showToast(`🎉 歡迎回來，${data.member.firstName || '玩家'}！已成功登入！`, 'success');
        loadMemberStats();
      } else {
        loginErrorMsg.textContent = data.error || '驗證碼錯誤或已過期';
        loginErrorMsg.classList.remove('hidden');
      }
    } catch (err) {
      loginErrorMsg.textContent = '登入失敗: ' + err.message;
      loginErrorMsg.classList.remove('hidden');
    } finally {
      submitOtpLoginBtn.disabled = false;
      submitOtpLoginBtn.textContent = '🚀 確認登入';
    }
  };
}

// 管理員金鑰登入
if (submitAdminLoginBtn) {
  submitAdminLoginBtn.onclick = async () => {
    const adminKey = loginAdminKeyInput.value.trim();
    if (!adminKey) {
      adminLoginErrorMsg.textContent = '請輸入管理金鑰';
      adminLoginErrorMsg.classList.remove('hidden');
      return;
    }

    submitAdminLoginBtn.disabled = true;
    submitAdminLoginBtn.textContent = '登入中...';
    adminLoginErrorMsg.classList.add('hidden');

    try {
      const res = await fetch('/api/auth/login-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey })
      });
      const data = await res.json();
      if (data.success && data.token) {
        setAuthToken(data.token);
        currentUser = { authenticated: true, chatId: data.member.chatId, role: 'admin', isAdmin: true, member: data.member };
        updateAuthUI();
        closeLoginModal();
        showToast('👑 管理員身分已驗證，已解鎖全部後台權限！', 'success');
        loadMemberStats();
        // 自動展開管理員名冊
        if (adminPanelWrapper) {
          adminPanelWrapper.classList.remove('hidden');
          loadMembersList();
        }
      } else {
        adminLoginErrorMsg.textContent = data.error || '管理金鑰錯誤';
        adminLoginErrorMsg.classList.remove('hidden');
      }
    } catch (err) {
      adminLoginErrorMsg.textContent = '登入失敗: ' + err.message;
      adminLoginErrorMsg.classList.remove('hidden');
    } finally {
      submitAdminLoginBtn.disabled = false;
      submitAdminLoginBtn.textContent = '👑 管理員登入';
    }
  };
}

// 登出
if (logoutBtn) {
  logoutBtn.onclick = async () => {
    if (!confirm('確定要登出嗎？')) return;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders()
      });
    } catch (_) {}
    setAuthToken('');
    currentUser = null;
    updateAuthUI();
    showToast('👋 您已成功登出', 'success');
  };
}

// ==================== 個人偏好設定 Modal & 操作日誌 ====================
const HIGH_TIER_EGGS_META = [
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

const TOP_10_EGG_LIST = [
  'Cosmic Dragon', 'World Burner', 'Mutant Shark', 'Gargoyle', 'Kraken',
  'Cerberus', 'Eternal Lunar Dragon', 'Phoenix', 'Mosasaurus', 'ArchAngel'
];

// DOM 元素引用
const tabMyFilterBtn = document.getElementById('tabMyFilterBtn');
const tabMyLogsBtn = document.getElementById('tabMyLogsBtn');
const myFilterTabWrap = document.getElementById('myFilterTabWrap');
const myLogsTabWrap = document.getElementById('myLogsTabWrap');
const myLogsCountBadge = document.getElementById('myLogsCountBadge');
const myCustomEggsWrap = document.getElementById('myCustomEggsWrap');
const myEggsGridContainer = document.getElementById('myEggsGridContainer');
const mySelectedEggCount = document.getElementById('mySelectedEggCount');
const mySelectAll28Btn = document.getElementById('mySelectAll28Btn');
const mySelectTop10Btn = document.getElementById('mySelectTop10Btn');
const myClearEggsBtn = document.getElementById('myClearEggsBtn');
const myLogsTimeline = document.getElementById('myLogsTimeline');
const myLogsEmptyNotice = document.getElementById('myLogsEmptyNotice');
const refreshMyLogsBtn = document.getElementById('refreshMyLogsBtn');

// 切換 Tab
if (tabMyFilterBtn && tabMyLogsBtn) {
  tabMyFilterBtn.onclick = () => {
    tabMyFilterBtn.classList.add('active');
    tabMyLogsBtn.classList.remove('active');
    if (myFilterTabWrap) myFilterTabWrap.classList.remove('hidden');
    if (myLogsTabWrap) myLogsTabWrap.classList.add('hidden');
  };

  tabMyLogsBtn.onclick = () => {
    tabMyLogsBtn.classList.add('active');
    tabMyFilterBtn.classList.remove('active');
    if (myLogsTabWrap) myLogsTabWrap.classList.remove('hidden');
    if (myFilterTabWrap) myFilterTabWrap.classList.add('hidden');
    loadMyLogs();
  };
}

if (openMySettingsBtn) {
  openMySettingsBtn.onclick = () => {
    if (!currentUser || !currentUser.member) {
      showToast('請先登入會員', 'error');
      return;
    }
    const m = currentUser.member;

    // 預設切換至推播 Tab
    if (tabMyFilterBtn) tabMyFilterBtn.click();

    if (myProfileTierBadge) {
      const tierClass = m.tier === 'admin' ? 'admin' : (m.isVip ? 'vip' : 'free');
      const tierText = m.tier === 'admin' ? '👑 Admin' : (m.isVip ? '🌟 VIP' : '⚪ Free');
      myProfileTierBadge.className = `tier-badge ${tierClass}`;
      myProfileTierBadge.textContent = tierText;
    }

    if (myProfileExpireText) {
      myProfileExpireText.textContent = m.tier === 'admin' ? '永久有效' : (m.expireAt ? new Date(m.expireAt).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) : '未開通 (免費方案)');
    }

    if (myProfileChatId) {
      myProfileChatId.textContent = m.chatId;
    }

    if (myNotifyToggle) {
      myNotifyToggle.checked = m.enabled !== false;
    }

    // 模式選擇
    const currentMode = m.filterType || 'all';
    const radios = document.querySelectorAll('input[name="myFilterMode"]');
    radios.forEach(r => {
      r.checked = r.value === currentMode;
    });

    const selectedEggs = Array.isArray(m.customEggNames)
      ? m.customEggNames
      : [...DEFAULT_HIGH_TIER_NAMES];

    renderMyEggsChecklist(selectedEggs);

    if (currentMode === 'custom') {
      if (myCustomEggsWrap) myCustomEggsWrap.classList.remove('hidden');
    } else {
      if (myCustomEggsWrap) myCustomEggsWrap.classList.add('hidden');
    }

    if (myLogsCountBadge) {
      myLogsCountBadge.textContent = m.activityLogs?.length || 0;
    }

    if (mySettingsModal) mySettingsModal.classList.remove('hidden');
  };
}

// 渲染 28 款神蛋勾選卡片 (支援關鍵字搜尋、階級篩選與批次操作)
let myModalSearchQuery = '';
let myModalRarityFilter = 'all';

function filterMyEggsCards() {
  if (!myEggsGridContainer) return;
  const q = myModalSearchQuery.toLowerCase();
  myEggsGridContainer.querySelectorAll('.my-egg-card').forEach(card => {
    const name = (card.querySelector('.my-egg-name')?.textContent || '').toLowerCase();
    const tag = (card.querySelector('.my-egg-tag')?.textContent || '').toLowerCase();
    const biome = (card.querySelector('.my-egg-tag.biome')?.textContent || '').toLowerCase();

    const rarityMatch = (myModalRarityFilter === 'all') || (tag === myModalRarityFilter.toLowerCase());
    const searchMatch = !q || name.includes(q) || tag.includes(q) || biome.includes(q);

    if (rarityMatch && searchMatch) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}

function renderMyEggsChecklist(selectedEggs = []) {
  if (!myEggsGridContainer) return;

  myEggsGridContainer.innerHTML = HIGH_TIER_EGGS_META.map(egg => {
    const isChecked = selectedEggs.includes(egg.name);
    const rarityClass = `rarity-${egg.rarity.toLowerCase().replace(/[^a-z]/g, '')}`;
    return `
      <label class="my-egg-card ${isChecked ? 'selected' : ''}">
        <input type="checkbox" value="${egg.name}" ${isChecked ? 'checked' : ''} class="my-egg-chk" style="accent-color:#38bdf8;">
        <div class="my-egg-info">
          <div class="my-egg-name" title="${egg.name}">${egg.name}</div>
          <div class="my-egg-meta">
            <span class="my-egg-tag ${rarityClass}">${egg.rarity}</span>
            <span class="my-egg-tag biome">${egg.biome}</span>
          </div>
        </div>
      </label>
    `;
  }).join('');

  updateSelectedCount();
  filterMyEggsCards();

  // 綁定卡片勾選事件
  myEggsGridContainer.querySelectorAll('.my-egg-card').forEach(card => {
    const chk = card.querySelector('.my-egg-chk');
    if (!chk) return;
    chk.onchange = () => {
      if (chk.checked) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
      updateSelectedCount();
    };
  });
}

// 彈窗內部搜尋與階級篩選監聽
const myEggSearchInput = document.getElementById('myEggSearchInput');
const myEggSearchClearBtn = document.getElementById('myEggSearchClearBtn');
const myEggRarityPills = document.querySelectorAll('#myEggRarityPills .modal-rarity-pill');
const mySelectFilteredBtn = document.getElementById('mySelectFilteredBtn');
const myDeselectFilteredBtn = document.getElementById('myDeselectFilteredBtn');

if (myEggSearchInput) {
  myEggSearchInput.addEventListener('input', (e) => {
    myModalSearchQuery = e.target.value.trim();
    if (myEggSearchClearBtn) myEggSearchClearBtn.classList.toggle('hidden', !myModalSearchQuery);
    filterMyEggsCards();
  });
}

if (myEggSearchClearBtn) {
  myEggSearchClearBtn.addEventListener('click', () => {
    if (myEggSearchInput) myEggSearchInput.value = '';
    myModalSearchQuery = '';
    myEggSearchClearBtn.classList.add('hidden');
    filterMyEggsCards();
  });
}

myEggRarityPills.forEach(pill => {
  pill.addEventListener('click', () => {
    myEggRarityPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    myModalRarityFilter = pill.getAttribute('data-rarity') || 'all';
    filterMyEggsCards();
  });
});

if (mySelectFilteredBtn) {
  mySelectFilteredBtn.addEventListener('click', () => {
    const visibleCards = myEggsGridContainer.querySelectorAll('.my-egg-card:not(.hidden)');
    visibleCards.forEach(card => {
      const chk = card.querySelector('.my-egg-chk');
      if (chk) {
        chk.checked = true;
        card.classList.add('selected');
      }
    });
    updateSelectedCount();
    showToast(`✅ 已勾選目前篩選出的 ${visibleCards.length} 款神蛋！`, 'info');
  });
}

if (myDeselectFilteredBtn) {
  myDeselectFilteredBtn.addEventListener('click', () => {
    const visibleCards = myEggsGridContainer.querySelectorAll('.my-egg-card:not(.hidden)');
    visibleCards.forEach(card => {
      const chk = card.querySelector('.my-egg-chk');
      if (chk) {
        chk.checked = false;
        card.classList.remove('selected');
      }
    });
    updateSelectedCount();
    showToast(`⬜ 已取消勾選目前篩選出的 ${visibleCards.length} 款神蛋！`, 'info');
  });
}

function updateSelectedCount() {
  const checked = document.querySelectorAll('.my-egg-chk:checked');
  if (mySelectedEggCount) {
    mySelectedEggCount.textContent = checked.length;
  }
}

// 快速範本按鈕
if (mySelectAll28Btn) {
  mySelectAll28Btn.onclick = () => {
    document.querySelectorAll('.my-egg-chk').forEach(chk => {
      chk.checked = true;
      chk.closest('.my-egg-card')?.classList.add('selected');
    });
    updateSelectedCount();
  };
}

if (mySelectTop10Btn) {
  mySelectTop10Btn.onclick = () => {
    document.querySelectorAll('.my-egg-chk').forEach(chk => {
      const isTop10 = TOP_10_EGG_LIST.includes(chk.value);
      chk.checked = isTop10;
      if (isTop10) {
        chk.closest('.my-egg-card')?.classList.add('selected');
      } else {
        chk.closest('.my-egg-card')?.classList.remove('selected');
      }
    });
    updateSelectedCount();
  };
}

if (myClearEggsBtn) {
  myClearEggsBtn.onclick = () => {
    document.querySelectorAll('.my-egg-chk').forEach(chk => {
      chk.checked = false;
      chk.closest('.my-egg-card')?.classList.remove('selected');
    });
    updateSelectedCount();
  };
}

// 監聽個人推播模式切換
document.addEventListener('change', (e) => {
  if (e.target && e.target.name === 'myFilterMode') {
    if (e.target.value === 'custom') {
      if (myCustomEggsWrap) myCustomEggsWrap.classList.remove('hidden');
    } else {
      if (myCustomEggsWrap) myCustomEggsWrap.classList.add('hidden');
    }
  }
});

// 載入我的操作歷史日誌
async function loadMyLogs() {
  if (!myLogsTimeline) return;
  myLogsTimeline.innerHTML = '<div style="color:#94a3b8; font-size:13px; text-align:center; padding:20px;">載入日誌中...</div>';

  try {
    const res = await fetch('/api/auth/my-logs', {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.logs)) {
      if (myLogsCountBadge) myLogsCountBadge.textContent = data.logs.length;
      if (data.logs.length === 0) {
        myLogsTimeline.innerHTML = '';
        if (myLogsEmptyNotice) myLogsEmptyNotice.classList.remove('hidden');
        return;
      }

      if (myLogsEmptyNotice) myLogsEmptyNotice.classList.add('hidden');
      myLogsTimeline.innerHTML = data.logs.map(log => {
        const timeStr = formatDateTime(log.timestamp);
        const sourceClass = `source-${log.source || 'telegram'}`;
        const sourceText = log.source === 'web' ? '🌐 網頁' : (log.source === 'system' ? '⚙️ 系統' : '📱 Telegram');
        let icon = '📝';
        if (log.action === 'toggle_egg') icon = '🥚';
        else if (log.action === 'apply_preset') icon = '⭐';
        else if (log.action === 'toggle_enabled') icon = '🔔';
        else if (log.action === 'web_login') icon = '🔑';
        else if (log.action === 'vip_grant') icon = '👑';

        return `
          <div class="log-item">
            <div class="log-icon-badge">${icon}</div>
            <div class="log-content">
              <div class="log-header-row">
                <span class="log-source-badge ${sourceClass}">${sourceText}</span>
                <span class="log-time">${timeStr}</span>
              </div>
              <div class="log-desc">${log.description}</div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      myLogsTimeline.innerHTML = `<div style="color:#fb7185; font-size:13px; text-align:center; padding:20px;">無法讀取紀錄: ${data.error || '未授權'}</div>`;
    }
  } catch (err) {
    myLogsTimeline.innerHTML = `<div style="color:#fb7185; font-size:13px; text-align:center; padding:20px;">連線異常: ${err.message}</div>`;
  }
}

if (refreshMyLogsBtn) {
  refreshMyLogsBtn.onclick = () => {
    loadMyLogs();
    showToast('🔄 已重新整理個人操作日誌', 'success');
  };
}

function closeMySettingsModal() {
  if (mySettingsModal) mySettingsModal.classList.add('hidden');
}

if (closeMySettingsModalBtn) closeMySettingsModalBtn.onclick = closeMySettingsModal;
if (closeMySettingsBtn2) closeMySettingsBtn2.onclick = closeMySettingsModal;

if (saveMySettingsBtn) {
  saveMySettingsBtn.onclick = async () => {
    saveMySettingsBtn.disabled = true;
    saveMySettingsBtn.textContent = '儲存中...';

    const enabled = myNotifyToggle.checked;
    const selectedMode = document.querySelector('input[name="myFilterMode"]:checked')?.value || 'all';
    const checkedEggs = Array.from(document.querySelectorAll('.my-egg-chk:checked')).map(c => c.value);

    try {
      const res = await fetch('/api/auth/update-my-settings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          enabled,
          filterType: selectedMode,
          customEggNames: checkedEggs
        })
      });
      const data = await res.json();
      if (data.success && data.member) {
        currentUser.member = data.member;
        updateAuthUI();
        closeMySettingsModal();
        showToast('💾 個人推播設定已儲存並同步至 Telegram！', 'success');
      } else {
        showToast('儲存失敗: ' + (data.error || '請重試'), 'error');
      }
    } catch (err) {
      showToast('連線失敗: ' + err.message, 'error');
    } finally {
      saveMySettingsBtn.disabled = false;
      saveMySettingsBtn.innerHTML = '<span>💾 儲存個人偏好</span>';
    }
  };
}

// 測試發送 Telegram 推播按鈕
const sendTestTelegramBtn = document.getElementById('sendTestTelegramBtn');
if (sendTestTelegramBtn) {
  sendTestTelegramBtn.onclick = async () => {
    sendTestTelegramBtn.disabled = true;
    const origHtml = sendTestTelegramBtn.innerHTML;
    sendTestTelegramBtn.innerHTML = '<span>⏳ 發送中...</span>';
    try {
      const res = await fetch('/api/auth/test-telegram', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (data.success) {
        showToast('🧪 ' + (data.message || '測試推播已發送至您的 Telegram！'), 'success');
      } else {
        showToast('發送失敗: ' + (data.error || '請重試'), 'error');
      }
    } catch (err) {
      showToast('連線失敗: ' + err.message, 'error');
    } finally {
      sendTestTelegramBtn.disabled = false;
      sendTestTelegramBtn.innerHTML = origHtml;
    }
  };
}

// ==================== 💎 寵物鑽石產能與價值試算器 ====================
const PET_CALC_DATA = [
  // Divine 階級 (神聖寵物 - 優先最新最高階區塊)
  {
    name: 'World Burner',
    icon: '🔥',
    rarity: 'Divine',
    biome: 'Angels & Demons',
    baseRate: 5000000000,
    speedReq: '20B 速度',
    tier: '👑 EX 級神寵 (God Tier)',
    tradeValue: '約 1.2M ~ 1.8M 鑽石 / $50+',
    proTips: '產自「Angels & Demons」暗黑模式！搭配 Spirit Bloom / Rainbow 變異可達到全服頂尖產能，是合成 Aetheron 的必備核心。'
  },
  {
    name: 'ArchAngel',
    icon: '👼',
    rarity: 'Divine',
    biome: 'Angels & Demons',
    baseRate: 4500000000,
    speedReq: '20B 速度',
    tier: '👑 EX 級神寵 (God Tier)',
    tradeValue: '約 1.0M ~ 1.5M 鑽石',
    proTips: '產自「Angels & Demons」天使模式！極高基底產能，外觀華麗且極具收藏與掛機價值。'
  },
  {
    name: 'Nightflame',
    icon: '🖤',
    rarity: 'Divine',
    biome: 'Titan Temple',
    baseRate: 3000000000,
    speedReq: '5B 速度',
    tier: '🔥 S+ 頂級 (Ultra Rare)',
    tradeValue: '約 750k ~ 1.0M 鑽石',
    proTips: '產自「Titan Temple」神廟深處，僅次於天使更新的最高階神聖寵物，升級與變異回報極高。'
  },
  {
    name: 'Kitsune',
    icon: '🌸',
    rarity: 'Divine',
    biome: 'Cherry Blossom',
    baseRate: 2000000000,
    speedReq: '1.5B 速度',
    tier: '🔥 S+ 頂級 (Ultra Rare)',
    tradeValue: '約 500k ~ 800k 鑽石',
    proTips: '九尾狐神聖寵，在櫻花保溫箱 (Sakura Incubator) 孵化有機會直接出 Spirit Bloom 變異！'
  },
  {
    name: 'Unicorn',
    icon: '🦄',
    rarity: 'Divine',
    biome: 'Cosmic',
    baseRate: 1500000000,
    speedReq: '1B 速度',
    tier: '⭐ S 級 (High End)',
    tradeValue: '約 350k ~ 500k 鑽石',
    proTips: '太空宇宙區塊神聖寵物，穩定出蛋且自帶神聖光環，是新手邁向神級的重要門檻。'
  },

  // Eternal 階級 (永恆寵物 - 優先最新最高階區塊)
  {
    name: 'Skeleton Horse',
    icon: '🐎',
    rarity: 'Eternal',
    biome: 'Angels & Demons',
    baseRate: 950000000,
    speedReq: '20B 速度',
    tier: '⭐ S 級 (High End)',
    tradeValue: '約 250k ~ 400k 鑽石',
    proTips: '天使與惡魔地圖的頂級永恆寵物，體重普遍偏重，容易洗出高收益數值。'
  },
  {
    name: 'Pegasus',
    icon: '🪽',
    rarity: 'Eternal',
    biome: 'Angels & Demons',
    baseRate: 900000000,
    speedReq: '20B 速度',
    tier: '⭐ S 級 (High End)',
    tradeValue: '約 220k ~ 350k 鑽石',
    proTips: '天馬神翼，極高飛行速度加成與穩定產能。'
  },
  {
    name: 'Gorilla King',
    icon: '🦍',
    rarity: 'Eternal',
    biome: 'Titan Temple',
    baseRate: 800000000,
    speedReq: '5B 速度',
    tier: '⭐ S 級 (High End)',
    tradeValue: '約 200k ~ 300k 鑽石',
    proTips: '泰坦神廟守門神，基礎體型龐大，重量系數優於一般寵物。'
  },
  {
    name: 'Eternal Lunar Dragon',
    icon: '🌙',
    rarity: 'Eternal',
    biome: 'Cosmic',
    baseRate: 650000000,
    speedReq: '1B 速度',
    tier: '💎 A+ 級 (Excellent)',
    tradeValue: '約 150k ~ 250k 鑽石',
    proTips: '永恆月龍，夜間或太空區掛機效益顯著，市場流通量大。'
  },
  {
    name: 'Phoenix',
    icon: '🦅',
    rarity: 'Eternal',
    biome: 'Volcano',
    baseRate: 450000000,
    speedReq: '500M 速度',
    tier: '💎 A+ 級 (Excellent)',
    tradeValue: '約 100k ~ 180k 鑽石',
    proTips: '火山不死鳥，重生火焰特效，融合時極易保留高階火系變異。'
  },
  {
    name: 'El Maja',
    icon: '🐠',
    rarity: 'Eternal',
    biome: 'Abyss Ocean',
    baseRate: 350000000,
    speedReq: '200M 速度',
    tier: '💎 A 級 (Good)',
    tradeValue: '約 80k ~ 140k 鑽石',
    proTips: '深海巨魚，適合掛機深海生態採集。'
  },
  {
    name: 'Mosasaurus',
    icon: '🦖',
    rarity: 'Eternal',
    biome: 'Prehistoric',
    baseRate: 250000000,
    speedReq: '80M 速度',
    tier: '💎 A 級 (Good)',
    tradeValue: '約 60k ~ 100k 鑽石',
    proTips: '遠古滄龍，新手進階永恆的首選。'
  },
  {
    name: 'Ice Dragon',
    icon: '❄️',
    rarity: 'Eternal',
    biome: 'Snow',
    baseRate: 180000000,
    speedReq: '30M 速度',
    tier: '🔹 B+ 級 (Solid)',
    tradeValue: '約 40k ~ 70k 鑽石',
    proTips: '雪地永恆冰龍，穩健過渡用寵物。'
  },
  {
    name: 'Lava Dragon',
    icon: '🌋',
    rarity: 'Eternal',
    biome: 'Volcano',
    baseRate: 150000000,
    speedReq: '500M 速度',
    tier: '🔹 B+ 級 (Solid)',
    tradeValue: '約 35k ~ 60k 鑽石',
    proTips: '熔岩巨龍，適合中期玩家組隊融合。'
  },
  {
    name: 'Oni Tiger',
    icon: '🐯',
    rarity: 'Eternal',
    biome: 'Cherry Blossom',
    baseRate: 120000000,
    speedReq: '1.5B 速度',
    tier: '🔹 B 級 (Entry)',
    tradeValue: '約 30k ~ 50k 鑽石',
    proTips: '櫻花鬼虎，入門級永恆寵物。'
  },

  // Secret 隱藏頂級 (玩家常問的重點寵物)
  {
    name: 'Gargoyle',
    icon: '🗿',
    rarity: 'Secret',
    biome: 'Angels & Demons',
    baseRate: 750000000,
    speedReq: '20B 速度',
    tier: '⭐ S 級 (High End)',
    tradeValue: '約 180k ~ 280k 鑽石',
    proTips: '天使地圖隱藏秘密寵物，石像鬼防禦與產能均屬一流水準。'
  },
  {
    name: 'Cosmic Dragon',
    icon: '🪐',
    rarity: 'Secret',
    biome: 'Cosmic',
    baseRate: 500000000,
    speedReq: '1B 速度',
    tier: '💎 A+ 級 (Excellent)',
    tradeValue: '約 120k ~ 200k 鑽石',
    proTips: '全遊戲人氣最高的秘密龍種之一，外觀極度炫酷。'
  },
  {
    name: 'Mutant Shark',
    icon: '🦈',
    rarity: 'Secret',
    biome: 'Titan Temple',
    baseRate: 400000000,
    speedReq: '5B 速度',
    tier: '💎 A 級 (Good)',
    tradeValue: '約 90k ~ 150k 鑽石',
    proTips: '泰坦神廟突變巨鯊，基礎攻擊與產能雙高。'
  },
  {
    name: 'Kraken',
    icon: '🐙',
    rarity: 'Secret',
    biome: 'Abyss Ocean',
    baseRate: 280000000,
    speedReq: '200M 速度',
    tier: '💎 A 級 (Good)',
    tradeValue: '約 70k ~ 120k 鑽石',
    proTips: '深海霸主克拉肯，八爪觸手極具標誌性。'
  },
  {
    name: 'Cerberus',
    icon: '🐕',
    rarity: 'Secret',
    biome: 'Volcano',
    baseRate: 180000000,
    speedReq: '500M 速度',
    tier: '🔹 B+ 級 (Solid)',
    tradeValue: '約 40k ~ 80k 鑽石',
    proTips: '地獄三頭犬，經典火山秘密神寵。'
  }
];

const MUTATIONS_LIST = [
  { id: 'spirit_bloom', name: 'Spirit Bloom', mult: 3.0, icon: '🌸', radiant: true, note: '櫻花保溫箱 3.0x' },
  { id: 'monstrous', name: 'Monstrous', mult: 3.0, icon: '👾', radiant: true, note: '怪物寶箱 3.0x' },
  { id: 'rainbow', name: 'Rainbow', mult: 2.5, icon: '🌈', radiant: true, note: '彩虹融合 2.5x' },
  { id: 'ascended', name: 'Ascended', mult: 2.5, icon: '⚡', radiant: false, note: '昇華聖堂 2.5x' },
  { id: 'golden', name: 'Golden', mult: 2.0, icon: '👑', radiant: false, note: '黃金變異 2.0x' },
  { id: 'bloom', name: 'Bloom', mult: 1.5, icon: '🌺', radiant: false, note: '初階綻放 1.5x' },
  { id: 'shiny', name: 'Shiny', mult: 1.5, icon: '✨', radiant: false, note: '閃亮光澤 1.5x' },
  { id: 'silver', name: 'Silver', mult: 1.25, icon: '🥈', radiant: false, note: '白銀變異 1.25x' },
  { id: 'fractured', name: 'Fractured', mult: 1.1, icon: '💥', radiant: false, note: '首領商店 +10%' },
  { id: 'giant', name: 'Giant', mult: 1.3, icon: '🪐', radiant: false, note: '重量+25% & 1.3x' },
  { id: 'radioactive', name: 'Radioactive', mult: 5.0, icon: '☢️', radiant: true, note: '放射性 5.0x' },
  { id: 'void', name: 'Void', mult: 4.0, icon: '🌌', radiant: true, note: '虛空暗黑 4.0x' }
];

function formatGameNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  const abs = Math.abs(num);
  if (abs >= 1e18) return (num / 1e18).toFixed(2) + ' Qi';
  if (abs >= 1e15) return (num / 1e15).toFixed(2) + ' Qa';
  if (abs >= 1e12) return (num / 1e12).toFixed(2) + ' T';
  if (abs >= 1e9) return (num / 1e9).toFixed(2) + ' B';
  if (abs >= 1e6) return (num / 1e6).toFixed(2) + ' M';
  if (abs >= 1e3) return (num / 1e3).toFixed(2) + ' K';
  return Math.round(num).toLocaleString();
}

function initPetCalculator() {
  const select = document.getElementById('calcPetSelect');
  const slider = document.getElementById('calcWeightSlider');
  const numberInput = document.getElementById('calcWeightInput');
  const weightVal = document.getElementById('calcWeightValue');
  const mutationsGrid = document.getElementById('calcMutationsGrid');
  const resetBtn = document.getElementById('calcResetBtn');
  const topConfigBtn = document.getElementById('calcTopConfigBtn');
  const presetBtns = document.querySelectorAll('.weight-preset-btn');
  const selectedMutCount = document.getElementById('calcSelectedMutationCount');

  if (!select || !slider || !numberInput) return;

  // 1. 填入寵物下拉選項
  let groupedHtml = '';
  const rarities = ['Divine', 'Eternal', 'Secret'];
  for (const r of rarities) {
    const list = PET_CALC_DATA.filter(p => p.rarity === r);
    if (list.length > 0) {
      groupedHtml += `<optgroup label="🌟 ${r} 階級 (${list.length} 款)">`;
      for (const p of list) {
        groupedHtml += `<option value="${p.name}">${p.icon} ${p.name} [${p.biome}]</option>`;
      }
      groupedHtml += `</optgroup>`;
    }
  }
  select.innerHTML = groupedHtml;
  select.value = 'World Burner';

  // 2. 渲染變異屬性 Checkbox 晶片
  if (mutationsGrid) {
    mutationsGrid.innerHTML = MUTATIONS_LIST.map(m => `
      <label class="mutation-chip" data-id="${m.id}">
        <div class="mutation-chip-left">
          <input type="checkbox" class="mutation-chip-checkbox" value="${m.id}" data-mult="${m.mult}">
          <span class="mutation-chip-name">${m.icon} ${m.name}</span>
        </div>
        <span class="mutation-chip-mult">${m.mult}x</span>
      </label>
    `).join('');
  }

  // 3. 計算並更新面板
  function recalculate() {
    const petName = select.value;
    const pet = PET_CALC_DATA.find(p => p.name === petName) || PET_CALC_DATA[0];

    let weight = parseFloat(numberInput.value) || 100;
    if (weight < 1) weight = 1;

    // 檢查已勾選變異
    const checkedBoxes = Array.from(document.querySelectorAll('.mutation-chip-checkbox:checked'));
    let hasGiant = false;
    let totalMult = 1.0;
    const selectedNames = [];

    checkedBoxes.forEach(chk => {
      const mult = parseFloat(chk.dataset.mult) || 1.0;
      totalMult *= mult;
      const mDef = MUTATIONS_LIST.find(m => m.id === chk.value);
      if (mDef) selectedNames.push(`${mDef.icon} ${mDef.name} (${mDef.mult}x)`);
      if (chk.value === 'giant') hasGiant = true;

      // 突顯外觀
      const parent = chk.closest('.mutation-chip');
      if (parent) {
        parent.classList.add('selected');
        if (mDef && mDef.radiant) parent.classList.add('radiant');
      }
    });

    // 移除未勾選外觀
    document.querySelectorAll('.mutation-chip-checkbox:not(:checked)').forEach(chk => {
      const parent = chk.closest('.mutation-chip');
      if (parent) {
        parent.classList.remove('selected', 'radiant');
      }
    });

    // 重量計算 (Giant 額外 +25% 重量加成)
    const effectiveWeight = hasGiant ? (weight * 1.25) : weight;
    const weightRatio = effectiveWeight / 100.0;

    // 最終每秒產能
    const finalPerSec = pet.baseRate * weightRatio * totalMult;
    const finalPerMin = finalPerSec * 60;
    const finalPerHour = finalPerSec * 3600;
    const finalPerDay = finalPerSec * 86400;

    // 更新 DOM 數值
    if (weightVal) weightVal.textContent = Math.round(weight);

    const rarityBadge = document.getElementById('calcPetRarityBadge');
    if (rarityBadge) {
      rarityBadge.textContent = pet.rarity;
      rarityBadge.className = `calc-badge ${pet.rarity.toLowerCase()}`;
    }

    const iconEl = document.getElementById('calcPetIcon');
    if (iconEl) iconEl.textContent = pet.icon;

    const nameEl = document.getElementById('calcResultPetName');
    if (nameEl) nameEl.textContent = pet.name;

    const rRarityEl = document.getElementById('calcResultRarity');
    if (rRarityEl) rRarityEl.textContent = pet.rarity;

    const rBiomeEl = document.getElementById('calcResultBiome');
    if (rBiomeEl) rBiomeEl.textContent = pet.biome;

    const rSpeedEl = document.getElementById('calcResultSpeed');
    if (rSpeedEl) rSpeedEl.textContent = `⚡ 需 ${pet.speedReq}`;

    const rTierEl = document.getElementById('calcResultTierBadge');
    if (rTierEl) rTierEl.textContent = pet.tier;

    const perSecText = document.getElementById('calcPerSecText');
    if (perSecText) perSecText.textContent = `💎 ${formatGameNumber(finalPerSec)} / 秒`;

    const perSecRaw = document.getElementById('calcPerSecRaw');
    if (perSecRaw) perSecRaw.textContent = `${Math.round(finalPerSec).toLocaleString()} / sec`;

    const perMinText = document.getElementById('calcPerMinText');
    if (perMinText) perMinText.textContent = `${formatGameNumber(finalPerMin)}`;

    const perHourText = document.getElementById('calcPerHourText');
    if (perHourText) perHourText.textContent = `${formatGameNumber(finalPerHour)}`;

    const perDayText = document.getElementById('calcPerDayText');
    if (perDayText) perDayText.textContent = `${formatGameNumber(finalPerDay)}`;

    if (selectedMutCount) {
      selectedMutCount.textContent = `已選 ${checkedBoxes.length} 種 (${totalMult.toFixed(2)}x)`;
    }

    // 公式解析
    const formulaEl = document.getElementById('calcFormulaBreakdown');
    if (formulaEl) {
      formulaEl.textContent = `基礎 ${formatGameNumber(pet.baseRate)} × 重量 ${weightRatio.toFixed(2)}x × 變異 ${totalMult.toFixed(2)}x = ${formatGameNumber(finalPerSec)}/s`;
    }

    const detailsEl = document.getElementById('calcBreakdownDetails');
    if (detailsEl) {
      const mutDetailsStr = selectedNames.length > 0 ? selectedNames.join('、') : '無變異 (1.00x)';
      detailsEl.innerHTML = `
        • 基礎產能：${formatGameNumber(pet.baseRate)} / 秒 (${pet.rarity} 基準)<br>
        • 重量係數：${Math.round(weight)}kg ${hasGiant ? '(+25% 巨化後 = ' + Math.round(effectiveWeight) + 'kg)' : ''} → <b>${weightRatio.toFixed(2)}x</b><br>
        • 變異加成：${mutDetailsStr} → <b>${totalMult.toFixed(2)}x</b>
      `;
    }

    // 交易估值與攻略
    const valPrice = document.getElementById('calcMarketValue');
    if (valPrice) valPrice.textContent = pet.tradeValue;

    const proTips = document.getElementById('calcProTips');
    if (proTips) {
      proTips.innerHTML = `💡 <b>打寶攻略：</b> ${pet.proTips}`;
    }
  }

  // 4. 事件監聽綁定
  select.addEventListener('change', recalculate);

  slider.addEventListener('input', () => {
    numberInput.value = slider.value;
    presetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.weight === slider.value);
    });
    recalculate();
  });

  numberInput.addEventListener('input', () => {
    slider.value = numberInput.value;
    presetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.weight === numberInput.value);
    });
    recalculate();
  });

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const w = btn.dataset.weight;
      slider.value = w;
      numberInput.value = w;
      recalculate();
    });
  });

  if (mutationsGrid) {
    mutationsGrid.addEventListener('change', recalculate);
  }

  // 重置按鈕
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      select.value = 'World Burner';
      slider.value = 100;
      numberInput.value = 100;
      presetBtns.forEach(b => b.classList.toggle('active', b.dataset.weight === '100'));
      document.querySelectorAll('.mutation-chip-checkbox').forEach(chk => {
        chk.checked = false;
      });
      recalculate();
      showToast('🔄 已重置寵物產能試算器！', 'info');
    });
  }

  // 一鍵套用頂配 (Rainbow + Spirit Bloom)
  if (topConfigBtn) {
    topConfigBtn.addEventListener('click', () => {
      select.value = 'World Burner';
      slider.value = 250;
      numberInput.value = 250;
      presetBtns.forEach(b => b.classList.toggle('active', b.dataset.weight === '250'));
      document.querySelectorAll('.mutation-chip-checkbox').forEach(chk => {
        chk.checked = (chk.value === 'spirit_bloom' || chk.value === 'rainbow');
      });
      recalculate();
      showToast('👑 已套用頂配：World Burner 250kg + Spirit Bloom + Rainbow！', 'success');
    });
  }

  // 初始計算一次
  recalculate();
}

// 初始化
window.addEventListener('DOMContentLoaded', async () => {
  initLiveTickerControls();
  initFilterBars();
  initDbExplorer();
  initPetCalculator();
  await loadStatus();
  await loadEggsCatalog();
  await loadConfig();
  await loadPrediction();
  await initEggPredictor();
  await loadHistory();
  await loadMemberStats();
  await checkAuthStatus();

  // 每秒更新倒數
  countdownInterval = setInterval(updateCountdown, 1000);

  // 每 15 秒背景刷新狀態與預測
  setInterval(() => {
    loadStatus();
    loadPrediction();
    loadEggPredictions();
    loadHistory();
    loadMemberStats();
  }, 15000);
});
