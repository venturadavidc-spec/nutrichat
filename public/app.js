// NutriChat PWA — app logic
// Talks to the Node proxy at /analyze for AI macro extraction

const GOALS = { cal: 2200, pro: 175, fiber: 35, carb: 220, fat: 75 };
const STORAGE_KEY = 'nutrichat_v1';

let entries = [];
let pendingEntry = null;
let editingIndex = null;
const todayKey = new Date().toISOString().slice(0, 10);

// ─── Storage ───────────────────────────────────────────────

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.date === todayKey) entries = data.entries || [];
    else entries = [];
  } catch { entries = []; }
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    date: todayKey,
    entries
  }));
}

// ─── Render ────────────────────────────────────────────────

function renderAll() {
  updateTotals();
  renderLog();
}

function updateTotals() {
  const t = entries.reduce((a, e) => ({
    cal: a.cal + e.cal,
    pro: a.pro + e.pro,
    fiber: a.fiber + (e.fiber || 0),
    carb: a.carb + e.carb,
    fat: a.fat + e.fat
  }), { cal: 0, pro: 0, fiber: 0, carb: 0, fat: 0 });

  document.getElementById('tot-cal').textContent = Math.round(t.cal);
  document.getElementById('tot-pro').textContent = Math.round(t.pro);
  document.getElementById('tot-fiber').textContent = Math.round(t.fiber);
  document.getElementById('tot-carb').textContent = Math.round(t.carb);
  document.getElementById('tot-fat').textContent = Math.round(t.fat);

  document.getElementById('pb-cal').style.width = Math.min(100, Math.round(t.cal / GOALS.cal * 100)) + '%';
  document.getElementById('pb-pro').style.width = Math.min(100, Math.round(t.pro / GOALS.pro * 100)) + '%';
  document.getElementById('pb-fiber').style.width = Math.min(100, Math.round(t.fiber / GOALS.fiber * 100)) + '%';
  document.getElementById('pb-carb').style.width = Math.min(100, Math.round(t.carb / GOALS.carb * 100)) + '%';
  document.getElementById('pb-fat').style.width = Math.min(100, Math.round(t.fat / GOALS.fat * 100)) + '%';
}

function renderLog() {
  const list = document.getElementById('log-list');
  if (!entries.length) {
    list.innerHTML = '<div class="empty-log">Nothing logged yet.</div>';
    return;
  }
  list.innerHTML = entries.map((e, i) => `
    <div class="log-entry">
      <div style="flex:1">
        <div class="log-desc">${e.desc}</div>
        <div class="log-macros">
          ${Math.round(e.cal)} kcal &nbsp;·&nbsp;
          ${Math.round(e.pro)}g protein &nbsp;·&nbsp;
          ${Math.round(e.fiber || 0)}g fiber &nbsp;·&nbsp;
          ${Math.round(e.carb)}g carbs &nbsp;·&nbsp;
          ${Math.round(e.fat)}g fat
        </div>
      </div>
      <div class="log-meta">
        <span class="log-time">${e.time}</span>
        <button class="edit-btn" onclick="startEdit(${i})">Edit</button>
        <button class="delete-btn" onclick="deleteEntry(${i})">✕</button>
      </div>
    </div>
  `).join('');
}

function deleteEntry(i) {
  entries.splice(i, 1);
  saveEntries();
  renderAll();
}

function resetDay() {
  if (!entries.length) return;
  entries = [];
  saveEntries();
  renderAll();
}

// ─── Edit flow ─────────────────────────────────────────────

function startEdit(i) {
  editingIndex = i;
  const entry = entries[i];
  const input = document.getElementById('chat-input');
  input.value = entry.desc;
  input.focus();
  document.getElementById('send-btn').textContent = 'Update';
  addMessage('ai', `<div class="ai-bubble">Editing: <em>${entry.desc}</em> — update the description and hit Update to re-run the AI.</div>`);
  document.getElementById('chat-input').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  editingIndex = null;
  document.getElementById('chat-input').value = '';
  document.getElementById('send-btn').textContent = 'Log';
}

// ─── Chat ──────────────────────────────────────────────────

function addMessage(role, html) {
  const wrap = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'user') {
    div.textContent = html;
  } else {
    div.innerHTML = html;
  }
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function showTyping() {
  const wrap = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'msg ai';
  div.id = 'typing-indicator';
  div.innerHTML = '<div class="ai-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  document.getElementById('send-btn').disabled = true;
  document.getElementById('send-btn').textContent = 'Log';
  addMessage('user', text);
  showTyping();

  const isEdit = editingIndex !== null;

  try {
    const res = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Server error ${res.status}`);
    }

    const parsed = await res.json();
    removeTyping();

    if (parsed.error === 'not_food') {
      addMessage('ai', `<div class="ai-bubble">${parsed.message}</div>`);
      if (isEdit) cancelEdit();
    } else {
      const timeStr = isEdit
        ? entries[editingIndex].time
        : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      pendingEntry = { ...parsed, time: timeStr };

      const notesHtml = parsed.notes
        ? `<div class="confirm-note">Note: ${parsed.notes}</div>`
        : '';

      const actionLabel = isEdit ? 'Save edit' : 'Log it';

      addMessage('ai', `
        <div class="macro-confirm">
          <div class="confirm-title">${parsed.desc}</div>
          <div class="confirm-row"><span>Calories</span><span>${Math.round(parsed.cal)} kcal</span></div>
          <div class="confirm-row"><span>Protein</span><span>${Math.round(parsed.pro)}g</span></div>
          <div class="confirm-row"><span>Fiber</span><span>${Math.round(parsed.fiber || 0)}g</span></div>
          <div class="confirm-row"><span>Carbs</span><span>${Math.round(parsed.carb)}g</span></div>
          <div class="confirm-row"><span>Fat</span><span>${Math.round(parsed.fat)}g</span></div>
          ${notesHtml}
          <div class="confirm-actions">
            <button class="btn-log" onclick="confirmLog()">${actionLabel}</button>
            <button class="btn-cancel" onclick="cancelLog()">Cancel</button>
          </div>
        </div>
      `);
    }

  } catch (err) {
    removeTyping();
    const msg = err.message.includes('timeout')
      ? 'Request timed out — is the server running?'
      : `Something went wrong: ${err.message}`;
    addMessage('ai', `<div class="ai-bubble">${msg}</div>`);
    if (isEdit) cancelEdit();
  }

  document.getElementById('send-btn').disabled = false;
}

function confirmLog() {
  if (!pendingEntry) return;

  if (editingIndex !== null) {
    // Replace the existing entry
    entries[editingIndex] = pendingEntry;
    editingIndex = null;
    addMessage('ai', '<div class="ai-bubble">Updated. Anything else?</div>');
  } else {
    entries.push(pendingEntry);
    addMessage('ai', '<div class="ai-bubble">Logged. What else?</div>');
  }

  pendingEntry = null;
  saveEntries();
  renderAll();
  document.querySelectorAll('.confirm-actions').forEach(el => el.style.display = 'none');
  document.getElementById('send-btn').textContent = 'Log';
}

function cancelLog() {
  pendingEntry = null;
  editingIndex = null;
  document.getElementById('send-btn').textContent = 'Log';
  addMessage('ai', '<div class="ai-bubble">Cancelled. Anything else?</div>');
  document.querySelectorAll('.confirm-actions').forEach(el => el.style.display = 'none');
}

// Enter key to send
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});

// ─── Server status ─────────────────────────────────────────

async function checkServer() {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  try {
    const r = await fetch('/health', { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    if (d.status === 'ok') {
      dot.className = 'status-dot online';
      txt.textContent = 'Connected';
    } else throw new Error();
  } catch {
    dot.className = 'status-dot offline';
    txt.textContent = 'Server offline';
  }
}

// ─── Init ──────────────────────────────────────────────────

document.getElementById('date-display').textContent = new Date().toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric'
});

loadEntries();
renderAll();
checkServer();