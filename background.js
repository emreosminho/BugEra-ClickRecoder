// Background service worker: manages recording state and relays messages

let isRecording = false;
let currentTabId = null;
let clickRecords = [];
let loadedFromSession = false;
let contentScriptReady = false;

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
  // Store the tab where user clicked the icon
  if (tab && tab.id) {
    await chrome.storage.session.set({ lastActiveTabId: tab.id });
  }
});

async function saveToSession() {
  try {
    await chrome.storage.session.set({ clickRecords, isRecording, currentTabId });
  } catch (e) {
    // ignore storage errors
  }
}

async function loadFromSessionIfNeeded() {
  if (loadedFromSession) return;
  try {
    const data = await chrome.storage.session.get(['clickRecords', 'isRecording', 'currentTabId']);
    if (Array.isArray(data.clickRecords)) clickRecords = data.clickRecords;
    if (typeof data.isRecording === 'boolean') isRecording = data.isRecording;
    if (typeof data.currentTabId === 'number') currentTabId = data.currentTabId;
  } catch (e) {
    // ignore
  } finally {
    loadedFromSession = true;
  }
}

async function getActiveTabId() {
  // First try to get the last active tab where user clicked the extension icon
  try {
    const data = await chrome.storage.session.get(['lastActiveTabId']);
    if (data.lastActiveTabId) {
      // Verify the tab still exists
      const tab = await chrome.tabs.get(data.lastActiveTabId).catch(() => null);
      if (tab) return data.lastActiveTabId;
    }
  } catch (e) {
    // ignore
  }
  
  // Fallback: find first non-extension tab in current window
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  for (const tab of allTabs) {
    // Skip extension pages (side panel, popup, etc.)
    if (tab.url && 
        !tab.url.startsWith('chrome-extension://') && 
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('about:')) {
      return tab.id;
    }
  }
  
  // Last resort: try active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0].id : null;
}

async function startRecording() {
  await loadFromSessionIfNeeded();
  isRecording = true;
  currentTabId = await getActiveTabId();
  console.log('[Background] Starting recording on tab:', currentTabId);
  
  if (currentTabId != null) {
    // Wait for content script to be ready before starting recording
    let retryCount = 0;
    const maxRetries = 10;
    
    while (!contentScriptReady && retryCount < maxRetries) {
      console.log('[Background] Waiting for content script to be ready... (attempt', retryCount + 1, 'of', maxRetries, ')');
      await new Promise(resolve => setTimeout(resolve, 100));
      retryCount++;
    }
    
    if (!contentScriptReady) {
      console.warn('[Background] Content script not ready after', maxRetries, 'attempts');
    }
    
    try { 
      await chrome.tabs.sendMessage(currentTabId, { type: 'START_RECORDING' }); 
      console.log('[Background] START_RECORDING message sent successfully');
    } catch (e) { 
      console.error('[Background] Failed to send START_RECORDING:', e);
    }
  } else {
    console.warn('[Background] No valid tab found for recording');
  }
  await saveToSession();
}

async function stopRecording() {
  await loadFromSessionIfNeeded();
  isRecording = false;
  if (currentTabId != null) {
    try { await chrome.tabs.sendMessage(currentTabId, { type: 'STOP_RECORDING' }); } catch (e) { /* ignore */ }
  }
  await saveToSession();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await loadFromSessionIfNeeded();
    switch (message && message.type) {
      case 'START_RECORDING':
        await startRecording();
        sendResponse({ ok: true });
        break;
      case 'STOP_RECORDING':
        await stopRecording();
        sendResponse({ ok: true });
        break;
      case 'GET_RECORDS':
        sendResponse({ ok: true, records: clickRecords });
        break;
      case 'GET_STATE':
        sendResponse({ ok: true, isRecording });
        break;
      case 'SET_ACTIVE_TAB': {
        // Allow side panel to change the active recording tab
        const newTabId = message.tabId;
        if (newTabId && typeof newTabId === 'number') {
          const oldTabId = currentTabId;
          console.log('[Background] Changing active tab from', oldTabId, 'to', newTabId);
          
          // If recording is active and there's an old tab, stop recording on it
          if (isRecording && oldTabId && oldTabId !== newTabId) {
            try {
              await chrome.tabs.sendMessage(oldTabId, { type: 'STOP_RECORDING' });
              console.log('[Background] STOP_RECORDING message sent to old tab:', oldTabId);
            } catch (e) {
              console.log('[Background] Could not stop recording on old tab (may be closed):', e.message);
            }
          }
          
          currentTabId = newTabId;
          await chrome.storage.session.set({ lastActiveTabId: newTabId });
          
          // If recording is active, start recording on the new tab
          if (isRecording) {
            try {
              await chrome.tabs.sendMessage(currentTabId, { type: 'START_RECORDING' });
              console.log('[Background] START_RECORDING message sent to new tab:', currentTabId);
            } catch (e) {
              console.error('[Background] Failed to send START_RECORDING to new tab:', e);
            }
          }
          await saveToSession();
          sendResponse({ ok: true, tabId: currentTabId });
        } else {
          sendResponse({ ok: false, error: 'Invalid tab ID' });
        }
        break;
      }
      case 'CLEAR_RECORDS':
        clickRecords = [];
        await saveToSession();
        try { chrome.runtime.sendMessage({ type: 'RECORDS_UPDATED', total: 0 }); } catch (e) {}
        sendResponse({ ok: true });
        break;
      case 'CONTENT_READY': {
        console.log('[Background] Content script ready notification received');
        contentScriptReady = true;
        sendResponse({ ok: true });
        break;
      }
      case 'CLICK_CAPTURE': {
        const fromTabId = sender && sender.tab ? sender.tab.id : null;
        if (currentTabId == null && fromTabId != null) {
          currentTabId = fromTabId; // initialize on first event
        }
        if (isRecording && message.payload) {
          console.log('[Background] Click captured:', message.payload);
          clickRecords.push(message.payload);
          await saveToSession();
          try {
            chrome.runtime.sendMessage({ type: 'RECORDS_UPDATED', total: clickRecords.length });
          } catch (e) {
            // ignore
          }
        }
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false });
        break;
    }
  })();
  return true; // keep the message channel open for async response
});

// Re-enable content recording on navigation within the same tab while recording
chrome.webNavigation.onCommitted.addListener(async (details) => {
  try {
    await loadFromSessionIfNeeded();
    if (!isRecording) return;
    if (details.tabId !== currentTabId) return;
    // Re-signal content script in the navigated frame to start recording
    await chrome.tabs.sendMessage(details.tabId, { type: 'START_RECORDING' });
  } catch (e) {
    // ignore
  }
});

// Handle SPA navigations (history API changes)
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  try {
    await loadFromSessionIfNeeded();
    if (!isRecording) return;
    if (details.tabId !== currentTabId) return;
    await chrome.tabs.sendMessage(details.tabId, { type: 'START_RECORDING' });
  } catch (e) {
    // ignore
  }
});


