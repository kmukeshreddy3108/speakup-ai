/**
 * bundle/learner-profile.js
 *
 * Progressive Learner Profile & Onboarding Engine for SpeakUp AI.
 * Handles:
 * - 5-7 question onboarding (skippable, conversational, persistent)
 * - Safe memory storage (never stores sensitive passwords, financial, medical, or ID data)
 * - "What the coach knows about me" data management (view, edit, delete, export)
 * - Compact prompt summarization for Agent Session
 */

import {
  StorageAdapter,
  KEY_PROFILE,
  DEFAULT_PROFILE,
} from "./storage-migration.js";

// Sensitive topics / terms that must NEVER be retained in the coach's memory
const SENSITIVE_PATTERNS = [
  /\bpassword\b/i,
  /\bcredit\s*card\b/i,
  /\bssn\b/i,
  /\bsocial\s*security\b/i,
  /\bbank\s*account\b/i,
  /\bpin\s*code\b/i,
  /\bmedical\s*history\b/i,
  /\bdiagnosis\b/i,
  /\bpassport\s*number\b/i,
];

export const ONBOARDING_QUESTIONS = [
  {
    id: "name",
    question: "What name or nickname would you like the coach to call you?",
    placeholder: "e.g. Alex, Sam, Maria",
    field: "displayName",
    default: "Learner",
  },
  {
    id: "nativeLanguage",
    question: "What is your native or first language?",
    placeholder: "e.g. Spanish, Hindi, Telugu, Japanese, French",
    field: "nativeLanguage",
    default: "English (ESL)",
  },
  {
    id: "goal",
    question: "Why do you want to practice English?",
    options: [
      { value: "Everyday conversational fluency", label: "Everyday Life & Casual Conversations" },
      { value: "Job interviews and career advancement", label: "Job Interviews & Career" },
      { value: "College seminars and academic discussions", label: "College & Academic Studies" },
      { value: "Travel, dining, and global communication", label: "Travel & Exploring the World" },
      { value: "Workplace meetings and presentations", label: "Workplace & Professional Meetings" },
    ],
    field: "primaryGoal",
  },
  {
    id: "level",
    question: "How would you rate your current English speaking comfort?",
    options: [
      { value: "A1", label: "A1 — Beginner (Simple words, short phrases: 'I like coffee')" },
      { value: "A2", label: "A2 — Elementary (Basic daily routines: 'Yesterday I went to market')" },
      { value: "B1", label: "B1 — Intermediate (Express opinions, tell stories with some pauses)" },
      { value: "B2", label: "B2 — Upper Intermediate (Comfortable discussing varied topics fluidly)" },
      { value: "C1", label: "C1 — Advanced (Nuanced, fast-paced professional or academic debate)" },
    ],
    field: "targetCefr",
  },
  {
    id: "style",
    question: "How would you like the coach to give you feedback?",
    options: [
      { value: "balanced", label: "Balanced — Gentle live correction after each turn" },
      { value: "notes_end", label: "Notes at End — Speak freely, review mistakes when session ends" },
      { value: "strict", label: "Thorough — Highlight both grammar and natural native phrasing" },
      { value: "none", label: "Fluency Focus — No live interruptions, just conversation flow" },
    ],
    field: "correctionStyle",
  },
  {
    id: "minutes",
    question: "What is your daily speaking practice goal?",
    options: [
      { value: 5, label: "5 minutes — Quick daily warm-up" },
      { value: 10, label: "10 minutes — Recommended balanced practice" },
      { value: 15, label: "15 minutes — Deep focus session" },
      { value: 20, label: "20 minutes — Intensive conversational mastery" },
    ],
    field: "dailyGoalMins",
  },
  {
    id: "interests",
    question: "What topics or hobbies do you enjoy talking about?",
    placeholder: "e.g. Movies, cooking, programming, travel, music, sports",
    field: "topicsOfInterest",
    isTags: true,
  },
];

export class LearnerProfileManager {
  constructor(storage = new StorageAdapter()) {
    this.storage = storage;
  }

  getProfile() {
    return this.storage.get(KEY_PROFILE, { ...DEFAULT_PROFILE });
  }

  saveProfile(updated) {
    const profile = {
      ...this.getProfile(),
      ...updated,
      version: 2,
      updatedAt: new Date().toISOString(),
    };
    this.storage.set(KEY_PROFILE, profile);
    return profile;
  }

  isOnboardingComplete() {
    const profile = this.getProfile();
    return !!profile.onboardingCompleted;
  }

  completeOnboarding(data) {
    const profile = this.getProfile();
    const updated = {
      ...profile,
      ...data,
      onboardingCompleted: true,
      updatedAt: new Date().toISOString(),
    };
    this.storage.set(KEY_PROFILE, updated);
    return updated;
  }

  skipOnboarding() {
    return this.completeOnboarding({ onboardingCompleted: true });
  }

  /**
   * Add a memory point (e.g. "prefers talking about sci-fi movies", "works as a backend engineer").
   * Sanitizes sensitive content.
   *
   * @param {string} fact
   * @returns {boolean} whether the fact was safely stored
   */
  addMemoryHighlight(fact) {
    if (!fact || typeof fact !== "string") return false;
    const trimmed = fact.trim();
    if (!trimmed || trimmed.length > 200) return false;

    // Check sensitive patterns
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(trimmed)) {
        console.warn("[Privacy Guard] Blocked sensitive memory item from being stored:", trimmed);
        return false;
      }
    }

    const profile = this.getProfile();
    const list = Array.isArray(profile.memoryHighlights) ? [...profile.memoryHighlights] : [];

    // Avoid exact duplicates
    if (!list.includes(trimmed)) {
      list.push(trimmed);
      if (list.length > 30) list.shift(); // keep recent 30 highlights
      profile.memoryHighlights = list;
      this.saveProfile(profile);
    }
    return true;
  }

  deleteMemoryHighlight(index) {
    const profile = this.getProfile();
    if (Array.isArray(profile.memoryHighlights) && index >= 0 && index < profile.memoryHighlights.length) {
      profile.memoryHighlights.splice(index, 1);
      this.saveProfile(profile);
      return true;
    }
    return false;
  }

  clearAllMemoryHighlights() {
    const profile = this.getProfile();
    profile.memoryHighlights = [];
    this.saveProfile(profile);
    return true;
  }

  /**
   * Generate a compact summary string for Agent Session system prompt injection.
   * Keeps token footprint minimal while providing essential context.
   *
   * @returns {string}
   */
  getCoachPromptContext() {
    const p = this.getProfile();
    const highlights = (p.memoryHighlights || []).slice(-5).join("; ");
    const topics = Array.isArray(p.topicsOfInterest) ? p.topicsOfInterest.join(", ") : "General";

    return [
      `Learner Name: ${p.displayName || "Learner"}`,
      `Target CEFR Level: ${p.targetCefr || "B1"}`,
      `Primary Goal: ${p.primaryGoal || "Everyday fluency"}`,
      `Feedback Style: ${p.correctionStyle || "balanced"}`,
      topics ? `Interests: ${topics}` : null,
      highlights ? `Known Preferences: ${highlights}` : null,
      `Instruction: Do NOT repeat onboarding questions. Keep the conversation natural, encouraging, and tailored to level ${p.targetCefr || "B1"}.`,
    ]
      .filter(Boolean)
      .join("\n");
  }
}

