const DEEPGRAM_LIVE_LISTEN_URL = "wss://api.deepgram.com/v1/listen";

export interface DeepgramDictationResult {
  transcript: string;
  isFinal: boolean;
  speechFinal: boolean;
}

export function createDeepgramDictationUrl(): string {
  const url = new URL(DEEPGRAM_LIVE_LISTEN_URL);
  url.searchParams.set("model", "nova-3");
  url.searchParams.set("language", "en-US");
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", "16000");
  url.searchParams.set("channels", "1");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("interim_results", "true");
  url.searchParams.set("endpointing", "300");
  url.searchParams.set("utterance_end_ms", "1000");
  return url.toString();
}

export function parseDeepgramDictationMessage(
  payload: unknown,
): DeepgramDictationResult | null {
  if (typeof payload !== "string") return null;

  let message: unknown;
  try {
    message = JSON.parse(payload);
  } catch {
    return null;
  }

  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    message.type !== "Results" ||
    !("channel" in message) ||
    typeof message.channel !== "object" ||
    message.channel === null ||
    !("alternatives" in message.channel) ||
    !Array.isArray(message.channel.alternatives)
  ) {
    return null;
  }

  const firstAlternative = message.channel.alternatives[0];
  const transcript =
    typeof firstAlternative === "object" &&
    firstAlternative !== null &&
    "transcript" in firstAlternative &&
    typeof firstAlternative.transcript === "string"
      ? firstAlternative.transcript.trim()
      : "";

  return {
    transcript,
    isFinal: "is_final" in message && message.is_final === true,
    speechFinal: "speech_final" in message && message.speech_final === true,
  };
}

export function joinDictationText(...parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}
