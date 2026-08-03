import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeepgramDictationUrl,
  joinDictationText,
  parseDeepgramDictationMessage,
} from "../app/lib/deepgram-dictation";

test("builds a live Deepgram URL for 16 kHz browser microphone audio", () => {
  const url = new URL(createDeepgramDictationUrl());
  assert.equal(url.origin, "wss://api.deepgram.com");
  assert.equal(url.pathname, "/v1/listen");
  assert.equal(url.searchParams.get("model"), "nova-3");
  assert.equal(url.searchParams.get("encoding"), "linear16");
  assert.equal(url.searchParams.get("sample_rate"), "16000");
  assert.equal(url.searchParams.get("interim_results"), "true");
});

test("parses interim and final transcription results", () => {
  assert.deepEqual(
    parseDeepgramDictationMessage(JSON.stringify({
      type: "Results",
      is_final: false,
      speech_final: false,
      channel: { alternatives: [{ transcript: "the torn men" }] },
    })),
    { transcript: "the torn men", isFinal: false, speechFinal: false },
  );

  assert.deepEqual(
    parseDeepgramDictationMessage(JSON.stringify({
      type: "Results",
      is_final: true,
      speech_final: true,
      channel: { alternatives: [{ transcript: "the torn meniscus" }] },
    })),
    { transcript: "the torn meniscus", isFinal: true, speechFinal: true },
  );
});

test("ignores malformed and non-result messages", () => {
  assert.equal(parseDeepgramDictationMessage("not-json"), null);
  assert.equal(parseDeepgramDictationMessage(JSON.stringify({ type: "Metadata" })), null);
  assert.equal(parseDeepgramDictationMessage(new ArrayBuffer(0)), null);
});

test("joins typed and dictated answers without duplicate whitespace", () => {
  assert.equal(
    joinDictationText("  The surgeon may ", " trim the torn meniscus.  "),
    "The surgeon may trim the torn meniscus.",
  );
});
