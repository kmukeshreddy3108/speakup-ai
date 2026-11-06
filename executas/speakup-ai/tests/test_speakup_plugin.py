import pytest
from pathlib import Path
import speakup_ai_plugin as plugin


REGRESSION_CASES = [
    ("hello", "Hello."),
    ("i am", "I am."),
    ("hello there", "Hello there."),
    ("good morning", "Good morning."),
    ("how are you", "How are you?"),
    ("what is your name", "What is your name?"),
    ("where are you from", "Where are you from?"),
    ("i like reading", "I like reading."),
    ("i am a student", "I am a student."),
    ("this is my book", "This is my book."),
    ("hello  there", "Hello there."),
    ("I  am  ready", "I am ready."),
    ("hello , how are you", "Hello, how are you?"),
    ("I like tea .", "I like tea."),
    ("how are you ?", "How are you?"),
    ("i dont know", "I don't know."),
    ("i cant go", "I can't go."),
    ("she doesnt understand", "She doesn't understand."),
    ("we arent late", "We aren't late."),
    ("theyre working", "They're working."),
    ("speal", "Speak."),
    ("exiting", "Exciting."),
    ("recieve", "Receive."),
    ("becuase", "Because."),
    ("definately", "Definitely."),
    (" enviroment ", "Environment."),
    ("teh answer", "The answer."),
    ("I realy like it", "I really like it."),
    ("She go to school yesterday", "She went to school yesterday."),
    ("He don't like it", "He doesn't like it."),
    ("I have 20 years", "I am 20 years old."),
    ("how do are doing", "How are you doing?"),
    ("I has a car", "I have a car."),
    ("She have two books", "She has two books."),
    ("They was happy", "They were happy."),
    ("He were tired", "He was tired."),
    ("I is ready", "I am ready."),
    ("We is students", "We are students."),
    ("She walk to work", "She walks to work."),
    ("He play football", "He plays football."),
    ("I goed home", "I went home."),
    ("She buyed a gift", "She bought a gift."),
    ("I maked dinner", "I made dinner."),
    ("Yesterday I go to class", "Yesterday I went to class."),
    ("Last week she visit us", "Last week she visited us."),
    ("I am engineer", "I am an engineer."),
    ("She is doctor", "She is a doctor."),
    ("He is student", "He is a student."),
    ("I want go home", "I want to go home."),
    ("I enjoy to read", "I enjoy reading."),
    ("very much people like music", "Very many people like music."),
    ("I am good in English", "I am good at English."),
    ("depend of the weather", "Depend on the weather."),
    ("discuss about the problem", "Discuss the problem."),
    ("explain me this", "Explain this to me."),
    ("I look forward to meet you", "I look forward to meeting you."),
    ("Can you suggest me a topic", "Can you suggest a topic to me?"),
    ("What topic we can speak", "What topic can we speak about?"),
    ("Can you give me some topic that we can speal on", "Can you give me some topics that we can speak about?"),
    ("I don't know nothing", "I don't know anything."),
    ("She can sings well", "She can sing well."),
    ("I am agree with you", "I agree with you."),
    ("I did not went there", "I did not go there."),
    ("This informations are useful", "This information is useful."),
    ("The people is friendly", "The people are friendly."),
    ("I have finished my work", "I have finished my work."),
    ("She is studying English.", "She is studying English."),
    ("What time is it?", "What time is it?"),
    ("I am happy today.", "I am happy today."),
    ("They went home yesterday.", "They went home yesterday."),
]


@pytest.mark.parametrize("original, expected", REGRESSION_CASES)
def test_correction_regression_contract(original, expected):
    result = plugin.correct_sentence(original)
    assert result["corrected"] == expected
    if original in {"I have finished my work", "She is studying English.", "What time is it?", "I am happy today.", "They went home yesterday."}:
        assert result["isCorrect"] is True
        assert result["category"] == "Clear expression"
    else:
        assert result["isCorrect"] is False


def test_required_corrections():
    cases = {
        "hello how do are doing": "Hello, how are you doing?",
        "i am very exiting today": "I am very excited today.",
        "can you give me some topic that we can speal on": "Can you give me some topics that we can speak about?",
        "She go to school yesterday": "She went to school yesterday.",
        "I have 20 years": "I am 20 years old.",
    }
    for original, expected in cases.items():
        result = plugin.correct_sentence(original)
        assert result["corrected"] == expected
        assert result["isCorrect"] is False
        assert result["category"]
        assert result["explanation"]
        assert len(result["better_expressions"]) >= 1


def test_speech_transcript_punctuation_is_not_flagged_as_error():
    # In speech mode, missing leading capital or end period should not be treated as a mistake
    result = plugin.correct_sentence("hello", is_speech=True)
    assert result["isCorrect"] is True
    assert result["category"] == "Clear expression"

    result2 = plugin.correct_sentence("i am working on a new project", is_speech=True)
    assert result2["isCorrect"] is True


def test_correct_sentence_is_perfect_without_inventing_errors():
    result = plugin.correct_sentence("This sentence is correct.")
    assert result["isCorrect"] is True
    assert result["corrected"] == "This sentence is correct."
    assert result["better_expressions"] == []


def test_no_repeated_sentences_in_coach_turn():
    # Test deduplication directly
    reply = "Thanks for sharing that. What happened next, and how did you feel about it?"
    follow_up = "What happened next, and how did you feel about it?"
    clean_reply, clean_follow, full = plugin.deduplicate_sentences(reply, follow_up)

    sentences = [s.strip().lower() for s in full.split(".") if s.strip()]
    assert len(sentences) == len(set(sentences)), f"Duplicate sentence detected in: {full}"


def test_contextual_turn_for_greeting():
    reply, follow_up, topics = plugin.fallback_contextual_turn("hello", "introduction", 1)
    assert "Hello" in reply or "wonderful" in reply
    # Must NOT say "What happened next"
    assert "What happened next" not in reply
    assert "What happened next" not in follow_up
    assert follow_up  # Has a concrete opening question


def test_contextual_turn_for_short_answer():
    reply, follow_up, topics = plugin.fallback_contextual_turn("yes", "introduction", 2)
    assert "detail" in follow_up.lower() or "reason" in follow_up.lower() or "expand" in reply.lower()


def test_contextual_turn_for_topic_request():
    reply, follow_up, topics = plugin.fallback_contextual_turn(
        "Can you give me some topic that we can speak on?",
        "everyday",
        1,
    )
    assert len(topics) >= 3
    assert "topic" in follow_up.lower()


def test_malformed_coach_json_is_rejected():
    assert plugin._parse_coach_json("not json") is None
    assert plugin._parse_coach_json('{"reply": "Hi"}') is None
    parsed = plugin._parse_coach_json(
        '```json\n{"reply":"Thanks for sharing.","follow_up":"What next?","suggested_topics":[]}\n```'
    )
    assert parsed["reply"] == "Thanks for sharing."
    assert parsed["follow_up"] == "What next?"


def test_coach_json_includes_strict_correction_payload():
    parsed = plugin._parse_coach_json(
        '{"original":"hello","corrected":"Hello.","naturalAlternative":"Hi there.",'
        '"errors":[{"type":"capitalization","wrong":"hello","right":"Hello.","explanation":"Start with a capital."}],'
        '"isCorrect":false,"reply":"You greeted me clearly.","followUp":"Where are you from?"}'
    )
    assert parsed["correction"]["corrected"] == "Hello."
    assert parsed["correction"]["errors"][0]["right"] == "Hello."


def test_coach_turn_uses_rule_based_fallback_when_sampling_unavailable():
    original = plugin._sampling_available
    plugin._sampling_available = False
    try:
        result = plugin.tool_coach_turn(
            {
                "user_input": "i am very exiting today",
                "scenario_key": "everyday",
                "turn_number": 1,
                "session_id": "test-session",
                "input_mode": "typed",
            },
            {},
            "test-invoke",
        )
    finally:
        plugin._sampling_available = original

    assert result["success"] is True
    data = result["data"]
    assert data["source"] == "rules"
    assert data["is_scripted"] is True
    assert data["correction"]["corrected"] == "I am very excited today."
    assert data["follow_up"]
    # Verify no repeated sentence in full_message
    full = data["full_message"]
    sentences = [s.strip().lower() for s in full.split(".") if s.strip()]
    assert len(sentences) == len(set(sentences))


def test_health_check_reports_honest_status():
    res = plugin.tool_health({}, {}, "test-invoke")
    assert res["success"] is True
    assert res["data"]["status"] == "ready"
    assert res["data"]["default_source"] in ("ai", "rules")


def test_start_session_contract():
    result = plugin.tool_start_session({"scenario": "everyday"}, {}, "test-invoke")
    assert result["success"] is True
    assert result["data"]["total_turns"] is None
    assert result["data"]["source"] in ("ai", "rules")
    assert result["data"]["opening_prompt"]


def test_fallback_answers_user_question_without_generic_praise():
    original = plugin._sampling_available
    plugin._sampling_available = False
    try:
        result = plugin.tool_coach_turn(
            {"user_input": "What topic can we discuss?", "scenario_key": "everyday",
             "turn_number": 1, "session_id": "test-session", "input_mode": "typed"},
            {}, "test-invoke",
        )
    finally:
        plugin._sampling_available = original
    data = result["data"]
    assert "great conversational question" not in data["full_message"].lower()
    assert "topic" in data["follow_up"].lower()
    assert data["correction"]["errors"] == []
    assert data["correction"]["naturalAlternative"]


def test_manifest_matches_anna_protocol_and_disk_manifest():
    import json
    from pathlib import Path

    manifest = plugin.MANIFEST
    assert manifest["name"] == plugin.TOOL_ID
    assert manifest["version"] == "0.3.2"
    assert "display_name" in manifest
    assert "description" in manifest
    assert isinstance(manifest["tools"], list)
    assert len(manifest["tools"]) == 10

    valid_types = {"string", "integer", "number", "boolean", "array", "object"}
    tool_names = set()

    for t in manifest["tools"]:
        assert "name" in t
        assert "description" in t
        assert t["name"] not in tool_names, f"Duplicate tool name: {t['name']}"
        tool_names.add(t["name"])

        # Tool parameters must be a list of objects, NOT a JSON schema object
        params = t.get("parameters")
        assert isinstance(params, list), f"Tool {t['name']} parameters must be a list, got {type(params)}"

        for p in params:
            assert isinstance(p, dict)
            assert "name" in p
            assert "type" in p
            assert p["type"] in valid_types, f"Invalid param type '{p['type']}' in tool {t['name']}"
            if p["type"] == "array":
                assert "items" in p or "items_type" in p, f"Array parameter {p['name']} missing items/items_type"

    # Compare with manifest.json on disk
    manifest_disk_path = Path(__file__).resolve().parent.parent / "manifest.json"
    assert manifest_disk_path.exists(), f"Missing {manifest_disk_path}"
    with open(manifest_disk_path, "r", encoding="utf-8") as f:
        disk_data = json.load(f)
    assert disk_data["name"] == manifest["name"]
    assert disk_data["version"] == manifest["version"]
    assert len(disk_data["tools"]) == len(manifest["tools"])


def test_stdio_describe_and_clean_exit_on_eof():
    import subprocess
    import json
    import sys

    plugin_py = Path(plugin.__file__).resolve()
    proc = subprocess.Popen(
        [sys.executable, str(plugin_py)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    try:
        # Request 1: describe
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "describe"}) + "\n")
        proc.stdin.flush()
        line1 = proc.stdout.readline()
        assert line1, "describe produced no response"
        resp1 = json.loads(line1.strip())
        assert resp1["jsonrpc"] == "2.0"
        assert resp1["id"] == 1
        assert "result" in resp1
        assert resp1["result"]["name"] == plugin.TOOL_ID
        assert isinstance(resp1["result"]["tools"], list)

        # Request 2: follow-up health request
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "health"}) + "\n")
        proc.stdin.flush()
        line2 = proc.stdout.readline()
        assert line2, "health produced no response"
        resp2 = json.loads(line2.strip())
        assert resp2["jsonrpc"] == "2.0"
        assert resp2["id"] == 2
        assert resp2["result"]["status"] == "ready"

        # Request 3: unknown method error check
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 3, "method": "unknown_test"}) + "\n")
        proc.stdin.flush()
        line3 = proc.stdout.readline()
        resp3 = json.loads(line3.strip())
        assert resp3["id"] == 3
        assert resp3["error"]["code"] == -32601

        # Request 4: malformed JSON ignored without crashing
        proc.stdin.write("{not json}\n")
        proc.stdin.flush()
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 4, "method": "ping"}) + "\n")
        proc.stdin.flush()
        line4 = proc.stdout.readline()
        resp4 = json.loads(line4.strip())
        assert resp4["id"] == 4

        # Close stdin and assert clean exit
        proc.stdin.close()
        exit_code = proc.wait(timeout=3)
        assert exit_code == 0, f"Process exited with non-zero code: {exit_code}"
    finally:
        if proc.poll() is None:
            proc.kill()
