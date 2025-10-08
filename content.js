// Content script: listens for start/stop and captures click details

let isRecording = false;
let clickHandlerBound = null;
let isInitialized = false;

// Wait for both DOM and ClickUtils to be ready
function initializeContentScript() {
  if (isInitialized) return;
  
  if (!window.ClickUtils) {
    console.log('[Content] Waiting for ClickUtils to load...');
    setTimeout(initializeContentScript, 50);
    return;
  }

  if (document.readyState === 'loading') {
    console.log('[Content] Waiting for DOM to be ready...');
    document.addEventListener('DOMContentLoaded', initializeContentScript);
    return;
  }

  isInitialized = true;
  console.log('[Content] Script initialized successfully');
  chrome.runtime.sendMessage({ type: 'CONTENT_READY' });
}

function buildClickPayload(target) {
  if (!window.ClickUtils) {
    console.error('[Content] ClickUtils not found! Waiting for utils.js to load...');
    return;
  }
  const { getElementXPath, getElementCssSelector, clipText } = window.ClickUtils;
  const tagName = target.tagName || '';
  const id = target.id || '';
  const className = typeof target.className === 'string' ? target.className : (target.getAttribute && target.getAttribute('class')) || '';
  const name = target.getAttribute && target.getAttribute('name') || '';
  const textContent = clipText ? clipText(target.textContent || '') : (target.textContent || '').slice(0, 50);
  const xpath = getElementXPath ? getElementXPath(target) : '';
  const cssSelector = getElementCssSelector ? getElementCssSelector(target) : '';

  return { tagName, id, className, name, textContent, xpath, cssSelector, timestamp: Date.now() };
}

function onDocumentClick(event) {
  try {
    // Use composedPath to get the deepest node (handles shadow DOM and SVG better)
    const path = (typeof event.composedPath === 'function') ? event.composedPath() : [];
    const target = (path && path[0] && path[0].nodeType === Node.ELEMENT_NODE) ? path[0] : event.target;
    if (!target || !isRecording) return;
    const payload = buildClickPayload(target);
    console.log('[Content] Click captured:', payload);
    chrome.runtime.sendMessage({ type: 'CLICK_CAPTURE', payload });
  } catch (e) {
    console.error('[Content] Error capturing click:', e);
  }
}

function startRecording() {
  if (!isInitialized) {
    console.log('[Content] Waiting for initialization before starting recording...');
    setTimeout(startRecording, 50);
    return;
  }

  if (isRecording) return;
  isRecording = true;
  clickHandlerBound = onDocumentClick;
  document.addEventListener('click', clickHandlerBound, true); // capture phase to catch early
  console.log('[Content] Click recording started on:', window.location.href);
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  if (clickHandlerBound) {
    document.removeEventListener('click', clickHandlerBound, true);
    clickHandlerBound = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;
  switch (message.type) {
    case 'START_RECORDING':
      startRecording();
      sendResponse && sendResponse({ ok: true });
      break;
    case 'STOP_RECORDING':
      stopRecording();
      sendResponse && sendResponse({ ok: true });
      break;
    default:
      break;
  }
});

// Initialize the content script
initializeContentScript();

// If background indicates recording is already on (e.g., after navigation), start automatically
try {
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (res && res.isRecording) {
      startRecording();
    }
  });
} catch (e) {
  console.error('[Content] Error checking recording state:', e);
}


