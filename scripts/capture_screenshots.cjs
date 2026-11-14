// scripts/capture_screenshots.cjs
// Automatically captures the 6 required store screenshots for SpeakUp AI
const http = require('http');
const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      };
    });
  }

  async send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async saveScreenshot(filepath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, buffer);
    console.log(`[SAVED] ${filepath} (${buffer.length} bytes)`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function main() {
  const outDir = path.resolve(__dirname, '../docs/store/screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Connecting to Chrome CDP...');
  const tabs = await fetchJson('http://localhost:9222/json/list');
  const pageTab = tabs.find(t => t.type === 'page') || tabs[0];
  if (!pageTab) throw new Error('No page tab found in Chrome');

  const cdp = new CDPClient(pageTab.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  });

  console.log('Waiting for app iframe to be fully rendered...');
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const ready = await cdp.eval(`
      (() => {
        const iframe = document.getElementById('app');
        if (!iframe) return false;
        const doc = iframe.contentDocument;
        return !!doc && doc.querySelectorAll('.scenario-card').length > 0;
      })()
    `);
    if (ready) break;
  }

  // 1. Capture Home Screen
  console.log('Capturing 01-home.png...');
  await sleep(1000);
  await cdp.saveScreenshot(path.join(outDir, '01-home.png'));

  // 2. Start Practice & Capture Speaking Stage
  console.log('Starting practice session for 02-speaking-stage.png...');
  await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      const card = doc.querySelector('.scenario-card[data-id="everyday"]') || doc.querySelector('.scenario-card');
      if (card) card.click();
      doc.getElementById('start-btn').click();
    })()
  `);
  
  // Wait for coach prompt to display
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const hasPrompt = await cdp.eval(`
      (() => {
        const doc = document.getElementById('app').contentDocument;
        const text = doc.getElementById('coach-prompt-text')?.textContent?.trim();
        return text && !text.includes('Loading');
      })()
    `);
    if (hasPrompt) break;
  }
  await sleep(1000);
  console.log('Capturing 02-speaking-stage.png...');
  await cdp.saveScreenshot(path.join(outDir, '02-speaking-stage.png'));

  // 3. Submit turn and capture Live Feedback deck
  console.log('Submitting learner answer for 03-feedback.png...');
  await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      const typeDrawer = doc.getElementById('type-drawer');
      if (!typeDrawer.classList.contains('open')) {
        doc.getElementById('type-toggle-btn').click();
      }
      doc.getElementById('user-input').value = "I am very exiting today.";
      doc.getElementById('send-btn').click();
    })()
  `);

  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const feedbackVisible = await cdp.eval(`
      (() => {
        const doc = document.getElementById('app').contentDocument;
        return doc.querySelectorAll('#feedback-items .grammar-item').length > 0;
      })()
    `);
    if (feedbackVisible) break;
  }
  await sleep(1000);
  console.log('Capturing 03-feedback.png...');
  await cdp.saveScreenshot(path.join(outDir, '03-feedback.png'));

  // 4. Capture Notebook Tab
  console.log('Switching to Notebook tab for 04-notebook.png...');
  await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      doc.getElementById('tab-notebook').click();
    })()
  `);
  await sleep(1000);
  console.log('Capturing 04-notebook.png...');
  await cdp.saveScreenshot(path.join(outDir, '04-notebook.png'));

  // 5. Capture Progress Tab
  console.log('Switching to Progress tab for 05-progress.png...');
  await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      doc.getElementById('tab-progress').click();
    })()
  `);
  await sleep(1000);
  console.log('Capturing 05-progress.png...');
  await cdp.saveScreenshot(path.join(outDir, '05-progress.png'));

  // 6. Return to Home and Capture Settings & Privacy Modal
  console.log('Opening Settings & Privacy modal for 06-settings.png...');
  await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      doc.getElementById('back-btn').click();
      doc.getElementById('settings-btn').click();
    })()
  `);
  await sleep(1000);
  console.log('Capturing 06-settings.png...');
  await cdp.saveScreenshot(path.join(outDir, '06-settings.png'));

  console.log('\n[SUCCESS] All 6 required store screenshots captured successfully!');
  cdp.close();
}

main().catch(err => {
  console.error('[CAPTURE FAILED]:', err);
  process.exit(1);
});

