# SpeakUp AI — English Conversation Practice Coach

An intelligent, voice-first English conversation coach built as an Anna App. Practice real-world conversations in focused sessions, receive honest grammar and expression feedback, explore contextual vocabulary, and track your speaking habits with transparent data.

---

## 1. Feature Honesty Table

SpeakUp AI upholds absolute transparency about where AI is used versus deterministic logic:

| Feature | Powered By | Needs Internet? | Needs Browser Speech? | Works when Sampling Denied? |
|---|---|---|---|---|
| **Conversation Coaching** | Anna LLM (via reverse Sampling) or Rules fallback | Yes (for Sampling) / No (for Rules) | No (Text fallback always available) | **Yes** — runs in basic rule-based mode; label shows "Coach (basic mode)" |
| **Grammar & Expression Checks** | Deterministic rule engine + idiom catalog | No | No | **Yes** — runs identically regardless of sampling status |
| **Spoken Audio (Coach TTS)** | Browser `SpeechSynthesis` API | No (Local browser voices) | Yes (for audio output) | **Yes** — visual text displayed at all times |
| **Voice Input** | Browser `Web Speech` API (SpeechRecognition) | Yes (Chromium speech backend) | Yes (Microphone required) | **Yes** — fully functional via typed drawer |
| **Mistake Notebook** | Anna Persistent Storage (APS KV) | No (Platform local) | No | **Yes** — persisted to APS tool partition |
| **Progress Metrics** | Pure mathematical aggregation of stored logs | No | No | **Yes** — 100% computed from real session records |

---

## 2. Key Architecture & Platform Capabilities

- **Bundled Executa Pattern:** The backend plugin resides in `executas/speakup-ai/` and is bundled directly with the Anna App.
- **Dynamic Tool Resolution:** Frontend loads `anna-tool-ids.js` and resolves `window.__ANNA_TOOL_IDS__["speakup-ai"]` with a dev fallback, ensuring seamless transition between local dev and Anna production.
- **Reverse Sampling:** The Python Executa requests completions from Anna's host LLM via standard JSON-RPC 2.0 `sampling/createMessage` over `stdio`. No third-party API keys or external model bills are required.
- **Account-Scoped Persistence:** User mistake notebook items and progress counters are stored in Anna Persistent Storage (APS KV) using `storage/get`, `storage/set`, and `storage/list`.
- **Zero Duplicate Sentences:** Robust sentence deduplication prevents repetitive follow-up prompts across coaching turns.
- **Speech vs. Typed Discrimination:** Punctuation and capitalization artifacts inherent to speech recognition transcripts are never falsely penalized as grammatical mistakes.

---

## 3. Prerequisites & Development Setup

- **Node.js:** 22+
- **Python Package Manager:** `uv` (https://astral.sh/uv)
- **Anna CLI:** `@anna-ai/cli` (`npm install -g @anna-ai/cli`)

### Environment Check

```bash
node --version     # 22+
uv --version       # any modern version
anna-app --version # 0.1.59+
anna-app doctor    # all required checks should pass
anna-app whoami    # verify active login against https://anna.partners
```

---

## 4. Running & Validating Locally

```bash
# 1. Validate App Manifest and schema
anna-app validate --strict

# 2. Run Python Executa unit tests
cd executas/speakup-ai
uv run pytest
cd ../..

# 3. Launch local developer harness
anna-app dev --port 5180
```

Open `http://localhost:5180/` in Google Chrome or Microsoft Edge.

---

## 5. Release & Publishing Steps

> **Note:** Publishing to Anna and submitting for review are manual steps performed by the developer.

1. **Build Cross-Platform Binaries:**
   Push a version tag (e.g., `v0.3.0`) to trigger the GitHub Actions workflow (`.github/workflows/build-binaries.yml`), which builds standalone packages for:
   - `darwin-arm64` (.tar.gz)
   - `darwin-x86_64` (.tar.gz)
   - `linux-x86_64` (.tar.gz) — **Essential for Anna Cloud Agents**
   - `windows-x86_64` (.zip)
2. **Download Archives:** Place the generated archives and `.sha256` checksums into `executas/speakup-ai/dist/speakup-ai/0.3.0/`.
3. **Verify Strict Validation:** Run `anna-app validate --strict`.
4. **Publish to Anna:** Run `anna-app apps publish`.

---

## 6. Known Limitations

1. **Web Speech API Availability:** The browser's native `SpeechRecognition` requires an active connection to Google's speech recognition servers on Chromium (Chrome/Edge). If offline or blocked by container network policy, SpeakUp AI displays a clear diagnostic banner and seamlessly provides the typed response drawer.
2. **Rule-Based Grammar Scope:** The offline grammar engine checks for common non-native speaker patterns (subject-verb agreement, irregular past tense, double negatives, article usage, age expressions, and prepositions). It clearly indicates its rule-based scope and never claims that an unflagged sentence is certified error-free.
