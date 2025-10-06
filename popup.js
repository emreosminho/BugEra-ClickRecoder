// Popup logic: controls UI, asks background to start/stop, renders list, saves JSON

const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnSave = document.getElementById('btnSave');
const listEl = document.getElementById('list');
const btnClear = document.getElementById('btnClear');

async function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response || {}));
  });
}

function renderList(records) {
  listEl.innerHTML = '';
  if (!Array.isArray(records) || records.length === 0) return;
  for (const rec of records) {
    const li = document.createElement('li');
    li.className = 'item';
    const lines = [];
    lines.push(`<span class="label">tagName:</span> <span class="value">${escapeHtml(rec.tagName || '')}</span>`);
    lines.push(`<span class="label">id:</span> <span class="value">${escapeHtml(rec.id || '')}</span>`);
    lines.push(`<span class="label">className:</span> <span class="value">${escapeHtml(rec.className || '')}</span>`);
    lines.push(`<span class="label">name:</span> <span class="value">${escapeHtml(rec.name || '')}</span>`);
    lines.push(`<span class="label">textContent:</span> <span class="value">${escapeHtml(rec.textContent || '')}</span>`);
    lines.push(`<span class="label">xpath:</span> <span class="value">${escapeHtml(rec.xpath || '')}</span>`);
    lines.push(`<span class="label">cssSelector:</span> <span class="value">${escapeHtml(rec.cssSelector || '')}</span>`);
    li.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
    listEl.appendChild(li);
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
}

btnStart.addEventListener('click', async () => {
  await sendMessage({ type: 'START_RECORDING' });
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
  a.download = `click-records-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

if (btnClear) {
  btnClear.addEventListener('click', async () => {
    await sendMessage({ type: 'CLEAR_RECORDS' });
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
      if (btnClear) btnClear.disabled = !(res.records && res.records.length);
    });
  }
});


