const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: 460,
    height: 270,
    minWidth: 150,
    minHeight: 100,
    x: workArea.x + 16,
    y: workArea.y + 16,
    frame: false,
    transparent: true,
    hasShadow: true,
    alwaysOnTop: true,
    resizable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.loadFile('index.html');

  if (process.platform === 'darwin') app.dock.hide();   // no Dock icon, behaves like a widget
});
// API calls run here so the page never hits CORS problems
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stamps = [];

// keeps us under OpenF1's free limit (3 per second, 30 per minute)
async function throttle() {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > 60000) stamps.shift();
    const lastSec = stamps.filter(t => now - t < 1000).length;
    if (stamps.length < 25 && lastSec < 2) { stamps.push(now); return; }
    await sleep(250);
  }
}

ipcMain.handle('get', async (_e, url) => {
  if (!url.startsWith('https://api.openf1.org/')) throw new Error('blocked');
  for (let i = 0; i < 3; i++) {
    await throttle();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return [];        // OpenF1 uses 404 for "no data in this range"
    } catch (e) { /* network hiccup, retry */ }
    await sleep(1500 * (i + 1));
  }
  return null;                                 // failed, the app will try again shortly
});

app.on('window-all-closed', () => app.quit());