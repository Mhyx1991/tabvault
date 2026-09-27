// Captures Chrome Web Store screenshots from the shots harness using
// headless Chrome over the DevTools protocol. Zero dependencies
// (Node 22+ built-in WebSocket). Writes 1280x800 PNGs to store-assets/screenshots.
//
// Usage: node scripts/capture-shots.js [port]
//   port — http.server port serving the project root (default 8797)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'store-assets', 'screenshots');
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];

const PORT = Number(process.argv[2]) || 8797;
const WIDTH = 1280;
const HEIGHT = 800;

const SHOTS = [
  { name: '01-overview', view: 'overview', theme: 'dark' },
  { name: '02-suggestions', view: 'suggestions', theme: 'dark' },
  { name: '03-workspaces', view: 'workspaces', theme: 'dark' },
  { name: '04-history', view: 'history', theme: 'dark' },
  { name: '05-care', view: 'care', theme: 'dark' },
  { name: '06-settings', view: 'settings', theme: 'dark' },
  { name: '07-privacy', view: 'privacy', theme: 'dark' },
  { name: '08-overview-light', view: 'overview', theme: 'light' }
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No Chrome/Edge found at known paths');
}

function httpGetJSON(url) {
  return new Promise((resolve, reject) => {
    import('node:http').then(({ get }) => {
      get(url, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const chrome = findChrome();
  const profileDir = path.join(root, '.chrome-shots-profile');
  fs.rmSync(profileDir, { recursive: true, force: true });

  console.log(`Launching ${path.basename(chrome)} headless…`);
  const proc = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  proc.stderr.on('data', () => { /* DevTools listen line goes to stderr */ });

  // Wait for the DevTools endpoint; the port is written to DevToolsActivePort.
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  let wsPort = null;
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    try {
      if (fs.existsSync(portFile)) {
        wsPort = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
        if (wsPort) break;
      }
    } catch { /* retry */ }
  }
  if (!wsPort) { proc.kill(); throw new Error('DevTools port never appeared'); }

  // One tab for the whole run.
  const targets = await httpGetJSON(`http://127.0.0.1:${wsPort}/json/list`);
  const page = targets.find((t) => t.type === 'page');
  if (!page) { proc.kill(); throw new Error('No page target'); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false
  });

  // Collect console errors for diagnostics.
  const pageErrors = [];
  ws.onmessage = null; // replace with richer handler below
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(String(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text));
    }
  };

  for (const shot of SHOTS) {
    const url = `http://127.0.0.1:${PORT}/tests/ui-harness/shots.html?view=${shot.view}&theme=${shot.theme}`;
    await send('Page.navigate', { url });
    // Wait until the dashboard signals it booted, then let rAF settle.
    let ready = false;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        const r = await send('Runtime.evaluate', { expression: '!!(window.__qa && window.__qa.ready)', returnByValue: true });
        if (r.result.value === true) { ready = true; break; }
      } catch { /* page still loading */ }
    }
    if (!ready) console.warn(`  ⚠ ${shot.name}: ready flag never set — capturing anyway`);
    await sleep(600);

    const clip = { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 };
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
    const out = path.join(OUT_DIR, `${shot.name}.png`);
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    const errs = pageErrors.splice(0);
    console.log(`  ✔ ${shot.name}.png (${(Buffer.from(data, 'base64').length / 1024).toFixed(0)} KB${errs.length ? `, ${errs.length} page errors: ${errs[0]}` : ''})`);
  }

  ws.close();
  proc.kill();
  fs.rmSync(profileDir, { recursive: true, force: true });
  console.log(`\nDone — ${SHOTS.length} screenshots in store-assets/screenshots/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
