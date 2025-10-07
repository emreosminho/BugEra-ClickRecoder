// Side panel logic: controls UI, asks background to start/stop, renders list, saves JSON

const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnSave = document.getElementById('btnSave');
const listEl = document.getElementById('list');
const btnClear = document.getElementById('btnClear');
const btnSelectTab = document.getElementById('btnSelectTab');

async function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response || {}));
  });
}

let lastRecordCount = 0;

function renderList(records) {
  // Save current scroll position
  const currentScrollTop = listEl.scrollTop;
  const wasAtTop = currentScrollTop < 50; // User is near the top
  
  listEl.innerHTML = '';
  if (!Array.isArray(records) || records.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Henüz tıklama kaydı yok. Kayıt başlatın ve sayfada tıklama yapmaya başlayın.</div>';
    lastRecordCount = 0;
    return;
  }
  
  // Check if new records were added
  const hasNewRecords = records.length > lastRecordCount;
  lastRecordCount = records.length;
  
  // Reverse to show most recent clicks first
  const reversedRecords = [...records].reverse();
  for (const rec of reversedRecords) {
    const li = document.createElement('li');
    li.className = 'item';
    const lines = [];
    
    // Always show these fields
    lines.push(`<div><span class="label">🏷️ Tag:</span> <span class="value">${escapeHtml(rec.tagName || 'N/A')}</span></div>`);
    
    // Show optional fields only if they exist
    if (rec.id) lines.push(`<div><span class="label">🆔 ID:</span> <span class="value">${escapeHtml(rec.id)}</span></div>`);
    if (rec.className) lines.push(`<div><span class="label">📦 Class:</span> <span class="value">${escapeHtml(rec.className)}</span></div>`);
    if (rec.name) lines.push(`<div><span class="label">📝 Name:</span> <span class="value">${escapeHtml(rec.name)}</span></div>`);
    if (rec.textContent) lines.push(`<div><span class="label">📄 Text:</span> <span class="value">${escapeHtml(rec.textContent)}</span></div>`);
    
    // ALWAYS show XPath and CSS Selector (these are the most important!)
    lines.push(`<div><span class="label">🎯 XPath:</span> <span class="value" style="color: #a5f3fc; font-family: monospace; font-size: 11px;">${escapeHtml(rec.xpath || '⚠️ Not generated')}</span></div>`);
    lines.push(`<div><span class="label">🎨 CSS Selector:</span> <span class="value" style="color: #c4b5fd; font-family: monospace; font-size: 11px;">${escapeHtml(rec.cssSelector || '⚠️ Not generated')}</span></div>`);
    
    li.innerHTML = lines.join('');
    listEl.appendChild(li);
  }
  
  // Only auto-scroll to top if there are new records AND user was already at top
  if (hasNewRecords && wasAtTop) {
    listEl.scrollTop = 0;
  } else {
    // Restore previous scroll position
    listEl.scrollTop = currentScrollTop;
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function refreshStateAndUI() {
  const state = await sendMessage({ type: 'GET_STATE' });
  const isRecording = !!state.isRecording;
  btnStart.disabled = isRecording;
  btnStop.disabled = !isRecording;
  btnSave.disabled = isRecording; // sadece durdurulduğunda kaydet

  const res = await sendMessage({ type: 'GET_RECORDS' });
  renderList(res.records || []);
  if (btnClear) btnClear.disabled = isRecording || !(res.records && res.records.length);
  
  // Show current tab info
  await updateTabInfo(isRecording);
}

async function updateTabInfo(isRecording) {
  const tabInfoEl = document.getElementById('tabInfo');
  if (!tabInfoEl) return;
  
  try {
    // Get the last active tab ID from storage
    let data = await chrome.storage.session.get(['lastActiveTabId']);
    
    // If no tab is set, try to find and set the current active tab
    if (!data.lastActiveTabId) {
      console.log('[Side Panel] No lastActiveTabId found, searching for active tab...');
      const tabs = await chrome.tabs.query({ currentWindow: true });
      
      // Find first non-extension tab
      for (const tab of tabs) {
        if (tab.url && 
            !tab.url.startsWith('chrome-extension://') && 
            !tab.url.startsWith('chrome://') &&
            !tab.url.startsWith('about:')) {
          console.log('[Side Panel] Found active tab:', tab.id, tab.url);
          // Notify background.js about the tab
          await sendMessage({ type: 'SET_ACTIVE_TAB', tabId: tab.id });
          data.lastActiveTabId = tab.id;
          break;
        }
      }
    }
    
    if (data.lastActiveTabId) {
      const tab = await chrome.tabs.get(data.lastActiveTabId);
      const title = tab.title || 'Bilinmeyen';
      const url = tab.url || '';
      const displayUrl = url.length > 50 ? url.substring(0, 50) + '...' : url;
      tabInfoEl.innerHTML = `<strong>📍 Kayıt Sekmesi:</strong> ${escapeHtml(title)}<br><span style="font-size: 10px;">${escapeHtml(displayUrl)}</span>`;
      tabInfoEl.style.display = 'block';
    } else {
      tabInfoEl.innerHTML = '<strong>⚠️ Kayıt yapılacak sekme bulunamadı</strong><br><span style="font-size: 10px;">Lütfen bir web sayfası açın</span>';
      tabInfoEl.style.display = 'block';
    }
  } catch (e) {
    console.error('[Side Panel] Error getting tab info:', e);
    tabInfoEl.innerHTML = '<strong>⚠️ Sekme bilgisi alınamadı</strong><br><span style="font-size: 10px;">Sayfayı yenileyin veya başka bir sekmede deneyin</span>';
    tabInfoEl.style.display = 'block';
  }
}

btnStart.addEventListener('click', async () => {
  console.log('[Side Panel] Start recording button clicked');
  const response = await sendMessage({ type: 'START_RECORDING' });
  console.log('[Side Panel] Start recording response:', response);
  await refreshStateAndUI();
});

btnStop.addEventListener('click', async () => {
  await sendMessage({ type: 'STOP_RECORDING' });
  await refreshStateAndUI();
});

btnSave.addEventListener('click', async () => {
  const res = await sendMessage({ type: 'GET_RECORDS' });
  const records = res.records || [];
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cosmic-records-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

if (btnClear) {
  btnClear.addEventListener('click', async () => {
    console.log('[Side Panel] Clear button clicked');
    lastRecordCount = 0; // Reset the counter
    await sendMessage({ type: 'CLEAR_RECORDS' });
    console.log('[Side Panel] Records cleared');
    await refreshStateAndUI();
  });
}

// Initialize
refreshStateAndUI();

// Listen updates to refresh list live while recording
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'RECORDS_UPDATED') {
    // live refresh without toggling buttons state
    sendMessage({ type: 'GET_RECORDS' }).then((res) => {
      renderList(res.records || []);
      if (btnClear) {
        sendMessage({ type: 'GET_STATE' }).then((state) => {
          btnClear.disabled = state.isRecording || !(res.records && res.records.length);
        });
      }
    });
  }
});

// Periodically refresh to catch any updates (fallback)
setInterval(() => {
  sendMessage({ type: 'GET_RECORDS' }).then((res) => {
    renderList(res.records || []);
  });
}, 1000);

// Manual tab selection
if (btnSelectTab) {
  btnSelectTab.addEventListener('click', async () => {
    console.log('[Side Panel] Select tab button clicked');
    try {
      // First, try to get the currently active tab
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      
      let selectedTab = null;
      
      // Check if active tab is a valid web page
      if (activeTabs.length > 0) {
        const activeTab = activeTabs[0];
        if (activeTab.url && 
            !activeTab.url.startsWith('chrome-extension://') && 
            !activeTab.url.startsWith('chrome://') &&
            !activeTab.url.startsWith('about:')) {
          selectedTab = activeTab;
          console.log('[Side Panel] Active tab is a valid web page:', selectedTab.id, selectedTab.url);
        }
      }
      
      // If active tab is not valid, find first valid web tab
      if (!selectedTab) {
        const allTabs = await chrome.tabs.query({ currentWindow: true });
        const webTabs = allTabs.filter(tab => 
          tab.url && 
          !tab.url.startsWith('chrome-extension://') && 
          !tab.url.startsWith('chrome://') &&
          !tab.url.startsWith('about:')
        );
        
        if (webTabs.length === 0) {
          alert('Kayıt yapılabilecek bir web sayfası sekmesi bulunamadı!\n\nLütfen bir web sayfası açın.');
          return;
        }
        
        selectedTab = webTabs[0];
        console.log('[Side Panel] Using first available web tab:', selectedTab.id, selectedTab.url);
      }
      
      // Notify background.js about the tab change
      const response = await sendMessage({ type: 'SET_ACTIVE_TAB', tabId: selectedTab.id });
      console.log('[Side Panel] Tab selected and saved:', selectedTab.id, selectedTab.url, 'Response:', response);
      await updateTabInfo();
    } catch (e) {
      console.error('[Side Panel] Error selecting tab:', e);
      alert('Sekme seçilirken hata oluştu!');
    }
  });
}

