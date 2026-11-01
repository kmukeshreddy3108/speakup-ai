import pytest
import speakup_ai_plugin as plugin


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
