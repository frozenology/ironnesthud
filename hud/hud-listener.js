// ==========================================================
// HUD UI — link screen + firing log display (uses SyncController)
// ==========================================================

const linkScreen = document.getElementById('linkScreen');
const dataScreen = document.getElementById('dataScreen');
const pinInput = document.getElementById('pinInput');
const btnLink = document.getElementById('btnLink');
const linkError = document.getElementById('linkError');
const linkStatus = document.getElementById('linkStatus');
const linkStatusText = document.getElementById('linkStatusText');
const btnChangePin = document.getElementById('btnChangePin');
const shotListEl = document.getElementById('shotList');
const hudEl = document.getElementById('hud');
const btnClose = document.getElementById('btnClose');
const btnCloseLink = document.getElementById('btnCloseLink');

let currentPin = null;
let shots = []; // newest first

SyncController.onUpdate(handleUpdate);

SyncController.onSubscribe((status, pin) => {
  if (status === 'SUBSCRIBED') {
    linkStatusText.textContent = `Linked · ${pin}`;
    linkStatus.classList.add('linked');
    SyncController.sendStatus({ linked: true });
  }
});

function closeHud() {
  if (window.HudWindow) {
    HudWindow.requestHide();
  }
}

if (btnClose) btnClose.addEventListener('click', closeHud);
if (btnCloseLink) btnCloseLink.addEventListener('click', closeHud);

// ========== LINK SCREEN ==========

function showLinkScreen() {
  linkScreen.classList.remove('hidden');
  dataScreen.classList.remove('active');
  pinInput.value = currentPin || '';
  pinInput.focus();
  linkError.textContent = '';

  if (window.HudWindow) {
    HudWindow.setLinked(false);
    HudWindow.onReady(false);
  }
}

function showDataScreen() {
  linkScreen.classList.add('hidden');
  dataScreen.classList.add('active');
}

async function linkWithPin(pin) {
  linkStatusText.textContent = `Connecting · ${pin}...`;
  linkStatus.classList.remove('linked');

  await SyncController.connect(pin, { presenceKey: 'electron-hud' });
  currentPin = pin;
  localStorage.setItem('hud_link_pin', pin);
  showDataScreen();

  if (window.HudWindow) {
    HudWindow.setLinked(true);
  }
}

btnLink.addEventListener('click', async () => {
  const pin = pinInput.value.trim();

  if (!SyncController.validatePin(pin)) {
    linkError.textContent = 'Please enter a valid 6-digit code';
    return;
  }

  linkError.textContent = '';
  try {
    await linkWithPin(pin);
  } catch (err) {
    console.error(err);
    linkError.textContent = 'Failed to connect. Try again.';
  }
});

pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnLink.click();
});

pinInput.addEventListener('input', () => {
  pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 6);
});

btnChangePin.addEventListener('click', async () => {
  await SyncController.disconnect();
  currentPin = null;
  localStorage.removeItem('hud_link_pin');
  shots = [];
  renderShots();
  showLinkScreen();
});

// ========== DEEP LINK (ironnesthud://link?pin=XXXXXX) ==========

async function applyDeepLink(payload) {
  if (!payload) return;

  const action = (payload.action || 'show').toLowerCase();
  const pin = payload.pin ? String(payload.pin).trim() : null;

  if (window.HudWindow) {
    HudWindow.requestShow();
  }

  if (action === 'link' && pin && SyncController.validatePin(pin)) {
    if (currentPin === pin && SyncController.isConnected()) {
      showDataScreen();
      if (window.HudWindow) HudWindow.setLinked(true);
      return;
    }

    pinInput.value = pin;
    linkError.textContent = '';

    try {
      await linkWithPin(pin);
      if (window.HudWindow) {
        HudWindow.setLinked(true);
        HudWindow.clearAutoHide();
      }
    } catch (err) {
      console.error('Deep link connect failed:', err);
      linkError.textContent = 'Failed to link from app shortcut';
      showLinkScreen();
    }
    return;
  }

  if (window.HudWindow) HudWindow.requestShow();
}

if (window.electronAPI && window.electronAPI.onDeepLink) {
  window.electronAPI.onDeepLink((data) => {
    applyDeepLink(data);
  });
}

// ========== SHOT LIST ==========

function renderShots() {
  if (!shotListEl) return;

  if (!shots.length) {
    shotListEl.innerHTML = '<div class="history-empty">No shots logged yet.</div>';
    return;
  }

  shotListEl.innerHTML = shots.map((entry) => {
    const rt = entry.roundType
      ? `<span class="round-tag ${entry.roundType.toLowerCase()}">${entry.roundType}</span>`
      : '';
    return `
      <div class="shot-row">
        <div class="shot-stats">
          <div class="shot-stat">
            <div class="lbl">CH#</div>
            <div class="val">${entry.charges}</div>
          </div>
          <div class="shot-stat">
            <div class="lbl">Bearing</div>
            <div class="val">${entry.bearing}°</div>
          </div>
          <div class="shot-stat">
            <div class="lbl">Elev</div>
            <div class="val elev">${entry.elevation}°</div>
          </div>
        </div>
        <div class="shot-meta">
          <span>${entry.meters}m</span>
          ${rt}
          <span>${entry.loggedAt || ''}</span>
        </div>
      </div>`;
  }).join('');

  shotListEl.scrollTop = 0;
}

function handleUpdate({ action, data }) {
  console.log('HUD received:', action, data);

  switch (action) {
    case 'LOG_SHOT':
      if (data && data.id != null) {
        shots = shots.filter((s) => s.id !== data.id);
        shots.unshift(data);
        if (shots.length > 30) shots.pop();
        renderShots();
        if (window.HudWindow) {
          HudWindow.requestShow();
        }
      }
      break;

    case 'SYNC_SHOTS':
      shots = Array.isArray(data?.shots) ? data.shots.slice() : [];
      renderShots();
      break;

    case 'CLEAR_SHOTS':
      shots = [];
      renderShots();
      break;

    case 'EXECUTE_COMMAND':
      if (data.commandName === 'FLASH_ALERT') {
        hudEl.classList.add('alert');
        setTimeout(() => hudEl.classList.remove('alert'), 600);
      }
      if (data.commandName === 'CLEAR_HUD') {
        shots = [];
        renderShots();
      }
      break;

    default:
      break;
  }
}

// ========== BOOT ==========

const savedPin = localStorage.getItem('hud_link_pin');

if (savedPin && SyncController.validatePin(savedPin)) {
  pinInput.value = savedPin;
  linkWithPin(savedPin)
    .then(() => {
      if (window.HudWindow) HudWindow.onReady(true);
    })
    .catch((err) => {
      console.error(err);
      showLinkScreen();
    });
} else {
  showLinkScreen();
}
