// Background service worker: manages recording state and relays messages

let isRecording = false;
let currentTabId = null;
let clickRecords = [];
let loadedFromSession = false;

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
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0].id : null;
}

async function startRecording() {
  await loadFromSessionIfNeeded();
  isRecording = true;
  currentTabId = await getActiveTabId();
  if (currentTabId != null) {
    try { await chrome.tabs.sendMessage(currentTabId, { type: 'START_RECORDING' }); } catch (e) { /* tab may not have content script */ }
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
      case 'CLICK_CAPTURE': {
        const fromTabId = sender && sender.tab ? sender.tab.id : null;
        if (currentTabId == null && fromTabId != null) {
          currentTabId = fromTabId; // initialize on first event
        }
        if (isRecording && message.payload) {
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


