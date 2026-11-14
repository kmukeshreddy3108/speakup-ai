/**
 * bundle/scenarios.js
 *
 * Rich conversational scenarios, tone selectors, and difficulty adapters for SpeakUp AI.
 * Implements STEP 3 requirements:
 * - Standalone "Self-Introduction" removed from picker (covered by onboarding).
 * - Real-life hands-free and screen scenarios.
 * - Goal tracking, key phrases, and completion checks.
 * - "Surprise Me" tailored to profile interests.
 */

export const SCENARIO_CATALOG = [
  {
    key: "free_talk",
    title: "Free Talk (My Day)",
    icon: "☕",
    description: "Casual, open-ended talk about your day, feelings, and thoughts.",
    goal: "Share at least 3 things that happened today or that you have planned.",
    keyPhrases: [
      "To be honest...",
      "Earlier today I was thinking about...",
      "What made my day was...",
      "On top of that...",
    ],
    tags: ["Daily Life", "Casual", "Feelings"],
  },
  {
    key: "everyday",
    title: "Everyday Conversation",
    icon: "💬",
    description: "Natural everyday banter about weather, weekend plans, and hobbies.",
    goal: "Have an easy-going 5-minute conversation with natural transitions.",
    keyPhrases: [
      "How have you been lately?",
      "Speaking of which...",
      "Do you have any plans for...",
      "That reminds me of...",
    ],
    tags: ["Daily Life", "Hobbies", "General"],
  },
  {
    key: "workplace",
    title: "Workplace & Meetings",
    icon: "📊",
    description: "Stand-ups, project updates, and professional workplace discussions.",
    goal: "Give a crisp status update and negotiate a timeline or task ownership.",
    keyPhrases: [
      "From my perspective...",
      "Let's circle back to...",
      "The main bottleneck right now is...",
      "I propose we move forward with...",
    ],
    tags: ["Workplace", "Career", "Professional"],
  },
  {
    key: "job_interview",
    title: "Job Interview",
    icon: "💼",
    description: "Practice answering behavioral and situational interview questions.",
    goal: "Deliver a structured answer using the STAR method (Situation, Task, Action, Result).",
    keyPhrases: [
      "In my previous role at...",
      "The challenge we faced was...",
      "I took the initiative to...",
      "The measurable outcome was...",
    ],
    tags: ["Career", "Interviews", "Professional"],
  },
  {
    key: "ordering_food",
    title: "Ordering Food & Shopping",
    icon: "🍔",
    description: "Order meals, ask about ingredients, customize dishes, and pay bills.",
    goal: "Politely order a meal, modify an item, and inquire about dietary preferences.",
    keyPhrases: [
      "Could I get that without...",
      "What do you recommend for...",
      "Does this contain any nuts or dairy?",
      "Could we have the check, please?",
    ],
    tags: ["Food", "Travel", "Daily Life"],
  },
  {
    key: "customer_service",
    title: "Customer Service Call",
    icon: "🎧",
    description: "Politely explain a billing or delivery issue and get it resolved.",
    goal: "Clearly explain the discrepancy, ask for a refund or replacement, and remain polite.",
    keyPhrases: [
      "I am calling regarding an order placed on...",
      "I noticed an unexpected charge on my receipt.",
      "Could you help me track down the status?",
      "I appreciate your assistance with this.",
    ],
    tags: ["Problem Solving", "Phone", "Everyday"],
  },
  {
    key: "phone_call",
    title: "Phone Call Practice",
    icon: "📱",
    description: "Practice phone conversations without visual cues or lip reading.",
    goal: "Conduct a clear phone conversation, confirm spelling, and summarize next steps.",
    keyPhrases: [
      "Could you repeat that last part?",
      "Let me make sure I wrote that down correctly.",
      "Thanks for calling back so promptly.",
      "I'll follow up with an email shortly.",
    ],
    tags: ["Phone", "Listening", "Workplace"],
  },
  {
    key: "travel",
    title: "Travel & Airport",
    icon: "✈️",
    description: "Navigate flight check-in, border control, asking directions, and hotel check-in.",
    goal: "Successfully ask for gate directions, check in at a hotel, and request a room adjustment.",
    keyPhrases: [
      "Excuse me, which way is baggage claim?",
      "I have a reservation under the name...",
      "Is breakfast included with the room?",
      "Could you recommend a quiet local cafe?",
    ],
    tags: ["Travel", "Hospitality", "Directions"],
  },
  {
    key: "college_discussion",
    title: "College & Academic Discussion",
    icon: "🎓",
    description: "Engage in academic seminars, debate theories, and present project ideas.",
    goal: "Articulate a thesis, cite an example, and respond respectfully to a critique.",
    keyPhrases: [
      "Building on what was just mentioned...",
      "The underlying premise suggests that...",
      "While that is a valid point, evidence shows...",
      "To substantiate this argument...",
    ],
    tags: ["Academic", "College", "Debate"],
  },
  {
    key: "storytelling",
    title: "Storytelling & Banter",
    icon: "🎭",
    description: "Tell an entertaining personal story, tell a joke, and share anecdotes.",
    goal: "Hook the listener with an engaging story arc (setup, twist, and punchline/lesson).",
    keyPhrases: [
      "You won't believe what happened the other day...",
      "So out of nowhere...",
      "Long story short...",
      "The funniest part about it was...",
    ],
    tags: ["Casual", "Humor", "Social"],
  },
  {
    key: "debate",
    title: "Debate an Opinion",
    icon: "⚖️",
    description: "Take a stand on a controversial or thought-provoking topic with logical arguments.",
    goal: "Defend your position with at least two strong reasons and acknowledge the counterargument.",
    keyPhrases: [
      "On the other hand, consider...",
      "It is important to weigh the pros and cons.",
      "The fundamental question boils down to...",
      "I respectfully disagree because...",
    ],
    tags: ["Critical Thinking", "Debate", "Advanced"],
  },
  {
    key: "daily_news",
    title: "Daily News Chat",
    icon: "📰",
    description: "Discuss a news article, tech breakthrough, or cultural event that you recently read.",
    goal: "Summarize a news story in your own words and explain how it impacts people.",
    keyPhrases: [
      "I came across an article about...",
      "Apparently, the main cause was...",
      "What surprised me most was...",
      "It makes you think about how...",
    ],
    tags: ["Current Events", "Tech", "Culture"],
  },
];

export const TONE_OPTIONS = [
  {
    id: "friendly",
    name: "Friendly & Encouraging",
    promptModifier: "Adopt a warm, encouraging, and enthusiastic tone. Use casual conversational contractions and friendly praise.",
  },
  {
    id: "formal",
    name: "Professional & Polished",
    promptModifier: "Adopt a polished, polite, and professional tone suitable for a modern business workplace.",
  },
  {
    id: "strict_interviewer",
    name: "Strict Interviewer",
    promptModifier: "Adopt a direct, sharp, and inquisitive tone. Challenge vague statements and ask for concrete examples.",
  },
];

export const DIFFICULTY_OPTIONS = [
  {
    id: "beginner",
    name: "Beginner (A1-A2)",
    promptModifier: "Keep speech simple, speak in shorter sentences, use high-frequency everyday vocabulary, and avoid complex idioms.",
  },
  {
    id: "intermediate",
    name: "Intermediate (B1-B2)",
    promptModifier: "Use natural conversational English, common phrasal verbs, idioms, and standard native pace.",
  },
  {
    id: "advanced",
    name: "Advanced (C1)",
    promptModifier: "Use rich vocabulary, nuanced phrasing, complex sentence structures, and challenge the learner with thought-provoking questions.",
  },
];

/**
 * Pick a scenario that matches the learner's profile interests ("Surprise Me").
 * @param {object} profile
 * @returns {object} scenario
 */
export function pickSurpriseScenario(profile = {}) {
  const interests = Array.isArray(profile.topicsOfInterest) ? profile.topicsOfInterest : [];
  if (interests.length > 0) {
    const matched = SCENARIO_CATALOG.filter((s) =>
      s.tags.some((t) => interests.some((userTag) => userTag.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(userTag.toLowerCase())))
    );
    if (matched.length > 0) {
      const idx = Math.floor(Math.random() * matched.length);
      return matched[idx];
    }
  }

  // Random pick among popular everyday scenarios
  const idx = Math.floor(Math.random() * SCENARIO_CATALOG.length);
  return SCENARIO_CATALOG[idx];
}

