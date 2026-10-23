# SpeakUp AI — Anna App

A personal English conversation coach. Practise real conversations in focused 10-minute sessions, get honest grammar feedback, explore vocabulary, and track your progress.

## What it does

| Feature | Detail |
|---|---|
| Conversation scenarios | Self-Introduction, Job Interview, College Discussion, Everyday Conversation |
| Grammar feedback | Rule-based checks (subject-verb, irregular past tense, double negatives, contractions, articles) — always labelled "rule-based" |
| Vocabulary builder | Tap any green word pill to see its meaning and an example sentence |
| Mistake notebook | Grammar corrections saved to your Anna account via APS KV storage |
| Progress tracking | Sessions, corrections, and words explored — persisted across sessions |
| Session timer | 10-minute countdown visible at all times |
| AI coaching | Uses Anna LLM sampling when your account allows it; falls back to scripted practice mode otherwise |
| Voice input | Browser Web Speech API (Chrome/Edge) — text input always available as fallback |

## Prerequisites

- Node.js 22+
- uv (Python package manager) — https://astral.sh/uv
- Anna CLI: `npm install -g @anna-ai/cli`

## Running locally

```bash
# 1. Install CLI (if not already installed)
npm install -g @anna-ai/cli

# 2. Log in to your Anna account
anna-app login --host https://anna.partners

# 3. In the project directory:
anna-app validate        # should print: ✓ validate passed
anna-app dev             # opens http://localhost:5180/
```

Open `http://localhost:5180/` in your browser.

## Checking environment

```bash
node --version     # should be 22+
uv --version       # any recent version
anna-app --version # should be 0.1.59+
anna-app doctor    # all checks should be green
```

## AI coaching vs practice mode

- **AI coaching (✨)**: available when your Anna account has LLM sampling enabled. The Python plugin calls `sampling/createMessage` on the Anna host — no API key needed.
- **Practice mode (📝)**: scripted responses from the built-in conversation scripts. Clearly labelled in the UI. Grammar checking works identically in both modes.

The UI shows which mode is active on every coach message.

## Storage

Progress and the mistake notebook are stored in Anna Persistent Storage (APS KV), scoped to your account.
If storage is not granted, the app still works — data will not persist between browser sessions.

## Voice input

Voice input uses the browser's built-in Web Speech API. This works in Chrome and Edge.
**Text input is always available** as the primary alternative.

## Project structure

```
Let's Speak/
├── manifest.json              # Anna App manifest (schema 2)
├── app.json                   # Store listing metadata
├── bundle/
│   ├── index.html             # Full single-page app (HTML + CSS)
│   └── app.js                 # App logic (ES module)
└── executas/
    └── speakup-ai/
        ├── speakup_ai_plugin.py   # Python Executa (tools + grammar + LLM)
        └── pyproject.toml
```

## Notes for the Founding Builder Challenge

- No paid API keys or subscriptions are required for the core experience.
- LLM coaching uses Anna's native sampling capability (billed to the user's Anna plan, not a developer secret).
- Grammar checking is fully deterministic and clearly labelled as rule-based in the UI.
- All data stays within the Anna platform — no external data transmission.
