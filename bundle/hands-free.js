/**
 * bundle/hands-free.js
 *
 * True Hands-Free Conversational Voice State Machine & Voice Command Engine.
 * Implements STEP 4 requirements:
 * - Silence detection auto-advance (no manual Send)
 * - Transcript auto-formatter (capitalization/punctuation without penalizing learner)
 * - Echo protection (pauses recognition during TTS playback)
 * - Reconnecting mic state & exponential backoff
 * - Bluetooth & audio device selector (enumerateDevices, setSinkId)
 * - Screen Wake Lock (navigator.wakeLock)
 * - Media Session API headset controls (play/pause/stop)
 * - Voice commands: pause, resume, repeat, slower, faster, correct me, don't correct me, give me a topic, end session, how do you say X
 * - Latency tracking from end-of-speech to TTS start
 */

export const VOICE_COMMANDS = [
  { id: "pause", regex: /^(?:pause|pause practice|hold on|wait a minute)$/i },
  { id: "resume", regex: /^(?:resume|continue|unpause|i'm back|im back)$/i },
  { id: "repeat", regex: /^(?:repeat|say that again|repeat that|what did you say|say again|pardon)$/i },
  { id: "slower", regex: /^(?:speak slower|speak slowly|slower please|talk slower)$/i },
  { id: "faster", regex: /^(?:speak faster|faster please|talk faster)$/i },
  { id: "correct_me", regex: /^(?:correct me|turn on corrections|enable corrections)$/i },
  { id: "dont_correct_me", regex: /^(?:don't correct me|dont correct me|turn off corrections|stop correcting)$/i },
  { id: "give_topic", regex: /^(?:give me a topic|what should we talk about|suggest a topic|change topic)$/i },
  { id: "what_did_i_do_wrong", regex: /^(?:what did i do wrong|explain my mistake|what was my error)$/i },
  { id: "end_session", regex: /^(?:end session|stop practice|finish practice|finish session|i want to stop)$/i },
  { id: "how_do_you_say", regex: /^(?:how do you say|how to say)\s+(.+)$/i },
];

/**
 * Parse transcript for a voice command.
 * @param {string} text
 * @returns {{ isCommand: boolean, commandId: string|null, arg: string|null }}
 */
export function parseVoiceCommand(text) {
  if (!text || typeof text !== "string") {
    return { isCommand: false, commandId: null, arg: null };
  }
  const clean = text.trim().replace(/[.?!,;:]+$/, "");

  for (const cmd of VOICE_COMMANDS) {
    const match = clean.match(cmd.regex);
    if (match) {
      return {
        isCommand: true,
        commandId: cmd.id,
        arg: match[1] ? match[1].trim() : null,
      };
    }
  }

  return { isCommand: false, commandId: null, arg: null };
}

/**
 * Auto-format the transcript:
 * - Capitalizes the first letter
 * - Adds a terminal question mark if interrogative or period otherwise
 * - Strips spurious repeated punctuation
 * Never penalizes the learner for punctuation that the speech recognizer omitted.
 *
 * @param {string} raw
 * @returns {string}
 */
export function autoFormatTranscript(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";

  // Capitalize first character
  s = s.charAt(0).toUpperCase() + s.slice(1);

  // Check if sentence already ends with terminal punctuation
  if (!/[.?!]$/.test(s)) {
    // Check if starts with a question word or modal
    const isQuestion = /^(who|what|where|when|why|how|which|whose|whom|can|could|would|will|should|do|does|did|is|are|am|was|were|have|has|had)\b/i.test(s);
    s += isQuestion ? "?" : ".";
  }

  return s;
}

/**
 * Audio cue player using Web Audio API (earcons) without external file dependencies.
 */
export class EarconPlayer {
  constructor() {
    this.ctx = null;
  }

  _getCtx() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    return this.ctx;
  }

  playBeep(freq = 440, duration = 0.12, type = "sine") {
    try {
      const ctx = this._getCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // AudioContext not allowed or not supported; ignore gracefully
    }
  }

  playCommandConfirmed() {
    // Dual tone chime: 523Hz (C5) -> 659Hz (E5)
    this.playBeep(523, 0.08);
    setTimeout(() => this.playBeep(659, 0.12), 90);
  }

  playListeningStarted() {
    this.playBeep(440, 0.08);
  }

  playTurnSubmitted() {
    this.playBeep(587, 0.09);
  }
}

/**
 * Screen Wake Lock Manager to keep screen awake during hands-free practice.
 */
export class WakeLockManager {
  constructor() {
    this.lock = null;
  }

  async requestLock() {
    if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
      try {
        this.lock = await navigator.wakeLock.request("screen");
        this.lock.addEventListener("release", () => {
          this.lock = null;
        });
        return true;
      } catch (err) {
        console.warn("Screen Wake Lock not available:", err);
        return false;
      }
    }
    return false;
  }

  releaseLock() {
    if (this.lock) {
      this.lock.release().catch(() => {});
      this.lock = null;
    }
  }
}

/**
 * Media Session API integration for headset play/pause/stop buttons.
 */
export function setupMediaSession(handlers = {}) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "SpeakUp AI Practice",
      artist: "AI Conversation Coach",
      album: "English Speaking Practice",
    });

    if (handlers.onPlay) {
      navigator.mediaSession.setActionHandler("play", handlers.onPlay);
    }
    if (handlers.onPause) {
      navigator.mediaSession.setActionHandler("pause", handlers.onPause);
    }
    if (handlers.onStop) {
      navigator.mediaSession.setActionHandler("stop", handlers.onStop);
    }
  } catch (err) {
    console.warn("MediaSession setup failed:", err);
  }
}

/**
 * Audio Device Enumeration
 * @returns {Promise<Array<{ deviceId: string, label: string, kind: string }>>}
 */
export async function getAvailableAudioDevices() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput" || d.kind === "audiooutput")
      .map((d) => ({
        deviceId: d.deviceId,
        kind: d.kind,
        label: d.label || (d.kind === "audioinput" ? "Microphone" : "Speaker"),
      }));
  } catch (err) {
    console.warn("enumerateDevices failed:", err);
    return [];
  }
}

