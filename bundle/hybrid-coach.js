/**
 * bundle/hybrid-coach.js
 *
 * Hybrid Coaching Engine for SpeakUp AI (Layer 1 Rules + Layer 2 AI Agent Session).
 * Implements STEP 5 & STEP 6:
 * - Structured turn generation: [Brief Correction] -> [Direct Reaction] -> [Follow-up Prompt]
 * - Guard against identical alternatives (ensures alternative != corrected)
 * - Safe deduplicated Mistake Notebook updates
 * - Spaced repetition review generator
 * - Session summary & wrap-up analytics
 */

import { cleanSentinels } from "./agent-stream.js";

/**
 * Format a coach turn to be spoken concisely in hands-free mode (under ~15 seconds).
 *
 * @param {object} params
 * @param {object|null} params.correction - Correction object { original, corrected, explanation, alternative, isCorrect }
 * @param {string} params.reply - The conversational reaction or answer
 * @param {string} params.followUp - The follow-up question
 * @param {string} params.correctionStyle - "balanced" | "notes_end" | "none" | "strict"
 * @returns {string} spoken prompt
 */
export function formatSpokenTurn({ correction, reply, followUp, correctionStyle = "balanced" }) {
  const parts = [];

  // 1. Spoken correction (only if style is live/balanced/strict and correction is genuine)
  if (correction && !correction.isCorrect && (correctionStyle === "balanced" || correctionStyle === "strict")) {
    if (correction.corrected && correction.corrected !== correction.original) {
      parts.push(`Try saying: "${correction.corrected}".`);
    }
  }

  // 2. Conversational answer / reaction
  if (reply) {
    parts.push(cleanSentinels(reply));
  }

  // 3. Follow-up question
  if (followUp) {
    parts.push(cleanSentinels(followUp));
  }

  return parts.join(" ").trim();
}

/**
 * Validate and clean correction data.
 * Guarantees that alternative is genuinely different from corrected sentence.
 *
 * @param {object|null} rawCorr
 * @param {string} originalUserText
 * @returns {object|null}
 */
export function sanitizeCorrection(rawCorr, originalUserText) {
  if (!rawCorr || typeof rawCorr !== "object") return null;

  const original = String(rawCorr.original || originalUserText || "").trim();
  const corrected = String(rawCorr.corrected || "").trim();
  const explanation = String(rawCorr.explanation || "").trim();
  let alternative = rawCorr.alternative ? String(rawCorr.alternative).trim() : null;

  // If alternative is identical to corrected or empty, drop it
  if (alternative && (alternative.toLowerCase() === corrected.toLowerCase() || alternative.toLowerCase() === original.toLowerCase())) {
    alternative = null;
  }

  const isCorrect = rawCorr.isCorrect === true || (original && corrected && original.toLowerCase() === corrected.toLowerCase());

  return {
    original,
    corrected,
    explanation,
    alternative,
    isCorrect,
    ruleType: rawCorr.ruleType || "Grammar & Phrasing",
  };
}

/**
 * Build end-of-session comprehensive summary.
 *
 * @param {object} sessionData
 * @returns {object}
 */
export function buildSessionSummary({
  elapsedMins = 0,
  turnsCount = 0,
  wordsCount = 0,
  mistakes = [],
  vocabulary = [],
  scenarioTitle = "Everyday Conversation",
  newLearnedFacts = [],
}) {
  const wordsPerMinute = elapsedMins > 0 ? Math.round(wordsCount / elapsedMins) : 0;
  const mistakeRate = turnsCount > 0 ? Math.round((mistakes.length / turnsCount) * 100) : 0;
  const estimatedAccuracy = Math.max(0, 100 - mistakeRate);

  // Top 3 mistakes (deduplicated)
  const topMistakes = mistakes.slice(0, 3);

  // 5 Useful phrases
  const usefulPhrases = (vocabulary.length >= 5 ? vocabulary.slice(0, 5) : [
    "To be quite honest...",
    "Speaking from my own experience...",
    "That makes a lot of sense.",
    "Could you elaborate on that?",
    "On the other hand...",
  ]).map((v) => (typeof v === "string" ? v : v.word || v.example || String(v)));

  // Tomorrow's action tip
  let tipForTomorrow = "Practice speaking aloud for 5 minutes during your morning routine.";
  if (mistakes.length > 3) {
    tipForTomorrow = "Review today's notebook items before tomorrow's session to lock in correct verb tenses.";
  } else if (wordsPerMinute < 70) {
    tipForTomorrow = "Try speaking in longer compound sentences using 'because', 'although', and 'furthermore'.";
  }

  return {
    elapsedMins,
    turnsCount,
    wordsCount,
    wordsPerMinute,
    estimatedAccuracy,
    topMistakes,
    usefulPhrases,
    tipForTomorrow,
    scenarioTitle,
    newLearnedFacts,
  };
}

/**
 * Generate spaced repetition practice challenges for the Mistake Notebook.
 *
 * @param {Array<object>} notebookItems
 * @returns {Array<object>} practice cards
 */
export function generateSpacedRepetitionCards(notebookItems = []) {
  if (!Array.isArray(notebookItems) || notebookItems.length === 0) return [];

  return notebookItems.map((item, idx) => {
    const original = item.original_sentence || item.mistake || "";
    const corrected = item.corrected_sentence || item.correction || "";
    const explanation = item.explanation || "Grammar improvement";

    // Create a fill-in-the-blank challenge by blanking out a changed word
    const origWords = original.split(/\s+/);
    const corrWords = corrected.split(/\s+/);
    let blankedSentence = corrected;
    let targetWord = "";

    for (let i = 0; i < corrWords.length; i++) {
      if (origWords[i] !== corrWords[i]) {
        targetWord = corrWords[i];
        const pattern = new RegExp(`\\b${targetWord}\\b`, "i");
        blankedSentence = corrected.replace(pattern, "_______");
        break;
      }
    }

    return {
      id: item.id || `card-${idx}`,
      original,
      corrected,
      explanation,
      blankedSentence: targetWord ? blankedSentence : `Rewrite correctly: "${original}"`,
      targetWord: targetWord || corrected,
      status: item.status || "practising",
    };
  });
}

