import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isStreamSentinel,
  cleanSentinels,
  extractTextDelta,
  readAgentStream,
  parseCoachStructuredResponse,
} from "../bundle/agent-stream.js";

async function* mockStream(frames) {
  for (const f of frames) {
    yield f;
  }
}

describe("Agent Stream Reader & Sentinel Stripper", () => {
  it("detects and rejects sentinel end markers", () => {
    assert.equal(isStreamSentinel("[DONE]"), true);
    assert.equal(isStreamSentinel("DONE"), true);
    assert.equal(isStreamSentinel("[END]"), true);
    assert.equal(isStreamSentinel("data: [DONE]"), true);
    assert.equal(isStreamSentinel("<|im_end|>"), true);
    assert.equal(isStreamSentinel("Hello world!"), false);
    assert.equal(isStreamSentinel(""), false);
  });

  it("defensively cleans embedded sentinels", () => {
    assert.equal(cleanSentinels("Hello world! [DONE]"), "Hello world!");
    assert.equal(cleanSentinels("[DONE]"), "");
    assert.equal(cleanSentinels("Practice conversation. [END]"), "Practice conversation.");
  });

  it("extracts text from various delta formats and ignores meta frames", () => {
    // OpenAI delta.content
    assert.equal(extractTextDelta({ delta: { content: "Good " } }), "Good ");
    // Chat completion choices[0].delta.content
    assert.equal(extractTextDelta({ choices: [{ delta: { content: "job!" } }] }), "job!");
    // Model token event
    assert.equal(extractTextDelta({ event: "model_token", text: " Keep going." }), " Keep going.");
    // Delta text
    assert.equal(extractTextDelta({ delta: { text: " You speak well." } }), " You speak well.");
    // Plain content string
    assert.equal(extractTextDelta({ content: " Well done." }), " Well done.");
    // Sentinel frame
    assert.equal(extractTextDelta({ event: "raw", text: "[DONE]" }), "");
    assert.equal(extractTextDelta({ text: "[DONE]" }), "");
    // Protocol lifecycle frames
    assert.equal(extractTextDelta({ event: "run_meta", meta: {} }), "");
    assert.equal(extractTextDelta({ event: "task_complete", status: "completed" }), "");
    assert.equal(extractTextDelta({ event: "end" }), "");
    assert.equal(extractTextDelta({ event: "complete", content: [] }), "");
    assert.equal(extractTextDelta({ event: "error", message: "Failed" }), "");
  });

  it("reads a normal text stream split across many chunks", async () => {
    const stream = mockStream([
      { event: "run_meta", run_id: "r1" },
      { delta: { content: "That " } },
      { delta: { content: "is " } },
      { delta: { content: "a " } },
      { delta: { content: "great " } },
      { delta: { content: "answer!" } },
      { event: "complete" },
      { event: "raw", text: "[DONE]" },
      { event: "end" },
    ]);

    const res = await readAgentStream(stream);
    assert.equal(res.text, "That is a great answer!");
    assert.equal(res.wasCancelled, false);
    assert.equal(res.error, null);
    assert.equal(res.rawFrames.length, 9);
  });

  it("handles sentinel-only stream by returning empty text without rendering '[DONE]'", async () => {
    const stream = mockStream([
      { event: "run_meta", run_id: "r2" },
      { event: "raw", text: "[DONE]" },
      { event: "end" },
    ]);

    const res = await readAgentStream(stream);
    assert.equal(res.text, "");
    assert.equal(res.error, null);
  });

  it("handles empty stream", async () => {
    const stream = mockStream([]);
    const res = await readAgentStream(stream);
    assert.equal(res.text, "");
    assert.equal(res.error, null);
  });

  it("captures error frame gracefully", async () => {
    const stream = mockStream([
      { delta: { content: "Partial start..." } },
      { event: "error", message: "Model timeout" },
    ]);

    const res = await readAgentStream(stream);
    assert.equal(res.text, "Partial start...");
    assert.equal(res.error, "Model timeout");
  });

  it("handles cancelled stream using AbortSignal", async () => {
    const controller = new AbortController();
    async function* cancellableStream() {
      yield { delta: { content: "Word 1 " } };
      controller.abort();
      yield { delta: { content: "Word 2" } };
    }

    const res = await readAgentStream(cancellableStream(), { signal: controller.signal });
    assert.equal(res.text, "Word 1");
    assert.equal(res.wasCancelled, true);
  });

  it("handles very long reply without truncation or buffer issues", async () => {
    const chunks = [];
    for (let i = 0; i < 500; i++) {
      chunks.push({ delta: { content: `token${i} ` } });
    }
    chunks.push({ event: "raw", text: "[DONE]" });

    const res = await readAgentStream(mockStream(chunks));
    assert.ok(res.text.startsWith("token0 token1"));
    assert.ok(res.text.endsWith("token499"));
    assert.ok(!res.text.includes("[DONE]"));
  });
});

describe("Structured Response Parser", () => {
  it("parses valid JSON response block", () => {
    const raw = JSON.stringify({
      reply: "Excellent job describing your project.",
      followUp: "What was the most challenging technical hurdle you faced?",
      correction: {
        original: "I am having 5 years experience.",
        corrected: "I have 5 years of experience.",
        explanation: "In English, we use 'have experience' rather than 'having'.",
        alternative: "I bring five years of hands-on experience.",
      },
      hint: "Use the STAR method to structure your answer.",
    });

    const parsed = parseCoachStructuredResponse(raw);
    assert.equal(parsed.isStructured, true);
    assert.equal(parsed.reply, "Excellent job describing your project.");
    assert.equal(parsed.followUp, "What was the most challenging technical hurdle you faced?");
    assert.equal(parsed.correction.original, "I am having 5 years experience.");
    assert.equal(parsed.correction.corrected, "I have 5 years of experience.");
    assert.equal(parsed.hint, "Use the STAR method to structure your answer.");
  });

  it("parses fenced ```json markdown blocks", () => {
    const raw = "```json\n" + JSON.stringify({
      reply: "Good introduction!",
      followUp: "Can you tell me about your college background?",
    }) + "\n```";

    const parsed = parseCoachStructuredResponse(raw);
    assert.equal(parsed.isStructured, true);
    assert.equal(parsed.reply, "Good introduction!");
    assert.equal(parsed.followUp, "Can you tell me about your college background?");
  });

  it("falls back cleanly to plain conversational text when JSON is malformed", () => {
    const raw = "Here is my advice: { invalid json: 123";
    const parsed = parseCoachStructuredResponse(raw);
    assert.equal(parsed.isStructured, false);
    assert.equal(parsed.reply, "Here is my advice: { invalid json: 123");
    assert.equal(parsed.followUp, "");
  });

  it("strips sentinels from structured reply fields", () => {
    const raw = JSON.stringify({
      reply: "Great point! [DONE]",
      followUp: "Would you agree? [END]",
    });

    const parsed = parseCoachStructuredResponse(raw);
    assert.equal(parsed.reply, "Great point!");
    assert.equal(parsed.followUp, "Would you agree?");
  });
});

