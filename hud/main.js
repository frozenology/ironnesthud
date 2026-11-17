const { app, BrowserWindow, globalShortcut, screen, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const PROTOCOL = 'ironnesthud';

let hudWindow = null;
let tray = null;
let isVisible = false;
let pendingDeepLink = null;
let rendererReady = false;

// Register custom protocol (dev + packaged)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// Single instance — second launch forwards deep link
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = findProtocolUrl(argv);
    if (url) handleDeepLink(url);
    showHUD();
    if (hudWindow) hudWindow.focus();
  });
}

// macOS open-url
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

function findProtocolUrl(argv = []) {
  return argv.find((a) => typeof a === 'string' && a.startsWith(`${PROTOCOL}://`)) || null;
}

function handleDeepLink(urlString) {
  if (!urlString) return;

  let payload = { action: 'show', pin: null };

  try {
    const url = new URL(urlString);
    // ironnesthud://link?pin=123456
    // hostname = "link", searchParams pin
    const action = (url.hostname || url.pathname.replace(/^\/+/, '') || 'show').toLowerCase();
    const pin = url.searchParams.get('pin');
    payload = { action, pin: pin ? String(pin).trim() : null };
  } catch (e) {
    console.error('Invalid deep link:', urlString, e);
  }

  // Always show HUD when opened via deep link
  showHUD();

  if (!rendererReady || !hudWindow) {
    pendingDeepLink = payload;
    return;
  }

  sendDeepLinkToRenderer(payload);
}

function sendDeepLinkToRenderer(payload) {
  if (!hudWindow || hudWindow.isDestroyed()) return;
  hudWindow.webContents.send('deep-link', payload);
}

function flushPendingDeepLink() {
  if (pendingDeepLink) {
    sendDeepLinkToRenderer(pendingDeepLink);
    pendingDeepLink = null;
  }
}

// ============ CREATE HUD WINDOW ============
function createHUD() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const hudWidth = Math.max(640, Math.round(screenW * 0.6));
  const hudHeight = Math.min(380, Math.round(screenH * 0.45));
  const x = Math.round((screenW - hudWidth) / 2);

  hudWindow = new BrowserWindow({
    width: hudWidth,
    height: hudHeight,
    minWidth: 640,
    minHeight: 200,
    maxWidth: hudWidth,
    x,
    y: -hudHeight - 20,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: false,
    focusable: true,
    hasShadow: false,
    show: false,
    icon: path.join(__dirname, 'ironnesthud.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  hudWindow.loadFile('hud.html');

  hudWindow.webContents.on('did-finish-load', () => {
    rendererReady = true;
    showHUD();
    flushPendingDeepLink();
  });
}

// ============ SHOW / HIDE ============
function showHUD() {
  if (!hudWindow) return;
  const bounds = hudWindow.getBounds();
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.round((screenW - bounds.width) / 2);
  hudWindow.setPosition(x, 0);
  hudWindow.show();
  hudWindow.focus();
  hudWindow.webContents.send('hud-show');
  isVisible = true;
}

function hideHUD() {
  if (!hudWindow) return;
  hudWindow.webContents.send('hud-hide');

  setTimeout(() => {
    if (!hudWindow) return;
    const { height, width } = hudWindow.getBounds();
    const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
    const x = Math.round((screenW - width) / 2);
    hudWindow.setPosition(x, -height - 20);
    hudWindow.hide();
    isVisible = false;
  }, 280);
}

function toggleHUD() {
  isVisible ? hideHUD() : showHUD();
}

// ============ TRAY ICON ============
function createTray() {
  const candidates = ['ironnesthud.ico', 'ironnesthud.png', 'icon.png'];
  let icon = nativeImage.createEmpty();

  for (const name of candidates) {
    const iconPath = path.join(__dirname, name);
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty() && process.platform === 'win32') {
        icon = icon.resize({ width: 16, height: 16 });
      }
      break;
    }
  }

  tray = new Tray(icon);
  tray.setToolTip('IronNest HUD');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Toggle HUD', click: toggleHUD },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', toggleHUD);
}

// ============ APP LIFECYCLE ============
app.whenReady().then(() => {
  createHUD();
  createTray();

  const registered = globalShortcut.register('F7', () => {
    toggleHUD();
  });

  if (!registered) {
    console.warn('Failed to register global shortcut F7');
  }

  // Cold start on Windows: protocol URL may be in argv
  const coldUrl = findProtocolUrl(process.argv);
  if (coldUrl) handleDeepLink(coldUrl);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // keep running for tray
});

// IPC from renderer
ipcMain.on('toggle-hud', () => toggleHUD());
ipcMain.on('show-hud', () => showHUD());
ipcMain.on('hide-hud', () => hideHUD());
