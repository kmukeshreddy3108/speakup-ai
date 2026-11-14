/**
 * bundle/agent-stream.js
 *
 * Robust Agent Session stream consumer, sentinel stripper, and structured response parser.
 * Follows Build on Anna Guide 103 (Agent Session usage).
 */

const SENTINEL_PATTERNS = [
  /^(\[DONE\]|DONE|\[END\]|data:\s*\[DONE\]|<\|im_end\|>|<\|endoftext\|>|<!--\s*end\s*-->)\s*$/i,
];

/**
 * Check if a text chunk is a stream sentinel rather than actual content.
 * @param {string} text
 * @returns {boolean}
 */
export function isStreamSentinel(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return SENTINEL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Defensively clean any stream sentinels or artifacts from accumulated text.
 * @param {string} text
 * @returns {string}
 */
export function cleanSentinels(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\[DONE\]/gi, "")
    .replace(/\[END\]/gi, "")
    .replace(/<\|im_end\|>/gi, "")
    .replace(/<\|endoftext\|>/gi, "")
    .trim();
}

/**
 * Extract the text delta from an individual stream frame.
 * Supports:
 * - chunk.delta.content (standard OpenAI/Anthropic SSE delta)
 * - chunk.choices[0].delta.content (chat completions stream format)
 * - chunk.text (when event is "model_token" or "text_delta", or generic string)
 * - chunk.delta.text
 * - chunk.content (when string)
 *
 * @param {object} chunk - Raw stream event frame
 * @returns {string} extracted text delta (or empty string if none)
 */
export function extractTextDelta(chunk) {
  if (!chunk || typeof chunk !== "object") return "";

  // 1. Skip protocol/lifecycle/meta frames
  const event = chunk.event;
  if (
    event === "run_meta" ||
    event === "task_complete" ||
    event === "task_cancelled" ||
    event === "complete" ||
    event === "end" ||
    event === "error"
  ) {
    return "";
  }

  // 2. Extract delta content from known fields
  let delta = "";
  if (typeof chunk.delta?.content === "string") {
    delta = chunk.delta.content;
  } else if (typeof chunk.choices?.[0]?.delta?.content === "string") {
    delta = chunk.choices[0].delta.content;
  } else if (
    event === "model_token" ||
    event === "text_delta" ||
    (typeof chunk.text === "string" && event !== "raw")
  ) {
    delta = chunk.text || "";
  } else if (typeof chunk.delta?.text === "string") {
    delta = chunk.delta.text;
  } else if (typeof chunk.content === "string") {
    delta = chunk.content;
  }

  // 3. Reject sentinels immediately
  if (isStreamSentinel(delta)) {
    return "";
  }

  return delta;
}

/**
 * Read and accumulate an Agent Session stream.
 *
 * @param {AsyncIterable} stream - The stream returned by agentSession.run()
 * @param {object} options
 * @param {function(string, string): void} [options.onToken] - Called on each delta: (delta, accumulated)
 * @param {AbortSignal} [options.signal] - Signal to abort stream consumption
 * @param {boolean} [options.logFrames] - Whether to log raw frames for debugging
 * @returns {Promise<{ text: string, rawFrames: Array<object>, wasCancelled: boolean, error: string|null }>}
 */
export async function readAgentStream(stream, options = {}) {
  const { onToken, signal, logFrames = false } = options;
  let accumulated = "";
  const rawFrames = [];
  let wasCancelled = false;
  let streamError = null;

  try {
    for await (const chunk of stream) {
      if (signal?.aborted) {
        wasCancelled = true;
        break;
      }
      if (!chunk || typeof chunk !== "object") continue;

      if (logFrames) {
        console.debug("[AgentStream Frame]", chunk);
      }
      rawFrames.push(chunk);

      if (chunk.event === "error") {
        streamError = chunk.message || chunk.error || "Stream returned error frame";
        continue;
      }
      if (chunk.event === "task_cancelled") {
        wasCancelled = true;
        break;
      }

      const delta = extractTextDelta(chunk);
      if (delta) {
        accumulated += delta;
        if (onToken) {
          onToken(delta, cleanSentinels(accumulated));
        }
      }
    }
  } catch (err) {
    streamError = err.message || String(err);
  }

  const cleanedText = cleanSentinels(accumulated);
  return {
    text: cleanedText,
    rawFrames,
    wasCancelled: wasCancelled || !!signal?.aborted,
    error: streamError,
  };
}

/**
 * Parse structured coach output if present (e.g. JSON reply + followUp + correction).
 * If the model returned plain conversational text, wrap it cleanly.
 * Guarantees the UI never displays raw JSON or protocol markers.
 *
 * @param {string} rawText
 * @returns {{ reply: string, followUp: string, correction: object|null, hint: string|null, isStructured: boolean }}
 */
export function parseCoachStructuredResponse(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { reply: "", followUp: "", correction: null, hint: null, isStructured: false };
  }

  const cleaned = cleanSentinels(rawText).trim();
  if (!cleaned) {
    return { reply: "", followUp: "", correction: null, hint: null, isStructured: false };
  }

  // Try parsing JSON block if fenced or bare
  let jsonString = "";
  const fencedMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fencedMatch) {
    jsonString = fencedMatch[1].trim();
  } else if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    jsonString = cleaned;
  }

  if (jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed && typeof parsed === "object") {
        const reply = typeof parsed.reply === "string" ? cleanSentinels(parsed.reply) : "";
        const followUp = typeof parsed.followUp === "string" ? cleanSentinels(parsed.followUp) : "";
        const hint = typeof parsed.hint === "string" ? cleanSentinels(parsed.hint) : null;
        let correction = null;

        if (parsed.correction && typeof parsed.correction === "object") {
          correction = {
            original: String(parsed.correction.original || ""),
            corrected: String(parsed.correction.corrected || ""),
            explanation: String(parsed.correction.explanation || ""),
            alternative: parsed.correction.alternative ? String(parsed.correction.alternative) : null,
          };
        }

        if (reply || followUp) {
          return {
            reply,
            followUp,
            correction,
            hint,
            isStructured: true,
          };
        }
      }
    } catch {
      // JSON parse failed; fall back to plain text
    }
  }

  // Plain conversational text
  return {
    reply: cleaned,
    followUp: "",
    correction: null,
    hint: null,
    isStructured: false,
  };
}

