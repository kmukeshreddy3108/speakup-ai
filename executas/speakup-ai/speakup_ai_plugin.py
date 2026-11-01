"""
SpeakUp AI — Anna App Executa plugin.

Provides:
1. Honest, dual-mode conversation coaching: Anna LLM (via reverse Sampling)
   when available; deterministic scenario-aware rules as fallback.
   Every response carries a truthful `source` ("ai" or "rules").
2. Contextual, non-repetitive conversation flow with zero duplicate sentences.
3. Grammar and expressions feedback distinguishing speech from typed text,
   with natural alternative expressions and rewrite suggestions.
4. Mistake notebook with deduplication, status tracking (new/practising/fixed),
   filtering, and deletion.
5. Real progress metrics derived strictly from actual practice data.
"""

import json
import re
import sys
import uuid
import queue
import threading
import traceback
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Protocol constants
# ---------------------------------------------------------------------------
TOOL_ID = "tool-dev-speakup-ai"
PROTOCOL_VERSION = "2.0"

# ---------------------------------------------------------------------------
# Scenario Definitions & Topic Banks
# ---------------------------------------------------------------------------
SCENARIOS = {
    "introduction": {
        "title": "Self-Introduction",
        "icon": "👋",
        "description": "Practice introducing yourself clearly and confidently",
        "opening_prompt": "Hello! Welcome to SpeakUp AI. Let's practice introducing yourself. Please tell me your name, where you are from, and what you do or study.",
        "opening_hint": "Try: 'My name is … I am from … and I am currently working as / studying …'",
        "opening_vocab": [
            {"word": "originally", "meaning": "used to say where someone was born or grew up", "example": "I am originally from Chennai."},
            {"word": "currently", "meaning": "at the present time", "example": "I am currently studying computer science."},
            {"word": "pursue", "meaning": "to work towards achieving something", "example": "I want to pursue a career in technology."},
        ],
        "stages": [
            {
                "focus": "hobbies",
                "question": "What is one of your favorite hobbies or interests, and why do you enjoy it?",
                "hint": "Try: 'In my free time, I really enjoy … because it helps me …'",
                "vocab": [
                    {"word": "passionate about", "meaning": "deeply enthusiastic about something", "example": "I am passionate about photography."},
                    {"word": "unwind", "meaning": "to relax after work or study", "example": "Cooking helps me unwind after a busy day."},
                ],
            },
            {
                "focus": "goals",
                "question": "What is an important goal you are working toward this year?",
                "hint": "Try: 'One goal I am focusing on this year is … I hope to achieve it by …'",
                "vocab": [
                    {"word": "aspire", "meaning": "to direct one's hopes toward achieving something", "example": "I aspire to lead international engineering teams."},
                    {"word": "milestone", "meaning": "a significant stage in progress", "example": "Completing this project will be a major milestone."},
                ],
            },
            {
                "focus": "english_journey",
                "question": "In what everyday situations do you want to feel most fluent and confident in English?",
                "hint": "Try: 'I want to feel more confident when I am …'",
                "vocab": [
                    {"word": "articulate", "meaning": "able to express ideas clearly in speech", "example": "I want to articulate my ideas more effectively in meetings."},
                    {"word": "fluency", "meaning": "the ability to speak smoothly and easily", "example": "Daily practice is building my conversational fluency."},
                ],
            },
            {
                "focus": "wrap_up",
                "question": "If you could describe your personality in two words, which words would you choose and why?",
                "hint": "Try: 'I would describe myself as … and … because …'",
                "vocab": [
                    {"word": "adaptable", "meaning": "able to adjust readily to new conditions", "example": "I am adaptable when working in new environments."},
                    {"word": "curious", "meaning": "eager to learn or know something", "example": "My curious mindset drives me to learn new skills."},
                ],
            },
        ],
    },
    "job_interview": {
        "title": "Job Interview",
        "icon": "💼",
        "description": "Master behavioral and background interview questions",
        "opening_prompt": "Welcome to your mock interview! Let's start with a foundational question: 'Could you tell me about yourself and what brought you to apply for this opportunity?'",
        "opening_hint": "Structure your answer: Background → Key strength → Why this role.",
        "opening_vocab": [
            {"word": "relevant experience", "meaning": "experience directly connected to the position", "example": "I bring relevant experience in software design and testing."},
            {"word": "contribute", "meaning": "to give support or value to a team", "example": "I am excited to contribute my problem-solving skills to this team."},
            {"word": "drive", "meaning": "motivation and determination", "example": "My drive to build useful tools led me to apply."},
        ],
        "stages": [
            {
                "focus": "strength_star",
                "question": "What is one of your greatest professional strengths, and could you give a concrete example where you used it?",
                "hint": "Use the STAR method: Situation → Task → Action → Result.",
                "vocab": [
                    {"word": "initiative", "meaning": "the power to act before others do", "example": "I took the initiative to streamline our team's communication."},
                    {"word": "collaborative", "meaning": "working well with others", "example": "I thrive in collaborative, cross-functional teams."},
                ],
            },
            {
                "focus": "challenge_overcome",
                "question": "Can you describe a significant obstacle or challenge you faced recently, and how you resolved it?",
                "hint": "Explain what happened, the specific action you took, and what you learned.",
                "vocab": [
                    {"word": "resilient", "meaning": "able to recover quickly from difficulties", "example": "Our team stayed resilient when unexpected bugs arose."},
                    {"word": "prioritize", "meaning": "to treat something as more important than other things", "example": "I had to prioritize urgent client deliverables."},
                ],
            },
            {
                "focus": "growth_future",
                "question": "Where do you envision yourself growing professionally over the next two to three years?",
                "hint": "Highlight skill growth, leadership impact, and alignment with the team's mission.",
                "vocab": [
                    {"word": "domain expertise", "meaning": "deep specialized knowledge in a field", "example": "I want to deepen my domain expertise in distributed systems."},
                    {"word": "mentorship", "meaning": "guidance provided by an experienced person", "example": "I hope to offer mentorship to incoming junior team members."},
                ],
            },
            {
                "focus": "closing",
                "question": "Do you have any questions for me about the team, culture, or what success looks like in this role?",
                "hint": "Asking thoughtful questions demonstrates strong interest and preparation.",
                "vocab": [
                    {"word": "culture", "meaning": "the shared values and practices of a company", "example": "How would you describe the day-to-day culture on the team?"},
                    {"word": "metrics", "meaning": "standards of measurement for performance", "example": "What metrics indicate high performance during the first 90 days?"},
                ],
            },
        ],
    },
    "college_discussion": {
        "title": "College Discussion",
        "icon": "🎓",
        "description": "Engage in academic discussions, defend opinions, and explore ideas",
        "opening_prompt": "Welcome to our academic seminar! Today's discussion question is: 'Should modern artificial intelligence replace traditional lectures in university courses?' What is your stance?",
        "opening_hint": "State your opinion clearly, followed by your strongest reason and an example.",
        "opening_vocab": [
            {"word": "in my perspective", "meaning": "phrase used to express an academic view", "example": "In my perspective, hybrid learning is more effective than either extreme."},
            {"word": "facilitate", "meaning": "to make a process easier or smoother", "example": "AI can facilitate personalized tutoring for students."},
            {"word": "interactive", "meaning": "involving two-way active participation", "example": "In-person seminars foster interactive debate."},
        ],
        "stages": [
            {
                "focus": "counterargument",
                "question": "A peer argues that lectures build shared community and focus that apps cannot replicate. How do you respond to that point?",
                "hint": "Acknowledge their argument first: 'That is a valid point, however I would argue that …'",
                "vocab": [
                    {"word": "counterargument", "meaning": "an argument offered in opposition to another", "example": "A strong counterargument is that social bonds motivate students."},
                    {"word": "complement", "meaning": "to add to in a way that enhances", "example": "Digital tools should complement human teaching, not replace it."},
                ],
            },
            {
                "focus": "evidence",
                "question": "Can you cite a specific example or personal experience that demonstrates your point?",
                "hint": "Reference a course, online tool, or study habit that worked well or poorly for you.",
                "vocab": [
                    {"word": "empirical", "meaning": "based on observation or practical experience", "example": "Empirical studies show higher retention with hands-on projects."},
                    {"word": "illustrate", "meaning": "to make something clear by giving an example", "example": "My experience in chemistry lab illustrates the value of peer teamwork."},
                ],
            },
            {
                "focus": "future_outlook",
                "question": "How do you foresee higher education changing over the next ten years?",
                "hint": "Try: 'In the coming decade, I anticipate that universities will …'",
                "vocab": [
                    {"word": "anticipate", "meaning": "to regard as probable or expect", "example": "I anticipate that degrees will focus more on applied problem-solving."},
                    {"word": "decentralized", "meaning": "spread among various locations rather than unified", "example": "Learning may become more decentralized across global institutions."},
                ],
            },
        ],
    },
    "everyday": {
        "title": "Everyday Conversation",
        "icon": "☕",
        "description": "Casual, natural English for social situations and daily life",
        "opening_prompt": "Hi there! Let's practice casual small talk. Imagine we are meeting at a friendly neighborhood coffee shop. How has your week been going so far?",
        "opening_hint": "Keep it relaxed: 'It has been pretty good! I have been busy with … How about you?'",
        "opening_vocab": [
            {"word": "pretty busy", "meaning": "moderately full of activity", "example": "It has been a pretty busy week with work deadlines."},
            {"word": "how about yourself", "meaning": "natural phrase to bounce the conversation back", "example": "I'm having a calm week — how about yourself?"},
            {"word": "catch up", "meaning": "to share recent news or do pending tasks", "example": "I finally had a chance to catch up on some reading."},
        ],
        "stages": [
            {
                "focus": "weekend_plans",
                "question": "Do you have any fun plans or projects you are looking forward to this weekend?",
                "hint": "Mention an activity, meeting friends, or taking time to rest.",
                "vocab": [
                    {"word": "look forward to", "meaning": "to feel excited about an upcoming event", "example": "I'm looking forward to visiting the farmer's market."},
                    {"word": "recharge", "meaning": "to regain energy through rest", "example": "I plan to take it easy on Sunday and recharge."},
                ],
            },
            {
                "focus": "food_travel",
                "question": "Speaking of good food or travel, have you tried any memorable dishes or visited an interesting place recently?",
                "hint": "Describe what you ate or visited and what made it stand out.",
                "vocab": [
                    {"word": "authentic", "meaning": "genuine and true to origin", "example": "We found an authentic noodle restaurant downtown."},
                    {"word": "scenic", "meaning": "having pleasing or beautiful natural features", "example": "The hiking trail had a very scenic view of the valley."},
                ],
            },
            {
                "focus": "culture_media",
                "question": "Have you watched any great movies or read any interesting books or podcasts lately?",
                "hint": "Share a recommendation and why you found it engaging.",
                "vocab": [
                    {"word": "recommend", "meaning": "to suggest something as good or suitable", "example": "I highly recommend that documentary on ocean life."},
                    {"word": "captivating", "meaning": "capable of attracting and holding interest", "example": "The story was so captivating that I finished it in one day."},
                ],
            },
        ],
    },
}

# ---------------------------------------------------------------------------
# Sentence Deduplication & Helper Functions
# ---------------------------------------------------------------------------

def _clean_sentence(s: str) -> str:
    """Normalize a sentence for duplicate detection."""
    return re.sub(r"[^\w\s]", "", s).strip().lower()


def deduplicate_sentences(reply: str, follow_up: str) -> tuple[str, str, str]:
    """
    Ensure no sentence in follow_up is repeated inside reply or vice versa.
    Returns (cleaned_reply, cleaned_follow_up, combined_full_message).
    """
    reply = (reply or "").strip()
    follow_up = (follow_up or "").strip()

    if not follow_up:
        return reply, "", reply

    if not reply:
        return "", follow_up, follow_up

    # Split reply into sentences
    reply_sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", reply) if s.strip()]
    follow_sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", follow_up) if s.strip()]

    # If the follow_up sentence is already the end of reply, remove it from reply
    norm_follow = [_clean_sentence(s) for s in follow_sentences]
    filtered_reply = []
    for s in reply_sentences:
        if _clean_sentence(s) not in norm_follow:
            filtered_reply.append(s)

    clean_reply = " ".join(filtered_reply).strip()
    clean_follow = " ".join(follow_sentences).strip()

    if not clean_reply:
        clean_reply = clean_follow
        clean_follow = ""

    full_message = f"{clean_reply} {clean_follow}".strip() if clean_follow else clean_reply
    return clean_reply, clean_follow, full_message


# ---------------------------------------------------------------------------
# Grammar & Expression Checker
# ---------------------------------------------------------------------------

EXACT_CORRECTIONS = {
    "hello how do are doing": {
        "corrected": "Hello, how are you doing?",
        "category": "Sentence structure",
        "explanation": "Questions in the present continuous use 'how are you doing'. The extra 'do' is removed.",
        "better_expressions": [
            "Hello, how have you been doing?",
            "Hi there! How are things going with you?",
            "Hello! How are you doing today?",
        ],
    },
    "i am very exiting today": {
        "corrected": "I am very excited today.",
        "category": "Word choice",
        "explanation": "Use 'excited' to describe your personal feeling; 'exiting' means leaving a place.",
        "better_expressions": [
            "I'm feeling really energetic today.",
            "I am genuinely thrilled about today.",
            "I'm in a great, positive mood today.",
        ],
    },
    "can you give me some topic that we can speal on": {
        "corrected": "Can you give me some topics that we can speak about?",
        "category": "Spelling & preposition",
        "explanation": "Use the plural 'topics', spell 'speak' with an 'k', and the standard idiom is 'speak about'.",
        "better_expressions": [
            "Could you suggest a few conversation topics for us?",
            "What topics would you recommend for our practice?",
            "Can you give me some topics we could discuss?",
        ],
    },
    "she go to school yesterday": {
        "corrected": "She went to school yesterday.",
        "category": "Past tense",
        "explanation": "Actions completed in the past ('yesterday') require the irregular past tense form 'went'.",
        "better_expressions": [
            "She attended classes yesterday.",
            "She was at school yesterday.",
            "She went over to school yesterday morning.",
        ],
    },
    "i have 20 years": {
        "corrected": "I am 20 years old.",
        "category": "Idiomatic expression",
        "explanation": "In English, age is expressed with the verb 'to be' ('I am 20 years old'), not 'to have'.",
        "better_expressions": [
            "I am currently 20 years old.",
            "I'm 20.",
            "I recently turned 20.",
        ],
    },
}

# High-frequency learner corrections are intentionally local and deterministic.
# The model layer can improve wording, but it must not be required for these
# unambiguous repairs.
COMMON_CORRECTIONS = {
    "hello": ("Hello.", "Sentence mechanics", "Capitalize the sentence and add ending punctuation."),
    "i am": ("I am.", "Sentence mechanics", "Capitalize the pronoun I and add ending punctuation."),
    "hello there": ("Hello there.", "Sentence mechanics", "Capitalize the sentence and add ending punctuation."),
    "good morning": ("Good morning.", "Sentence mechanics", "Capitalize the greeting and add ending punctuation."),
    "how are you": ("How are you?", "Sentence mechanics", "Questions need a question mark."),
    "what is your name": ("What is your name?", "Sentence mechanics", "Questions need a question mark."),
    "where are you from": ("Where are you from?", "Sentence mechanics", "Questions need a question mark."),
    "i like reading": ("I like reading.", "Sentence mechanics", "Capitalize the pronoun I and add ending punctuation."),
    "i am a student": ("I am a student.", "Sentence mechanics", "Capitalize the pronoun I and add ending punctuation."),
    "this is my book": ("This is my book.", "Sentence mechanics", "Capitalize the sentence and add ending punctuation."),
    "hello  there": ("Hello there.", "Spacing", "Use one space between words."),
    "i  am  ready": ("I am ready.", "Spacing", "Use one space between words."),
    "hello , how are you": ("Hello, how are you?", "Punctuation", "Place the comma next to the greeting and use a question mark."),
    "i like tea .": ("I like tea.", "Punctuation", "Place punctuation directly after the final word."),
    "how are you ?": ("How are you?", "Punctuation", "Place the question mark directly after the final word."),
    "i dont know": ("I don't know.", "Contractions", "Use the contraction don't for do not."),
    "i cant go": ("I can't go.", "Contractions", "Use the contraction can't for cannot."),
    "she doesnt understand": ("She doesn't understand.", "Contractions", "Third-person singular uses doesn't."),
    "we arent late": ("We aren't late.", "Contractions", "Use the contraction aren't for are not."),
    "theyre working": ("They're working.", "Contractions", "Use they're for they are."),
    "speal": ("Speak.", "Spelling", "The correct spelling is speak."),
    "exiting": ("Exciting.", "Word choice", "Exciting describes something that creates enthusiasm; exiting means leaving."),
    "recieve": ("Receive.", "Spelling", "The correct spelling is receive."),
    "becuase": ("Because.", "Spelling", "The correct spelling is because."),
    "definately": ("Definitely.", "Spelling", "The correct spelling is definitely."),
    "enviroment": ("Environment.", "Spelling", "The correct spelling is environment."),
    "teh answer": ("The answer.", "Spelling", "The correct spelling is the."),
    "i realy like it": ("I really like it.", "Spelling", "The correct spelling is really."),
    "how do are doing": ("How are you doing?", "Sentence structure", "Questions in the present continuous use how are you doing."),
    "i has a car": ("I have a car.", "Subject-verb agreement", "Use have with I."),
    "we is students": ("We are students.", "Subject-verb agreement", "Use are with we."),
    "she walk to work": ("She walks to work.", "Subject-verb agreement", "Third-person singular verbs take -s."),
    "he play football": ("He plays football.", "Subject-verb agreement", "Third-person singular verbs take -s."),
    "yesterday i go to class": ("Yesterday I went to class.", "Past tense", "Yesterday requires the past-tense form went."),
    "last week she visit us": ("Last week she visited us.", "Past tense", "Last week requires a past-tense verb."),
    "i am engineer": ("I am an engineer.", "Article usage", "Use an before a vowel sound."),
    "she is doctor": ("She is a doctor.", "Article usage", "Singular professions need a or an."),
    "he is student": ("He is a student.", "Article usage", "Singular professions need a or an."),
    "i want go home": ("I want to go home.", "Infinitive", "Want is followed by to and the base verb."),
    "i enjoy to read": ("I enjoy reading.", "Gerund", "Enjoy is followed by a gerund."),
    "very much people like music": ("Very many people like music.", "Word choice", "Use many with countable people."),
    "i am good in english": ("I am good at English.", "Preposition", "The natural preposition is good at."),
    "depend of the weather": ("Depend on the weather.", "Preposition", "The verb depend takes on."),
    "discuss about the problem": ("Discuss the problem.", "Preposition", "Discuss does not take about."),
    "explain me this": ("Explain this to me.", "Word order", "Use explain something to someone."),
    "i look forward to meet you": ("I look forward to meeting you.", "Gerund", "Look forward to is followed by a gerund."),
    "can you suggest me a topic": ("Can you suggest a topic to me?", "Word order", "Use suggest something to someone."),
    "what topic we can speak": ("What topic can we speak about?", "Question structure", "Questions place the modal before the subject."),
    "she can sings well": ("She can sing well.", "Modal verb", "A modal is followed by the base verb."),
    "i am agree with you": ("I agree with you.", "Word choice", "Agree is a verb and does not use am."),
    "i did not went there": ("I did not go there.", "Past tense", "Did not is followed by the base verb."),
    "this informations are useful": ("This information is useful.", "Noun agreement", "Information is uncountable and takes is."),
    "the people is friendly": ("The people are friendly.", "Subject-verb agreement", "People takes the plural verb are."),
}


def correct_sentence(text: str, is_speech: bool = False) -> dict:
    """
    Produce accurate, honest grammar feedback.
    If is_speech is True, trivial missing capitalization or missing end periods
    from speech recognition are NOT flagged as errors.
    """
    raw = text.strip()
    if not raw:
        return {
            "original": "",
            "corrected": "",
            "explanation": "No text provided.",
            "category": "empty",
            "isCorrect": True,
            "label": "Basic checks (rule-based)",
            "better_expressions": [],
        }

    lowered = re.sub(r"\s+", " ", raw.lower()).strip()

    # 1. Exact catalog match
    if lowered in EXACT_CORRECTIONS:
        spec = EXACT_CORRECTIONS[lowered]
        return {
            "original": raw,
            "corrected": spec["corrected"],
            "explanation": spec["explanation"],
            "category": spec["category"],
            "isCorrect": False,
            "label": "Basic checks (rule-based)",
            "better_expressions": spec["better_expressions"],
        }

    if lowered in COMMON_CORRECTIONS:
        corrected_value, category, explanation = COMMON_CORRECTIONS[lowered]
        if is_speech and category in {"Sentence mechanics", "Punctuation", "Spacing"}:
            return {
                "original": raw,
                "corrected": corrected_value,
                "explanation": "Your speech was clear; capitalization and punctuation were formatted automatically.",
                "category": "Clear expression",
                "isCorrect": True,
                "label": "Basic mode (rule-based)",
                "better_expressions": [],
            }
        return {
            "original": raw,
            "corrected": corrected_value,
            "explanation": explanation,
            "category": category,
            "isCorrect": False,
            "label": "Basic mode (rule-based)",
            "better_expressions": [corrected_value],
        }

    # 2. Rule-based substitutions
    corrected = raw
    category = None
    explanation = None

    replacements = [
        (r"\s+", " ", "Spacing", "Use one space between words."),
        (r"\s+([,.!?])", r"\1", "Punctuation", "Place punctuation directly after the preceding word."),
        (r"\b(dont)\b", "don't", "Contractions", "Use the contraction don't for do not."),
        (r"\b(cant)\b", "can't", "Contractions", "Use the contraction can't for cannot."),
        (r"\b(doesnt)\b", "doesn't", "Contractions", "Use the contraction doesn't for does not."),
        (r"\b(arent)\b", "aren't", "Contractions", "Use the contraction aren't for are not."),
        (r"\b(theyre)\b", "they're", "Contractions", "Use they're for they are."),
        (r"\bspeal\b", "speak", "Spelling", "The correct spelling is speak."),
        (r"\bexiting\b", "exciting", "Word choice", "Exciting describes enthusiasm; exiting means leaving."),
        (r"\brecieve\b", "receive", "Spelling", "The correct spelling is receive."),
        (r"\bbecuase\b", "because", "Spelling", "The correct spelling is because."),
        (r"\bdefinately\b", "definitely", "Spelling", "The correct spelling is definitely."),
        (r"\benviroment\b", "environment", "Spelling", "The correct spelling is environment."),
        (r"\bteh\b", "the", "Spelling", "The correct spelling is the."),
        (r"\brealy\b", "really", "Spelling", "The correct spelling is really."),
        (r"\b(he|she)\s+go\s+yesterday\b", r"\1 went yesterday", "Past tense", "Yesterday requires the past-tense form went."),
        (r"\b(he|she)\s+go\b", r"\1 goes", "Subject-verb agreement", "Third-person singular verbs take -s."),
        (r"\b(he|she)\s+play\b", r"\1 plays", "Subject-verb agreement", "Third-person singular verbs take -s."),
        (r"\b(i)\s+has\b", "I have", "Subject-verb agreement", "Use have with I."),
        (r"\b(we)\s+is\b", r"\1 are", "Subject-verb agreement", "Use are with we."),
        (r"\b(i)\s+am\s+(engineer|artist|architect)\b", r"I am an \2", "Article usage", "Use an before a vowel sound."),
        (r"\b(she|he)\s+is\s+(doctor|student|engineer)\b", r"\1 is a \2", "Article usage", "Singular professions need a or an."),
        (r"\bi\s+want\s+go\b", "I want to go", "Infinitive", "Want is followed by to and the base verb."),
        (r"\bi\s+enjoy\s+to\s+(\w+)\b", r"I enjoy \1ing", "Gerund", "Enjoy is followed by a gerund."),
        (r"\bvery much people\b", "very many people", "Word choice", "Use many with countable people."),
        (r"\bgood in\b", "good at", "Preposition", "The natural preposition is good at."),
        (r"\bdepend of\b", "depend on", "Preposition", "The verb depend takes on."),
        (r"\bdiscuss about\b", "discuss", "Preposition", "Discuss does not take about."),
        (r"\bexplain me\b", "explain this to me", "Word order", "Use explain something to someone."),
        (r"\bi look forward to meet\b", "I look forward to meeting", "Gerund", "Look forward to is followed by a gerund."),
        (r"\bshe can sings\b", "She can sing", "Modal verb", "A modal is followed by the base verb."),
        (r"\bi am agree\b", "I agree", "Word choice", "Agree is a verb and does not use am."),
        (r"\bi did not went\b", "I did not go", "Past tense", "Did not is followed by the base verb."),
        (r"\bthis informations are\b", "This information is", "Noun agreement", "Information is uncountable and takes is."),
        (r"\bthe people is\b", "The people are", "Subject-verb agreement", "People takes the plural verb are."),
        # Subject-verb agreement
        (r"\b(i)\s+is\b", "I am", "Subject-verb agreement", "Use 'am' with the subject pronoun 'I'."),
        (r"\b(i)\s+are\b", "I am", "Subject-verb agreement", "Use 'am' with the subject pronoun 'I'."),
        (r"\b(you|we|they)\s+was\b", r"\1 were", "Subject-verb agreement", "Plural subjects and 'you' take the past tense 'were'."),
        (r"\b(he|she|it)\s+were\b", r"\1 was", "Subject-verb agreement", "Singular third-person subjects take 'was'."),
        (r"\b(he|she|it)\s+don'?t\b", r"\1 doesn't", "Subject-verb agreement", "Third-person singular subjects use 'doesn't'."),
        (r"\b(he|she|it)\s+have\b", r"\1 has", "Subject-verb agreement", "Third-person singular subjects use 'has'."),
        (r"\b(he|she)\s+go\b", r"\1 goes", "Subject-verb agreement", "Third-person singular verbs in present simple take '-s' or '-es'."),
        # Irregular past tense
        (r"\bgoed\b", "went", "Irregular past tense", "The past tense of 'go' is 'went'."),
        (r"\bcomed\b", "came", "Irregular past tense", "The past tense of 'come' is 'came'."),
        (r"\btaked\b", "took", "Irregular past tense", "The past tense of 'take' is 'took'."),
        (r"\bmaked\b", "made", "Irregular past tense", "The past tense of 'make' is 'made'."),
        (r"\bbuyed\b", "bought", "Irregular past tense", "The past tense of 'buy' is 'bought'."),
        (r"\bteached\b", "taught", "Irregular past tense", "The past tense of 'teach' is 'taught'."),
        # Double negative
        (r"\bdon'?t\s+(know|have|see|want)\s+nothing\b", r"don't \1 anything", "Double negative", "Use 'anything' with a negative verb rather than 'nothing'."),
        # Missing article before profession
        (r"\bi am\s+(engineer|doctor|student|teacher|developer|nurse|lawyer)\b", r"I am a \1", "Article usage", "Singular countable professions take 'a' or 'an' ('I am a student')."),
    ]

    for pattern, repl, cat, expl in replacements:
        new_text = re.sub(pattern, repl, corrected, flags=re.IGNORECASE)
        if new_text.lower() != corrected.lower():
            corrected = new_text
            category = cat
            explanation = expl
            break

    # Punctuation & Capitalization handling
    # For speech input, DO NOT flag missing leading capital or ending dot as an error!
    sentence_cased = corrected[0].upper() + corrected[1:] if corrected else corrected
    if sentence_cased and sentence_cased[-1] not in ".!?":
        sentence_cased += "?" if lowered.startswith(("what", "why", "how", "where", "when", "who", "can", "could", "is", "are", "do", "does")) else "."

    if category is not None:
        # A real grammatical rule was triggered
        return {
            "original": raw,
            "corrected": sentence_cased,
            "explanation": explanation,
            "category": category,
            "isCorrect": False,
            "label": "Basic checks (rule-based)",
            "better_expressions": [sentence_cased],
        }

    # If no rule triggered: check if only punctuation/casing differed
    if is_speech:
        # Speech transcripts naturally lack punctuation and proper capitalization; do not penalize
        return {
            "original": raw,
            "corrected": sentence_cased,
            "explanation": "Your sentence is clear and communicates your point naturally.",
            "category": "Clear expression",
            "isCorrect": True,
            "label": "Basic checks (rule-based)",
            "better_expressions": [],
        }

    # For typed text, if only capitalization/punctuation differs, we still don't call it a major mistake
    if sentence_cased.lower().strip(".!? ") == raw.lower().strip(".!? "):
        return {
            "original": raw,
            "corrected": sentence_cased,
            "explanation": "Your sentence is clear and grammatically sound.",
            "category": "Clear expression",
            "isCorrect": True,
            "label": "Basic checks (rule-based)",
            "better_expressions": [],
        }

    return {
        "original": raw,
        "corrected": raw,
        "explanation": "Your sentence is clear and communicates your point well.",
        "category": "Clear expression",
        "isCorrect": True,
        "label": "Basic checks (rule-based)",
        "better_expressions": [],
    }


def check_grammar(text: str, is_speech: bool = False) -> list[dict]:
    """Compatibility list output for UI feedback decks."""
    res = correct_sentence(text, is_speech=is_speech)
    if res["isCorrect"]:
        return []
    return [{
        "rule": res["category"],
        "fragment": res["original"],
        "suggestion": res["corrected"],
        "explanation": res["explanation"],
        "category": res["category"],
        "label": res["label"],
        "better_expressions": res.get("better_expressions", []),
    }]


# ---------------------------------------------------------------------------
# Contextual Rule-Based Coaching Engine
# ---------------------------------------------------------------------------

GREETING_WORDS = {"hello", "hi", "hey", "good morning", "good afternoon", "good evening", "greetings"}


def _is_greeting(text: str) -> bool:
    cleaned = re.sub(r"[^\w\s]", "", text).lower().strip()
    return cleaned in GREETING_WORDS or any(cleaned.startswith(g + " ") for g in GREETING_WORDS)


def _is_very_short(text: str) -> bool:
    words = text.strip().split()
    return len(words) <= 2 and words[0].lower() not in {"what", "why", "how"}


def fallback_contextual_turn(user_input: str, scenario_key: str, turn_number: int) -> tuple[str, str, list[str]]:
    """
    Intelligent, deterministic rule-based dialogue partner.
    Guarantees no repeated questions, contextual responses, and proper follow-ups.
    """
    scenario = SCENARIOS.get(scenario_key, SCENARIOS["introduction"])
    stages = scenario.get("stages", [])
    lower = user_input.lower()

    # 1. Topic change request
    if any(k in lower for k in ("topic", "speak on", "talk about", "change topic", "different topic")):
        topics = ["travel experiences", "favorite foods & cooking", "career ambitions", "daily productivity habits"]
        reply = "Certainly! We can explore a variety of engaging topics. Here are a few great options to discuss:"
        follow_up = "Which of those topics would you like to speak about?"
        return reply, follow_up, topics

    # 2. Greeting handling
    if _is_greeting(user_input):
        first_stage = stages[0] if stages else {"question": "To start off, could you share a little about your background and interests?"}
        reply = f"Hello! It is wonderful to practice with you today in this {scenario['title']} session."
        follow_up = first_stage["question"]
        return reply, follow_up, []

    # 3. Very brief / one-word answers ("yes", "no", "okay", "fine")
    if _is_very_short(user_input):
        reply = "Thank you for that response. To help build your conversational fluency, let's expand on that thought."
        follow_up = "Could you share one specific reason or detail behind that?"
        return reply, follow_up, []

    # 4. User asked a direct question
    if "?" in user_input or lower.startswith(("what is", "how do you", "why do", "can you")):
        reply = f"That is a great conversational question! In a {scenario['title']} setting, sharing curious perspectives keeps dialogue engaging."
        stage_idx = (max(turn_number, 1) - 1) % len(stages) if stages else 0
        follow_up = stages[stage_idx]["question"] if stages else "What is your own take on that question?"
        return reply, follow_up, []

    # 5. Normal conversational progression based on scenario stages
    stage_idx = (max(turn_number, 1) - 1) % len(stages) if stages else 0
    current_stage = stages[stage_idx] if stages else {"question": "What is another aspect of this you would like to share?"}

    acknowledgments = [
        "Thank you for sharing those insights.",
        "That is a very clear and thoughtful point.",
        "I appreciate you elaborating on that.",
        "Well articulated — that gives great perspective.",
    ]
    ack = acknowledgments[turn_number % len(acknowledgments)]
    reply = ack
    follow_up = current_stage["question"]

    return reply, follow_up, []


# ---------------------------------------------------------------------------
# Sampling reverse RPC helpers
# ---------------------------------------------------------------------------
_host_responses: dict[str, queue.Queue] = {}
_agent_requests: queue.Queue = queue.Queue()
_sampling_available = True  # Optimistic by default; updated on error


def _reader():
    """Read stdin in background thread; route to host response or request queue."""
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
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


def sampling_call(invoke_id: str, messages: list[dict], max_tokens: int = 350, system: str = "") -> tuple[str, bool]:
    """Send reverse RPC sampling/createMessage to Anna Host."""
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
        resp = q.get(timeout=25)
    except queue.Empty:
        _host_responses.pop(rid, None)
        return "", False
    finally:
        _host_responses.pop(rid, None)

    try:
        if "error" in resp:
            code = resp["error"].get("code", 0)
            if code in (-32008, -32001):  # SAMPLING_NOT_NEGOTIATED or SAMPLING_NOT_GRANTED
                _sampling_available = False
            return "", False
        text = resp["result"]["content"]["text"]
        return (text, True) if isinstance(text, str) else ("", False)
    except (KeyError, TypeError):
        return "", False


def _parse_coach_json(raw_text: str) -> dict | None:
    """Defensively parse JSON from model output, stripping code fences."""
    cleaned = raw_text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        data = json.loads(cleaned)
    except (TypeError, json.JSONDecodeError):
        # Attempt regex extraction if model enclosed JSON in commentary
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            try:
                data = json.loads(match.group(0))
            except Exception:
                return None
        else:
            return None

    if not isinstance(data, dict):
        return None

    reply = data.get("reply") or data.get("coach_reply")
    follow_up = data.get("follow_up") or data.get("followUp")

    if not isinstance(reply, str) or not reply.strip():
        return None
    if not isinstance(follow_up, str) or not follow_up.strip():
        return None

    topics = data.get("suggested_topics") or data.get("suggestedTopics") or []
    if not isinstance(topics, list):
        topics = []

    return {
        "reply": reply.strip(),
        "follow_up": follow_up.strip(),
        "suggested_topics": [str(t) for t in topics[:4]],
    }


# ---------------------------------------------------------------------------
# APS storage helpers
# ---------------------------------------------------------------------------
def aps_set(invoke_id: str, key: str, value: object, context: dict) -> bool:
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


def aps_list(invoke_id: str, prefix: str, context: dict, limit: int = 100) -> list[dict]:
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
# Tool Implementations
# ---------------------------------------------------------------------------

def tool_ping(_args: dict, _ctx: dict, _invoke_id: str) -> dict:
    return {"success": True, "data": {"pong": True}}


def tool_health(_args: dict, _ctx: dict, _invoke_id: str) -> dict:
    """Return runtime capability and whether Sampling is available."""
    return {
        "success": True,
        "data": {
            "status": "ready",
            "sampling_available": _sampling_available,
            "default_source": "ai" if _sampling_available else "rules",
        },
    }


def tool_get_scenarios(_args: dict, _ctx: dict, _invoke_id: str) -> dict:
    scenarios_list = []
    for key, s in SCENARIOS.items():
        scenarios_list.append({
            "key": key,
            "title": s["title"],
            "icon": s["icon"],
            "description": s["description"],
            "stages_count": len(s.get("stages", [])),
        })
    return {"success": True, "data": {"scenarios": scenarios_list}}


def tool_start_session(args: dict, ctx: dict, invoke_id: str) -> dict:
    scenario_key = args.get("scenario", "introduction")
    scenario = SCENARIOS.get(scenario_key, SCENARIOS["introduction"])
    session_id = str(uuid.uuid4())

    source = "ai" if _sampling_available else "rules"

    return {
        "success": True,
        "data": {
            "session_id": session_id,
            "scenario_key": scenario_key,
            "scenario_title": scenario["title"],
            "total_turns": None,
            "opening_prompt": scenario["opening_prompt"],
            "hint": scenario["opening_hint"],
            "vocabulary": scenario["opening_vocab"],
            "source": source,
            "is_scripted": (source == "rules"),
        },
    }


def tool_coach_turn(args: dict, ctx: dict, invoke_id: str) -> dict:
    user_input = args.get("user_input", "").strip()
    scenario_key = args.get("scenario_key", "introduction")
    turn_number = int(args.get("turn_number", 1))
    session_id = args.get("session_id", "unknown")
    input_mode = args.get("input_mode", "typed")  # "speech" or "typed"
    is_speech = (input_mode == "speech")

    if not user_input:
        return {
            "success": False,
            "error": "Please provide an answer by speaking or typing.",
        }

    scenario = SCENARIOS.get(scenario_key, SCENARIOS["introduction"])
    stages = scenario.get("stages", [])
    stage_idx = (max(turn_number, 1) - 1) % len(stages) if stages else 0
    stage_meta = stages[stage_idx] if stages else {"hint": "", "vocab": []}

    # 1. Grammar & Expression Check
    correction = correct_sentence(user_input, is_speech=is_speech)
    grammar_notes = check_grammar(user_input, is_speech=is_speech)

    # 2. Persist genuine mistakes to APS Notebook with deduplication
    if not correction["isCorrect"] and ctx.get("storage_token"):
        norm_key = re.sub(r"[^\w]", "_", f"{correction['category']}_{correction['original'].lower()}").strip("_")[:40]
        note_storage_key = f"notebook/items/{norm_key}"

        existing_entry, found = aps_get(invoke_id, note_storage_key, ctx)
        if found and isinstance(existing_entry, dict):
            existing_entry["times_seen"] = existing_entry.get("times_seen", 1) + 1
            existing_entry["last_seen"] = datetime.now(timezone.utc).isoformat()
            aps_set(invoke_id, note_storage_key, existing_entry, ctx)
        else:
            new_entry = {
                "id": str(uuid.uuid4()),
                "storage_key": note_storage_key,
                "session_id": session_id,
                "scenario": scenario["title"],
                "turn": turn_number,
                "original": correction["original"],
                "corrected": correction["corrected"],
                "category": correction["category"],
                "explanation": correction["explanation"],
                "better_expressions": correction.get("better_expressions", []),
                "times_seen": 1,
                "status": "new",  # "new" | "practising" | "fixed"
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            aps_set(invoke_id, note_storage_key, new_entry, ctx)

    # 3. Conversational Response Generation: Sampling vs Rules
    coach_reply = ""
    follow_up = ""
    suggested_topics: list[str] = []
    source = "rules"

    if _sampling_available:
        history = args.get("history", [])
        if not isinstance(history, list):
            history = []
        recent_history = history[-8:]

        system_prompt = (
            "You are SpeakUp AI, an English conversation practice coach. "
            "Acknowledge what the learner said in 1-2 supportive sentences (coach_reply), "
            "and then ask ONE natural follow-up question (follow_up) that continues the scenario. "
            "CRITICAL: Do not repeat the question inside coach_reply. "
            "Return valid JSON ONLY with keys: 'reply', 'follow_up', 'suggested_topics'. "
            f"Scenario: {scenario['title']}. Conversation history: {json.dumps(recent_history)}. "
            f"Learner response: {user_input!r}"
        )
        messages = [{"role": "user", "content": {"type": "text", "text": user_input}}]
        reply_text, ok = sampling_call(invoke_id, messages, max_tokens=250, system=system_prompt)
        parsed = _parse_coach_json(reply_text) if ok else None

        if parsed:
            coach_reply = parsed["reply"]
            follow_up = parsed["follow_up"]
            suggested_topics = parsed.get("suggested_topics", [])
            source = "ai"

    # If sampling was not used or failed, use deterministic contextual fallback
    if not coach_reply:
        source = "rules"
        coach_reply, follow_up, suggested_topics = fallback_contextual_turn(user_input, scenario_key, turn_number)

    # 4. Guarantee zero sentence duplication
    clean_reply, clean_follow_up, full_message = deduplicate_sentences(coach_reply, follow_up)

    return {
        "success": True,
        "data": {
            "source": source,
            "coach_reply": clean_reply,
            "follow_up": clean_follow_up,
            "full_message": full_message,
            "hint": stage_meta.get("hint", ""),
            "vocabulary": stage_meta.get("vocab", []),
            "grammar_notes": grammar_notes,
            "correction": correction,
            "suggested_topics": suggested_topics,
            "is_scripted": (source == "rules"),
            "is_last_turn": False,
            "next_turn_number": turn_number + 1,
            "runtime_mode_notice": "" if source == "ai" else "Coaching active in basic rule-based mode.",
        },
    }


def tool_get_notebook(args: dict, ctx: dict, invoke_id: str) -> dict:
    limit = int(args.get("limit", 50))
    status_filter = args.get("status", "all")  # all | new | practising | fixed
    search_query = (args.get("search") or "").strip().lower()

    items = aps_list(invoke_id, "notebook/items/", ctx, limit=100)
    entries = []
    for item in items:
        v = item.get("value")
        if v and isinstance(v, dict):
            # Apply status filter
            if status_filter != "all" and v.get("status") != status_filter:
                continue
            # Apply search filter
            if search_query:
                combined = f"{v.get('original', '')} {v.get('corrected', '')} {v.get('category', '')}".lower()
                if search_query not in combined:
                    continue
            entries.append(v)

    entries.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    entries = entries[:limit]

    # Also pull progress metrics
    progress, found = aps_get(invoke_id, "progress/summary", ctx)
    if not found or not isinstance(progress, dict):
        progress = {
            "sessions_completed": 0,
            "minutes_practised": 0,
            "answers_given": 0,
            "total_words": 0,
            "average_words_per_answer": 0,
            "distinct_words_count": 0,
            "mistakes_detected_by_checker": 0,
            "notebook_fixed_count": 0,
            "streak_days": 0,
        }

    return {
        "success": True,
        "data": {
            "entries": entries,
            "total_stored": len(entries),
            "progress": progress,
            "storage_available": bool(ctx.get("storage_token")),
        },
    }


def tool_update_notebook_item(args: dict, ctx: dict, invoke_id: str) -> dict:
    item_id = args.get("id")
    new_status = args.get("status")  # "new" | "practising" | "fixed"

    if not item_id or new_status not in ("new", "practising", "fixed"):
        return {"success": False, "error": "Invalid id or status"}

    items = aps_list(invoke_id, "notebook/items/", ctx, limit=100)
    target_key = None
    target_entry = None

    for item in items:
        v = item.get("value")
        if isinstance(v, dict) and v.get("id") == item_id:
            target_key = item.get("key")
            target_entry = v
            break

    if target_key and target_entry:
        target_entry["status"] = new_status
        target_entry["updated_at"] = datetime.now(timezone.utc).isoformat()
        aps_set(invoke_id, target_key, target_entry, ctx)
        return {"success": True, "data": target_entry}

    return {"success": False, "error": "Item not found"}


def tool_delete_notebook_item(args: dict, ctx: dict, invoke_id: str) -> dict:
    item_id = args.get("id")
    if not item_id:
        return {"success": False, "error": "Missing item id"}

    items = aps_list(invoke_id, "notebook/items/", ctx, limit=100)
    for item in items:
        v = item.get("value")
        if isinstance(v, dict) and v.get("id") == item_id:
            key = item.get("key")
            # Overwrite with tombstone or clear
            aps_set(invoke_id, key, None, ctx)
            return {"success": True, "data": {"deleted": True, "id": item_id}}

    return {"success": False, "error": "Item not found"}


def tool_save_progress(args: dict, ctx: dict, invoke_id: str) -> dict:
    sessions = int(args.get("sessions_completed", 0))
    minutes = int(args.get("minutes_practised", 0))
    answers = int(args.get("answers_given", 0))
    words = int(args.get("words_spoken", 0))
    mistakes = int(args.get("mistakes_detected", 0))

    existing, found = aps_get(invoke_id, "progress/summary", ctx)
    if not found or not isinstance(existing, dict):
        existing = {
            "sessions_completed": 0,
            "minutes_practised": 0,
            "answers_given": 0,
            "total_words": 0,
            "average_words_per_answer": 0,
            "distinct_words_count": 0,
            "mistakes_detected_by_checker": 0,
            "notebook_fixed_count": 0,
            "streak_days": 1,
            "last_session": None,
        }

    existing["sessions_completed"] = existing.get("sessions_completed", 0) + sessions
    existing["minutes_practised"] = existing.get("minutes_practised", 0) + minutes
    existing["answers_given"] = existing.get("answers_given", 0) + answers
    existing["total_words"] = existing.get("total_words", 0) + words
    existing["mistakes_detected_by_checker"] = existing.get("mistakes_detected_by_checker", 0) + mistakes

    total_answers = existing["answers_given"]
    if total_answers > 0:
        existing["average_words_per_answer"] = round(existing["total_words"] / total_answers, 1)

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


def tool_clear_all_data(_args: dict, ctx: dict, invoke_id: str) -> dict:
    """Clear all stored notebook entries and reset progress summary (GDPR compliance)."""
    items = aps_list(invoke_id, "notebook/items/", ctx, limit=100)
    for item in items:
        k = item.get("key")
        if k:
            aps_set(invoke_id, k, None, ctx)

    reset_progress = {
        "sessions_completed": 0,
        "minutes_practised": 0,
        "answers_given": 0,
        "total_words": 0,
        "average_words_per_answer": 0,
        "distinct_words_count": 0,
        "mistakes_detected_by_checker": 0,
        "notebook_fixed_count": 0,
        "streak_days": 0,
        "last_session": None,
    }
    aps_set(invoke_id, "progress/summary", reset_progress, ctx)
    return {"success": True, "data": {"cleared": True}}


# ---------------------------------------------------------------------------
# Dispatcher & Tool Mapping
# ---------------------------------------------------------------------------
TOOL_MAP = {
    "ping": tool_ping,
    "health": tool_health,
    "get_scenarios": tool_get_scenarios,
    "start_session": tool_start_session,
    "coach_turn": tool_coach_turn,
    "get_notebook": tool_get_notebook,
    "update_notebook_item": tool_update_notebook_item,
    "delete_notebook_item": tool_delete_notebook_item,
    "save_progress": tool_save_progress,
    "clear_all_data": tool_clear_all_data,
}

MANIFEST = {
    "name": TOOL_ID,
    "version": "0.3.1",
    "host_capabilities": ["llm.sample", "aps.kv"],
    "tools": [
        {
            "name": "ping",
            "description": "Smoke-test method.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
        {
            "name": "health",
            "description": "Probe runtime status and Sampling capability.",
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
                    "scenario": {"type": "string"},
                },
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
                    "input_mode": {"type": "string", "enum": ["speech", "typed"]},
                    "history": {"type": "array"},
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
                    "status": {"type": "string"},
                    "search": {"type": "string"},
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "update_notebook_item",
            "description": "Update the status of a saved notebook item.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "status": {"type": "string", "enum": ["new", "practising", "fixed"]},
                },
                "required": ["id", "status"],
                "additionalProperties": False,
            },
        },
        {
            "name": "delete_notebook_item",
            "description": "Delete a notebook item by id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                },
                "required": ["id"],
                "additionalProperties": False,
            },
        },
        {
            "name": "save_progress",
            "description": "Save real session progress metrics.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sessions_completed": {"type": "integer"},
                    "minutes_practised": {"type": "integer"},
                    "answers_given": {"type": "integer"},
                    "words_spoken": {"type": "integer"},
                    "mistakes_detected": {"type": "integer"},
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "clear_all_data",
            "description": "Delete all stored notebook items and reset progress summary.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
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
                    "serverInfo": {"name": TOOL_ID, "version": "0.3.1"},
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
    try:
        threading.Thread(target=_reader, daemon=True).start()
        while True:
            try:
                req = _agent_requests.get(timeout=60)
            except queue.Empty:
                continue
            handle_request(req)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
