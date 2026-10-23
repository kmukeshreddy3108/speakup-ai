/**
 * SpeakUp AI — Voice-First English Conversation Practice Coach
 *
 * Implements:
 * 1. Primary Speaking Stage (centered, high-contrast, zero-scroll)
 * 2. Speech recognition with honest diagnosis of Chromium cloud dependency
 * 3. Browser SpeechSynthesis (TTS) with Replay controls
 * 4. Inline grammar correction deck & APS persistence (Notebook/Progress)
 * 5. Clean, non-intrusive "Type instead" fallback drawer
 */

import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const TOOL_ID       = "tool-dev-speakup-ai";
const SESSION_SECS  = 10 * 60;   // 10 minutes

// ─── State ────────────────────────────────────────────────────────────────────
let anna            = null;
let annaAvailable   = false;

let selectedScenario = "introduction";
let sessionId        = null;
let scenarioKey      = null;
let turnNumber       = 0;
let totalTurns       = 4;
let timerInterval    = null;
let secsLeft         = SESSION_SECS;
let mistakeCount     = 0;
let vocabCount       = 0;
let isLlmMode        = false;

// Audio & Speech State
// States: 'ready' | 'requesting' | 'listening' | 'processing' | 'speaking' | 'error'
let voiceState       = "ready";
let audioEnabled     = true;
let currentCoachText = "";
let speechSupported  = false;
let recognition      = null;
let recognizedText   = "";
let isListening      = false;

// Local notebook cache (persisted via APS)
let notebookEntries  = [];
let progress = { sessions_completed: 0, mistakes_corrected: 0, vocab_saved: 0 };
let storageAvailable = true;

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const screens           = { home: $("home-screen"), conv: $("conv-screen"), summary: $("summary-screen") };
const loadingEl         = $("loading-overlay");
const toastEl           = $("toast-container");
const vocabPopup        = $("vocab-popup");

// Home elements
const startBtn          = $("start-btn");
const scenarioGrid      = $("scenario-grid");
const statSessions      = $("stat-sessions");
const statMistakes      = $("stat-mistakes");
const statVocab         = $("stat-vocab");
const aiBadge           = $("ai-badge");

// Header controls
const backBtn           = $("back-btn");
const convTitle         = $("conv-title");
const convSubtitle      = $("conv-subtitle");
const timerText         = $("timer-text");
const timerPill         = $("timer-pill");
const soundToggleBtn    = $("sound-toggle-btn");
const soundIcon         = $("sound-icon");
const soundLabel        = $("sound-label");

// Coach Stage Card
const coachPromptText   = $("coach-prompt-text");
const coachSpeakingBars = $("coach-speaking-bars");
const coachReplayBtn    = $("coach-replay-btn");
const coachHintCard     = $("coach-hint-card");
const coachHintText     = $("coach-hint-text");
const coachVocabStrip   = $("coach-vocab-strip");

// Voice Stage (Primary)
const voiceMicBtn       = $("voice-mic-btn");
const heroMicIcon       = $("hero-mic-icon");
const micPulseWave      = $("mic-pulse-wave");
const voiceStatePill    = $("voice-state-pill");
const voiceStatusText   = $("voice-status-text");
const recordingControls = $("recording-controls");
const doneVoiceBtn      = $("done-voice-btn");
const cancelVoiceBtn    = $("cancel-voice-btn");
const transcriptPreview = $("transcript-preview");

// Speech Diagnostic Banner
const speechDiagCard    = $("speech-diagnostic-card");
const retryMicBtn       = $("retry-mic-btn");
const openTypeBtn       = $("open-type-btn");
const diagDesc          = $("diag-desc");

// Feedback Deck
const feedbackDeck      = $("feedback-deck");
const feedbackItems     = $("feedback-items");

// Collapsible Type Drawer
const typeToggleBtn     = $("type-toggle-btn");
const typeDrawer        = $("type-drawer");
const userInput         = $("user-input");
const sendBtn           = $("send-btn");

// Tabs & Panels
const tabPractice       = $("tab-practice");
const tabHistory        = $("tab-history");
const tabNotebook       = $("tab-notebook");
const tabProgress       = $("tab-progress");
const panelPractice     = $("panel-practice");
const panelHistory      = $("panel-history");
const panelNotebook     = $("panel-notebook");
const panelProgress     = $("panel-progress");
const chatMessages      = $("chat-messages");
const notebookBadge     = $("notebook-badge");
const notebookList      = $("notebook-list");
const prSessions        = $("pr-sessions");
const prMistakes        = $("pr-mistakes");
const prVocab           = $("pr-vocab");
const storageNote       = $("storage-note");

// Summary Screen
const sumEmoji          = $("sum-emoji");
const sumTitle          = $("sum-title");
const sumSubtitle       = $("sum-subtitle");
const sumTurns          = $("sum-turns");
const sumCorrections    = $("sum-corrections");
const sumWords          = $("sum-words");
const nextSteps         = $("next-steps");
const reviewNbBtn       = $("review-notebook-btn");
const newSessionBtn     = $("new-session-btn");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setLoading(show, text = "Loading SpeakUp AI…") {
  if (!loadingEl) return;
  const p = loadingEl.querySelector("p");
  if (p) p.textContent = text;
  loadingEl.classList.toggle("hidden", !show);
}

function toast(message, type = "info") {
  if (!toastEl) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  toastEl.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function showScreen(name) {
  Object.values(screens).forEach(s => s?.classList.remove("active"));
  if (screens[name]) screens[name].classList.add("active");
}

function fmtTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function escHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Voice State Machine ──────────────────────────────────────────────────────

function setVoiceState(state, customMessage) {
  voiceState = state;

  voiceMicBtn.className = "btn-main-mic";
  voiceStatePill.className = "mic-status-pill";
  micPulseWave.className = "mic-pulse-wave";

  const stateLabels = {
    ready:       "Ready to speak · Tap microphone",
    requesting:  "Accessing microphone…",
    listening:   "Listening… Speak clearly in English",
    processing:  "Analyzing response & grammar…",
    speaking:    "Coach is speaking…",
    error:       "Microphone unavailable · Tap retry or type below",
  };

  const stateIcons = {
    ready:       "🎙️",
    requesting:  "⏳",
    listening:   "🔴",
    processing:  "⚙️",
    speaking:    "🔊",
    error:       "⚠️",
  };

  voiceMicBtn.classList.add(state);
  voiceStatePill.classList.add(state);
  if (state === "listening") {
    micPulseWave.classList.add("active");
    recordingControls.classList.add("active");
  } else {
    recordingControls.classList.remove("active");
  }

  voiceStatusText.textContent = customMessage || stateLabels[state] || "Ready";
  heroMicIcon.textContent = stateIcons[state] || "🎙️";
}

// ─── Speech Synthesis (Coach Spoken Audio) ───────────────────────────────────

function speakCoachPrompt(text) {
  currentCoachText = text;
  if (!audioEnabled || !("speechSynthesis" in window)) {
    coachSpeakingBars?.classList.remove("active");
    return;
  }

  window.speechSynthesis.cancel();

  // Strip emojis for clean pronunciation
  const clean = text.replace(/[\u{1F300}-\u{1F9FF}]/gu, "").trim();
  if (!clean) return;

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = "en-US";
  utterance.rate = 0.95;

  const voices = window.speechSynthesis.getVoices();
  const enVoice = voices.find(v => v.lang.startsWith("en-US") && (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Microsoft")))
               || voices.find(v => v.lang.startsWith("en"));
  if (enVoice) utterance.voice = enVoice;

  utterance.onstart = () => {
    coachSpeakingBars?.classList.add("active");
    if (voiceState !== "listening") {
      setVoiceState("speaking", "Coach is speaking…");
    }
  };

  utterance.onend = () => {
    coachSpeakingBars?.classList.remove("active");
    if (voiceState === "speaking") {
      setVoiceState("ready");
    }
  };

  utterance.onerror = () => {
    coachSpeakingBars?.classList.remove("active");
    if (voiceState === "speaking") {
      setVoiceState("ready");
    }
  };

  window.speechSynthesis.speak(utterance);
}

function stopCoachAudio() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  coachSpeakingBars?.classList.remove("active");
  if (voiceState === "speaking") {
    setVoiceState("ready");
  }
}

function replayCoachPrompt() {
  if (currentCoachText) {
    speakCoachPrompt(currentCoachText);
  }
}

// ─── Speech Recognition with Honest Chromium Diagnostics ─────────────────────

function setupSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechSupported = Boolean(SR);

  if (!speechSupported) {
    showSpeechDiagnostic("Speech recognition is not supported in this browser. Please use the text input below.");
    setVoiceState("error", "Speech recognition unsupported");
    return;
  }

  setVoiceState("ready");
}

function showSpeechDiagnostic(message) {
  speechDiagCard.classList.add("visible");
  diagDesc.textContent = message;
}

function hideSpeechDiagnostic() {
  speechDiagCard.classList.remove("visible");
}

async function startListening() {
  if (isListening) {
    stopListening();
    return;
  }

  stopCoachAudio();
  hideSpeechDiagnostic();

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showSpeechDiagnostic("Speech recognition is not supported in this browser environment.");
    setVoiceState("error");
    expandTypeDrawer();
    return;
  }

  setVoiceState("requesting", "Accessing microphone…");

  // Step 1: Pre-request microphone stream cleanly via getUserMedia
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch (permErr) {
      console.warn("Microphone access check failed:", permErr);
      if (permErr.name === "NotAllowedError" || permErr.name === "PermissionDeniedError") {
        setVoiceState("error", "Microphone access blocked");
        showSpeechDiagnostic("Microphone access was denied. Please allow microphone permissions in your browser address bar.");
        expandTypeDrawer();
        return;
      }
      if (permErr.name === "NotFoundError" || permErr.name === "DevicesNotFoundError") {
        setVoiceState("error", "No microphone detected");
        showSpeechDiagnostic("No microphone hardware was detected on your computer.");
        expandTypeDrawer();
        return;
      }
    }
  }

  // Step 2: Instantiate Recognition instance
  try {
    if (recognition) {
      try { recognition.abort(); } catch {}
      recognition = null;
    }

    recognition = new SR();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognizedText = "";
    transcriptPreview.classList.add("visible", "interim");
    transcriptPreview.textContent = "Listening… start speaking in English";

    recognition.onstart = () => {
      isListening = true;
      setVoiceState("listening", "Listening… Speak your answer now");
    };

    recognition.onresult = (e) => {
      let interim = "";
      let final = "";

      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      recognizedText = (final || interim).trim();

      if (recognizedText) {
        transcriptPreview.textContent = recognizedText;
        transcriptPreview.className = "transcript-preview visible" + (final ? "" : " interim");
        userInput.value = recognizedText;
      }
    };

    recognition.onerror = (e) => {
      console.warn("Speech recognition error:", e.error);
      isListening = false;

      const errorExplanations = {
        "network": "Speech recognition service is currently unavailable. (Chromium cloud speech service requires an active connection to Google speech servers).",
        "not-allowed": "Microphone permission was denied. Please allow microphone permissions in the browser address bar.",
        "service-not-allowed": "Speech recognition service is blocked on this origin or container.",
        "no-speech": "No speech was detected. Tap the microphone to try again.",
        "audio-capture": "Microphone capture failed. Please check your sound input device.",
        "aborted": "Speech listening was cancelled.",
      };

      const msg = errorExplanations[e.error] || `Speech error: ${e.error}`;

      if (e.error === "network") {
        setVoiceState("error", "Cloud voice service unreachable");
        showSpeechDiagnostic(msg);
        expandTypeDrawer();
      } else if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setVoiceState("error", "Microphone access blocked");
        showSpeechDiagnostic(msg);
        expandTypeDrawer();
      } else if (e.error === "no-speech") {
        setVoiceState("ready", "No speech detected · Tap mic to try again");
      } else if (e.error !== "aborted") {
        setVoiceState("error", msg);
        showSpeechDiagnostic(msg);
      } else {
        setVoiceState("ready");
      }
    };

    recognition.onend = () => {
      isListening = false;
      if (voiceState === "listening") {
        if (recognizedText.trim()) {
          setVoiceState("ready", "Speech captured · Tap finish to send");
        } else {
          setVoiceState("ready");
          transcriptPreview.classList.remove("visible");
        }
      }
    };

    recognition.start();
  } catch (err) {
    console.error("Failed to start SpeechRecognition:", err);
    isListening = false;
    setVoiceState("error", "Could not start microphone");
    showSpeechDiagnostic("Failed to activate speech recognition. Please type your response below.");
    expandTypeDrawer();
  }
}

function stopListening() {
  isListening = false;
  if (recognition) {
    try { recognition.stop(); } catch {}
  }
  if (voiceState === "listening" || voiceState === "requesting") {
    setVoiceState("ready");
  }
}

function cancelSpeechInput() {
  stopListening();
  recognizedText = "";
  transcriptPreview.classList.remove("visible");
  transcriptPreview.textContent = "";
  userInput.value = "";
  setVoiceState("ready");
}

// ─── Collapsible Type Drawer ──────────────────────────────────────────────────

function expandTypeDrawer() {
  typeDrawer.classList.add("open");
  typeToggleBtn.setAttribute("aria-expanded", "true");
  setTimeout(() => userInput.focus(), 100);
}

function toggleTypeDrawer() {
  const isOpen = typeDrawer.classList.contains("open");
  typeDrawer.classList.toggle("open", !isOpen);
  typeToggleBtn.setAttribute("aria-expanded", String(!isOpen));
  if (!isOpen) {
    setTimeout(() => userInput.focus(), 100);
  }
}

// ─── Tool Calls (Anna SDK) ───────────────────────────────────────────────────

async function callTool(method, args) {
  if (!annaAvailable) {
    return standaloneStub(method, args);
  }
  try {
    const result = await anna.tools.invoke({
      tool_id: TOOL_ID,
      method,
      args,
    });
    return { success: true, data: result };
  } catch (e) {
    console.warn("Tool error:", method, e);
    return { success: false, error: e.message || "Tool unavailable" };
  }
}

function standaloneStub(method, args) {
  if (method === "get_scenarios") {
    return { success: true, data: { scenarios: [
      { key: "introduction",       title: "Self-Introduction",     icon: "👋", description: "Practice introducing yourself clearly", turn_count: 4 },
      { key: "job_interview",      title: "Job Interview",         icon: "💼", description: "Answer common interview questions", turn_count: 4 },
      { key: "college_discussion", title: "College Discussion",    icon: "🎓", description: "Academic and class discussions", turn_count: 4 },
      { key: "everyday",           title: "Everyday Conversation", icon: "☕", description: "Casual daily English situations", turn_count: 4 },
    ]}};
  }
  if (method === "start_session") {
    return { success: true, data: {
      session_id: "preview-" + Date.now(),
      scenario_key: args.scenario || "introduction",
      scenario_title: "Self-Introduction",
      total_turns: 4,
      opening_prompt: "Hello! Let's practice introducing yourself. Please tell me your name, where you are from, and what you do or study.",
      hint: "Try: 'My name is … I am from … and I am a student / I work as …'",
      vocabulary: [
        { word: "originally", meaning: "used to say where someone is really from", example: "I am originally from Chennai." },
        { word: "currently",  meaning: "at the present time", example: "I am currently studying computer science." },
        { word: "pursue",     meaning: "to follow or work towards something", example: "I want to pursue a career in technology." },
      ],
      is_scripted: true,
    }};
  }
  if (method === "coach_turn") {
    const notes = [];
    const lower = (args.user_input || "").toLowerCase();
    if (/\b(i goes|he go|she do)\b/.test(lower)) {
      notes.push({ rule: "Subject-verb agreement", fragment: "I goes", suggestion: "I go", label: "Grammar note (rule-based)" });
    }
    return { success: true, data: {
      coach_reply: "Good effort! Tell me about one of your hobbies or interests. Why do you enjoy it?",
      hint: "Try: 'One of my hobbies is … I enjoy it because …'",
      vocabulary: [
        { word: "passionate about", meaning: "very interested in something", example: "I am passionate about photography." },
        { word: "spare time",        meaning: "free time outside work", example: "In my spare time I read books." },
      ],
      grammar_notes: notes,
      is_scripted: true,
      is_last_turn: (args.turn_number || 1) >= 4,
      next_turn_number: (args.turn_number || 1) + 1,
    }};
  }
  if (method === "get_notebook") {
    return { success: true, data: { entries: notebookEntries, total_stored: notebookEntries.length, progress, storage_available: false }};
  }
  if (method === "save_progress") {
    return { success: true, data: { progress: args, persisted: false, storage_available: false }};
  }
  return { success: false, error: "Method not found" };
}

// ─── Timer Functions ──────────────────────────────────────────────────────────

function startTimer() {
  secsLeft = SESSION_SECS;
  updateTimerUI();
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    secsLeft = Math.max(0, secsLeft - 1);
    updateTimerUI();
    if (secsLeft <= 0) endSession("timeout");
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

function updateTimerUI() {
  timerText.textContent = fmtTime(secsLeft);
  if (secsLeft < 120) timerPill.classList.add("warn");
  else                timerPill.classList.remove("warn");
}

// ─── Vocabulary Popup ─────────────────────────────────────────────────────────

function showVocabPopup(word, meaning, example, targetEl) {
  $("vp-word").textContent    = word;
  $("vp-meaning").textContent = meaning;
  $("vp-example").textContent = '"' + example + '"';

  const rect = targetEl.getBoundingClientRect();
  vocabPopup.style.top  = (rect.bottom + 8) + "px";
  vocabPopup.style.left = Math.min(rect.left, window.innerWidth - 280) + "px";
  vocabPopup.classList.add("visible");

  const hide = (e) => {
    if (!vocabPopup.contains(e.target) && e.target !== targetEl) {
      vocabPopup.classList.remove("visible");
      document.removeEventListener("click", hide);
    }
  };
  setTimeout(() => document.addEventListener("click", hide), 50);
}

// ─── Feedback & Notebook Rendering ───────────────────────────────────────────

function displayLiveFeedback(notes) {
  if (!notes || !notes.length) {
    feedbackDeck.classList.remove("visible");
    feedbackItems.innerHTML = "";
    return;
  }

  feedbackItems.innerHTML = "";
  notes.forEach(n => {
    const item = document.createElement("div");
    item.className = "grammar-item";
    item.innerHTML = `
      <span class="frag">${escHtml(n.fragment)}</span>
      <span class="arrow">→</span>
      <span class="sugg">${escHtml(n.suggestion)}</span>
      <span class="rule-tag">${escHtml(n.rule)}</span>
    `;
    feedbackItems.appendChild(item);

    notebookEntries.unshift({
      scenario: convTitle.textContent,
      original: n.fragment,
      corrections: [n],
      timestamp: new Date().toISOString(),
    });
  });

  feedbackDeck.classList.add("visible");
  mistakeCount += notes.length;
  updateNotebookBadge();
  renderNotebook();
}

function updateNotebookBadge() {
  if (mistakeCount > 0) {
    notebookBadge.style.display = "inline-flex";
    notebookBadge.textContent   = mistakeCount > 9 ? "9+" : mistakeCount;
  }
}

function renderNotebook() {
  if (!notebookEntries.length) {
    notebookList.innerHTML = '<p class="nb-empty">No corrections yet. Start practising!</p>';
    return;
  }
  notebookList.innerHTML = "";
  notebookEntries.slice(0, 30).forEach(entry => {
    const card = document.createElement("div");
    card.className = "nb-card";
    const corrs = entry.corrections || [];
    const c     = corrs[0] || {};
    card.innerHTML = `
      <div class="nb-meta">${escHtml(entry.scenario || "")} · ${fmtTimestamp(entry.timestamp)}</div>
      <div class="nb-original">"${escHtml(entry.original || c.fragment || "")}"</div>
      <div class="nb-correction">
        → <span style="color:var(--accent); font-weight:600;">${escHtml(c.suggestion || "")}</span>
        <span class="nb-rule">${escHtml(c.rule || "")}</span>
      </div>
    `;
    notebookList.appendChild(card);
  });
}

function fmtTimestamp(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function updateProgressUI() {
  statSessions.textContent = progress.sessions_completed || 0;
  statMistakes.textContent = progress.mistakes_corrected || 0;
  statVocab.textContent    = progress.vocab_saved || 0;

  prSessions.textContent   = progress.sessions_completed || 0;
  prMistakes.textContent   = progress.mistakes_corrected || 0;
  prVocab.textContent      = progress.vocab_saved || 0;

  storageNote.textContent = storageAvailable
    ? "✓ Progress & mistakes saved to your Anna cloud account"
    : "ℹ️ Session progress stored locally for this session";
}

// ─── History Messages (Review Tab) ───────────────────────────────────────────

function appendHistoryMessage(role, text) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = role === "coach" ? "🎙️" : "🧑";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = text;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ─── Scenario & Session Flow ─────────────────────────────────────────────────

async function loadScenarios() {
  const res = await callTool("get_scenarios", {});
  if (!res.success || !res.data?.scenarios) return;

  const scenarios = res.data.scenarios;
  scenarioGrid.innerHTML = "";

  scenarios.forEach(s => {
    const card = document.createElement("div");
    card.className = `scenario-card ${s.key === selectedScenario ? "selected" : ""}`;
    card.dataset.key = s.key;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.innerHTML = `
      <div class="scenario-icon">${s.icon}</div>
      <div class="scenario-name">${escHtml(s.title)}</div>
      <div class="scenario-desc">${escHtml(s.description)}</div>
      <div class="scenario-turns">⏱ 10 mins · ${s.turn_count || 4} turns</div>
    `;

    card.addEventListener("click", () => {
      document.querySelectorAll(".scenario-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedScenario = s.key;
    });

    scenarioGrid.appendChild(card);
  });
}

async function loadProgress() {
  const res = await callTool("get_notebook", { limit: 30 });
  if (res.success && res.data) {
    notebookEntries  = res.data.entries || [];
    progress         = res.data.progress || progress;
    storageAvailable = res.data.storage_available !== false;
    updateProgressUI();
    renderNotebook();
  }
}

async function startSession() {
  startBtn.disabled = true;
  startBtn.textContent = "Starting practice…";

  // Reset turn & session state
  sessionId       = null;
  turnNumber      = 0;
  mistakeCount    = 0;
  vocabCount      = 0;
  recognizedText  = "";
  chatMessages.innerHTML = "";
  feedbackDeck.classList.remove("visible");
  feedbackItems.innerHTML = "";
  notebookBadge.style.display = "none";
  notebookEntries = [];
  hideSpeechDiagnostic();

  const res = await callTool("start_session", { scenario: selectedScenario });

  startBtn.disabled = false;
  startBtn.innerHTML = "<span>🎙️</span> Start 10-minute practice";

  if (!res.success) {
    toast("Could not start session: " + (res.error || "Unknown error"), "error");
    return;
  }

  const d = res.data;
  sessionId   = d.session_id;
  scenarioKey = d.scenario_key;
  totalTurns  = d.total_turns || 4;
  turnNumber  = 1;

  convTitle.textContent    = d.scenario_title || "Practice Session";
  convSubtitle.textContent = `Turn 1 of ${totalTurns}`;

  // Reset inputs & previews
  transcriptPreview.classList.remove("visible");
  transcriptPreview.textContent = "";
  userInput.value = "";

  showScreen("conv");
  tabPractice.click();
  startTimer();

  // Populate Coach Prompt
  displayCoachTurn(d.opening_prompt, d.hint, d.vocabulary || []);

  setVoiceState("ready");
}

function displayCoachTurn(promptText, hint, vocabulary) {
  coachPromptText.textContent = promptText;

  appendHistoryMessage("coach", promptText);
  speakCoachPrompt(promptText);

  if (hint) {
    coachHintText.textContent = hint;
    coachHintCard.style.display = "inline-flex";
  } else {
    coachHintCard.style.display = "none";
  }

  coachVocabStrip.innerHTML = "";
  if (vocabulary && vocabulary.length) {
    vocabulary.forEach(v => {
      const pill = document.createElement("button");
      pill.className = "vocab-pill";
      pill.textContent = v.word;
      pill.setAttribute("aria-label", `Vocabulary: ${v.word}`);
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        showVocabPopup(v.word, v.meaning, v.example, pill);
        vocabCount++;
        updateProgressUI();
      });
      coachVocabStrip.appendChild(pill);
    });
    coachVocabStrip.style.display = "inline-flex";
  } else {
    coachVocabStrip.style.display = "none";
  }
}

async function submitTurn(providedText) {
  const text = (providedText !== undefined ? providedText : userInput.value || recognizedText).trim();

  if (!text) {
    toast("Please speak or type your answer before sending.", "warn");
    return;
  }

  stopListening();
  stopCoachAudio();

  setVoiceState("processing", "Analyzing response & grammar…");
  doneVoiceBtn.disabled = true;
  sendBtn.disabled = true;

  appendHistoryMessage("user", text);

  userInput.value = "";
  recognizedText = "";
  transcriptPreview.classList.remove("visible");
  transcriptPreview.textContent = "";

  const res = await callTool("coach_turn", {
    user_input:   text,
    scenario_key: scenarioKey,
    turn_number:  turnNumber,
    session_id:   sessionId,
  });

  doneVoiceBtn.disabled = false;
  sendBtn.disabled = false;

  if (!res.success) {
    setVoiceState("ready");
    toast(res.error || "Something went wrong. Please try again.", "error");
    return;
  }

  const d = res.data;
  isLlmMode = !d.is_scripted;
  aiBadge.textContent = isLlmMode ? "✨ AI coaching" : "🗣️ Voice coach";

  turnNumber = d.next_turn_number || (turnNumber + 1);
  convSubtitle.textContent = `Turn ${Math.min(turnNumber, totalTurns)} of ${totalTurns}`;

  displayCoachTurn(d.coach_reply, d.hint, d.vocabulary || []);
  displayLiveFeedback(d.grammar_notes || []);

  updateProgressUI();

  if (d.is_last_turn) {
    setTimeout(() => endSession("complete"), 2200);
  } else {
    setVoiceState("ready");
  }
}

async function endSession(reason = "complete") {
  stopTimer();
  stopListening();
  stopCoachAudio();

  const saveRes = await callTool("save_progress", {
    sessions_completed: 1,
    mistakes_corrected: mistakeCount,
    vocab_saved:        vocabCount,
  });

  if (saveRes.success && saveRes.data?.progress) {
    progress = saveRes.data.progress;
  }

  const emoji = reason === "timeout" ? "⏰" :
                mistakeCount === 0   ? "🌟" :
                mistakeCount < 3     ? "🎉" : "💪";
  sumEmoji.textContent    = emoji;
  sumTitle.textContent    = reason === "timeout" ? "Time's up!" : "Session complete!";
  sumSubtitle.textContent = reason === "timeout"
    ? "Great effort — 10 focused minutes of English speaking practice!"
    : `You completed all speaking turns in the ${convTitle.textContent} scenario.`;

  sumTurns.textContent       = Math.max(0, turnNumber - 1);
  sumCorrections.textContent = mistakeCount;
  sumWords.textContent       = vocabCount;

  nextSteps.innerHTML = "";
  const recommendations = buildRecommendations();
  recommendations.forEach(rec => {
    const div = document.createElement("div");
    div.className = "next-step";
    div.innerHTML = `<div class="ns-icon">${rec.icon}</div><div>${escHtml(rec.text)}</div>`;
    nextSteps.appendChild(div);
  });

  showScreen("summary");
  updateProgressUI();
}

function buildRecommendations() {
  const recs = [];
  if (mistakeCount > 0) {
    recs.push({ icon: "📝", text: `You had ${mistakeCount} grammar feedback points. Review them in your notebook and repeat the scenario to master them.` });
  } else {
    recs.push({ icon: "⭐", text: "Zero grammar mistakes detected — fluent and confident! Try the Job Interview or College Discussion next." });
  }
  if (vocabCount < 3) {
    recs.push({ icon: "🔤", text: "Tap the purple vocabulary pills during sessions to learn new expressions and practice them aloud." });
  } else {
    recs.push({ icon: "🔤", text: `You explored ${vocabCount} vocabulary words today. Incorporate them into your next conversation.` });
  }
  return recs;
}

// ─── Tab Switching ────────────────────────────────────────────────────────────

function setupTabs() {
  const tabs = [
    { btn: tabPractice, panel: panelPractice },
    { btn: tabHistory,  panel: panelHistory },
    { btn: tabNotebook, panel: panelNotebook },
    { btn: tabProgress, panel: panelProgress },
  ];

  tabs.forEach(t => {
    t.btn.addEventListener("click", () => {
      tabs.forEach(o => {
        o.btn.classList.remove("active");
        o.btn.setAttribute("aria-selected", "false");
        o.panel.classList.remove("active");
      });
      t.btn.classList.add("active");
      t.btn.setAttribute("aria-selected", "true");
      t.panel.classList.add("active");

      if (t.panel === panelNotebook) renderNotebook();
    });
  });
}

// ─── Main Startup ─────────────────────────────────────────────────────────────

async function main() {
  try {
    anna = await AnnaAppRuntime.connect();
    annaAvailable = true;
    await anna.window.set_title({ title: "SpeakUp AI — English Practice Coach" });
    await anna.window.ready();
  } catch (e) {
    annaAvailable = false;
    console.info("SpeakUp AI running in preview mode (no Anna host detected).");
  }

  setLoading(true);
  await Promise.all([loadScenarios(), loadProgress()]);
  setLoading(false);

  setupSpeech();
  setupTabs();

  // Event Bindings
  startBtn.addEventListener("click", () => startSession());

  backBtn.addEventListener("click", () => {
    stopTimer();
    stopListening();
    stopCoachAudio();
    showScreen("home");
    loadProgress();
  });

  // Center microphone hero button
  voiceMicBtn.addEventListener("click", () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  });

  // Recording controls
  doneVoiceBtn.addEventListener("click", () => submitTurn());
  cancelVoiceBtn.addEventListener("click", () => cancelSpeechInput());

  // Coach audio replay
  coachReplayBtn.addEventListener("click", () => replayCoachPrompt());

  // Sound toggle button
  soundToggleBtn.addEventListener("click", () => {
    audioEnabled = !audioEnabled;
    soundIcon.textContent = audioEnabled ? "🔊" : "🔇";
    soundLabel.textContent = audioEnabled ? "Audio ON" : "Audio OFF";
    if (!audioEnabled) stopCoachAudio();
  });

  // Speech diagnostic banner buttons
  retryMicBtn.addEventListener("click", () => {
    hideSpeechDiagnostic();
    startListening();
  });
  openTypeBtn.addEventListener("click", () => {
    expandTypeDrawer();
  });

  // Collapsible Type Fallback
  typeToggleBtn.addEventListener("click", () => toggleTypeDrawer());
  sendBtn.addEventListener("click", () => submitTurn(userInput.value));

  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitTurn(userInput.value);
    }
  });

  newSessionBtn.addEventListener("click", () => {
    showScreen("home");
    loadProgress();
  });

  reviewNbBtn.addEventListener("click", () => {
    showScreen("conv");
    tabNotebook.click();
  });

  // Global Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      vocabPopup.classList.remove("visible");
      if (isListening) stopListening();
      stopCoachAudio();
    }
  });
}

main().catch(err => {
  console.error("SpeakUp AI startup error:", err);
  setLoading(false);
  toast("Failed to start SpeakUp AI: " + err.message, "error");
});
