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

```
node --version
uv --version
anna-app --version
anna-app doctor
anna-app whoami
```

---

## 4. Running & Validating Locally

```
anna-app validate --strict

cd executas/speakup-ai
uv run pytest
cd ../..

anna-app dev --port 5180
```

Open `http://localhost:5180/` in Google Chrome or Microsoft Edge.

---

## 5. Release & Publishing Steps

> **Note:** Publishing to Anna and submitting for review are manual steps performed by the developer.

1. **Build Cross-Platform Binaries:**
   Push a version tag (e.g. `v0.3.2`) or trigger the GitHub Actions workflow manually via **Run workflow** (`workflow_dispatch`) in the Actions tab. The workflow builds:
   - `speakup-ai-0.3.2-darwin-arm64.tar.gz`
   - `speakup-ai-0.3.2-darwin-x86_64.tar.gz`
   - `speakup-ai-0.3.2-linux-x86_64.tar.gz` (Critical for Anna Cloud Agents)
   - `speakup-ai-0.3.2-windows-x86_64.zip`
2. **Download Archives:**
   Place the 4 downloaded archives and their corresponding `.sha256` files into:
   ```
   executas/speakup-ai/dist/speakup-ai/0.3.2/
   ```
3. **Switch to Binary Distribution:**
   In `executas/speakup-ai/executa.json`, change `"active": "local"` to `"active": "binary"`.
4. **Verify Strict Validation:**
   ```
   anna-app validate --strict
   ```
5. **Publish to Anna Platform:**
   ```
   anna-app apps publish
   ```
6. **Submit for Review:**
   ```
   anna-app apps submit-review speakup-ai
   ```
   *(Alternatively, submit via the Anna Developer portal at https://anna.partners/developers)*

---

## 6. Known Limitations

1. **Web Speech API Availability:** The browser's native `SpeechRecognition` requires an active connection to Google's speech recognition servers on Chromium (Chrome/Edge). If offline or blocked by container network policy, SpeakUp AI displays a clear diagnostic banner and seamlessly provides the typed response drawer.
2. **Rule-Based Grammar Scope:** The offline grammar engine checks for common non-native speaker patterns (subject-verb agreement, irregular past tense, double negatives, article usage, age expressions, and prepositions). It clearly indicates its rule-based scope and never claims that an unflagged sentence is certified error-free.

3. **Hands-free mode:** The browser listens continuously only while the page, browser permissions, and speech-recognition service allow it. Chrome/Edge may stop recognition after silence or on transient errors; SpeakUp retries with a short backoff and exposes a typed fallback. Bluetooth pairing and the selected microphone/speaker are controlled by the phone or computer; SpeakUp uses the devices selected by the browser. Background tabs, locked phones, iOS Safari, noisy rooms, and headset-button behavior require manual testing on the target device.
4. **Microphone permissions:** The Anna iframe must be served from a secure origin and the host must allow microphone access through its iframe Permissions Policy. If the browser reports a blocked microphone, allow the microphone for the host page or use the typing drawer. The app does not bypass browser permissions.
5. **Privacy:** Audio is handled by the browser's speech-recognition service when voice input is used. SpeakUp does not store raw audio. Transcripts and correction notes are stored only when the user uses the practice flow and saves the resulting session data in the app's storage.
6. **AI versus Basic mode:** Anna Sampling is the default whenever the health check reports it available. If Sampling is unavailable, the UI says `Coach (basic mode)` and the reason is that the AI service was unavailable; deterministic rules continue without a paid key.
