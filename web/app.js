// ==========================================================
// Web UI — Iron Nest Fire Control + SyncController
// ==========================================================

const PIN_STORAGE_KEY = 'iron_nest_web_link_pin';
const statusText = document.getElementById('statusText');
const pinDisplay = document.getElementById('pinDisplay');

function loadOrCreatePin() {
  const saved = localStorage.getItem(PIN_STORAGE_KEY);
  if (saved && SyncController.validatePin(saved)) return saved;
  const pin = SyncController.generatePin();
  localStorage.setItem(PIN_STORAGE_KEY, pin);
  return pin;
}

let uniquePin = loadOrCreatePin();
pinDisplay.textContent = uniquePin;
updateOpenHudLink();

SyncController.onStatus((payload) => {
  if (payload && payload.linked) {
    statusText.textContent = '✅ HUD Linked & Active!';
    statusText.classList.add('connected');
  }
});

SyncController.onSubscribe((status, pin) => {
  if (status === 'SUBSCRIBED') {
    console.log(`Subscribed to room: hud-room-${pin}`);
  }
});

function connectWithPin(pin) {
  statusText.textContent = 'Waiting for HUD...';
  statusText.classList.remove('connected');
  return SyncController.connect(pin, { presenceKey: 'web-controller' }).catch((err) => {
    console.error(err);
    statusText.textContent = 'Connection failed';
  });
}

connectWithPin(uniquePin);

document.getElementById('btnRenewPin').addEventListener('click', async () => {
  await SyncController.disconnect();
  uniquePin = SyncController.generatePin();
  localStorage.setItem(PIN_STORAGE_KEY, uniquePin);
  pinDisplay.textContent = uniquePin;
  updateOpenHudLink();
  statusText.textContent = 'New code — waiting for HUD...';
  statusText.classList.remove('connected');
  connectWithPin(uniquePin);
});

const HudAPI = {
  broadcast: (action, data) => SyncController.broadcast(action, data),
  sendShot: (shot) => SyncController.sendShot(shot),
  clearShots: () => SyncController.clearShots(),
  sendCommand: (name, params) => SyncController.sendCommand(name, params)
};
window.HudAPI = HudAPI;

// ---- Field helpers (digit-roller style like original) ----

function makeBearingField(inputEl) {
  let bDigits = '0000'; // XXX.X
  function render() {
    let val = parseInt(bDigits, 10) / 10;
    if (val > 359.9) val = 359.9;
    inputEl.value = val.toFixed(1).padStart(5, '0');
    return val;
  }
  function push(d) { bDigits = (bDigits + d).slice(-4); render(); calc(); }
  function pop() { bDigits = ('0' + bDigits).slice(0, 4); render(); calc(); }
  inputEl.addEventListener('focus', () => { bDigits = '0000'; render(); });
  inputEl.addEventListener('beforeinput', (e) => {
    e.preventDefault();
    if (e.data && /^[0-9]$/.test(e.data)) push(e.data);
    else if (e.inputType === 'deleteContentBackward') pop();
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLogShot();
    }
  });
  render();
  return { getValue: render };
}

function makeDistanceField(inputEl, hintEl) {
  let digits = '0000'; // KK.KK km
  function render() {
    const whole = digits.slice(0, 2), frac = digits.slice(2, 4);
    inputEl.value = whole + '.' + frac;
    const meters = parseInt(digits, 10) * 10;
    if (hintEl) hintEl.textContent = '= ' + String(meters).padStart(4, '0') + ' m';
    return meters;
  }
  function push(d) { digits = (digits + d).slice(-4); render(); calc(); }
  function pop() { digits = ('0' + digits).slice(0, 4); render(); calc(); }
  inputEl.addEventListener('focus', () => { digits = '0000'; render(); calc(); });
  inputEl.addEventListener('beforeinput', (e) => {
    e.preventDefault();
    if (e.data && /^[0-9]$/.test(e.data)) push(e.data);
    else if (e.inputType === 'deleteContentBackward') pop();
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLogShot();
    }
  });
  render();
  return { getMeters: render };
}

function makeChargeRow(containerEl) {
  let selected = 1;
  const buttons = [];
  for (let i = 1; i <= 6; i++) {
    const btn = document.createElement('div');
    btn.className = 'charge-btn' + (i === 1 ? ' active' : '');
    btn.textContent = i;
    btn.addEventListener('click', () => {
      if (btn.classList.contains('charge-invalid')) return;
      containerEl.querySelectorAll('.charge-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selected = i;
      calc();
    });
    buttons.push(btn);
    containerEl.appendChild(btn);
  }
  function setValue(v) {
    selected = v;
    buttons.forEach(b => b.classList.toggle('active', parseInt(b.textContent, 10) === v));
  }
  function updateValidity(meters) {
    buttons.forEach(b => {
      const c = parseInt(b.textContent, 10);
      const invalid = meters > 0 && ((meters * 0.012) / c) > 60;
      b.classList.toggle('charge-invalid', invalid);
    });
    if (meters > 0 && ((meters * 0.012) / selected) > 60) {
      let found = null;
      for (let c = selected + 1; c <= 6; c++) {
        if (((meters * 0.012) / c) <= 60) { found = c; break; }
      }
      setValue(found || 6);
    }
  }
  return { getValue: () => selected, setValue, updateValidity };
}

function makeRoundTypeRow(containerEl, options) {
  let selected = null;
  const buttons = [];
  options.forEach(label => {
    const btn = document.createElement('div');
    btn.className = 'charge-btn round-btn round-type-' + label.toLowerCase();
    btn.textContent = label;
    btn.addEventListener('click', () => {
      if (selected === label) {
        selected = null;
        btn.classList.remove('active');
      } else {
        buttons.forEach(b => b.classList.remove('active'));
        selected = label;
        btn.classList.add('active');
      }
    });
    buttons.push(btn);
    containerEl.appendChild(btn);
  });
  return { getValue: () => selected };
}

// ---- Wire calculator ----

const output = document.getElementById('output');
const charges = makeChargeRow(document.getElementById('chargeRow'));
const bearing = makeBearingField(document.getElementById('bearing'));
const distance = makeDistanceField(document.getElementById('distance'), document.getElementById('meterHint'));
const roundType = makeRoundTypeRow(document.getElementById('roundRow'), ['HE', 'AP', 'DRIL', 'STAR']);

function calc() {
  const meters = distance.getMeters();
  charges.updateValidity(meters);
  const c = charges.getValue();
  if (meters <= 0) {
    output.textContent = '—';
    return;
  }
  output.textContent = ((meters * 0.012) / c).toFixed(2);
}

// ---- History log ----

let history = [];
let nextId = 1;
const historyList = document.getElementById('historyList');

function renderHistory() {
  if (history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No shots logged yet.</div>';
    return;
  }
  historyList.innerHTML = history.map(entry => {
    const roundHtml = entry.roundType
      ? `<span class="round-tag round-type-${entry.roundType.toLowerCase()}">${entry.roundType}</span>`
      : '';
    return `
      <div class="history-row" data-id="${entry.id}">
        <div class="h-controls">
          <span></span>
          <span class="h-remove" data-remove="${entry.id}">✕</span>
        </div>
        <div class="stat-trio">
          <div class="stat-block">
            <div class="stat-label">CH#</div>
            <div class="stat-value">${entry.charges}</div>
          </div>
          <div class="stat-block">
            <div class="stat-label">Bearing</div>
            <div class="stat-value">${entry.bearing}°</div>
          </div>
          <div class="stat-block">
            <div class="stat-label">Elev</div>
            <div class="stat-value elev">${entry.elevation}°</div>
          </div>
        </div>
        <div class="h-secondary">
          <span>${entry.meters}m</span>
          ${roundHtml}
          <span class="h-time">${entry.loggedAt}</span>
        </div>
      </div>`;
  }).join('');

  historyList.querySelectorAll('.h-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseFloat(btn.dataset.remove);
      history = history.filter(e => e.id !== id);
      renderHistory();
      HudAPI.broadcast('SYNC_SHOTS', { shots: history });
    });
  });
}

function handleLogShot() {
  const meters = distance.getMeters();
  if (meters <= 0) return;

  const bearingVal = bearing.getValue();
  const chargeVal = charges.getValue();
  const elevation = ((meters * 0.012) / chargeVal).toFixed(2);
  const rt = roundType.getValue();
  const loggedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const id = nextId++;

  const entry = {
    id,
    bearing: bearingVal.toFixed(1).padStart(5, '0'),
    meters,
    charges: chargeVal,
    elevation,
    roundType: rt,
    loggedAt
  };

  history.unshift(entry);
  if (history.length > 30) history.pop();
  renderHistory();
  HudAPI.sendShot(entry);
}

document.getElementById('logShotBtn').addEventListener('click', handleLogShot);

document.getElementById('clearBtn').addEventListener('click', () => {
  history = [];
  renderHistory();
  HudAPI.clearShots();
});

calc();

function updateOpenHudLink() {
  const el = document.getElementById('btnOpenHud');
  if (!el) return;
  el.setAttribute('href', 'ironnesthud://link?pin=' + encodeURIComponent(uniquePin));
}
