// Steal An Egg Dashboard Client
let eggsCatalog = [];
let userConfig = {
  filterEnabled: true,
  allowedRarities: ['Secret', 'Divine', 'Eternal', 'Cosmic', 'Mythic', 'Legendary', 'Epic', 'Rare', 'Common', 'Uncommon'],
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
const rarityChips = document.getElementById('rarityChips');
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

// 倒數計時器
function updateCountdown() {
  if (!nextSpawnTimestamp) {
    countdownTimer.textContent = '--:--:--';
    return;
  }

  const now = Date.now();
  const diffMs = nextSpawnTimestamp - now;

  if (diffMs <= 0) {
    countdownTimer.textContent = '即將掉落！';
    countdownTimer.style.color = '#10b981';
    return;
  }

  const totalSec = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const hStr = hours > 0 ? `${hours.toString().padStart(2, '0')}:` : '';
  const mStr = minutes.toString().padStart(2, '0');
  const sStr = seconds.toString().padStart(2, '0');

  countdownTimer.textContent = `${hStr}${mStr}:${sStr}`;
  countdownTimer.style.color = '';
}

// 載入機器人狀態
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.online) {
      botStatusBadge.className = 'status-badge';
      botStatusText.textContent = `監聽中 (#${data.channelName || 'egg-notifier'})`;
    } else {
      botStatusBadge.className = 'status-badge error';
      botStatusText.textContent = '離線中';
    }
  } catch (err) {
    botStatusBadge.className = 'status-badge error';
    botStatusText.textContent = '後端無回應';
  }
}

// 載入蛋圖鑑
async function loadEggsCatalog() {
  try {
    const res = await fetch('/api/eggs');
    eggsCatalog = await res.json();
    renderRarityChips();
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
      masterFilterSwitch.checked = userConfig.filterEnabled !== false;
      renderRarityChips();
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
      avgInterval.textContent = `${data.avgIntervalMinutes || '--'} 分鐘`;
      recentAvg.textContent = `${data.recentAvgMinutes || '--'} 分鐘`;
      totalRecords.textContent = `${data.totalRecords || 0} 筆`;
      predictedTimeText.textContent = data.predictedTimeStr
        ? `預計掉落時間：${data.predictedTimeStr}`
        : '資料累積中 (需至少 2 筆紀錄)';

      if (data.nextTimestamp) {
        nextSpawnTimestamp = data.nextTimestamp;
        // 若上次計算的時間已過去，以平均間隔往後推算至未來的下一次掉落
        const stepMs = Math.max(1, (data.recentAvgMinutes || data.avgIntervalMinutes || 8)) * 60 * 1000;
        while (nextSpawnTimestamp < Date.now()) {
          nextSpawnTimestamp += stepMs;
        }
      } else if (data.minutesLeft) {
        nextSpawnTimestamp = Date.now() + data.minutesLeft * 60 * 1000;
      }

      if (nextSpawnTimestamp) {
        const pDate = new Date(nextSpawnTimestamp);
        predictedTimeText.textContent = `預計掉落時間：${pDate.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}`;
      } else {
        predictedTimeText.textContent = data.predictedTimeStr
          ? `預計掉落時間：${data.predictedTimeStr}`
          : '資料累積中 (需至少 2 筆紀錄)';
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

// 渲染稀有度選取按鈕
function renderRarityChips() {
  const allRarities = Array.from(new Set(eggsCatalog.map(e => e.rarity).filter(Boolean)));
  // 合併標準列表
  const displayRarities = Array.from(new Set([...RARITIES_ORDER, ...allRarities]));

  rarityChips.innerHTML = displayRarities.map(r => {
    const isAllowed = userConfig.allowedRarities.map(x => x.toLowerCase()).includes(r.toLowerCase());
    return `
      <div class="rarity-chip rarity-${r} ${isAllowed ? '' : 'inactive'}" data-rarity="${r}">
        <span>${isAllowed ? '✓' : '✗'}</span> ${r}
      </div>
    `;
  }).join('');

  // 點擊事件
  rarityChips.querySelectorAll('.rarity-chip').forEach(chip => {
    chip.onclick = () => {
      const r = chip.getAttribute('data-rarity');
      const idx = userConfig.allowedRarities.findIndex(x => x.toLowerCase() === r.toLowerCase());
      if (idx >= 0) {
        userConfig.allowedRarities.splice(idx, 1);
      } else {
        userConfig.allowedRarities.push(r);
      }
      renderRarityChips();
      renderEggsGrid();
    };
  });
}

// 渲染蛋清單卡片
function renderEggsGrid() {
  const searchTerm = (eggSearchInput.value || '').trim().toLowerCase();
  const filtered = eggsCatalog.filter(egg => {
    const nameMatch = (egg.name || '').toLowerCase().includes(searchTerm) ||
                      (egg.cleanName || '').toLowerCase().includes(searchTerm);
    return nameMatch;
  });

  eggCountBadge.textContent = `顯示 ${filtered.length} / ${eggsCatalog.length} 顆蛋`;

  if (filtered.length === 0) {
    eggsGrid.innerHTML = `<div class="skeleton-loader">沒有找到符合搜尋條件的蛋</div>`;
    return;
  }

  eggsGrid.innerHTML = filtered.map(egg => {
    const isRarityAllowed = userConfig.allowedRarities.map(x => x.toLowerCase()).includes((egg.rarity || '').toLowerCase());
    const isIndividuallyIgnored = userConfig.ignoredEggs.map(x => x.toLowerCase()).includes(egg.name.toLowerCase()) ||
                                 userConfig.ignoredEggs.map(x => x.toLowerCase()).includes((egg.cleanName || '').toLowerCase());
    const isActive = isRarityAllowed && !isIndividuallyIgnored;

    return `
      <div class="egg-card ${isActive ? '' : 'muted'}" data-egg-name="${egg.name}">
        <div class="egg-img-wrap">
          <img src="${egg.imageUrl || 'https://cdn.discordapp.com/emojis/1547091103537438741.png'}" alt="${egg.name}" referrerpolicy="no-referrer" onerror="this.src='https://cdn.discordapp.com/emojis/1547091103537438741.png'">
        </div>
        <div class="egg-details">
          <div class="egg-title" title="${egg.name}">${egg.cleanName || egg.name}</div>
          <div>
            <span class="rarity-tag rarity-${egg.rarity || 'Common'}">${egg.rarity || '未知'}</span>
            ${egg.biome && egg.biome !== 'Unknown' ? `<span class="biome-tag">📍 ${egg.biome}</span>` : ''}
          </div>
        </div>
        <div class="egg-card-toggle">
          <label class="switch">
            <input type="checkbox" class="egg-toggle-input" ${isActive ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
        </div>
      </div>
    `;
  }).join('');

  // 綁定個別蛋開關
  eggsGrid.querySelectorAll('.egg-card').forEach(card => {
    const name = card.getAttribute('data-egg-name');
    const checkbox = card.querySelector('.egg-toggle-input');
    checkbox.onchange = (e) => {
      const checked = e.target.checked;
      if (!checked) {
        if (!userConfig.ignoredEggs.includes(name)) {
          userConfig.ignoredEggs.push(name);
        }
        card.classList.add('muted');
      } else {
        userConfig.ignoredEggs = userConfig.ignoredEggs.filter(x => x.toLowerCase() !== name.toLowerCase());
        card.classList.remove('muted');
      }
    };
  });
}

// 快速篩選按鈕事件
document.getElementById('selectAllRarities').onclick = () => {
  userConfig.allowedRarities = Array.from(new Set(eggsCatalog.map(e => e.rarity).filter(Boolean)));
  userConfig.ignoredEggs = [];
  renderRarityChips();
  renderEggsGrid();
};

document.getElementById('selectHighOnly').onclick = () => {
  userConfig.allowedRarities = ['Secret', 'Divine', 'Eternal', 'Cosmic', 'Mythic'];
  userConfig.ignoredEggs = [];
  renderRarityChips();
  renderEggsGrid();
};

document.getElementById('clearAllRarities').onclick = () => {
  userConfig.allowedRarities = [];
  renderRarityChips();
  renderEggsGrid();
};

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
  showToast('🔄 已重新整理最新數據！', 'success');
};

// 初始化
window.addEventListener('DOMContentLoaded', async () => {
  await loadStatus();
  await loadEggsCatalog();
  await loadConfig();
  await loadPrediction();
  await loadHistory();

  // 每秒更新倒數
  countdownInterval = setInterval(updateCountdown, 1000);

  // 每 15 秒背景刷新狀態與預測
  setInterval(() => {
    loadStatus();
    loadPrediction();
    loadHistory();
  }, 15000);
});
