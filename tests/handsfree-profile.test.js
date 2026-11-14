/**
 * tests/handsfree-profile.test.js
 *
 * Unit tests for:
 * 1. Learner Profile & Onboarding (privacy filtering, prompt injection, question flow)
 * 2. Scenarios (catalog integrity, surprise scenario selection)
 * 3. Hands-Free Engine (voice commands parsing, transcript auto-formatter)
 * 4. Hybrid Coach (spoken prompt formatting, alternative sanitization, summary generation, spaced repetition)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StorageAdapter } from "../bundle/storage-migration.js";
import { LearnerProfileManager, ONBOARDING_QUESTIONS } from "../bundle/learner-profile.js";
import { SCENARIO_CATALOG, pickSurpriseScenario } from "../bundle/scenarios.js";
import { parseVoiceCommand, autoFormatTranscript } from "../bundle/hands-free.js";
import {
  formatSpokenTurn,
  sanitizeCorrection,
  buildSessionSummary,
  generateSpacedRepetitionCards,
} from "../bundle/hybrid-coach.js";

describe("Learner Profile & Onboarding (Step 2)", () => {
  it("has 5 to 7 friendly onboarding questions", () => {
    assert.ok(ONBOARDING_QUESTIONS.length >= 5 && ONBOARDING_QUESTIONS.length <= 7);
  });

  it("stores facts safely and blocks sensitive personal data", () => {
    const memory = new StorageAdapter();
    const mgr = new LearnerProfileManager(memory);

    // Safe memory point
    const safeRes = mgr.addMemoryHighlight("Enjoys playing acoustic guitar");
    assert.equal(safeRes, true);

    // Blocked sensitive items (passwords, SSN, bank, credit cards)
    const passRes = mgr.addMemoryHighlight("My password is secret123");
    assert.equal(passRes, false);

    const ssnRes = mgr.addMemoryHighlight("User ssn is 000-11-2222");
    assert.equal(ssnRes, false);

    const cardRes = mgr.addMemoryHighlight("Here is my credit card number");
    assert.equal(cardRes, false);

    const profile = mgr.getProfile();
    assert.equal(profile.memoryHighlights.length, 1);
    assert.equal(profile.memoryHighlights[0], "Enjoys playing acoustic guitar");
  });

  it("produces compact system prompt context without repeating onboarding", () => {
    const memory = new StorageAdapter();
    const mgr = new LearnerProfileManager(memory);
    mgr.saveProfile({
      displayName: "Elena",
      targetCefr: "B2",
      primaryGoal: "Workplace meetings",
      correctionStyle: "balanced",
      topicsOfInterest: ["Technology", "Hiking"],
    });

    const context = mgr.getCoachPromptContext();
    assert.ok(context.includes("Learner Name: Elena"));
    assert.ok(context.includes("Target CEFR Level: B2"));
    assert.ok(context.includes("Do NOT repeat onboarding questions"));
  });
});

describe("Scenarios Catalog (Step 3)", () => {
  it("does not include standalone self-introduction in new scenario catalog", () => {
    const hasIntro = SCENARIO_CATALOG.some((s) => s.key === "introduction");
    assert.equal(hasIntro, false, "Self-introduction must be removed from picker");
  });

  it("includes all required real-life hands-free scenarios", () => {
    const keys = SCENARIO_CATALOG.map((s) => s.key);
    assert.ok(keys.includes("free_talk"));
    assert.ok(keys.includes("job_interview"));
    assert.ok(keys.includes("college_discussion"));
    assert.ok(keys.includes("everyday"));
    assert.ok(keys.includes("customer_service"));
    assert.ok(keys.includes("ordering_food"));
    assert.ok(keys.includes("workplace"));
    assert.ok(keys.includes("phone_call"));
    assert.ok(keys.includes("travel"));
    assert.ok(keys.includes("storytelling"));
    assert.ok(keys.includes("debate"));
    assert.ok(keys.includes("daily_news"));
  });

  it("picks surprise scenario matching learner interests", () => {
    const scenario = pickSurpriseScenario({ topicsOfInterest: ["Travel", "Hotels"] });
    assert.ok(scenario);
    assert.ok(scenario.title);
    assert.ok(scenario.goal);
  });
});

describe("Hands-Free Engine & Voice Commands (Step 4)", () => {
  it("parses all required voice commands accurately", () => {
    const commands = [
      { text: "pause", expected: "pause" },
      { text: "resume", expected: "resume" },
      { text: "say that again", expected: "repeat" },
      { text: "speak slower", expected: "slower" },
      { text: "speak faster", expected: "faster" },
      { text: "correct me", expected: "correct_me" },
      { text: "don't correct me", expected: "dont_correct_me" },
      { text: "give me a topic", expected: "give_topic" },
      { text: "what did I do wrong", expected: "what_did_i_do_wrong" },
      { text: "end session", expected: "end_session" },
    ];

    for (const { text, expected } of commands) {
      const res = parseVoiceCommand(text);
      assert.equal(res.isCommand, true, `Expected "${text}" to be recognized as command`);
      assert.equal(res.commandId, expected);
    }
  });

  it("parses parameterized voice command 'how do you say X'", () => {
    const res = parseVoiceCommand("how do you say breakthrough in French");
    assert.equal(res.isCommand, true);
    assert.equal(res.commandId, "how_do_you_say");
    assert.equal(res.arg, "breakthrough in French");
  });

  it("auto-formats transcript with capitalization and punctuation without penalizing learner", () => {
    assert.equal(autoFormatTranscript("hello world"), "Hello world.");
    assert.equal(autoFormatTranscript("what is the weather like today"), "What is the weather like today?");
    assert.equal(autoFormatTranscript("Can you repeat that"), "Can you repeat that?");
    assert.equal(autoFormatTranscript("Already punctuated!"), "Already punctuated!");
  });
});

describe("Hybrid Coaching & Summary (Step 5 & 6)", () => {
  it("formats spoken turn under 15s with concise correction and reaction", () => {
    const spoken = formatSpokenTurn({
      correction: {
        original: "I go to market yesterday",
        corrected: "I went to the market yesterday",
        isCorrect: false,
      },
      reply: "Markets are great for fresh produce.",
      followUp: "What did you buy there?",
      correctionStyle: "balanced",
    });

    assert.ok(spoken.startsWith('Try saying: "I went to the market yesterday".'));
    assert.ok(spoken.includes("Markets are great for fresh produce."));
    assert.ok(spoken.endsWith("What did you buy there?"));
  });

  it("omits spoken correction when learner chooses 'notes_end' style", () => {
    const spoken = formatSpokenTurn({
      correction: {
        original: "He don't know",
        corrected: "He doesn't know",
        isCorrect: false,
      },
      reply: "Understood.",
      followUp: "What happened next?",
      correctionStyle: "notes_end",
    });

    assert.ok(!spoken.includes("Try saying:"));
    assert.equal(spoken, "Understood. What happened next?");
  });

  it("sanitizes corrections and guarantees alternative is distinct from corrected", () => {
    const corr = sanitizeCorrection(
      {
        original: "I am agree",
        corrected: "I agree",
        alternative: "I agree", // Identical to corrected!
      },
      "I am agree"
    );

    assert.equal(corr.corrected, "I agree");
    assert.equal(corr.alternative, null, "Identical alternative must be dropped");
  });

  it("generates comprehensive end-of-session summary", () => {
    const summary = buildSessionSummary({
      elapsedMins: 10,
      turnsCount: 12,
      wordsCount: 450,
      mistakes: [{ mistake: "He don't", correction: "He doesn't" }],
      vocabulary: ["elaborate", "persuasive"],
      scenarioTitle: "Job Interview",
    });

    assert.equal(summary.elapsedMins, 10);
    assert.equal(summary.turnsCount, 12);
    assert.equal(summary.wordsPerMinute, 45);
    assert.ok(summary.estimatedAccuracy > 80);
    assert.equal(summary.topMistakes.length, 1);
    assert.ok(summary.usefulPhrases.length >= 2);
    assert.ok(summary.tipForTomorrow);
  });

  it("generates spaced repetition challenge cards from notebook entries", () => {
    const cards = generateSpacedRepetitionCards([
      {
        id: "note_1",
        original_sentence: "Yesterday I go there",
        corrected_sentence: "Yesterday I went there",
        explanation: "Use past tense 'went'",
      },
    ]);

    assert.equal(cards.length, 1);
    assert.ok(cards[0].blankedSentence.includes("_______"));
    assert.equal(cards[0].targetWord, "went");
  });
});

