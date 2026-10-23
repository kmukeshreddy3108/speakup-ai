"""
SpeakUp AI — Anna App Executa plugin.

Provides conversation coaching, grammar checking, vocabulary hints,
mistake notebook, and progress tracking.

LLM sampling (Anna platform) is used when available.
If the host does not grant sampling, the plugin falls back to
scripted conversation scripts and clearly marks every response
as practice-mode (is_scripted: True).

APS KV storage is used for the mistake notebook and progress.
If storage is not granted, data is returned but not persisted.
"""

import json
import re
import sys
import uuid
import queue
import threading
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Protocol constants
# ---------------------------------------------------------------------------
TOOL_ID = "tool-dev-speakup-ai"
PROTOCOL_VERSION = "2.0"

# ---------------------------------------------------------------------------
# Conversation scenario scripts
# Each scenario has a list of coach turns. The first entry is the opening
# prompt; subsequent entries are follow-up questions keyed by turn number.
# ---------------------------------------------------------------------------
SCENARIOS = {
    "introduction": {
        "title": "Self-Introduction",
        "icon": "👋",
        "description": "Practice introducing yourself clearly and confidently",
        "turns": [
            # turn 0 — opening
            {
                "prompt": "Hello! Let's practice introducing yourself. Please tell me your name, where you are from, and what you do or study.",
                "hint": "Try: 'My name is … I am from … and I am a student / I work as …'",
                "vocab": [
                    {"word": "originally", "meaning": "used to say where someone is really from", "example": "I am originally from Chennai."},
                    {"word": "currently", "meaning": "at the present time", "example": "I am currently studying computer science."},
                    {"word": "pursue", "meaning": "to follow or work towards something", "example": "I want to pursue a career in engineering."},
                ],
            },
            # turn 1
            {
                "prompt": "Great start! Now tell me about one of your hobbies or interests. Why do you enjoy it?",
                "hint": "Try: 'One of my hobbies is … I enjoy it because …'",
                "vocab": [
                    {"word": "passionate about", "meaning": "very interested in something", "example": "I am passionate about photography."},
                    {"word": "spare time", "meaning": "free time when you are not working", "example": "In my spare time I enjoy reading."},
                ],
            },
            # turn 2
            {
                "prompt": "Interesting! What are your goals for the next one or two years? What are you hoping to achieve?",
                "hint": "Try: 'In the next year, I am planning to … My goal is to …'",
                "vocab": [
                    {"word": "aspire", "meaning": "to want to achieve something important", "example": "I aspire to become a software developer."},
                    {"word": "milestone", "meaning": "an important achievement or event", "example": "Finishing my degree is a big milestone."},
                ],
            },
            # turn 3
            {
                "prompt": "Well done! Finally, why are you practising English, and what situation do you most want to feel confident in?",
                "hint": "Try: 'I am practising English because … I want to feel more confident when …'",
                "vocab": [
                    {"word": "fluency", "meaning": "the ability to speak smoothly and naturally", "example": "I want to improve my fluency in English."},
                    {"word": "confidence", "meaning": "belief in your own ability", "example": "I am building my confidence in conversations."},
                ],
            },
            # turn 4 — wrap-up
            {
                "prompt": "Excellent practice! You have introduced yourself, talked about your interests and goals, and reflected on your English journey. That is a complete self-introduction.",
                "hint": "",
                "vocab": [],
            },
        ],
    },

    "job_interview": {
        "title": "Job Interview",
        "icon": "💼",
        "description": "Practice answering common interview questions",
        "turns": [
            {
                "prompt": "Welcome to your mock job interview! Let's start with a classic question: 'Tell me about yourself and why you are applying for this position.'",
                "hint": "Structure your answer: Background → Skills → Why this role.",
                "vocab": [
                    {"word": "relevant experience", "meaning": "experience that relates to the job", "example": "I have relevant experience in data analysis."},
                    {"word": "contribute", "meaning": "to give something useful", "example": "I can contribute my problem-solving skills to the team."},
                    {"word": "motivated", "meaning": "having a strong desire to succeed", "example": "I am highly motivated to grow in this role."},
                ],
            },
            {
                "prompt": "Good answer! Next question: 'What is your greatest strength, and can you give me a specific example of when you used it?'",
                "hint": "Use the STAR method: Situation → Task → Action → Result.",
                "vocab": [
                    {"word": "strength", "meaning": "a quality that gives you an advantage", "example": "My greatest strength is attention to detail."},
                    {"word": "initiative", "meaning": "the ability to take action without being told", "example": "I took the initiative to improve the process."},
                ],
            },
            {
                "prompt": "Well explained! Now: 'Describe a challenge you faced and how you overcame it.'",
                "hint": "Be honest. Describe the challenge, your action, and a positive outcome.",
                "vocab": [
                    {"word": "obstacle", "meaning": "something that makes progress difficult", "example": "I faced an obstacle when the deadline was moved forward."},
                    {"word": "resilient", "meaning": "able to recover from difficulty", "example": "I stayed resilient and found a solution."},
                    {"word": "adapt", "meaning": "to change to fit new conditions", "example": "I had to quickly adapt my approach."},
                ],
            },
            {
                "prompt": "Impressive! Almost done. Final question: 'Where do you see yourself in five years?'",
                "hint": "Show ambition but stay realistic. Mention growth in the role.",
                "vocab": [
                    {"word": "long-term goal", "meaning": "something you want to achieve over many years", "example": "My long-term goal is to lead a product team."},
                    {"word": "expertise", "meaning": "a high level of knowledge or skill", "example": "I want to develop expertise in machine learning."},
                ],
            },
            {
                "prompt": "Fantastic interview practice! You handled all four questions confidently. Remember to always prepare specific examples and use clear, professional language.",
                "hint": "",
                "vocab": [],
            },
        ],
    },

    "college_discussion": {
        "title": "College Discussion",
        "icon": "🎓",
        "description": "Practise academic conversations and class participation",
        "turns": [
            {
                "prompt": "Welcome to a class discussion! Today's topic is: 'Should technology replace traditional classroom teaching?' What is your opinion, and why?",
                "hint": "Give your opinion → give one reason → give an example.",
                "vocab": [
                    {"word": "in my opinion", "meaning": "phrase to share your personal view", "example": "In my opinion, technology should support, not replace, teachers."},
                    {"word": "facilitate", "meaning": "to make something easier", "example": "Technology can facilitate learning in remote areas."},
                    {"word": "interactive", "meaning": "allowing two-way communication", "example": "Online tools make lessons more interactive."},
                ],
            },
            {
                "prompt": "Good point! A classmate disagrees and says: 'Classroom teaching builds social skills that technology cannot replace.' How do you respond to that?",
                "hint": "Acknowledge their point, then explain your position: 'That is a valid point, however …'",
                "vocab": [
                    {"word": "acknowledge", "meaning": "to recognise or accept something", "example": "I acknowledge that face-to-face learning is valuable."},
                    {"word": "counterargument", "meaning": "a reason against someone's point", "example": "My counterargument is that hybrid learning works best."},
                    {"word": "complement", "meaning": "to go well with something else", "example": "Technology can complement classroom teaching."},
                ],
            },
            {
                "prompt": "Great debate! Now your professor asks: 'Can you give a real-world example to support your position?'",
                "hint": "Choose a specific example you know, such as COVID online learning, Khan Academy, or coding bootcamps.",
                "vocab": [
                    {"word": "evidence", "meaning": "facts that prove something is true", "example": "The evidence shows that blended learning improves outcomes."},
                    {"word": "demonstrate", "meaning": "to show something clearly", "example": "Studies demonstrate that self-paced learning is effective."},
                ],
            },
            {
                "prompt": "Excellent! Final question from the professor: 'How do you think education will look in ten years?' Summarise your overall view.",
                "hint": "Use phrases like: 'I believe … will …', 'In the future … might …'",
                "vocab": [
                    {"word": "predict", "meaning": "to say what you think will happen", "example": "I predict that AI tutors will be common."},
                    {"word": "hybrid", "meaning": "combining two different things", "example": "Hybrid classrooms mix online and in-person learning."},
                ],
            },
            {
                "prompt": "Outstanding contribution to the discussion! You shared your opinion clearly, responded to a counterargument, used evidence, and made a prediction. These are key academic discussion skills.",
                "hint": "",
                "vocab": [],
            },
        ],
    },

    "everyday": {
        "title": "Everyday Conversation",
        "icon": "☕",
        "description": "Practise casual English for daily situations",
        "turns": [
            {
                "prompt": "Let's practise a casual conversation. Imagine you are meeting a new neighbour for the first time. Greet them and introduce yourself!",
                "hint": "Try: 'Hi, I just moved in next door. My name is …. It is nice to meet you!'",
                "vocab": [
                    {"word": "small talk", "meaning": "friendly conversation about everyday topics", "example": "We made small talk about the weather."},
                    {"word": "get to know", "meaning": "to learn about someone through conversation", "example": "I would love to get to know my neighbours."},
                ],
            },
            {
                "prompt": "Friendly greeting! Your neighbour says: 'So, what do you do for work or studies?' Tell them a bit about your daily life.",
                "hint": "Keep it casual and friendly. Ask a question back at the end.",
                "vocab": [
                    {"word": "commute", "meaning": "the journey to and from work or school", "example": "My commute takes about 30 minutes."},
                    {"word": "routine", "meaning": "a regular set of activities", "example": "I have a morning routine that helps me stay focused."},
                ],
            },
            {
                "prompt": "Your neighbour says: 'I am planning a small gathering this weekend. Would you like to come?' How do you respond?",
                "hint": "Accept politely or politely decline. Either way, show appreciation.",
                "vocab": [
                    {"word": "appreciate", "meaning": "to be grateful for something", "example": "I appreciate the invitation very much."},
                    {"word": "look forward to", "meaning": "to feel excited about something in the future", "example": "I look forward to meeting everyone."},
                ],
            },
            {
                "prompt": "Great social skills! Now your neighbour mentions the weather has been unusual. Make a comment about the weather and transition to a different topic naturally.",
                "hint": "Weather is a classic small-talk topic. Try moving to: food, the area, or weekend plans.",
                "vocab": [
                    {"word": "by the way", "meaning": "phrase to change the topic", "example": "By the way, have you tried the café on the corner?"},
                    {"word": "speaking of which", "meaning": "phrase to connect to a related topic", "example": "Speaking of which, do you know any good local restaurants?"},
                ],
            },
            {
                "prompt": "Wonderful conversation! You greeted a new person, talked about your life, accepted an invitation, and moved between topics naturally. That is real conversational fluency in action.",
                "hint": "",
                "vocab": [],
            },
        ],
    },
}

# ---------------------------------------------------------------------------
# Grammar rules — honest, labelled rule-based checks
# ---------------------------------------------------------------------------
GRAMMAR_RULES = [
    {
        "name": "Subject-verb mismatch",
        "patterns": [
            r"\bhe don'?t\b", r"\bshe don'?t\b", r"\bit don'?t\b",
            r"\bhe have\b", r"\bshe have\b", r"\bit have\b",
            r"\bthey was\b", r"\bwe was\b", r"\byou was\b",
            r"\bi is\b", r"\bi are\b",
            r"\bhe do\b", r"\bshe do\b", r"\bit do\b",
        ],
        "suggestions": {
            r"\bhe don'?t\b": "he doesn't",
            r"\bshe don'?t\b": "she doesn't",
            r"\bit don'?t\b": "it doesn't",
            r"\bhe have\b": "he has",
            r"\bshe have\b": "she has",
            r"\bit have\b": "it has",
            r"\bthey was\b": "they were",
            r"\bwe was\b": "we were",
            r"\byou was\b": "you were",
            r"\bi is\b": "I am",
            r"\bi are\b": "I am",
            r"\bhe do\b": "he does",
            r"\bshe do\b": "she does",
            r"\bit do\b": "it does",
        },
    },
    {
        "name": "Irregular past tense",
        "patterns": [
            r"\bgoed\b", r"\bgoed\b", r"\bcomed\b", r"\bcommed\b",
            r"\btaked\b", r"\bmaked\b", r"\bgived\b",
            r"\bsayed\b", r"\bknowed\b", r"\bwanted to went\b",
            r"\bbuyed\b", r"\bbrought to buy\b", r"\bdrived\b",
            r"\bteached\b", r"\bcatched\b", r"\bbreaked\b",
            r"\bfalled\b", r"\bfeeled\b", r"\bthought to\b",
            r"\bshooted\b", r"\bputted\b",
        ],
        "suggestions": {
            r"\bgoed\b": "went",
            r"\bcomed\b": "came",
            r"\bcommed\b": "came",
            r"\btaked\b": "took",
            r"\bmaked\b": "made",
            r"\bgived\b": "gave",
            r"\bsayed\b": "said",
            r"\bknowed\b": "knew",
            r"\bbuyed\b": "bought",
            r"\bdrived\b": "drove",
            r"\bteached\b": "taught",
            r"\bcatched\b": "caught",
            r"\bbreaked\b": "broke",
            r"\bfalled\b": "fell",
            r"\bfeeled\b": "felt",
            r"\bshooted\b": "shot",
            r"\bputted\b": "put",
        },
    },
    {
        "name": "Double negative",
        "patterns": [
            r"\bdon'?t\s+\w+\s+nothing\b",
            r"\bcan'?t\s+\w+\s+nothing\b",
            r"\bdidn'?t\s+\w+\s+nothing\b",
            r"\bwon'?t\s+\w+\s+nothing\b",
            r"\bdon'?t\s+\w+\s+nobody\b",
            r"\bcan'?t\s+\w+\s+nobody\b",
            r"\bnot\s+\w+\s+neither\b",
            r"\bnever\s+\w+\s+nothing\b",
        ],
        "suggestion_template": "Use only one negative word. E.g. 'I don't know anything' or 'I know nothing'.",
    },
    {
        "name": "Missing apostrophe in contraction",
        "patterns": [
            r"\bdont\b", r"\bcant\b", r"\bwont\b", r"\bisnt\b",
            r"\barent\b", r"\bwasnt\b", r"\bwerent\b",
            r"\bhasnt\b", r"\bhavent\b", r"\bhadnt\b",
            r"\bdidnt\b", r"\bdoesnt\b", r"\bshouldnt\b",
            r"\bwouldnt\b", r"\bcouldnt\b", r"\bwont\b",
        ],
        "suggestions": {
            r"\bdont\b": "don't",
            r"\bcant\b": "can't",
            r"\bwont\b": "won't",
            r"\bisnt\b": "isn't",
            r"\barent\b": "aren't",
            r"\bwasnt\b": "wasn't",
            r"\bwerent\b": "weren't",
            r"\bhasnt\b": "hasn't",
            r"\bhavent\b": "haven't",
            r"\bhadnt\b": "hadn't",
            r"\bdidnt\b": "didn't",
            r"\bdoesnt\b": "doesn't",
            r"\bshouldnt\b": "shouldn't",
            r"\bwouldnt\b": "wouldn't",
            r"\bcouldnt\b": "couldn't",
        },
    },
    {
        "name": "Article usage",
        "patterns": [
            r"\bi am\s+(engineer|doctor|student|teacher|developer|manager|designer|writer|nurse|lawyer|pilot|chef|accountant)\b",
            r"\bhe is\s+(engineer|doctor|student|teacher|developer|manager|designer|writer|nurse|lawyer|pilot|chef|accountant)\b",
            r"\bshe is\s+(engineer|doctor|student|teacher|developer|manager|designer|writer|nurse|lawyer|pilot|chef|accountant)\b",
        ],
        "suggestion_template": "Use an article before a job title: 'I am AN engineer' or 'I am A student'.",
    },
    {
        "name": "Informal 'gonna / wanna / gotta'",
        "patterns": [r"\bgonna\b", r"\bwanna\b", r"\bgotta\b", r"\bkinda\b", r"\bsorta\b"],
        "suggestions": {
            r"\bgonna\b": "going to",
            r"\bwanna\b": "want to",
            r"\bgotta\b": "have to / got to",
            r"\bkinda\b": "kind of",
            r"\bsorta\b": "sort of",
        },
    },
]


def check_grammar(text: str) -> list[dict]:
    """Run all grammar rules against the user text. Returns a list of findings."""
    findings = []
    lower = text.lower()
    seen_rules = set()

    for rule in GRAMMAR_RULES:
        for pattern in rule["patterns"]:
            match = re.search(pattern, lower)
            if match and rule["name"] not in seen_rules:
                seen_rules.add(rule["name"])
                fragment = match.group(0)

                # Derive suggestion
                if "suggestions" in rule and pattern in rule.get("suggestions", {}):
                    suggestion = rule["suggestions"][pattern]
                elif "suggestion_template" in rule:
                    suggestion = rule["suggestion_template"]
                else:
                    suggestion = "(see rule description)"

                findings.append({
                    "rule": rule["name"],
                    "fragment": fragment,
                    "suggestion": suggestion,
                    "label": "Grammar note (rule-based)",
                })
                break  # one finding per rule per check

    return findings


# ---------------------------------------------------------------------------
# Sampling reverse RPC helpers
# ---------------------------------------------------------------------------
_host_responses: dict[str, queue.Queue] = {}
_agent_requests: queue.Queue = queue.Queue()
_sampling_available = True   # optimistic; set False on first SAMPLING_NOT_NEGOTIATED


def _reader():
    """Read stdin in a background thread; route to the right queue."""
    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            msg = json.loads(raw_line)
        except json.JSONDecodeError:
            continue
        if "method" in msg:
            _agent_requests.put(msg)
        else:
            rid = msg.get("id")
            if rid and rid in _host_responses:
                _host_responses[rid].put(msg)


def send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def sampling_call(invoke_id: str, messages: list[dict], max_tokens: int = 600, system: str = "") -> tuple[str, bool]:
    """
    Send a sampling/createMessage reverse RPC.
    Returns (response_text, success).
    Sets _sampling_available = False on protocol-level failures.
    """
    global _sampling_available
    if not _sampling_available:
        return "", False

    rid = str(uuid.uuid4())
    q: queue.Queue = queue.Queue()
    _host_responses[rid] = q

    params: dict = {
        "messages": messages,
        "maxTokens": max_tokens,
        "includeContext": "none",
        "metadata": {"executa_invoke_id": invoke_id},
    }
    if system:
        params["systemPrompt"] = system

    send({
        "jsonrpc": "2.0",
        "id": rid,
        "method": "sampling/createMessage",
        "params": params,
    })

    try:
        resp = q.get(timeout=30)
    except queue.Empty:
        _host_responses.pop(rid, None)
        return "", False
    finally:
        _host_responses.pop(rid, None)

    if "error" in resp:
        code = resp["error"].get("code", 0)
        if code in (-32008, -32001):  # NOT_NEGOTIATED or NOT_GRANTED
            _sampling_available = False
        return "", False

    return resp["result"]["content"]["text"], True


# ---------------------------------------------------------------------------
# APS storage helpers
# ---------------------------------------------------------------------------
def aps_set(invoke_id: str, key: str, value: object, context: dict) -> bool:
    """Write a KV value. Returns True on success."""
    storage_token = context.get("storage_token")
    if not storage_token:
        return False
    rid = str(uuid.uuid4())
    q: queue.Queue = queue.Queue()
    _host_responses[rid] = q
    send({
        "jsonrpc": "2.0",
        "id": rid,
        "method": "storage/set",
        "params": {"scope": "tool", "key": key, "value": value},
    })
    try:
        resp = q.get(timeout=10)
        return "result" in resp
    except queue.Empty:
        return False
    finally:
        _host_responses.pop(rid, None)


def aps_get(invoke_id: str, key: str, context: dict) -> tuple[object, bool]:
    """Read a KV value. Returns (value, found)."""
    storage_token = context.get("storage_token")
    if not storage_token:
        return None, False
    rid = str(uuid.uuid4())
    q: queue.Queue = queue.Queue()
    _host_responses[rid] = q
    send({
        "jsonrpc": "2.0",
        "id": rid,
        "method": "storage/get",
        "params": {"scope": "tool", "key": key},
    })
    try:
        resp = q.get(timeout=10)
        if "result" in resp:
            r = resp["result"]
            return r.get("value"), r.get("exists", False)
        return None, False
    except queue.Empty:
        return None, False
    finally:
        _host_responses.pop(rid, None)


def aps_list(invoke_id: str, prefix: str, context: dict, limit: int = 50) -> list[dict]:
    """List KV keys by prefix. Returns list of {key, value} items."""
    storage_token = context.get("storage_token")
    if not storage_token:
        return []
    rid = str(uuid.uuid4())
    q: queue.Queue = queue.Queue()
    _host_responses[rid] = q
    send({
        "jsonrpc": "2.0",
        "id": rid,
        "method": "storage/list",
        "params": {"scope": "tool", "prefix": prefix, "limit": limit},
    })
    try:
        resp = q.get(timeout=10)
        if "result" in resp:
            return resp["result"].get("items", [])
        return []
    except queue.Empty:
        return []
    finally:
        _host_responses.pop(rid, None)


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def tool_ping(_args: dict, _ctx: dict, _invoke_id: str) -> dict:
    return {"success": True, "data": {"pong": True}}


def tool_start_session(args: dict, ctx: dict, invoke_id: str) -> dict:
    scenario_key = args.get("scenario", "introduction")
    scenario = SCENARIOS.get(scenario_key, SCENARIOS["introduction"])
    session_id = str(uuid.uuid4())
    first_turn = scenario["turns"][0]

    return {
        "success": True,
        "data": {
            "session_id": session_id,
            "scenario_key": scenario_key,
            "scenario_title": scenario["title"],
            "total_turns": len(scenario["turns"]) - 1,  # last is closing
            "opening_prompt": first_turn["prompt"],
            "hint": first_turn["hint"],
            "vocabulary": first_turn["vocab"],
            "is_scripted": True,
        },
    }


def tool_coach_turn(args: dict, ctx: dict, invoke_id: str) -> dict:
    user_input = args.get("user_input", "").strip()
    scenario_key = args.get("scenario_key", "introduction")
    turn_number = int(args.get("turn_number", 1))
    session_id = args.get("session_id", "unknown")

    if not user_input:
        return {
            "success": False,
            "error": "Please type your answer before submitting.",
        }

    scenario = SCENARIOS.get(scenario_key, SCENARIOS["introduction"])
    turns = scenario["turns"]

    # Grammar check (always run, regardless of LLM availability)
    grammar_notes = check_grammar(user_input)

    # Save grammar mistakes to APS notebook
    if grammar_notes and ctx.get("storage_token"):
        entry = {
            "session_id": session_id,
            "scenario": scenario["title"],
            "turn": turn_number,
            "original": user_input,
            "corrections": grammar_notes,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        note_key = f"notebook/{session_id}/{turn_number}"
        aps_set(invoke_id, note_key, entry, ctx)

    # Determine next turn index (after user responds to turn_number prompt)
    next_turn_idx = min(turn_number + 1, len(turns) - 1)
    is_last = next_turn_idx == len(turns) - 1

    next_turn = turns[next_turn_idx]

    # Try LLM sampling for a personalised coaching response
    coach_reply = ""
    is_scripted = True

    if _sampling_available:
        scenario_title = scenario["title"]
        system_prompt = (
            f"You are a warm, encouraging English conversation coach. "
            f"The student is practising a '{scenario_title}' conversation. "
            f"They just said: \"{user_input}\". "
            f"In 2-3 sentences: briefly acknowledge what they said, give ONE specific tip to improve their English, "
            f"then naturally ask the following follow-up question: \"{next_turn['prompt']}\" "
            f"Do NOT use bullet points. Keep the tone friendly and simple."
        )
        messages = [{"role": "user", "content": {"type": "text", "text": user_input}}]
        reply_text, ok = sampling_call(invoke_id, messages, max_tokens=200, system=system_prompt)
        if ok and reply_text:
            coach_reply = reply_text
            is_scripted = False

    # Scripted fallback
    if is_scripted:
        # Build a simple acknowledgement + scripted next prompt
        ack_phrases = [
            "Good effort! ",
            "Well done! ",
            "Nice try! ",
            "That is a good response! ",
            "Keep it up! ",
        ]
        ack = ack_phrases[turn_number % len(ack_phrases)]
        coach_reply = ack + next_turn["prompt"]

    return {
        "success": True,
        "data": {
            "coach_reply": coach_reply,
            "next_prompt": next_turn["prompt"],
            "hint": next_turn["hint"],
            "vocabulary": next_turn["vocab"],
            "grammar_notes": grammar_notes,
            "is_scripted": is_scripted,
            "is_last_turn": is_last,
            "next_turn_number": next_turn_idx,
        },
    }


def tool_get_notebook(args: dict, ctx: dict, invoke_id: str) -> dict:
    limit = int(args.get("limit", 20))
    items = aps_list(invoke_id, "notebook/", ctx, limit=100)

    # items from APS list are {key, value} dicts; extract the value payloads
    entries = []
    for item in items:
        v = item.get("value")
        if v and isinstance(v, dict):
            entries.append(v)

    # Sort by timestamp descending, take limit
    entries.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    entries = entries[:limit]

    # Also pull progress
    progress, _ = aps_get(invoke_id, "progress/summary", ctx)
    if not progress:
        progress = {"sessions_completed": 0, "mistakes_corrected": 0, "streak_days": 0}

    return {
        "success": True,
        "data": {
            "entries": entries,
            "total_stored": len(entries),
            "progress": progress,
            "storage_available": bool(ctx.get("storage_token")),
        },
    }


def tool_save_progress(args: dict, ctx: dict, invoke_id: str) -> dict:
    sessions = int(args.get("sessions_completed", 1))
    mistakes = int(args.get("mistakes_corrected", 0))
    vocab_saved = int(args.get("vocab_saved", 0))

    # Load existing, increment
    existing, found = aps_get(invoke_id, "progress/summary", ctx)
    if not found or not isinstance(existing, dict):
        existing = {"sessions_completed": 0, "mistakes_corrected": 0, "vocab_saved": 0,
                    "streak_days": 0, "last_session": None}

    existing["sessions_completed"] = existing.get("sessions_completed", 0) + sessions
    existing["mistakes_corrected"] = existing.get("mistakes_corrected", 0) + mistakes
    existing["vocab_saved"] = existing.get("vocab_saved", 0) + vocab_saved
    existing["last_session"] = datetime.now(timezone.utc).isoformat()

    stored = aps_set(invoke_id, "progress/summary", existing, ctx)

    return {
        "success": True,
        "data": {
            "progress": existing,
            "persisted": stored,
            "storage_available": bool(ctx.get("storage_token")),
        },
    }


def tool_get_scenarios(_args: dict, _ctx: dict, _invoke_id: str) -> dict:
    result = []
    for key, s in SCENARIOS.items():
        result.append({
            "key": key,
            "title": s["title"],
            "icon": s["icon"],
            "description": s["description"],
            "turn_count": len(s["turns"]) - 1,
        })
    return {"success": True, "data": {"scenarios": result}}


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------
TOOL_MAP = {
    "ping": tool_ping,
    "start_session": tool_start_session,
    "coach_turn": tool_coach_turn,
    "get_notebook": tool_get_notebook,
    "save_progress": tool_save_progress,
    "get_scenarios": tool_get_scenarios,
}

MANIFEST = {
    "name": TOOL_ID,
    "version": "0.2.0",
    "host_capabilities": ["llm.sample", "aps.kv"],
    "tools": [
        {
            "name": "ping",
            "description": "Smoke-test method.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
        {
            "name": "get_scenarios",
            "description": "Return the list of available conversation scenarios.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
        {
            "name": "start_session",
            "description": "Start a new coaching session for a given scenario.",
            "parameters": {
                "type": "object",
                "properties": {
                    "scenario": {"type": "string", "description": "Scenario key (introduction, job_interview, college_discussion, everyday)"},
                },
                "required": [],
                "additionalProperties": False,
            },
        },
        {
            "name": "coach_turn",
            "description": "Submit a user answer and receive coaching feedback.",
            "parameters": {
                "type": "object",
                "properties": {
                    "user_input": {"type": "string"},
                    "scenario_key": {"type": "string"},
                    "turn_number": {"type": "integer"},
                    "session_id": {"type": "string"},
                },
                "required": ["user_input", "scenario_key", "turn_number", "session_id"],
                "additionalProperties": False,
            },
        },
        {
            "name": "get_notebook",
            "description": "Return saved grammar mistakes from the notebook.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer"},
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "save_progress",
            "description": "Save session progress summary.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sessions_completed": {"type": "integer"},
                    "mistakes_corrected": {"type": "integer"},
                    "vocab_saved": {"type": "integer"},
                },
                "additionalProperties": False,
            },
        },
    ],
}


def handle_request(req: dict) -> None:
    method = req.get("method", "")
    rid = req.get("id")

    try:
        if method == "describe":
            send({"jsonrpc": "2.0", "id": rid, "result": MANIFEST})

        elif method == "initialize":
            send({
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "serverInfo": {"name": TOOL_ID, "version": "0.2.0"},
                    "capabilities": {"sampling": {}, "storage": {}},
                },
            })

        elif method == "health":
            send({"jsonrpc": "2.0", "id": rid, "result": {"status": "ready"}})

        elif method == "invoke":
            params = req.get("params", {})
            tool_name = params.get("tool", "")
            args = params.get("arguments", {})
            ctx = params.get("context", {})
            invoke_id = ctx.get("invoke_id", str(uuid.uuid4()))

            fn = TOOL_MAP.get(tool_name)
            if fn is None:
                send({
                    "jsonrpc": "2.0",
                    "id": rid,
                    "result": {"success": False, "error": f"Unknown tool: {tool_name}"},
                })
            else:
                result = fn(args, ctx, invoke_id)
                send({"jsonrpc": "2.0", "id": rid, "result": result})

        else:
            send({
                "jsonrpc": "2.0",
                "id": rid,
                "error": {"code": -32601, "message": f"Unknown method: {method}"},
            })

    except Exception as exc:  # noqa: BLE001
        send({
            "jsonrpc": "2.0",
            "id": rid,
            "error": {"code": -32603, "message": str(exc)},
        })


def main() -> None:
    threading.Thread(target=_reader, daemon=True).start()

    while True:
        try:
            req = _agent_requests.get(timeout=60)
        except queue.Empty:
            # Keep alive — no heartbeat needed, just loop
            continue
        handle_request(req)


if __name__ == "__main__":
    main()
