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
  // Always get the currently active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tabs && tabs[0]) {
    const tab = tabs[0];
    // Check if it's a valid web page
    if (tab.url && 
        !tab.url.startsWith('chrome-extension://') && 
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('about:')) {
      return tab.id;
    }
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
  
  return null;
}

async function startRecording() {
  await loadFromSessionIfNeeded();
  isRecording = true;
  currentTabId = await getActiveTabId();
  console.log('[Background] Starting recording on tab:', currentTabId);
  
  if (currentTabId != null) {
    // Clear previous records when starting new recording
    clickRecords = [];
    
    try { 
      // Inject content scripts
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ['utils.js', 'content.js']
      });
      console.log('[Background] Content scripts injected successfully');
      
      // Give content script time to initialize
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(currentTabId, { type: 'START_RECORDING' }); 
          console.log('[Background] START_RECORDING message sent successfully');
        } catch (e) {
          console.error('[Background] Failed to send START_RECORDING:', e);
        }
      }, 150);
    } catch (e) { 
      console.error('[Background] Failed to inject content scripts:', e);
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
          // Notify all extension views about the update
          try {
            // Notify popup
            const views = chrome.extension.getViews({ type: 'popup' });
            for (const view of views) {
              view.postMessage({ type: 'RECORDS_UPDATED', records: clickRecords }, '*');
            }
            
            // Notify side panel
            const sidePanelViews = chrome.extension.getViews({ type: 'side_panel' });
            for (const view of sidePanelViews) {
              view.postMessage({ type: 'RECORDS_UPDATED', records: clickRecords }, '*');
            }
          } catch (e) {
            console.error('[Background] Error notifying views:', e);
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
    
    // Only handle main frame navigations (not iframes)
    if (details.frameId !== 0) return;
    
    console.log('[Background] Navigation detected on recording tab, re-injecting content scripts');
    
    // Re-inject content scripts (page reload clears them)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['utils.js', 'content.js']
      });
      console.log('[Background] Content scripts re-injected after navigation');
    } catch (e) {
      console.error('[Background] Failed to re-inject content scripts:', e);
    }
    
    // Give content script a moment to initialize, then start recording
    setTimeout(async () => {
      try {
        await chrome.tabs.sendMessage(details.tabId, { type: 'START_RECORDING' });
        console.log('[Background] START_RECORDING sent after navigation');
      } catch (e) {
        console.error('[Background] Failed to send START_RECORDING after navigation:', e);
      }
    }, 100);
  } catch (e) {
    console.error('[Background] Error in navigation handler:', e);
  }
});

// Handle SPA navigations (history API changes)
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  try {
    await loadFromSessionIfNeeded();
    if (!isRecording) return;
    if (details.tabId !== currentTabId) return;
    
    console.log('[Background] SPA navigation detected, ensuring recording continues');
    
    // For SPA navigations, content scripts should still be present
    // but we re-send START_RECORDING to ensure it's active
    await chrome.tabs.sendMessage(details.tabId, { type: 'START_RECORDING' });
  } catch (e) {
    console.error('[Background] Error in SPA navigation handler:', e);
  }
});

// Automatic tab tracking: when user switches tabs during recording
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await loadFromSessionIfNeeded();
    
    // Only track tab changes if recording is active
    if (!isRecording) return;
    
    const newTabId = activeInfo.tabId;
    const oldTabId = currentTabId;
    
    // Check if the new tab is a valid web page
    const tab = await chrome.tabs.get(newTabId);
    if (!tab.url || 
        tab.url.startsWith('chrome-extension://') || 
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('about:')) {
      console.log('[Background] Skipping tab change - not a valid web page:', tab.url);
      return;
    }
    
    // If already on this tab, do nothing
    if (newTabId === oldTabId) return;
    
    console.log('[Background] Auto-switching recording from tab', oldTabId, 'to tab', newTabId);
    
    // Stop recording on old tab (if exists)
    if (oldTabId) {
      try {
        await chrome.tabs.sendMessage(oldTabId, { type: 'STOP_RECORDING' });
        console.log('[Background] Stopped recording on old tab:', oldTabId);
      } catch (e) {
        console.log('[Background] Could not stop recording on old tab (may be closed):', e.message);
      }
    }
    
    // Update current tab
    currentTabId = newTabId;
    await chrome.storage.session.set({ lastActiveTabId: newTabId });
    await saveToSession();
    
    // Start recording on new tab
    try {
      // Inject content scripts if not already present
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ['utils.js', 'content.js']
      }).catch(() => {
        console.log('[Background] Content scripts may already be present on new tab');
      });
      
      // Start recording
      await chrome.tabs.sendMessage(currentTabId, { type: 'START_RECORDING' });
      console.log('[Background] Started recording on new tab:', currentTabId);
    } catch (e) {
      console.error('[Background] Failed to start recording on new tab:', e);
    }
  } catch (e) {
    console.error('[Background] Error in tab activation handler:', e);
  }
});


