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
  createVoiceNarrationBarrier,
  getRequestedProcedureDestination,
  getVoiceFunctionProtocolErrors,
  isFullProcedureWalkthroughRequest,
  isVisualizationVoiceToolCall,
  normalizeVoiceToolCall,
  recoverLiteralVisualizationToolCall,
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
    show_body_overview: "The requested whole-body view is now visible.",
    focus_body_region: "The configured procedure region is now in focus.",
    enter_procedure: "The detailed procedure visualization is now visible.",
    play_procedure_step: "The requested approved procedure step is now visible.",
    highlight_structure: "The requested approved structure is now highlighted.",
    set_visual_mode: "The requested visualization mode is now active.",
    return_to_overview: "The visualization returned to the whole-body overview.",
    inspect_current_visual: "The current visualization context is ready to explain.",
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
  const suppressAgentAudioRef = useRef(false);
  const literalRecoveryRef = useRef<{
    session: AgentSession;
    audioDone: boolean;
    narration: string | null;
  } | null>(null);
  const autoWalkthroughRef = useRef(false);
  const pendingWalkthroughContinuationRef = useRef<{
    session: AgentSession;
    instruction: string;
  } | null>(null);
  const internalUserMessagesRef = useRef<Set<string>>(new Set());
  const pendingDirectVisualCallRef = useRef<ReturnType<
    typeof getRequestedProcedureDestination
  >>(null);
  const pendingVisualReferenceRef = useRef<string | null>(null);
  const toolExecutionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const voiceNarrationBarrierRef = useRef(createVoiceNarrationBarrier());
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
    voiceNarrationBarrierRef.current.transition("reset");
    suppressAgentAudioRef.current = false;
    literalRecoveryRef.current = null;
    autoWalkthroughRef.current = false;
    pendingWalkthroughContinuationRef.current = null;
    internalUserMessagesRef.current.clear();
    pendingDirectVisualCallRef.current = null;
    pendingVisualReferenceRef.current = null;

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

  const applyPendingPatientIntent = useCallback((call: VoiceToolCall): VoiceToolCall => {
    const directDestination = pendingDirectVisualCallRef.current;
    if (directDestination) {
      pendingDirectVisualCallRef.current = null;
      return { ...directDestination, id: call.id };
    }

    if (call.name === "inspect_current_visual") {
      const reference = call.arguments.reference ?? pendingVisualReferenceRef.current;
      pendingVisualReferenceRef.current = null;
      return {
        ...call,
        arguments: {
          ...(reference ? { reference } : {}),
        },
      };
    }
    return call;
  }, []);

  const executeFunctionCall = useCallback(
    async (
      session: AgentSession,
      wireCall: FunctionCallItem,
      protocolError?: string,
    ) => {
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

      if (protocolError) {
        session.sendFunctionCallResponse(
          wireCall.id,
          wireCall.name,
          serializeVoiceToolResult({ ok: false, error: protocolError }),
        );
        if (mountedRef.current) setError(`Voice command rejected: ${protocolError}`);
        return;
      }

      const patientGroundedCall = applyPendingPatientIntent(normalized.call);
      const visualizationCall = isVisualizationVoiceToolCall(patientGroundedCall);
      if (visualizationCall) {
        // A model-generated visual call has already continued the sequence, so
        // cancel any client-side continuation that was waiting for narration.
        pendingWalkthroughContinuationRef.current = null;
        await voiceNarrationBarrierRef.current.waitUntilReady();
        if (sessionRef.current !== session) return;
      }

      let result: VoiceToolExecutionResult;
      try {
        const handlerResult = await callbacksRef.current.onToolCall(patientGroundedCall);
        if (visualizationCall) {
          result = handlerResult?.ok && handlerResult.settled?.transitionCompleted
            ? handlerResult
            : handlerResult && !handlerResult.ok
              ? handlerResult
              : {
                  ok: false,
                  error:
                    "The visualization did not confirm that its transition settled, so narration was paused.",
                };
        } else {
          result = handlerResult ?? defaultToolSuccess(patientGroundedCall);
        }
      } catch (toolError) {
        result = { ok: false, error: friendlyError(toolError) };
      }

      if (sessionRef.current !== session) return;

      if (visualizationCall && result.ok) {
        // A timer from speech that preceded this visual must not release the
        // barrier for the narration that Deepgram will speak in response.
        clearAudioDoneTimer();
        voiceNarrationBarrierRef.current.transition("visual-settled");
        if (result.waitForPatientResponse) {
          autoWalkthroughRef.current = false;
          pendingWalkthroughContinuationRef.current = null;
        } else if (
          autoWalkthroughRef.current &&
          result.nextApprovedAction
        ) {
          pendingWalkthroughContinuationRef.current = {
            session,
            instruction: result.nextApprovedAction,
          };
        }
      }

      session.sendFunctionCallResponse(
        wireCall.id,
        wireCall.name,
        serializeVoiceToolResult(result),
      );

      if (!result.ok && mountedRef.current) {
        setError(`The requested interface action failed: ${result.error}`);
      } else if (visualizationCall && mountedRef.current) {
        // A recovered destination request replaces any stale sequencing error
        // shown by an earlier visual call in the same live voice session.
        setError(null);
      }
    },
    [applyPendingPatientIntent, clearAudioDoneTimer],
  );

  const speakRecoveredLiteralCall = useCallback((session: AgentSession) => {
    const recovery = literalRecoveryRef.current;
    if (
      !recovery ||
      recovery.session !== session ||
      !recovery.audioDone ||
      !recovery.narration
    ) {
      return;
    }

    const narration = recovery.narration;
    literalRecoveryRef.current = null;
    suppressAgentAudioRef.current = false;
    session.injectAgentMessage(narration);
  }, []);

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
    voiceNarrationBarrierRef.current.transition("reset");
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
        if (message.role === "user") {
          const rawContent = message.content.trim();
          const unquotedContent = rawContent.replace(/^"([\s\S]*)"$/u, "$1");
          const injectedMessages = internalUserMessagesRef.current;
          const matchedInternalMessage = injectedMessages.has(rawContent)
            ? rawContent
            : injectedMessages.has(unquotedContent)
              ? unquotedContent
              : null;
          if (matchedInternalMessage !== null) {
            injectedMessages.delete(matchedInternalMessage);
            return;
          }
        }
        if (message.role === "user") {
          autoWalkthroughRef.current = isFullProcedureWalkthroughRequest(
            message.content,
          );
          pendingDirectVisualCallRef.current = getRequestedProcedureDestination(
            message.content,
            `patient-destination-${transcriptCounterRef.current + 1}`,
          );
          pendingVisualReferenceRef.current = message.content.trim();
          if (!autoWalkthroughRef.current) {
            pendingWalkthroughContinuationRef.current = null;
          }
        }
        if (message.role === "assistant") {
          const recovered = recoverLiteralVisualizationToolCall(
            message.content,
            `literal-visual-${transcriptCounterRef.current + 1}`,
          );
          if (recovered) {
            const lastHistory = session.conversationHistory.at(-1);
            if (
              lastHistory &&
              "role" in lastHistory &&
              lastHistory.role === "assistant" &&
              "content" in lastHistory &&
              lastHistory.content === message.content
            ) {
              session.conversationHistory.pop();
            }

            player.interrupt();
            suppressAgentAudioRef.current = true;
            literalRecoveryRef.current = {
              session,
              audioDone: false,
              narration: null,
            };
            updateStatus("thinking");

            const run = async () => {
              if (!recovered.ok || !isVisualizationVoiceToolCall(recovered.call)) {
                if (mountedRef.current) {
                  setError(
                    `Voice command rejected: ${recovered.ok ? "Unsupported visual call." : recovered.error}`,
                  );
                }
                literalRecoveryRef.current = null;
                suppressAgentAudioRef.current = false;
                return;
              }

              const patientGroundedRecoveredCall = applyPendingPatientIntent(
                recovered.call,
              );
              if (!isVisualizationVoiceToolCall(patientGroundedRecoveredCall)) {
                literalRecoveryRef.current = null;
                suppressAgentAudioRef.current = false;
                return;
              }

              await voiceNarrationBarrierRef.current.waitUntilReady();
              if (sessionRef.current !== session) return;

              try {
                const handlerResult = await callbacksRef.current.onToolCall(
                  patientGroundedRecoveredCall,
                );
                if (
                  !handlerResult?.ok ||
                  !handlerResult.settled?.transitionCompleted
                ) {
                  if (mountedRef.current) {
                    setError(
                      `The requested interface action failed: ${handlerResult && !handlerResult.ok ? handlerResult.error : "The visualization did not settle."}`,
                    );
                  }
                  literalRecoveryRef.current = null;
                  suppressAgentAudioRef.current = false;
                  return;
                }

                clearAudioDoneTimer();
                voiceNarrationBarrierRef.current.transition("visual-settled");
                if (mountedRef.current) setError(null);
                const recovery = literalRecoveryRef.current;
                if (recovery?.session === session) {
                  if (
                    autoWalkthroughRef.current &&
                    handlerResult.nextApprovedAction
                  ) {
                    pendingWalkthroughContinuationRef.current = {
                      session,
                      instruction: handlerResult.nextApprovedAction,
                    };
                  }
                  recovery.narration =
                    handlerResult.narration?.text ?? "The requested view is ready.";
                  speakRecoveredLiteralCall(session);
                }
              } catch (toolError) {
                literalRecoveryRef.current = null;
                suppressAgentAudioRef.current = false;
                if (mountedRef.current) {
                  setError(`The requested interface action failed: ${friendlyError(toolError)}`);
                }
              }
            };
            toolExecutionQueueRef.current = toolExecutionQueueRef.current.then(run, run);
            return;
          }
        }
        appendTranscript(message.role, message.content);
      }
    });
    session.on("user-started-speaking", () => {
      // Deepgram emits the same event for injected continuation turns. Those
      // are private orchestration messages, not a patient interruption.
      if (internalUserMessagesRef.current.size > 0) return;
      clearAudioDoneTimer();
      voiceNarrationBarrierRef.current.transition("user-interrupted");
      player.interrupt();
      suppressAgentAudioRef.current = false;
      literalRecoveryRef.current = null;
      autoWalkthroughRef.current = false;
      pendingWalkthroughContinuationRef.current = null;
      pendingDirectVisualCallRef.current = null;
      pendingVisualReferenceRef.current = null;
      updateStatus("listening");
    });
    session.on("agent-thinking", () => updateStatus("thinking"));
    session.on("agent-started-speaking", () => {
      if (!suppressAgentAudioRef.current) updateStatus("speaking");
    });
    session.on("audio", (chunk) => {
      if (!suppressAgentAudioRef.current) player.queue(chunk);
    });
    session.on("agent-audio-done", () => {
      const recovery = literalRecoveryRef.current;
      if (recovery?.session === session) {
        recovery.audioDone = true;
        speakRecoveredLiteralCall(session);
        return;
      }
      clearAudioDoneTimer();
      const delayMs = Math.max(0, Math.ceil(player.getRemainingPlaybackTime() * 1_000));
      audioDoneTimerRef.current = setTimeout(() => {
        audioDoneTimerRef.current = null;
        voiceNarrationBarrierRef.current.transition("audio-finished");
        const continuation = pendingWalkthroughContinuationRef.current;
        if (
          continuation?.session === session &&
          autoWalkthroughRef.current &&
          sessionRef.current === session &&
          session.state === "connected"
        ) {
          pendingWalkthroughContinuationRef.current = null;
          internalUserMessagesRef.current.add(continuation.instruction.trim());
          session.injectUserMessage(continuation.instruction);
          updateStatus("thinking");
        } else {
          updateStatus("listening");
        }
      }, delayMs);
    });
    session.on("function-call-request", (message) => {
      const protocolErrors = getVoiceFunctionProtocolErrors(message.functions);
      message.functions.forEach((functionCall, index) => {
        const protocolError = protocolErrors[index];
        const run = async () => {
          if (sessionRef.current !== session) return;
          await executeFunctionCall(session, functionCall, protocolError);
        };
        toolExecutionQueueRef.current = toolExecutionQueueRef.current.then(run, run);
      });
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
    applyPendingPatientIntent,
    clearAudioDoneTimer,
    disposeSession,
    executeFunctionCall,
    speakRecoveredLiteralCall,
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
    voiceNarrationBarrierRef.current.transition("user-interrupted");
    playerRef.current?.interrupt();
    autoWalkthroughRef.current = isFullProcedureWalkthroughRequest(normalized);
    pendingWalkthroughContinuationRef.current = null;
    pendingDirectVisualCallRef.current = getRequestedProcedureDestination(
      normalized,
      `patient-destination-${transcriptCounterRef.current + 1}`,
    );
    pendingVisualReferenceRef.current = normalized;
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
