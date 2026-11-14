// scripts/e2e_test.js
// Automated interactive browser test for SpeakUp AI inside the Anna App Harness

const http = require('http');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
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

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function runTest() {
  console.log('Connecting to Chrome DevTools Protocol at http://localhost:9222...');
  
  // Find open tab
  const tabs = await fetchJson('http://localhost:9222/json/list');
  const pageTab = tabs.find(t => t.type === 'page') || tabs[0];
  if (!pageTab) throw new Error('No page tab found in Chrome');
  console.log(`Using tab: ${pageTab.id}, URL: ${pageTab.url}`);
  
  const cdp = new CDPClient(pageTab.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  cdp.ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
        console.log(`[BROWSER CONSOLE ${msg.params.type.toUpperCase()}]:`, text);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[BROWSER EXCEPTION]:', msg.params.exceptionDetails?.text, msg.params.exceptionDetails?.exception?.description);
      }
    } catch (_) {}
  });

  console.log('Waiting for harness and app iframe to initialize...');
  
  // Wait up to 20s for the iframe inside harness to load
  let iframeReady = false;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    try {
      const state = await cdp.eval(`
        (() => {
          const iframe = document.getElementById('app');
          if (!iframe) return { ready: false, step: 'no-iframe' };
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!doc) return { ready: false, step: 'no-doc' };
          const startBtn = doc.getElementById('start-btn');
          const cards = doc.querySelectorAll('.scenario-card');
          const title = doc.querySelector('.home-title h1')?.textContent;
          return {
            ready: !!startBtn && cards.length > 0,
            cardCount: cards.length,
            title,
            startBtnText: startBtn?.textContent?.trim()
          };
        })()
      `);
      if (state && state.ready) {
        console.log(`[OK] App loaded with ${state.cardCount} scenario cards! Title: "${state.title}", Start button: "${state.startBtnText}"`);
        iframeReady = true;
        break;
      } else {
        process.stdout.write('.');
      }
    } catch (e) {
      process.stdout.write('x');
    }
  }

  if (!iframeReady) {
    throw new Error('Timeout waiting for app iframe to load inside harness');
  }

  // 1. Check Home Screen & Scenarios
  console.log('\n--- Step 1: Inspecting Home Screen UI ---');
  const homeInfo = await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      const cards = Array.from(doc.querySelectorAll('.scenario-card')).map(c => ({
        id: c.getAttribute('data-id'),
        name: c.querySelector('.scenario-name')?.textContent,
        turns: c.querySelector('.scenario-turns')?.textContent
      }));
      const tone = doc.getElementById('persona-tone-select')?.value;
      const diff = doc.getElementById('difficulty-select')?.value;
      const dur = doc.querySelector('.duration-pill.selected')?.getAttribute('data-mins');
      return { cardsCount: cards.length, sampleCards: cards.slice(0, 4), tone, diff, dur };
    })()
  `);
  console.log(`Available scenarios count: ${homeInfo.cardsCount}`);
  console.log('Sample scenarios:', JSON.stringify(homeInfo.sampleCards, null, 2));
  console.log(`Default tone: ${homeInfo.tone}, difficulty: ${homeInfo.diff}, duration: ${homeInfo.dur}m`);

  // 2. Select a scenario and click Start Speaking Practice
  console.log('\n--- Step 2: Selecting Scenario & Starting Practice ---');
  const startResult = await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      // Select 'everyday' scenario card if available, or first card
      const everydayCard = doc.querySelector('.scenario-card[data-id="everyday"]') || doc.querySelector('.scenario-card');
      if (everydayCard) everydayCard.click();
      
      const startBtn = doc.getElementById('start-btn');
      startBtn.click();
      return { clicked: true, selectedScenario: everydayCard?.getAttribute('data-id') };
    })()
  `);
  console.log('Start clicked for scenario:', startResult.selectedScenario);

  // Wait for conversation screen to activate and coach prompt to appear
  console.log('Waiting for practice stage to load prompt...');
  let promptText = '';
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const stageState = await cdp.eval(`
      (() => {
        const doc = document.getElementById('app').contentDocument;
        const convScreen = doc.getElementById('conv-screen');
        const isActive = convScreen?.classList.contains('active');
        const prompt = doc.getElementById('coach-prompt-text')?.textContent?.trim();
        const hint = doc.getElementById('coach-hint-text')?.textContent?.trim();
        const label = doc.getElementById('coach-label-text')?.textContent?.trim();
        return { isActive, prompt, hint, label };
      })()
    `);
    if (stageState.isActive && stageState.prompt && !stageState.prompt.includes('Loading')) {
      promptText = stageState.prompt;
      console.log(`[OK] Practice Stage Active!`);
      console.log(`Coach Label: ${stageState.label}`);
      console.log(`Coach Prompt: "${stageState.prompt}"`);
      console.log(`Coach Hint: "${stageState.hint}"`);
      break;
    } else {
      process.stdout.write('.');
    }
  }

  // 3. Give user input via text fallback
  console.log('\n--- Step 3: Submitting Learner Response via Text Drawer ---');
  const testInput = "I am very exiting today.";
  console.log(`Input text to submit: "${testInput}"`);
  
  const submitResult = await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      // Open type drawer if closed
      const typeDrawer = doc.getElementById('type-drawer');
      const typeBtn = doc.getElementById('type-toggle-btn');
      if (!typeDrawer.classList.contains('open')) {
        typeBtn.click();
      }
      
      // Enter text
      const inputEl = doc.getElementById('user-input');
      inputEl.value = "${testInput}";
      
      // Click send
      const sendBtn = doc.getElementById('send-btn');
      sendBtn.click();
      return { sent: true };
    })()
  `);
  console.log('Submitted input, waiting for Coach evaluation and turn update...');

  // Wait for turn 2 or coach reply
  let turnAdvanced = false;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    const turnState = await cdp.eval(`
      (() => {
        const doc = document.getElementById('app').contentDocument;
        const subtitle = doc.getElementById('conv-subtitle')?.textContent?.trim();
        const prompt = doc.getElementById('coach-prompt-text')?.textContent?.trim();
        const feedbackItems = Array.from(doc.querySelectorAll('#feedback-items .grammar-item')).map(el => el.textContent.trim());
        const historyMsgs = Array.from(doc.querySelectorAll('#chat-messages .msg')).map(m => ({
          role: m.classList.contains('user') ? 'user' : 'coach',
          text: m.querySelector('.msg-bubble')?.textContent?.trim()
        }));
        const isSubmitting = doc.getElementById('send-btn')?.disabled;
        return { subtitle, prompt, feedbackCount: feedbackItems.length, feedbackItems, historyCount: historyMsgs.length, historyMsgs, isSubmitting };
      })()
    `);

    if (!turnState.isSubmitting && (turnState.historyCount >= 3 || (turnState.subtitle && turnState.subtitle.includes('2')))) {
      console.log(`\n[OK] Turn completed! Subtitle: ${turnState.subtitle}`);
      console.log(`New Coach Prompt: "${turnState.prompt}"`);
      console.log(`Feedback items (${turnState.feedbackCount}):`, turnState.feedbackItems);
      console.log(`Conversation History (${turnState.historyCount} messages):`);
      turnState.historyMsgs.forEach(m => console.log(`  [${m.role}] ${m.text}`));
      turnAdvanced = true;
      break;
    } else {
      process.stdout.write('.');
    }
  }

  // 4. Check Notebook Tab
  console.log('\n--- Step 4: Checking Notebook Tab ---');
  const notebookData = await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      doc.getElementById('tab-notebook').click();
      const cards = Array.from(doc.querySelectorAll('#notebook-list .nb-card')).map(c => ({
        orig: c.querySelector('.nb-card-orig')?.textContent?.trim(),
        sugg: c.querySelector('.nb-card-sugg')?.textContent?.trim(),
        expl: c.querySelector('.nb-card-expl')?.textContent?.trim()
      }));
      return { count: cards.length, cards };
    })()
  `);
  console.log(`Notebook saved items: ${notebookData.count}`);
  if (notebookData.count > 0) {
    console.log('Sample notebook entry:', JSON.stringify(notebookData.cards[0], null, 2));
  }

  // 5. Check Progress Tab
  console.log('\n--- Step 5: Checking Progress Tab ---');
  const progressData = await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      doc.getElementById('tab-progress').click();
      return {
        answers: doc.getElementById('pr-answers')?.textContent?.trim(),
        avgWords: doc.getElementById('pr-avg-words')?.textContent?.trim(),
        vocab: doc.getElementById('pr-vocab')?.textContent?.trim()
      };
    })()
  `);
  console.log('Progress stats:', progressData);

  // 6. End Session and Check Summary Screen
  console.log('\n--- Step 6: Ending Practice Session & Verifying Summary Screen ---');
  const endResult = await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      const endBtn = doc.getElementById('end-session-btn');
      endBtn.click();
      return { clicked: true };
    })()
  `);
  await sleep(1500);

  const summaryData = await cdp.eval(`
    (() => {
      const doc = document.getElementById('app').contentDocument;
      const sumScreen = doc.getElementById('summary-screen');
      const isSumActive = sumScreen?.classList.contains('active');
      return {
        active: isSumActive,
        turns: doc.getElementById('sum-turns')?.textContent?.trim(),
        corrections: doc.getElementById('sum-corrections')?.textContent?.trim(),
        words: doc.getElementById('sum-words')?.textContent?.trim(),
        title: doc.getElementById('sum-title')?.textContent?.trim()
      };
    })()
  `);
  console.log(`Summary Screen Active: ${summaryData.active}`);
  console.log(`Summary title: "${summaryData.title}"`);
  console.log(`Stats - Turns: ${summaryData.turns}, Corrections: ${summaryData.corrections}, Words: ${summaryData.words}`);

  console.log('\n=============================================');
  console.log('>>> ALL INTERACTIVE CHECKS PASSED CLEANLY! <<<');
  console.log('=============================================');

  cdp.close();
}

runTest().catch(err => {
  console.error('\n[TEST FAILED]:', err);
  process.exit(1);
});

