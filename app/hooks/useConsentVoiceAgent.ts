"use client";

import {
  AgentMicrophone,
  AgentPlayer,
  AgentSession,
  type FunctionCallItem,
} from "@deepgram/agents";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  createConsentVoiceSessionConfig,
  createDeepgramTokenFactory,
  normalizeVoiceToolCall,
  serializeVoiceToolResult,
  type VoiceToolCall,
  type VoiceToolExecutionResult,
  type VoiceToolHandler,
} from "@/app/lib/voice-agent";

export type ConsentVoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "error";

export interface VoiceTranscriptEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface UseConsentVoiceAgentOptions {
  onToolCall: VoiceToolHandler;
  tokenEndpoint?: string;
  onTranscript?: (entry: VoiceTranscriptEntry) => void;
  onStatusChange?: (status: ConsentVoiceStatus) => void;
}

export interface ConsentVoiceStartOptions {
  /** Defaults to true. Set false for typed-only sessions that must not request mic access. */
  microphone?: boolean;
}

export interface ConsentVoiceAgentController {
  status: ConsentVoiceStatus;
  transcript: VoiceTranscriptEntry[];
  error: string | null;
  warning: string | null;
  sessionId: string | null;
  isActive: boolean;
  microphoneEnabled: boolean;
  microphoneMuted: boolean;
  outputMuted: boolean;
  start: (options?: ConsentVoiceStartOptions) => Promise<void>;
  stop: () => void;
  sendText: (content: string) => boolean;
  toggleMicrophone: () => boolean;
  toggleOutput: () => boolean;
  clearTranscript: () => void;
}

function friendlyError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was blocked. Allow microphone access, then try again.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "description" in error &&
    typeof error.description === "string"
  ) {
    return error.description;
  }
  return "The voice guide could not continue. Please try again.";
}

function defaultToolSuccess(call: VoiceToolCall): VoiceToolExecutionResult {
  const messages: Record<VoiceToolCall["name"], string> = {
    open_consent_section: "The requested consent section is now open.",
    focus_anatomy: "The requested anatomy and camera view are now visible.",
    preview_procedure_step: "The requested illustrated procedure step is now visible.",
    focus_option: "The requested option is now in focus; no preference was recorded.",
    request_human: "The confirmed handoff request is ready for the patient to review.",
  };
  return { ok: true, message: messages[call.name] };
}

/**
 * Owns one opt-in Deepgram Voice Agent session. Nothing connects and the
 * microphone is never requested until `start()` is called from a user gesture.
 */
export function useConsentVoiceAgent({
  onToolCall,
  tokenEndpoint = "/api/deepgram-token",
  onTranscript,
  onStatusChange,
}: UseConsentVoiceAgentOptions): ConsentVoiceAgentController {
  const [status, setStatus] = useState<ConsentVoiceStatus>("idle");
  const [transcript, setTranscript] = useState<VoiceTranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [outputMuted, setOutputMuted] = useState(false);

  const sessionRef = useRef<AgentSession | null>(null);
  const microphoneRef = useRef<AgentMicrophone | null>(null);
  const playerRef = useRef<AgentPlayer | null>(null);
  const mountedRef = useRef(true);
  const manualStopRef = useRef(false);
  const generationRef = useRef(0);
  const startingRef = useRef(false);
  const transcriptCounterRef = useRef(0);
  const audioDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onToolCall, onTranscript, onStatusChange });

  useEffect(() => {
    callbacksRef.current = { onToolCall, onTranscript, onStatusChange };
  }, [onStatusChange, onToolCall, onTranscript]);

  const updateStatus = useCallback((next: ConsentVoiceStatus) => {
    if (!mountedRef.current) return;
    setStatus(next);
    callbacksRef.current.onStatusChange?.(next);
  }, []);

  const clearAudioDoneTimer = useCallback(() => {
    if (audioDoneTimerRef.current !== null) {
      clearTimeout(audioDoneTimerRef.current);
      audioDoneTimerRef.current = null;
    }
  }, []);

  const disposeSession = useCallback(() => {
    clearAudioDoneTimer();

    const microphone = microphoneRef.current;
    const session = sessionRef.current;
    const player = playerRef.current;
    microphoneRef.current = null;
    sessionRef.current = null;
    playerRef.current = null;

    microphone?.stop();
    session?.disconnect();
    session?.removeAllListeners();
    player?.dispose();
  }, [clearAudioDoneTimer]);

  const failSession = useCallback((reason: unknown) => {
    manualStopRef.current = true;
    generationRef.current += 1;
    startingRef.current = false;
    disposeSession();
    if (mountedRef.current) {
      setSessionId(null);
      setActive(false);
      setMicrophoneEnabled(false);
      setMicrophoneMuted(false);
      setOutputMuted(false);
      setWarning(null);
      setError(friendlyError(reason));
    }
    updateStatus("error");
  }, [disposeSession, updateStatus]);

  const appendTranscript = useCallback(
    (role: "user" | "assistant", content: string) => {
      const normalized = content.trim();
      if (!normalized || !mountedRef.current) return;

      transcriptCounterRef.current += 1;
      const entry: VoiceTranscriptEntry = {
        id: `voice-${transcriptCounterRef.current}`,
        role,
        content: normalized,
        createdAt: Date.now(),
      };
      setTranscript((current) => [...current.slice(-39), entry]);
      callbacksRef.current.onTranscript?.(entry);
    },
    [],
  );

  const executeFunctionCall = useCallback(
    async (session: AgentSession, wireCall: FunctionCallItem) => {
      if (!wireCall.client_side) return;

      const normalized = normalizeVoiceToolCall(wireCall);
      if (!normalized.ok) {
        session.sendFunctionCallResponse(
          wireCall.id,
          wireCall.name,
          serializeVoiceToolResult({ ok: false, error: normalized.error }),
        );
        if (mountedRef.current) setError(`Voice command rejected: ${normalized.error}`);
        return;
      }

      let result: VoiceToolExecutionResult;
      try {
        const handlerResult = await callbacksRef.current.onToolCall(normalized.call);
        result = handlerResult ?? defaultToolSuccess(normalized.call);
      } catch (toolError) {
        result = { ok: false, error: friendlyError(toolError) };
      }

      session.sendFunctionCallResponse(
        wireCall.id,
        wireCall.name,
        serializeVoiceToolResult(result),
      );

      if (!result.ok && mountedRef.current) {
        setError(`The requested interface action failed: ${result.error}`);
      }
    },
    [],
  );

  const start = useCallback(async (
    options: ConsentVoiceStartOptions = {},
  ) => {
    if (startingRef.current || sessionRef.current) return;

    const shouldUseMicrophone = options.microphone !== false;
    startingRef.current = true;
    manualStopRef.current = false;
    const generation = ++generationRef.current;
    if (mountedRef.current) {
      setTranscript([]);
      transcriptCounterRef.current = 0;
      setError(null);
      setWarning(null);
      setMicrophoneEnabled(shouldUseMicrophone);
      setMicrophoneMuted(false);
      setOutputMuted(false);
    }
    updateStatus("connecting");

    const session = new AgentSession(
      createConsentVoiceSessionConfig(
        createDeepgramTokenFactory(tokenEndpoint),
      ),
    );
    const player = new AgentPlayer({ sampleRate: 24_000 });
    // Prime playback while this function is still running from the user's
    // button gesture. This gives strict autoplay browsers an unlocked context
    // before the agent's first audio packet arrives.
    player.queue(new Int16Array(8).buffer);
    const microphone = shouldUseMicrophone
      ? new AgentMicrophone(
          (audio) => session.sendAudio(audio),
          {
            sampleRate: 16_000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        )
      : null;

    sessionRef.current = session;
    playerRef.current = player;
    microphoneRef.current = microphone;
    if (mountedRef.current) setActive(true);

    session.on("connecting", () => updateStatus("connecting"));
    session.on("connected", () => updateStatus("connecting"));
    session.on("settings-applied", () => {
      if (mountedRef.current) setSessionId(session.getId());
      updateStatus("listening");
    });
    session.on("welcome", (message) => {
      if (mountedRef.current) {
        setSessionId(session.getId() ?? message.request_id ?? null);
      }
    });
    session.on("conversation-text", (message) => {
      if (message.role === "user" || message.role === "assistant") {
        appendTranscript(message.role, message.content);
      }
    });
    session.on("user-started-speaking", () => {
      clearAudioDoneTimer();
      player.interrupt();
      updateStatus("listening");
    });
    session.on("agent-thinking", () => updateStatus("thinking"));
    session.on("agent-started-speaking", () => updateStatus("speaking"));
    session.on("audio", (chunk) => player.queue(chunk));
    session.on("agent-audio-done", () => {
      clearAudioDoneTimer();
      const delayMs = Math.max(0, Math.ceil(player.getRemainingPlaybackTime() * 1_000));
      audioDoneTimerRef.current = setTimeout(() => {
        audioDoneTimerRef.current = null;
        updateStatus("listening");
      }, delayMs);
    });
    session.on("function-call-request", (message) => {
      void (async () => {
        for (const functionCall of message.functions) {
          await executeFunctionCall(session, functionCall);
        }
      })();
    });
    session.on("reconnecting", () => updateStatus("reconnecting"));
    session.on("warning", (message) => {
      if (mountedRef.current) setWarning(message.description);
    });
    session.on("injection-refused", (message) => {
      if (mountedRef.current) setError(message.message);
      updateStatus("listening");
    });
    session.on("error", (message) => {
      failSession(message.description);
    });
    session.on("sdk-error", (sessionError) => {
      // AgentSession schedules reconnect immediately after emitting this event.
      // Defer teardown one microtask so disconnect() can cancel that timer too.
      queueMicrotask(() => {
        if (sessionRef.current === session) failSession(sessionError);
      });
    });
    session.on("disconnected", (reason) => {
      if (manualStopRef.current) {
        updateStatus("idle");
        return;
      }
      failSession(reason || "The voice session disconnected.");
    });
    microphone?.on("error", (microphoneError) => {
      failSession(microphoneError);
    });

    try {
      // Request the microphone immediately inside the caller's user gesture.
      // Audio frames are safely buffered by AgentSession until settings apply.
      await microphone?.start();
      if (!mountedRef.current || generation !== generationRef.current) {
        microphone?.stop();
        return;
      }

      await session.connect();
      if (!mountedRef.current || generation !== generationRef.current) {
        session.disconnect();
        microphone?.stop();
        player.dispose();
      }
    } catch (startError) {
      if (generation === generationRef.current) {
        disposeSession();
        if (mountedRef.current) {
          setActive(false);
          setMicrophoneEnabled(false);
          setError(friendlyError(startError));
        }
        updateStatus("error");
      }
    } finally {
      if (generation === generationRef.current) startingRef.current = false;
    }
  }, [
    appendTranscript,
    clearAudioDoneTimer,
    disposeSession,
    executeFunctionCall,
    failSession,
    tokenEndpoint,
    updateStatus,
  ]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    generationRef.current += 1;
    startingRef.current = false;
    disposeSession();
    if (mountedRef.current) {
      setSessionId(null);
      setActive(false);
      setMicrophoneEnabled(false);
      setError(null);
      setWarning(null);
      setMicrophoneMuted(false);
      setOutputMuted(false);
    }
    updateStatus("idle");
  }, [disposeSession, updateStatus]);

  const sendText = useCallback((content: string): boolean => {
    const normalized = content.trim();
    const session = sessionRef.current;
    if (!normalized || !session || session.state !== "connected") return false;
    clearAudioDoneTimer();
    playerRef.current?.interrupt();
    session.injectUserMessage(normalized);
    if (mountedRef.current) setError(null);
    updateStatus("thinking");
    return true;
  }, [clearAudioDoneTimer, updateStatus]);

  const toggleMicrophone = useCallback((): boolean => {
    const microphone = microphoneRef.current;
    if (!microphone) return false;
    if (microphone.muted) {
      microphone.unmute();
      if (mountedRef.current) setMicrophoneMuted(false);
    } else {
      microphone.mute();
      if (mountedRef.current) setMicrophoneMuted(true);
    }
    return true;
  }, []);

  const toggleOutput = useCallback((): boolean => {
    const player = playerRef.current;
    if (!player) return false;
    if (player.muted) {
      player.unmute();
      if (mountedRef.current) setOutputMuted(false);
    } else {
      player.mute();
      if (mountedRef.current) setOutputMuted(true);
    }
    return true;
  }, []);

  const clearTranscript = useCallback(() => setTranscript([]), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      manualStopRef.current = true;
      generationRef.current += 1;
      disposeSession();
    };
  }, [disposeSession]);

  return {
    status,
    transcript,
    error,
    warning,
    sessionId,
    isActive: active,
    microphoneEnabled,
    microphoneMuted,
    outputMuted,
    start,
    stop,
    sendText,
    toggleMicrophone,
    toggleOutput,
    clearTranscript,
  };
}
