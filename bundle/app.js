/**
 * SpeakUp AI — Voice-First English Conversation Practice Coach
 *
 * Implements:
 * 1. Honest dual-mode coaching (Anna LLM Sampling vs Rule-based basic mode)
 * 2. Non-repetitive, contextual conversation flow
 * 3. Speech recognition with Chromium diagnostic assistance
 * 4. Browser SpeechSynthesis (TTS) with Replay and Audio toggle
 * 5. Meaningful grammar & expressions feedback with "Try rewriting"
 * 6. Mistake Notebook with deduplication, status tracking, filters, and deletion
 * 7. Real progress metrics derived strictly from stored practice data
 * 8. Account privacy controls (Export JSON, Clear All Data)
 */

import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";
import { readAgentStream, parseCoachStructuredResponse, cleanSentinels, isStreamSentinel, extractTextDelta } from "./agent-stream.js";
import { StorageAdapter, runStorageMigration, exportAllUserData, restoreUserData, KEY_PROFILE, KEY_SETTINGS, KEY_HISTORY, DEFAULT_SETTINGS } from "./storage-migration.js";
import { LearnerProfileManager, ONBOARDING_QUESTIONS } from "./learner-profile.js";
import { SCENARIO_CATALOG, TONE_OPTIONS, DIFFICULTY_OPTIONS, pickSurpriseScenario } from "./scenarios.js";
import { parseVoiceCommand, autoFormatTranscript, EarconPlayer, WakeLockManager, setupMediaSession, getAvailableAudioDevices } from "./hands-free.js";
import { formatSpokenTurn, sanitizeCorrection, buildSessionSummary, generateSpacedRepetitionCards } from "./hybrid-coach.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const EXECUTA_HANDLE       = "speakup-ai";
const DEV_FALLBACK_TOOL_ID = "tool-dev-speakup-ai";
const TOOL_ID              = window.__ANNA_TOOL_IDS__?.[EXECUTA_HANDLE] || DEV_FALLBACK_TOOL_ID;
const DEFAULT_SESSION_SECS = 10 * 60; // 10 minutes

// ─── State ────────────────────────────────────────────────────────────────────
let anna             = null;
let annaAvailable    = false;

let selectedScenario     = "everyday";
let selectedDurationMins = 10;
let sessionId            = null;
let scenarioKey          = null;
let turnNumber           = 0;
let timerInterval        = null;
let secsLeft             = DEFAULT_SESSION_SECS;
let isPaused             = false;
let sessionStartedAt     = null;
let pausedAt             = null;
let totalPausedMs        = 0;
let sessionEnded         = false;
let isSubmitting         = false;

// Metrics for the active session
let sessionTurnsCount    = 0;
let sessionMistakesCount = 0;
let sessionVocabCount    = 0;
let sessionWordsCount    = 0;
let activeSource         = "rules"; // "agent" | "rules"
let conversationHistory  = [];
let agentSession         = null;
let agentSessionAvailable= false;
let activeRunId          = null;
let isRunCancelled       = false;

// Audio & Speech State
let voiceState           = "ready"; // 'ready' | 'requesting' | 'listening' | 'processing' | 'speaking' | 'paused' | 'error'
let audioEnabled         = true;
let currentCoachText     = "";
let speechSupported      = false;
let recognition          = null;
let recognizedText       = "";
let isListening          = false;
let autoListenAfterCoach = true;
let handsFreeEnabled = false;
let recognitionRetryCount = 0;
let recognitionRetryTimer = null;
let speechRate = 1;

// ─── New: Profile, Migration & Hands-Free Engines ─────────────────────────────
const storageAdapter     = new StorageAdapter();
const profileManager     = new LearnerProfileManager(storageAdapter);
const earconPlayer       = new EarconPlayer();
const wakeLockMgr        = new WakeLockManager();
let selectedTone         = "friendly";
let selectedDifficulty   = "intermediate";
let selectedMode         = "screen"; // "screen" | "handsfree"
let sessionMistakes      = []; // Array of correction objects for session summary
let sessionVocabulary    = []; // Vocab collected this session
let speechEndTimestamp   = 0;  // For latency measurement

// Notebook & Progress
let notebookEntries      = [];
let currentFilter        = "all";
let currentSearch        = "";
let progressData         = {
  sessions_completed: 0,
  minutes_practised: 0,
  answers_given: 0,
  total_words: 0,
  average_words_per_answer: 0,
  distinct_words_count: 0,
  mistakes_detected_by_checker: 0,
  notebook_fixed_count: 0,
  streak_days: 1,
};
let storageAvailable     = true;

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const screens = {
  home: $("home-screen"),
  conv: $("conv-screen"),
  summary: $("summary-screen"),
};
const loadingEl   = $("loading-overlay");
const toastEl     = $("toast-container");
const vocabPopup  = $("vocab-popup");
const privacyModal= $("privacy-modal");

// Home elements
const startBtn            = $("start-btn");
const scenarioGrid        = $("scenario-grid");
const durationSelector    = $("duration-selector");
const customPillBtn       = $("custom-pill-btn");
const customMinsInput     = $("custom-mins-input");
const sessionDurationMeta = $("session-duration-meta");
const statSessions        = $("stat-sessions");
const statMistakes        = $("stat-mistakes");
const statVocab           = $("stat-vocab");
const aiBadge             = $("ai-badge");
const settingsBtn         = $("settings-btn");
const fontToggleBtn       = $("font-toggle-btn");
const fontSizeLabel       = $("font-size-label");

// Header controls
const backBtn             = $("back-btn");
const convTitle           = $("conv-title");
const convSubtitle        = $("conv-subtitle");
const pauseSessionBtn     = $("pause-session-btn");
const pauseIcon           = $("pause-icon");
const pauseLabel          = $("pause-label");
const timerText           = $("timer-text");
const timerPill           = $("timer-pill");
const soundToggleBtn      = $("sound-toggle-btn");
const soundIcon           = $("sound-icon");
const soundLabel          = $("sound-label");
const handsfreeToggleBtn  = $("handsfree-toggle-btn");
const endSessionBtn       = $("end-session-btn");

// Coach Stage Card
const coachCard           = $("coach-card");
const coachLabel          = $("coach-label");
const coachLabelIcon      = $("coach-label-icon");
const coachLabelText      = $("coach-label-text");
const coachPromptText     = $("coach-prompt-text");
const coachSpeakingBars   = $("coach-speaking-bars");
const coachReplayBtn      = $("coach-replay-btn");
const coachHintCard       = $("coach-hint-card");
const coachHintText       = $("coach-hint-text");
const coachVocabStrip     = $("coach-vocab-strip");

// Voice Stage
const voiceMicBtn         = $("voice-mic-btn");
const heroMicIcon         = $("hero-mic-icon");
const micPulseWave        = $("mic-pulse-wave");
const voiceStatePill      = $("voice-state-pill");
const voiceStatusText     = $("voice-status-text");
const recordingControls   = $("recording-controls");
const doneVoiceBtn        = $("done-voice-btn");
const cancelVoiceBtn      = $("cancel-voice-btn");
const agentProcessingControls = $("agent-processing-controls");
const cancelAgentBtn      = $("cancel-agent-btn");
const transcriptPreview   = $("transcript-preview");

// Speech Diagnostic
const speechDiagCard      = $("speech-diagnostic-card");
const retryMicBtn         = $("retry-mic-btn");
const openTypeBtn         = $("open-type-btn");
const diagDesc            = $("diag-desc");

// Feedback Deck
const feedbackDeck        = $("feedback-deck");
const feedbackItems       = $("feedback-items");
const feedbackTimingNote  = $("feedback-timing-note");

// Type Drawer
const typeToggleBtn       = $("type-toggle-btn");
const typeDrawer          = $("type-drawer");
const userInput           = $("user-input");
const sendBtn             = $("send-btn");

// Tabs & Panels
const tabPractice         = $("tab-practice");
const tabHistory          = $("tab-history");
const tabNotebook         = $("tab-notebook");
const tabProgress         = $("tab-progress");
const panelPractice       = $("panel-practice");
const panelHistory        = $("panel-history");
const panelNotebook       = $("panel-notebook");
const panelProgress       = $("panel-progress");
const chatMessages        = $("chat-messages");
const notebookBadge       = $("notebook-badge");
const notebookList        = $("notebook-list");
const nbSearchInput       = $("nb-search-input");

// Progress Stats
const prSessions          = $("pr-sessions");
const prMinutes           = $("pr-minutes");
const prAnswers           = $("pr-answers");
const prAvgWords          = $("pr-avg-words");
const prMistakes          = $("pr-mistakes");
const prFixed             = $("pr-fixed");
const prVocab             = $("pr-vocab");
const prStreak            = $("pr-streak");
const storageNote         = $("storage-note");

// Summary Screen
const sumEmoji            = $("sum-emoji");
const sumTitle            = $("sum-title");
const sumSubtitle         = $("sum-subtitle");
const sumTurns            = $("sum-turns");
const sumCorrections      = $("sum-corrections");
const sumWords            = $("sum-words");
const sumStrengths        = $("sum-strengths");
const sumPriorities       = $("sum-priorities");
const sumPhrases          = $("sum-phrases");
const reviewNbBtn         = $("review-notebook-btn");
const newSessionBtn       = $("new-session-btn");

// Modal Buttons
const closeModalBtn       = $("close-modal-btn");
const exportDataBtn       = $("export-data-btn");
const clearDataBtn        = $("clear-data-btn");

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
  Object.values(screens).forEach((s) => s?.classList.remove("active"));
  if (screens[name]) screens[name].classList.add("active");
}

function fmtTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    return { success: false, error: e.message || "Tool invocation failed" };
  }
}

function standaloneStub(method, args) {
  if (method === "health") {
    return {
      success: true,
      data: { status: "ready", sampling_available: false, default_source: "rules" },
    };
  }
  if (method === "get_scenarios") {
    return {
      success: true,
      data: {
        scenarios: SCENARIO_CATALOG.map(s => ({
          key: s.key,
          title: s.title,
          icon: s.icon,
          description: s.description,
        })),
      },
    };
  }
  if (method === "start_session") {
    return {
      success: true,
      data: {
        session_id: "local-" + Date.now(),
        scenario_key: args.scenario || "introduction",
        scenario_title: "Self-Introduction",
        total_turns: null,
        opening_prompt: "Hello! Welcome to SpeakUp AI. Let's practice introducing yourself. Please tell me your name, where you are from, and what you do or study.",
        hint: "Try: 'My name is … I am from … and I currently study / work as …'",
        vocabulary: [
          { word: "originally", meaning: "used to say where someone grew up", example: "I am originally from Chennai." },
          { word: "currently",  meaning: "at the present time", example: "I am currently studying computer science." },
          { word: "pursue",     meaning: "to work towards achieving something", example: "I want to pursue a career in technology." },
        ],
        source: "rules",
        is_scripted: true,
      },
    };
  }
  if (method === "coach_turn") {
    return {
      success: true,
      data: {
        source: "rules",
        coach_reply: "Thank you for sharing that with me.",
        follow_up: "What is one of your favorite hobbies or interests, and why do you enjoy it?",
        full_message: "Thank you for sharing that with me. What is one of your favorite hobbies or interests, and why do you enjoy it?",
        hint: "Try: 'In my spare time, I enjoy … because it helps me …'",
        vocabulary: [
          { word: "passionate about", meaning: "very interested in something", example: "I am passionate about photography." },
          { word: "unwind", meaning: "to relax after work", example: "Listening to music helps me unwind." },
        ],
        grammar_notes: [],
        correction: {
          original: args.user_input,
          corrected: args.user_input,
          explanation: "Your sentence is clear and communicates your point naturally.",
          category: "Clear expression",
          isCorrect: true,
          label: "Basic checks (rule-based)",
          better_expressions: [],
        },
        suggested_topics: [],
        is_scripted: true,
        is_last_turn: false,
        next_turn_number: (args.turn_number || 1) + 1,
      },
    };
  }
  if (method === "get_notebook") {
    return {
      success: true,
      data: {
        entries: notebookEntries,
        total_stored: notebookEntries.length,
        progress: progressData,
        storage_available: false,
      },
    };
  }
  if (method === "save_progress") {
    return {
      success: true,
      data: { progress: progressData, persisted: false, storage_available: false },
    };
  }
  if (method === "clear_all_data") {
    notebookEntries = [];
    return { success: true, data: { cleared: true } };
  }
  return { success: false, error: "Method not found" };
}

// ─── Voice State Machine ──────────────────────────────────────────────────────

function setVoiceState(state, customMessage) {
  voiceState = state;

  voiceMicBtn.className = "btn-main-mic";
  voiceStatePill.className = "mic-status-pill";
  micPulseWave.className = "mic-pulse-wave";

  const stateLabels = {
    ready:      "Ready to speak · Tap microphone",
    requesting: "Accessing microphone…",
    listening:  "Listening… Speak clearly in English",
    processing: "Analyzing response & grammar…",
    speaking:   "Coach is speaking…",
    paused:     "Conversation paused · Tap Resume",
    error:      "Microphone unavailable · Tap retry or type below",
  };

  const stateIcons = {
    ready:      "🎙️",
    requesting: "⏳",
    listening:  "🔴",
    processing: "⚙️",
    speaking:   "🔊",
    paused:     "⏸",
    error:      "⚠️",
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

// ─── Speech Synthesis (Coach TTS) ────────────────────────────────────────────

function speakCoachPrompt(text, onComplete) {
  currentCoachText = text;
  if (!audioEnabled || !("speechSynthesis" in window)) {
    coachSpeakingBars?.classList.remove("active");
    if (typeof onComplete === "function") {
      setTimeout(onComplete, 400);
    }
    return;
  }

  window.speechSynthesis.cancel();

  // Strip emojis for clean TTS
  const clean = text.replace(/[\u{1F300}-\u{1F9FF}]/gu, "").trim();
  if (!clean) {
    if (typeof onComplete === "function") onComplete();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = "en-US";
  utterance.rate = speechRate;

  const voices = window.speechSynthesis.getVoices();
  const enVoice =
    voices.find(
      (v) =>
        v.lang.startsWith("en-US") &&
        (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Microsoft"))
    ) || voices.find((v) => v.lang.startsWith("en"));
  if (enVoice) utterance.voice = enVoice;

  utterance.onstart = () => {
    coachSpeakingBars?.classList.add("active");
    if (voiceState !== "listening") {
      setVoiceState("speaking", "Coach is speaking…");
    }
  };

  const finishSpeaking = () => {
    coachSpeakingBars?.classList.remove("active");
    if (voiceState === "speaking") {
      setVoiceState("ready");
    }
    if (typeof onComplete === "function") {
      setTimeout(onComplete, 350);
    }
  };

  utterance.onend = finishSpeaking;
  utterance.onerror = finishSpeaking;

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

// ─── Speech Recognition (Web Speech API) ─────────────────────────────────────

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

  // Dim previous feedback deck while actively listening to a new answer
  if (feedbackDeck.classList.contains("visible")) {
    feedbackDeck.classList.add("faded");
    if (feedbackTimingNote) feedbackTimingNote.textContent = "(Previous turn feedback)";
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showSpeechDiagnostic("Speech recognition is not supported in this browser environment.");
    setVoiceState("error");
    expandTypeDrawer();
    return;
  }

  setVoiceState("requesting", "Accessing microphone…");

  // Step 1: Pre-request microphone stream via getUserMedia
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
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

  // Step 2: Instantiate Recognition
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
        network: "Chromium cloud voice recognition service is temporarily unreachable.",
        "not-allowed": "Microphone permission was denied in your browser.",
        "service-not-allowed": "Speech recognition service is blocked on this container/origin.",
        "no-speech": "No speech was detected. Tap the microphone to try again.",
        "audio-capture": "Microphone capture failed. Please verify your sound input device.",
        aborted: "Listening cancelled.",
      };

      const msg = errorExplanations[e.error] || `Speech error: ${e.error}`;

      if (e.error === "network") {
        setVoiceState("error", "Voice service unreachable");
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
          if (handleVoiceCommand(recognizedText)) {
            setVoiceState("ready", "Command accepted");
          } else if (handsFreeEnabled && !isPaused && !isSubmitting) {
            setVoiceState("processing", "Speech captured · Sending…");
            submitTurn(recognizedText);
          } else {
            setVoiceState("ready", "Speech captured · Tap finish to send");
          }
        } else {
          if (handsFreeEnabled && !isPaused) {
            setVoiceState("ready", "No speech detected · Reconnecting mic…");
            clearTimeout(recognitionRetryTimer);
            recognitionRetryTimer = setTimeout(() => startListening(), Math.min(4000, 500 * (recognitionRetryCount + 1)));
            recognitionRetryCount += 1;
          } else {
            setVoiceState("ready");
          }
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

function toggleHandsFree() {
  handsFreeEnabled = !handsFreeEnabled;
  if (handsfreeToggleBtn) {
    handsfreeToggleBtn.classList.toggle("active", handsFreeEnabled);
    handsfreeToggleBtn.setAttribute("aria-pressed", String(handsFreeEnabled));
  }

  const hfOverlay = $("handsfree-overlay");

  if (handsFreeEnabled) {
    autoListenAfterCoach = true;
    if (hfOverlay) hfOverlay.classList.add("active");
    toast("Hands-free on. Speak after the coach finishes.", "info");
    earconPlayer.playCommandConfirmed();
    wakeLockMgr.requestLock().then(acquired => {
      const badge = $("hf-wakelock-badge");
      if (badge) badge.textContent = acquired ? "💡 Wake Lock active" : "💡 Wake Lock unavailable";
    });
    if (!isListening && !isPaused && !isSubmitting) startListening();
  } else {
    if (hfOverlay) hfOverlay.classList.remove("active");
    wakeLockMgr.releaseLock();
    clearTimeout(recognitionRetryTimer);
    toast("Hands-free off. Tap Finish & Send when ready.", "info");
  }
}

function handleVoiceCommand(text) {
  const result = parseVoiceCommand(text);
  if (!result.isCommand) return false;

  earconPlayer.playCommandConfirmed();

  switch (result.commandId) {
    case "pause":
      if (!isPaused) togglePauseSession();
      return true;
    case "resume":
      if (isPaused) togglePauseSession();
      return true;
    case "repeat":
      replayCoachPrompt();
      return true;
    case "slower":
      speechRate = Math.max(0.6, speechRate - 0.2);
      toast(`Coach speed: ${speechRate.toFixed(1)}x`, "info");
      replayCoachPrompt();
      return true;
    case "faster":
      speechRate = Math.min(1.6, speechRate + 0.2);
      toast(`Coach speed: ${speechRate.toFixed(1)}x`, "info");
      replayCoachPrompt();
      return true;
    case "correct_me":
      autoListenAfterCoach = true;
      toast("Corrections are on.", "info");
      return true;
    case "dont_correct_me":
      toast("Corrections remain in your notebook; spoken corrections are paused.", "info");
      return true;
    case "what_did_i_do_wrong":
      tabNotebook?.click();
      return true;
    case "end_session":
      endSession("manual");
      return true;
    case "give_topic":
      const profile = profileManager.getProfile();
      const surprise = pickSurpriseScenario(profile);
      toast(`Topic suggestion: ${surprise.title}`, "info");
      return true;
    case "how_do_you_say":
      toast(`Looking up: "${result.arg}"`, "info");
      return false; // Let it pass through as a turn so the AI can answer
    default:
      return false;
  }
}

function stopListening() {
  isListening = false;
  speechEndTimestamp = Date.now(); // Record for latency measurement
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

// ─── Type Drawer ──────────────────────────────────────────────────────────────

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

// ─── Timer Functions ──────────────────────────────────────────────────────────

function startTimer() {
  if (!sessionStartedAt) {
    secsLeft = selectedDurationMins * 60;
    isPaused = false;
    sessionStartedAt = Date.now();
    pausedAt = null;
    totalPausedMs = 0;
  }
  sessionEnded = false;
  updateTimerUI();
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (isPaused) return;
    const elapsed = Math.floor((Date.now() - sessionStartedAt - totalPausedMs) / 1000);
    secsLeft = Math.max(0, selectedDurationMins * 60 - elapsed);
    updateTimerUI();
    if (secsLeft <= 0) {
      endSession("timeout");
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

function togglePauseSession() {
  isPaused = !isPaused;
  if (isPaused) {
    pausedAt = Date.now();
    stopListening();
    stopCoachAudio();
    pauseIcon.textContent = "▶";
    pauseLabel.textContent = "Resume";
    pauseSessionBtn.classList.add("active");
    timerPill.classList.add("paused");
    setVoiceState("paused", "Conversation paused · Tap Resume to continue");
    toast("Conversation paused", "info");
  } else {
    if (pausedAt) totalPausedMs += Date.now() - pausedAt;
    pausedAt = null;
    pauseIcon.textContent = "⏸";
    pauseLabel.textContent = "Pause";
    pauseSessionBtn.classList.remove("active");
    timerPill.classList.remove("paused");
    setVoiceState("ready", "Ready to speak · Tap microphone");
    toast("Conversation resumed", "ok");
    if (autoListenAfterCoach) {
      setTimeout(() => startListening(), 300);
    }
  }
}

function updateTimerUI() {
  const elapsed = Math.max(0, selectedDurationMins * 60 - secsLeft);
  timerText.textContent = `${fmtTime(secsLeft)} left · ${fmtTime(elapsed)} elapsed`;
  if (isPaused) {
    timerPill.className = "timer-pill paused";
  } else if (secsLeft < 120) {
    timerPill.className = "timer-pill warn";
  } else {
    timerPill.className = "timer-pill";
  }
}

// ─── Honest Coach Header Updates ──────────────────────────────────────────────

function updateCoachLabel(source) {
  activeSource = source;
  if (source === "agent" || source === "ai") {
    coachLabel.className = "coach-label";
    coachLabelIcon.textContent = "✨";
    coachLabelText.textContent = "AI Coach (Agent Session)";
    aiBadge.textContent = "✨ Anna Agent Session active";
  } else {
    coachLabel.className = "coach-label rules";
    coachLabelIcon.textContent = "📝";
    coachLabelText.textContent = "Coach (basic mode)";
    aiBadge.textContent = "📝 Rule-based basic mode";
  }
}

async function getOrCreateAgentSession(scenarioTitle) {
  if (!annaAvailable || !anna?.agent?.session) {
    agentSessionAvailable = false;
    return null;
  }
  const profileContext = profileManager.getCoachPromptContext();
  const toneOption = TONE_OPTIONS.find(t => t.id === selectedTone) || TONE_OPTIONS[0];
  const diffOption = DIFFICULTY_OPTIONS.find(d => d.id === selectedDifficulty) || DIFFICULTY_OPTIONS[1];
  const systemPrompt = `You are SpeakUp AI, an encouraging and natural English conversation practice coach.
Current practice scenario: ${scenarioTitle || selectedScenario}.
${toneOption.promptModifier}
${diffOption.promptModifier}

${profileContext}

Guidelines:
1. Provide a natural, friendly 1 to 2 sentence conversational reply to what the student said.
2. Ask ONE clear open-ended question to keep the conversation going and encourage the student to practice speaking English.
3. Be supportive, warm, and engaging.
4. Keep replies conversational and spoken-style. Do NOT use bullet points, markdown formatting, or lengthy explanations.
5. When the student makes a grammar mistake, briefly note the correct form before continuing.`;

  const savedUuid = localStorage.getItem("speakup_agent_session_uuid");
  if (savedUuid) {
    try {
      const existing = anna.agent.session.attach(savedUuid);
      await existing.refresh();
      agentSession = existing;
      agentSessionAvailable = true;
      return existing;
    } catch (e) {
      console.warn("Could not refresh existing agent session, creating new:", e);
      localStorage.removeItem("speakup_agent_session_uuid");
    }
  }

  try {
    const created = await anna.agent.session({
      submode: "auto",
      systemPrompt,
    });
    agentSession = created;
    agentSessionAvailable = true;
    if (created?.app_session_uuid) {
      localStorage.setItem("speakup_agent_session_uuid", created.app_session_uuid);
    }
    return created;
  } catch (err) {
    console.warn("Agent session creation failed, falling back to basic mode:", err);
    agentSession = null;
    agentSessionAvailable = false;
    return null;
  }
}

function cancelActiveRun() {
  if (!isSubmitting) return;
  isRunCancelled = true;
  if (activeRunId && agentSession) {
    agentSession.cancel(activeRunId).catch((err) => {
      console.warn("Cancel agent run error:", err);
    });
  }
  if (agentProcessingControls) agentProcessingControls.classList.remove("active");
  isSubmitting = false;
  doneVoiceBtn.disabled = false;
  sendBtn.disabled      = false;
  setVoiceState("ready", "AI response cancelled");
  toast("Response cancelled", "info");
}

// ─── Feedback & Notebook Rendering ───────────────────────────────────────────

function displayLiveFeedback(notes, correction) {
  feedbackDeck.classList.remove("faded");
  if (feedbackTimingNote) feedbackTimingNote.textContent = "";

  if ((!notes || !notes.length) && (!correction || correction.isCorrect)) {
    feedbackDeck.classList.remove("visible");
    feedbackItems.innerHTML = "";
    return;
  }

  feedbackItems.innerHTML = "";

  if (correction && !correction.isCorrect) {
    const item = document.createElement("div");
    item.className = "grammar-item";

    const fragSpan = document.createElement("span");
    fragSpan.className = "frag";
    fragSpan.textContent = correction.original;

    const arrowSpan = document.createElement("span");
    arrowSpan.textContent = " → ";

    const suggSpan = document.createElement("span");
    suggSpan.className = "sugg";
    suggSpan.textContent = correction.corrected;

    const ruleTag = document.createElement("span");
    ruleTag.className = "rule-tag";
    ruleTag.textContent = `${correction.label || "Basic check"} · ${correction.category}`;

    item.appendChild(fragSpan);
    item.appendChild(arrowSpan);
    item.appendChild(suggSpan);
    item.appendChild(ruleTag);

    const explDiv = document.createElement("div");
    explDiv.style.fontSize = "11px";
    explDiv.style.color = "var(--text2)";
    explDiv.style.marginTop = "3px";
    explDiv.textContent = correction.explanation;
    item.appendChild(explDiv);

    // Better expressions if present
    const exprs = correction.better_expressions || [];
    if (exprs.length > 0) {
      const exprWrap = document.createElement("div");
      exprWrap.className = "better-exprs";
      exprWrap.textContent = "Natural alternatives: " + exprs.slice(0, 2).join(" · ");
      item.appendChild(exprWrap);
    }

    // "Try rewriting" button
    const rewriteBtn = document.createElement("button");
    rewriteBtn.type = "button";
    rewriteBtn.className = "btn-rewrite";
    rewriteBtn.textContent = "✍️ Try rewriting this";
    rewriteBtn.addEventListener("click", () => {
      userInput.value = correction.corrected;
      expandTypeDrawer();
    });
    item.appendChild(rewriteBtn);

    feedbackItems.appendChild(item);
  }

  feedbackDeck.classList.add("visible");
}

function renderNotebook() {
  if (!notebookEntries.length) {
    notebookList.innerHTML = '<p class="nb-empty">No corrections saved yet. Practice speaking to capture learning points!</p>';
    return;
  }

  // Filter & Search
  const filtered = notebookEntries.filter((e) => {
    if (currentFilter !== "all" && e.status !== currentFilter) return false;
    if (currentSearch) {
      const target = `${e.original || ""} ${e.corrected || ""} ${e.category || ""}`.toLowerCase();
      if (!target.includes(currentSearch)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    notebookList.innerHTML = '<p class="nb-empty">No items match your filter.</p>';
    return;
  }

  notebookList.innerHTML = "";
  filtered.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "nb-card";

    const top = document.createElement("div");
    top.className = "nb-card-top";
    top.innerHTML = `<span>${escHtml(entry.scenario || "Practice")} · ${escHtml(entry.category || "Grammar")}</span><span>Seen ${entry.times_seen || 1}x</span>`;

    const orig = document.createElement("div");
    orig.className = "nb-card-orig";
    orig.textContent = `"${entry.original || ""}"`;

    const sugg = document.createElement("div");
    sugg.className = "nb-card-sugg";
    sugg.textContent = `→ ${entry.corrected || ""}`;

    const expl = document.createElement("div");
    expl.className = "nb-card-expl";
    expl.textContent = entry.explanation || "";

    const actions = document.createElement("div");
    actions.className = "nb-card-actions";

    const statusBtn = document.createElement("button");
    statusBtn.type = "button";
    statusBtn.className = `nb-status-btn ${entry.status === "fixed" ? "fixed" : ""}`;
    statusBtn.textContent = entry.status === "fixed" ? "✓ Mastered" : "Mark Mastered";
    statusBtn.addEventListener("click", async () => {
      const nextStatus = entry.status === "fixed" ? "practising" : "fixed";
      entry.status = nextStatus;
      await callTool("update_notebook_item", { id: entry.id, status: nextStatus });
      renderNotebook();
      loadProgress();
    });
    actions.appendChild(statusBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "nb-status-btn";
    deleteBtn.textContent = "🗑 Remove";
    deleteBtn.addEventListener("click", async () => {
      notebookEntries = notebookEntries.filter((i) => i.id !== entry.id);
      await callTool("delete_notebook_item", { id: entry.id });
      renderNotebook();
      updateNotebookBadge();
    });
    actions.appendChild(deleteBtn);

    card.appendChild(top);
    card.appendChild(orig);
    card.appendChild(sugg);
    card.appendChild(expl);
    card.appendChild(actions);

    notebookList.appendChild(card);
  });
}

function updateNotebookBadge() {
  const count = notebookEntries.length;
  if (count > 0) {
    notebookBadge.style.display = "inline-flex";
    notebookBadge.textContent = count > 9 ? "9+" : String(count);
  } else {
    notebookBadge.style.display = "none";
  }
}

function updateProgressUI() {
  statSessions.textContent = progressData.sessions_completed || 0;
  statMistakes.textContent = progressData.mistakes_detected_by_checker || 0;
  statVocab.textContent    = progressData.distinct_words_count || 0;

  prSessions.textContent   = progressData.sessions_completed || 0;
  prMinutes.textContent    = progressData.minutes_practised || 0;
  prAnswers.textContent    = progressData.answers_given || 0;
  prAvgWords.textContent   = progressData.average_words_per_answer || 0;
  prMistakes.textContent   = progressData.mistakes_detected_by_checker || 0;
  prFixed.textContent      = progressData.notebook_fixed_count || 0;
  prVocab.textContent      = progressData.distinct_words_count || 0;
  prStreak.textContent     = `${progressData.streak_days || 1}d`;

  storageNote.textContent = storageAvailable
    ? "✓ Practice metrics and mistake notebook saved to your personal Anna Persistent Storage (APS KV)"
    : "ℹ️ Session progress stored locally in memory for this session";
}

// ─── History Messages ─────────────────────────────────────────────────────────

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
  let scenarios = SCENARIO_CATALOG;
  const res = await callTool("get_scenarios", {});
  if (res.success && res.data?.scenarios && res.data.scenarios.length > 0) {
    const validBackend = res.data.scenarios.filter((s) => s.key !== "introduction");
    if (validBackend.length >= SCENARIO_CATALOG.length) {
      scenarios = validBackend;
    } else {
      const backendMap = new Map(validBackend.map((s) => [s.key, s]));
      scenarios = SCENARIO_CATALOG.map((cat) => ({
        ...cat,
        ...(backendMap.get(cat.key) || {}),
      }));
    }
  }

  // Ensure 'introduction' is excluded from the picker (Step 3 requirement)
  scenarios = scenarios.filter((s) => s.key !== "introduction");
  scenarioGrid.innerHTML = "";

  scenarios.forEach((s) => {
    const card = document.createElement("div");
    card.className = `scenario-card ${s.key === selectedScenario ? "selected" : ""}`;
    card.dataset.key = s.key;
    card.dataset.id = s.key;
    card.setAttribute("data-id", s.key);
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.innerHTML = `
      <div class="scenario-icon">${s.icon}</div>
      <div class="scenario-name">${escHtml(s.title)}</div>
      <div class="scenario-desc">${escHtml(s.description)}</div>
      <div class="scenario-turns">⏱ Until timer ends · unlimited natural turns</div>
    `;

    card.addEventListener("click", () => {
      document.querySelectorAll(".scenario-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedScenario = s.key;
    });

    scenarioGrid.appendChild(card);
  });
}

async function loadProgress() {
  const res = await callTool("get_notebook", { limit: 50 });
  if (res.success && res.data) {
    notebookEntries  = res.data.entries || [];
    progressData     = res.data.progress || progressData;
    storageAvailable = res.data.storage_available !== false;
    updateProgressUI();
    updateNotebookBadge();
    renderNotebook();
  }
}

async function startSession() {
  startBtn.disabled = true;
  startBtn.textContent = "Starting practice session…";

  // Reset turn & session counters
  sessionId            = null;
  turnNumber           = 0;
  sessionStartedAt     = null;
  pausedAt             = null;
  totalPausedMs        = 0;
  sessionTurnsCount    = 0;
  sessionMistakesCount = 0;
  sessionVocabCount    = 0;
  sessionWordsCount    = 0;
  recognizedText       = "";
  conversationHistory  = [];
  isRunCancelled       = false;

  chatMessages.innerHTML = "";
  feedbackDeck.classList.remove("visible");
  feedbackItems.innerHTML = "";
  hideSpeechDiagnostic();

  const res = await callTool("start_session", { scenario: selectedScenario });

  startBtn.disabled = false;
  startBtn.innerHTML = "<span>🎙️</span> Start Speaking Practice";

  if (!res.success) {
    toast("Could not start session: " + (res.error || "Unknown error"), "error");
    return;
  }

  const d = res.data;
  sessionId   = d.session_id;
  scenarioKey = d.scenario_key;
  turnNumber  = 1;

  // Initialize or attach Agent Session
  const session = await getOrCreateAgentSession(d.scenario_title);
  const source = session ? "agent" : (d.source || "rules");

  convTitle.textContent    = d.scenario_title || "Practice Session";
  convSubtitle.textContent = `Turn 1 · ${source === "agent" ? "AI Coach (Agent Session)" : "Basic mode (rules)"}`;

  updateCoachLabel(source);
  recognitionRetryCount = 0;

  // Reset inputs
  transcriptPreview.classList.remove("visible");
  transcriptPreview.textContent = "";
  userInput.value = "";

  showScreen("conv");
  tabPractice.click();
  startTimer();

  // Opening Coach prompt
  displayCoachTurn(d.opening_prompt, d.hint, d.vocabulary || []);
  setVoiceState("ready");
}

function displayCoachTurn(fullPromptText, hint, vocabulary) {
  coachPromptText.textContent = fullPromptText;
  appendHistoryMessage("coach", fullPromptText);
  conversationHistory.push({ role: "coach", text: fullPromptText });

  speakCoachPrompt(fullPromptText, () => {
    if (autoListenAfterCoach && !isPaused && screens.conv.classList.contains("active") && tabPractice.classList.contains("active")) {
      startListening();
    }
  });

  if (hint) {
    coachHintText.textContent = hint;
    coachHintCard.style.display = "inline-flex";
  } else {
    coachHintCard.style.display = "none";
  }

  coachVocabStrip.innerHTML = "";
  if (vocabulary && vocabulary.length) {
    vocabulary.forEach((v) => {
      const pill = document.createElement("button");
      pill.className = "vocab-pill";
      pill.textContent = v.word;
      pill.setAttribute("aria-label", `Vocabulary: ${v.word}`);
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        showVocabPopup(v.word, v.meaning, v.example, pill);
        sessionVocabCount++;
        progressData.distinct_words_count = (progressData.distinct_words_count || 0) + 1;
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
  if (isSubmitting) return;

  const inputMode = (isListening || recognizedText) ? "speech" : "typed";
  const text = (providedText !== undefined ? providedText : userInput.value || recognizedText).trim();

  if (!text) {
    toast("Please speak or type your answer before sending.", "warn");
    return;
  }

  isSubmitting = true;
  isRunCancelled = false;
  stopListening();
  stopCoachAudio();

  setVoiceState("processing", "Analyzing response & grammar…");
  doneVoiceBtn.disabled = true;
  sendBtn.disabled      = true;

  userInput.value = "";
  recognizedText  = "";
  transcriptPreview.classList.remove("visible");
  transcriptPreview.textContent = "";

  appendHistoryMessage("user", text);
  conversationHistory.push({ role: "user", text });

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  sessionWordsCount += wordCount;
  sessionTurnsCount += 1;

  let coachText = "";
  let usedAgent = false;

  // Stream turn via Agent Session if available
  if (agentSessionAvailable && agentSession) {
    if (agentProcessingControls) agentProcessingControls.classList.add("active");
    setVoiceState("processing", "AI Coach is generating reply…");
    const runId = "run-" + Date.now();
    activeRunId = runId;

    try {
      const stream = agentSession.run({
        run_id: runId,
        content: `Student said: "${text}"`,
      });

      // Use the robust stream reader that filters sentinels and handles all frame types
      const abortController = new AbortController();
      const streamTimeout = setTimeout(() => abortController.abort(), 10000);
      let streamResult = null;
      try {
        streamResult = await readAgentStream(stream, {
          onToken: (delta, accumulatedClean) => {
            if (isRunCancelled) return;
            coachPromptText.textContent = accumulatedClean;
          },
          signal: abortController.signal,
          logFrames: false,
        });
      } finally {
        clearTimeout(streamTimeout);
      }

      if (isRunCancelled) {
        if (agentProcessingControls) agentProcessingControls.classList.remove("active");
        doneVoiceBtn.disabled = false;
        sendBtn.disabled      = false;
        isSubmitting          = false;
        setVoiceState("ready", "Turn cancelled");
        toast("AI response was cancelled", "info");
        return;
      }

      if (streamResult && streamResult.text) {
        coachText = streamResult.text;
        usedAgent = true;
      } else if (streamResult && streamResult.error) {
        console.warn("Agent stream error:", streamResult.error);
      }
    } catch (agentErr) {
      console.warn("Agent run error, falling back to rule engine:", agentErr);
      agentSessionAvailable = false;
    } finally {
      if (agentProcessingControls) agentProcessingControls.classList.remove("active");
    }
  }

  // Always invoke coach_turn for grammar verification and notebook updates
  const res = await callTool("coach_turn", {
    user_input:   text,
    scenario_key: scenarioKey,
    turn_number:  turnNumber,
    session_id:   sessionId,
    input_mode:   inputMode,
    history:      conversationHistory,
  });

  doneVoiceBtn.disabled = false;
  sendBtn.disabled      = false;
  isSubmitting          = false;

  if (!res.success && !coachText) {
    setVoiceState("ready");
    toast(res.error || "Something went wrong. Please try again.", "error");
    return;
  }

  const d = res.data || {};
  const currentSource = usedAgent ? "agent" : (d.source || "rules");
  updateCoachLabel(currentSource);

  turnNumber = d.next_turn_number || (turnNumber + 1);
  convSubtitle.textContent = `Turn ${turnNumber} · ${currentSource === "agent" ? "AI Coach (Agent Session)" : "Basic mode (rules)"}`;

  if (d.correction && !d.correction.isCorrect) {
    const cleanedCorr = sanitizeCorrection(d.correction, text);
    if (cleanedCorr && !cleanedCorr.isCorrect) {
      sessionMistakesCount += 1;
      sessionMistakes.push(cleanedCorr);
    }
    loadProgress(); // Reload notebook in background
  }

  // Collect vocabulary for session summary
  if (d.vocabulary && d.vocabulary.length > 0) {
    sessionVocabulary.push(...d.vocabulary);
  }

  // Build the final spoken prompt using hybrid coach formatter
  const profile = profileManager.getProfile();
  const correctionStyle = profile.correctionStyle || "balanced";
  const rawFinalMessage = coachText || d.full_message || `${d.coach_reply} ${d.follow_up || ""}`.trim();

  // If in hands-free mode, format for concise spoken delivery
  const finalCoachMessage = handsFreeEnabled
    ? formatSpokenTurn({
        correction: d.correction,
        reply: coachText || d.coach_reply || "",
        followUp: d.follow_up || "",
        correctionStyle,
      })
    : rawFinalMessage;
  displayCoachTurn(finalCoachMessage, d.hint, d.vocabulary || []);
  displayLiveFeedback(d.grammar_notes || [], d.correction);

  setVoiceState("ready");
}

async function endSession(reason = "complete") {
  if (sessionEnded) return;
  sessionEnded = true;
  stopTimer();
  stopListening();
  stopCoachAudio();

  if (agentSession) {
    try {
      await agentSession.delete();
    } catch (e) {
      console.warn("Error deleting agent session:", e);
    }
    agentSession = null;
    agentSessionAvailable = false;
    localStorage.removeItem("speakup_agent_session_uuid");
  }

  const elapsedMins = Math.max(1, Math.round((selectedDurationMins * 60 - secsLeft) / 60));

  await callTool("save_progress", {
    sessions_completed: 1,
    minutes_practised:  elapsedMins,
    answers_given:      sessionTurnsCount,
    words_spoken:       sessionWordsCount,
    mistakes_detected:  sessionMistakesCount,
  });

  await loadProgress();

  sumEmoji.textContent = reason === "timeout" ? "⏰" : sessionMistakesCount === 0 ? "🌟" : "🎉";
  sumTitle.textContent = reason === "timeout" ? "Time's up!" : "Session complete!";
  sumSubtitle.textContent = `You completed ${sessionTurnsCount} speaking turns in the ${convTitle.textContent} scenario.`;

  sumTurns.textContent       = sessionTurnsCount;
  sumCorrections.textContent = sessionMistakesCount;
  sumWords.textContent       = sessionVocabCount;

  // Strengths
  sumStrengths.innerHTML = "";
  const strengths = [
    `Engaged in ${sessionTurnsCount} interactive conversational turns.`,
    `Spoke a total of ~${sessionWordsCount} words with conversational intent.`,
  ];
  if (sessionMistakesCount === 0) {
    strengths.push("Zero major grammar issues flagged by the basic rule checker!");
  }
  strengths.forEach((s) => {
    const d = document.createElement("div");
    d.className = "summary-item";
    d.innerHTML = `<span>✓</span><span>${escHtml(s)}</span>`;
    sumStrengths.appendChild(d);
  });

  // Priorities
  sumPriorities.innerHTML = "";
  const priorities = [];
  if (sessionMistakesCount > 0) {
    priorities.push(`Review the ${sessionMistakesCount} points saved in your notebook.`);
  }
  priorities.push("Practice answering with 2-3 detailed sentences per turn.");
  priorities.push("Try incorporating newly explored vocabulary pills into your answers.");
  priorities.forEach((p) => {
    const d = document.createElement("div");
    d.className = "summary-item";
    d.innerHTML = `<span>•</span><span>${escHtml(p)}</span>`;
    sumPriorities.appendChild(d);
  });

  // Useful phrases
  sumPhrases.innerHTML = "";
  const phrases = [
    "From my perspective, …",
    "To expand on that point, …",
    "One memorable example of this is …",
    "I'm really passionate about …",
    "How do you usually approach …?",
  ];
  phrases.forEach((ph) => {
    const d = document.createElement("div");
    d.className = "summary-item";
    d.innerHTML = `<span>💬</span><span>"${escHtml(ph)}"</span>`;
    sumPhrases.appendChild(d);
  });

  showScreen("summary");
}

// ─── Vocab Popup ──────────────────────────────────────────────────────────────

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

// ─── Tabs & Filters ───────────────────────────────────────────────────────────

function setupTabs() {
  const tabs = [
    { btn: tabPractice, panel: panelPractice },
    { btn: tabHistory,  panel: panelHistory },
    { btn: tabNotebook, panel: panelNotebook },
    { btn: tabProgress, panel: panelProgress },
  ];

  tabs.forEach((t) => {
    t.btn.addEventListener("click", () => {
      tabs.forEach((o) => {
        o.btn.classList.remove("active");
        o.btn.setAttribute("aria-selected", "false");
        o.panel.classList.remove("active");
      });
      t.btn.classList.add("active");
      t.btn.setAttribute("aria-selected", "true");
      t.panel.classList.add("active");

      if (t.panel === panelNotebook) renderNotebook();
      if (t.panel === panelProgress) loadProgress();
    });
  });

  // Notebook filter pills
  const pills = document.querySelectorAll(".nb-pill");
  pills.forEach((p) => {
    p.addEventListener("click", () => {
      pills.forEach((o) => o.classList.remove("active"));
      p.classList.add("active");
      currentFilter = p.dataset.filter;
      renderNotebook();
    });
  });

  // Notebook search input
  nbSearchInput?.addEventListener("input", (e) => {
    currentSearch = e.target.value.trim().toLowerCase();
    renderNotebook();
  });
}

// ─── Settings & Privacy Modal ─────────────────────────────────────────────────

function setupSettingsModal() {
  settingsBtn?.addEventListener("click", () => {
    privacyModal.classList.add("open");
  });

  closeModalBtn?.addEventListener("click", () => {
    privacyModal.classList.remove("open");
  });

  privacyModal?.addEventListener("click", (e) => {
    if (e.target === privacyModal) privacyModal.classList.remove("open");
  });

  exportDataBtn?.addEventListener("click", () => {
    const payload = {
      app: "SpeakUp AI",
      exportedAt: new Date().toISOString(),
      progress: progressData,
      notebook: notebookEntries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `speakup-ai-data-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Exported your SpeakUp AI records (JSON)", "ok");
  });

  clearDataBtn?.addEventListener("click", async () => {
    if (window.confirm("Are you sure you want to delete all saved notebook entries and progress? This cannot be undone.")) {
      await callTool("clear_all_data", {});
      notebookEntries = [];
      progressData = {
        sessions_completed: 0,
        minutes_practised: 0,
        answers_given: 0,
        total_words: 0,
        average_words_per_answer: 0,
        distinct_words_count: 0,
        mistakes_detected_by_checker: 0,
        notebook_fixed_count: 0,
        streak_days: 0,
      };
      updateProgressUI();
      updateNotebookBadge();
      renderNotebook();
      privacyModal.classList.remove("open");
      toast("All practice records deleted.", "ok");
    }
  });

  fontToggleBtn?.addEventListener("click", () => {
    document.body.classList.toggle("font-large");
    const isLarge = document.body.classList.contains("font-large");
    fontSizeLabel.textContent = isLarge ? "A-" : "A+";
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
    console.info("SpeakUp AI running in preview/standalone mode.");
  }

  setLoading(true);

  // Probe runtime health
  const healthRes = await callTool("health", {});
  if (healthRes.success && healthRes.data) {
    updateCoachLabel(healthRes.data.default_source || "rules");
  }

  await Promise.all([loadScenarios(), loadProgress()]);
  setLoading(false);

  setupSpeech();
  setupTabs();
  setupSettingsModal();

  // Event Bindings
  startBtn.addEventListener("click", () => startSession());
  endSessionBtn?.addEventListener("click", () => endSession("manual"));

  backBtn.addEventListener("click", () => {
    stopTimer();
    stopListening();
    stopCoachAudio();
    showScreen("home");
    loadProgress();
  });

  // Hero mic button
  voiceMicBtn.addEventListener("click", () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  });

  doneVoiceBtn.addEventListener("click", () => submitTurn());
  cancelVoiceBtn.addEventListener("click", () => cancelSpeechInput());
  cancelAgentBtn?.addEventListener("click", () => cancelActiveRun());

  // Duration Selector Bindings
  if (durationSelector) {
    const pills = durationSelector.querySelectorAll(".duration-pill");
    pills.forEach((pill) => {
      pill.addEventListener("click", () => {
        pills.forEach((p) => p.classList.remove("selected"));
        pill.classList.add("selected");
        const mins = pill.dataset.mins;
        if (mins === "custom") {
          customMinsInput.classList.add("visible");
          customMinsInput.focus();
        } else {
          customMinsInput.classList.remove("visible");
          selectedDurationMins = parseInt(mins, 10) || 10;
          if (sessionDurationMeta) {
            sessionDurationMeta.textContent = `⏱ ${selectedDurationMins} minutes`;
          }
        }
      });
    });

    customMinsInput?.addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      if (val && val > 0) {
        selectedDurationMins = Math.min(180, Math.max(1, val));
        if (sessionDurationMeta) {
          sessionDurationMeta.textContent = `⏱ ${selectedDurationMins} minutes`;
        }
      }
    });
  }

  pauseSessionBtn?.addEventListener("click", () => togglePauseSession());
  coachReplayBtn?.addEventListener("click", () => replayCoachPrompt());

  soundToggleBtn?.addEventListener("click", () => {
    audioEnabled = !audioEnabled;
    soundIcon.textContent = audioEnabled ? "🔊" : "🔇";
    soundLabel.textContent = audioEnabled ? "Audio ON" : "Audio OFF";
    if (!audioEnabled) stopCoachAudio();
  });
  handsfreeToggleBtn?.addEventListener("click", () => toggleHandsFree());

  retryMicBtn?.addEventListener("click", () => {
    hideSpeechDiagnostic();
    startListening();
  });
  openTypeBtn?.addEventListener("click", () => {
    expandTypeDrawer();
  });

  typeToggleBtn?.addEventListener("click", () => toggleTypeDrawer());
  sendBtn?.addEventListener("click", () => submitTurn(userInput.value));

  userInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitTurn(userInput.value);
    }
  });

  newSessionBtn?.addEventListener("click", () => {
    showScreen("home");
    loadProgress();
  });

  reviewNbBtn?.addEventListener("click", () => {
    showScreen("conv");
    tabNotebook.click();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      vocabPopup.classList.remove("visible");
      privacyModal?.classList.remove("open");
      $("onboarding-modal")?.classList.remove("open");
      $("profile-modal")?.classList.remove("open");
      if (isSubmitting) cancelActiveRun();
      if (isListening) stopListening();
      stopCoachAudio();
    }
  });

  // ─── Storage Migration (Safety Rule 2) ────────────────────────────────────
  const migrationResult = runStorageMigration(storageAdapter);
  if (migrationResult.migrated) {
    console.info(`[SpeakUp AI] Storage migrated from v${migrationResult.fromVersion} to v${migrationResult.toVersion}`);
  }

  // ─── Apply user settings from localStorage ───────────────────────────────
  const savedSettings = storageAdapter.get(KEY_SETTINGS, DEFAULT_SETTINGS);
  if (savedSettings.fontSize === "large") {
    document.body.classList.add("font-large");
    if (fontSizeLabel) fontSizeLabel.textContent = "A-";
  }
  speechRate = savedSettings.audioPlaybackSpeed || 1.0;
  handsFreeEnabled = savedSettings.handsFreeMode || false;

  // ─── Surprise Me Button ───────────────────────────────────────────────────
  $("btn-surprise")?.addEventListener("click", () => {
    const profile = profileManager.getProfile();
    const picked = pickSurpriseScenario(profile);
    if (picked) {
      selectedScenario = picked.key;
      document.querySelectorAll(".scenario-card").forEach((c) => {
        c.classList.toggle("selected", c.dataset.key === picked.key);
      });
      toast(`Surprise! Let's try: ${picked.title}`, "ok");
    }
  });

  // ─── Persona Tone & Difficulty Selectors ──────────────────────────────────
  $("persona-tone-select")?.addEventListener("change", (e) => {
    selectedTone = e.target.value;
  });
  $("difficulty-select")?.addEventListener("change", (e) => {
    selectedDifficulty = e.target.value;
  });

  // ─── Mode Toggle: Screen vs Hands-Free ────────────────────────────────────
  const modeScreenBtn = $("mode-screen-btn");
  const modeHandsfreeBtn = $("mode-handsfree-btn");
  const safetyNotice = $("safety-notice");
  if (safetyNotice) safetyNotice.style.display = "none";

  modeScreenBtn?.addEventListener("click", () => {
    selectedMode = "screen";
    modeScreenBtn.classList.add("active");
    modeHandsfreeBtn?.classList.remove("active");
    if (safetyNotice) safetyNotice.style.display = "none";
  });
  modeHandsfreeBtn?.addEventListener("click", () => {
    selectedMode = "handsfree";
    modeHandsfreeBtn.classList.add("active");
    modeScreenBtn?.classList.remove("active");
    if (safetyNotice) safetyNotice.style.display = "flex";
  });

  // ─── Profile Button → Profile Modal ───────────────────────────────────────
  $("profile-btn")?.addEventListener("click", () => {
    renderProfileModal();
    $("profile-modal")?.classList.add("open");
  });
  $("close-profile-btn")?.addEventListener("click", () => {
    $("profile-modal")?.classList.remove("open");
  });
  $("clear-memory-btn")?.addEventListener("click", () => {
    profileManager.clearAllMemoryHighlights();
    renderProfileModal();
    toast("Coach memory cleared.", "ok");
  });
  $("restart-onboarding-btn")?.addEventListener("click", () => {
    $("profile-modal")?.classList.remove("open");
    profileManager.saveProfile({ onboardingCompleted: false });
    showOnboarding();
  });

  // ─── Data Restore (file input) ────────────────────────────────────────────
  $("restore-file-input")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const result = restoreUserData(payload, storageAdapter);
      if (result.success) {
        toast("Data restored successfully. Reloading…", "ok");
        setTimeout(() => location.reload(), 1200);
      } else {
        toast(result.message, "error");
      }
    } catch (err) {
      toast("Invalid backup file: " + err.message, "error");
    }
    e.target.value = "";
  });

  // ─── Enhanced Export (omnibus JSON) ────────────────────────────────────────
  const origExportHandler = exportDataBtn?.onclick;
  exportDataBtn?.addEventListener("click", async () => {
    try {
      // Fetch APS data if available
      let apsData = {};
      const nbRes = await callTool("get_notebook", { limit: 100 });
      if (nbRes.success && nbRes.data) {
        apsData.notebook = nbRes.data.entries || [];
        apsData.progress = nbRes.data.progress || {};
      }
      const fullExport = exportAllUserData(storageAdapter, apsData);
      const blob = new Blob([JSON.stringify(fullExport, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `speakup-ai-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Data exported successfully.", "ok");
    } catch (err) {
      toast("Export failed: " + err.message, "error");
    }
  });

  // ─── Settings Sliders ─────────────────────────────────────────────────────
  const silenceSlider = $("silence-threshold-slider");
  const silenceVal = $("silence-threshold-val");
  silenceSlider?.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    if (silenceVal) silenceVal.textContent = val.toFixed(1) + "s";
  });
  const speechRateSlider = $("speech-rate-slider");
  const speechRateVal = $("speech-rate-val");
  speechRateSlider?.addEventListener("input", (e) => {
    speechRate = parseFloat(e.target.value);
    if (speechRateVal) speechRateVal.textContent = speechRate.toFixed(1) + "x";
  });

  // ─── Hands-Free Overlay Controls ──────────────────────────────────────────
  $("hf-pause-btn")?.addEventListener("click", () => togglePauseSession());
  $("hf-repeat-btn")?.addEventListener("click", () => replayCoachPrompt());
  $("hf-end-btn")?.addEventListener("click", () => endSession("manual"));

  // ─── Spaced Repetition Review Button ──────────────────────────────────────
  $("practice-cards-btn")?.addEventListener("click", () => {
    const cardBox = $("spaced-card-box");
    const cardContent = $("spaced-card-content");
    if (!cardBox || !cardContent) return;

    const cards = generateSpacedRepetitionCards(notebookEntries.filter(e => e.status !== "fixed"));
    if (cards.length === 0) {
      cardContent.innerHTML = `<p style="color:var(--text3); font-size:11px;">No items to review right now. Practice more to collect mistakes!</p>`;
    } else {
      const card = cards[Math.floor(Math.random() * cards.length)];
      cardContent.innerHTML = `
        <p style="font-size:12px; color:var(--text);">${escHtml(card.blankedSentence)}</p>
        <details style="font-size:11px; color:var(--text2); margin-top:6px;">
          <summary style="cursor:pointer; color:var(--accent);">Show Answer</summary>
          <p style="margin-top:4px;"><strong>Correct:</strong> ${escHtml(card.corrected)}</p>
          <p><strong>Why:</strong> ${escHtml(card.explanation)}</p>
        </details>
      `;
    }
    cardBox.style.display = "flex";
  });
  $("close-spaced-btn")?.addEventListener("click", () => {
    const cardBox = $("spaced-card-box");
    if (cardBox) cardBox.style.display = "none";
  });

  // ─── Audio Device Enumeration (Settings Modal) ────────────────────────────
  async function populateAudioDevices() {
    const devices = await getAvailableAudioDevices();
    const inputSelect = $("audio-input-select");
    const outputSelect = $("audio-output-select");
    if (inputSelect) {
      inputSelect.innerHTML = '<option value="default">Default System Microphone</option>';
      devices.filter(d => d.kind === "audioinput").forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label;
        inputSelect.appendChild(opt);
      });
    }
    if (outputSelect) {
      outputSelect.innerHTML = '<option value="default">Default System Audio Output</option>';
      devices.filter(d => d.kind === "audiooutput").forEach(d => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label;
        outputSelect.appendChild(opt);
      });
    }
  }
  settingsBtn?.addEventListener("click", () => {
    populateAudioDevices();
  });

  // ─── Media Session for headset play/pause ─────────────────────────────────
  setupMediaSession({
    onPlay: () => { if (isPaused) togglePauseSession(); },
    onPause: () => { if (!isPaused) togglePauseSession(); },
    onStop: () => endSession("manual"),
  });

  // ─── Onboarding: Show on first launch ─────────────────────────────────────
  if (!profileManager.isOnboardingComplete()) {
    setTimeout(() => showOnboarding(), 600);
  }
}

// ─── Onboarding Wizard ────────────────────────────────────────────────────────

function showOnboarding() {
  const modal = $("onboarding-modal");
  if (!modal) return;
  modal.classList.add("open");

  let stepIdx = 0;
  const answers = {};

  function renderStep() {
    const q = ONBOARDING_QUESTIONS[stepIdx];
    const indicator = $("onboarding-step-indicator");
    const titleEl = $("modal-onboarding-title");
    const questionText = $("onboarding-question-text");
    const inputContainer = $("onboarding-input-container");
    const nextBtn = $("onboarding-next-btn");

    if (indicator) indicator.textContent = `Question ${stepIdx + 1} of ${ONBOARDING_QUESTIONS.length}`;
    if (titleEl) titleEl.textContent = stepIdx === 0 ? "Welcome to SpeakUp AI" : "Tell us about you";
    if (questionText) questionText.textContent = q.question;
    if (nextBtn) nextBtn.textContent = stepIdx === ONBOARDING_QUESTIONS.length - 1 ? "Finish ✓" : "Next →";

    inputContainer.innerHTML = "";

    if (q.options) {
      const optDiv = document.createElement("div");
      optDiv.className = "onboarding-options";
      q.options.forEach((opt) => {
        const btn = document.createElement("button");
        btn.className = "onboarding-option-btn";
        btn.textContent = opt.label;
        btn.type = "button";
        if (answers[q.field] === opt.value) btn.classList.add("selected");
        btn.addEventListener("click", () => {
          answers[q.field] = opt.value;
          optDiv.querySelectorAll(".onboarding-option-btn").forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
        });
        optDiv.appendChild(btn);
      });
      inputContainer.appendChild(optDiv);
    } else if (q.isTags) {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = q.placeholder || "";
      input.value = Array.isArray(answers[q.field]) ? answers[q.field].join(", ") : "";
      input.style.cssText = "width:100%;padding:8px;background:var(--bg-card);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);font-size:12px;";
      input.addEventListener("input", () => {
        answers[q.field] = input.value.split(",").map(s => s.trim()).filter(Boolean);
      });
      inputContainer.appendChild(input);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = q.placeholder || "";
      input.value = answers[q.field] || "";
      input.style.cssText = "width:100%;padding:8px;background:var(--bg-card);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);font-size:12px;";
      input.addEventListener("input", () => {
        answers[q.field] = input.value.trim();
      });
      inputContainer.appendChild(input);
    }
  }

  renderStep();

  $("onboarding-next-btn")?.addEventListener("click", () => {
    stepIdx += 1;
    if (stepIdx >= ONBOARDING_QUESTIONS.length) {
      profileManager.completeOnboarding(answers);
      modal.classList.remove("open");
      toast(`Welcome, ${answers.displayName || "Learner"}! Let's practice.`, "ok");

      // Apply selected daily goal to duration picker
      if (answers.dailyGoalMins) {
        selectedDurationMins = Number(answers.dailyGoalMins) || 10;
        if (sessionDurationMeta) sessionDurationMeta.textContent = `⏱ ${selectedDurationMins} minutes`;
      }
    } else {
      renderStep();
    }
  });

  $("onboarding-skip-btn")?.addEventListener("click", () => {
    profileManager.skipOnboarding();
    modal.classList.remove("open");
    toast("Onboarding skipped. You can retake it from your Profile.", "info");
  });

  $("close-onboarding-btn")?.addEventListener("click", () => {
    profileManager.skipOnboarding();
    modal.classList.remove("open");
  });
}

// ─── Profile Modal Renderer ───────────────────────────────────────────────────

function renderProfileModal() {
  const profile = profileManager.getProfile();
  const detailsEl = $("profile-summary-details");
  const memoryListEl = $("profile-memory-list");

  if (detailsEl) {
    detailsEl.innerHTML = `
      <div><strong>Name:</strong> ${escHtml(profile.displayName)}</div>
      <div><strong>Native Language:</strong> ${escHtml(profile.nativeLanguage)}</div>
      <div><strong>Goal:</strong> ${escHtml(profile.primaryGoal)}</div>
      <div><strong>CEFR Level:</strong> ${escHtml(profile.targetCefr)}</div>
      <div><strong>Correction Style:</strong> ${escHtml(profile.correctionStyle)}</div>
      <div><strong>Daily Goal:</strong> ${profile.dailyGoalMins || 10} minutes</div>
      <div><strong>Interests:</strong> ${Array.isArray(profile.topicsOfInterest) ? profile.topicsOfInterest.join(", ") : "General"}</div>
    `;
  }

  if (memoryListEl) {
    const highlights = profile.memoryHighlights || [];
    if (highlights.length === 0) {
      memoryListEl.innerHTML = '<p style="font-size:11px;color:var(--text3);">No learned preferences yet. The coach learns about you through conversations.</p>';
    } else {
      memoryListEl.innerHTML = highlights.map((h, i) => `
        <div class="memory-item">
          <span>${escHtml(h)}</span>
          <button title="Delete this memory" data-idx="${i}">🗑</button>
        </div>
      `).join("");
      memoryListEl.querySelectorAll("button[data-idx]").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.idx, 10);
          profileManager.deleteMemoryHighlight(idx);
          renderProfileModal();
        });
      });
    }
  }
}

main().catch((err) => {
  console.error("SpeakUp AI startup error:", err);
  setLoading(false);
  toast("Failed to start SpeakUp AI: " + err.message, "error");
});
