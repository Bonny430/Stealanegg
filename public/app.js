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

// 載入最新歷史紀錄
async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    if (data && data.rows && data.rows.length > 0) {
      historyTableBody.innerHTML = data.rows.slice(0, 50).map(row => {
        const eggImg = getEggImage(row.name);
        return `
          <tr>
            <td>${formatDateTime(row.timestamp)}</td>
            <td>
              <img src="${eggImg}" alt="${row.name}" class="table-egg-img" referrerpolicy="no-referrer" onerror="this.src='https://cdn.discordapp.com/emojis/1547091103537438741.png'">
            </td>
            <td><strong>${row.name}</strong></td>
            <td><span class="rarity-tag rarity-${row.rarity || 'Common'}">${row.rarity}</span></td>
            <td>${row.location || '未知地點'}</td>
            <td><span class="status-badge" style="padding: 2px 8px; font-size: 11px;">已記錄</span></td>
          </tr>
        `;
      }).join('');
    } else {
      historyTableBody.innerHTML = `<tr><td colspan="6" class="text-center">暫無資料</td></tr>`;
    }
  } catch (err) {
    console.error('載入歷史失敗:', err);
  }
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

let selectedSpawnType = 'all';
let selectedBiome = 'all';

// 初始化機制與地區篩選按鈕事件
function initFilterBars() {
  const spawnChips = document.querySelectorAll('#spawnTypeChips .filter-chip');
  spawnChips.forEach(chip => {
    chip.onclick = () => {
      spawnChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedSpawnType = chip.getAttribute('data-spawn-type') || 'all';
      renderEggsGrid();
    };
  });

  const biomeChips = document.querySelectorAll('#biomeChips .filter-chip');
  biomeChips.forEach(chip => {
    chip.onclick = () => {
      biomeChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedBiome = chip.getAttribute('data-biome') || 'all';
      renderEggsGrid();
    };
  });
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
    if (result && result.status === 'success') {
      showToast('🎉 過濾器設定已成功儲存至 Google Sheet！', 'success');
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
const myCustomRaritiesWrap = document.getElementById('myCustomRaritiesWrap');

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
  openLoginModalBtn.onclick = () => {
    loginModal.classList.remove('hidden');
    loginErrorMsg.classList.add('hidden');
    adminLoginErrorMsg.classList.add('hidden');
    if (loginChatIdInput) loginChatIdInput.focus();
  };
}

function closeLoginModal() {
  if (loginModal) loginModal.classList.add('hidden');
  if (loginOtpInput) loginOtpInput.value = '';
}

if (closeLoginModalBtn) closeLoginModalBtn.onclick = closeLoginModal;
if (cancelLoginBtn) cancelLoginBtn.onclick = closeLoginModal;
if (cancelAdminLoginBtn) cancelAdminLoginBtn.onclick = closeLoginModal;

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

// 個人偏好設定 Modal
const RARITY_LIST = ['Secret', 'Eternal', 'Divine', 'World Burner', 'Mythical', 'Legendary', 'Rare'];

if (openMySettingsBtn) {
  openMySettingsBtn.onclick = () => {
    if (!currentUser || !currentUser.member) {
      showToast('請先登入會員', 'error');
      return;
    }
    const m = currentUser.member;

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

    renderMyCustomRarities(m.customRarities || []);

    if (currentMode === 'custom') {
      myCustomRaritiesWrap.classList.remove('hidden');
    } else {
      myCustomRaritiesWrap.classList.add('hidden');
    }

    mySettingsModal.classList.remove('hidden');
  };
}

function renderMyCustomRarities(selected = []) {
  if (!myCustomRaritiesWrap) return;
  myCustomRaritiesWrap.innerHTML = RARITY_LIST.map(r => {
    const isChecked = selected.includes(r);
    return `
      <label class="rarity-checkbox-item">
        <input type="checkbox" value="${r}" ${isChecked ? 'checked' : ''} class="my-rarity-chk">
        <span>${r}</span>
      </label>
    `;
  }).join('');
}

// 監聽模式 Radio 切換
document.addEventListener('change', (e) => {
  if (e.target && e.target.name === 'myFilterMode') {
    if (e.target.value === 'custom') {
      myCustomRaritiesWrap.classList.remove('hidden');
    } else {
      myCustomRaritiesWrap.classList.add('hidden');
    }
  }
});

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
    const checkedRarities = Array.from(document.querySelectorAll('.my-rarity-chk:checked')).map(c => c.value);

    try {
      const res = await fetch('/api/auth/update-my-settings', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          enabled,
          filterType: selectedMode,
          customRarities: checkedRarities
        })
      });
      const data = await res.json();
      if (data.success && data.member) {
        currentUser.member = data.member;
        updateAuthUI();
        closeMySettingsModal();
        showToast('💾 個人推播偏好已儲存並同步至 Telegram！', 'success');
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

// 初始化
window.addEventListener('DOMContentLoaded', async () => {
  initFilterBars();
  await loadStatus();
  await loadEggsCatalog();
  await loadConfig();
  await loadPrediction();
  await loadHistory();
  await loadMemberStats();
  await checkAuthStatus();

  // 每秒更新倒數
  countdownInterval = setInterval(updateCountdown, 1000);

  // 每 15 秒背景刷新狀態與預測
  setInterval(() => {
    loadStatus();
    loadPrediction();
    loadHistory();
    loadMemberStats();
  }, 15000);
});
