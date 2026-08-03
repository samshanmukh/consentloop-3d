"use client";

import { AgentMicrophone } from "@deepgram/agents";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createDeepgramDictationUrl,
  joinDictationText,
  parseDeepgramDictationMessage,
} from "@/app/lib/deepgram-dictation";

export type DeepgramDictationStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "finalizing"
  | "error";

export interface DeepgramDictationController {
  status: DeepgramDictationStatus;
  transcript: string;
  error: string | null;
  isActive: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

const MAX_BUFFERED_AUDIO_FRAMES = 160;
const FINALIZE_GRACE_MS = 800;

function friendlyDictationError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was blocked. Allow microphone access, then try again.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found on this device.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Voice input could not start. You can still type your answer.";
}

export function useDeepgramDictation(
  tokenEndpoint = "/api/deepgram-token",
): DeepgramDictationController {
  const [status, setStatus] = useState<DeepgramDictationStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const microphoneRef = useRef<AgentMicrophone | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const bufferedAudioRef = useRef<ArrayBuffer[]>([]);
  const committedTranscriptRef = useRef("");
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualStopRef = useRef(false);

  const clearFinalizeTimer = useCallback(() => {
    if (finalizeTimerRef.current !== null) {
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
  }, []);

  const dispose = useCallback(() => {
    clearFinalizeTimer();
    const microphone = microphoneRef.current;
    const socket = socketRef.current;
    microphoneRef.current = null;
    socketRef.current = null;
    bufferedAudioRef.current = [];
    microphone?.stop();

    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      try {
        socket.close(1000, "Dictation ended");
      } catch {
        // A connecting browser socket can reject an early close. It will be
        // ignored by the generation guard as soon as it emits an event.
      }
    }
  }, [clearFinalizeTimer]);

  const fail = useCallback((reason: unknown) => {
    generationRef.current += 1;
    manualStopRef.current = true;
    dispose();
    if (!mountedRef.current) return;
    setError(friendlyDictationError(reason));
    setStatus("error");
  }, [dispose]);

  const stop = useCallback(() => {
    const socket = socketRef.current;
    const microphone = microphoneRef.current;
    manualStopRef.current = true;
    microphoneRef.current = null;
    microphone?.stop();

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      generationRef.current += 1;
      dispose();
      if (mountedRef.current) setStatus("idle");
      return;
    }

    if (mountedRef.current) setStatus("finalizing");
    try {
      socket.send(JSON.stringify({ type: "Finalize" }));
    } catch {
      dispose();
      if (mountedRef.current) setStatus("idle");
      return;
    }

    clearFinalizeTimer();
    finalizeTimerRef.current = setTimeout(() => {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "CloseStream" }));
          socket.close(1000, "Dictation complete");
        }
      } finally {
        if (socketRef.current === socket) socketRef.current = null;
        if (mountedRef.current) setStatus("idle");
      }
    }, FINALIZE_GRACE_MS);
  }, [clearFinalizeTimer, dispose]);

  const start = useCallback(async () => {
    if (
      microphoneRef.current ||
      socketRef.current ||
      status === "connecting" ||
      status === "listening" ||
      status === "finalizing"
    ) {
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    manualStopRef.current = false;
    committedTranscriptRef.current = "";
    bufferedAudioRef.current = [];
    setTranscript("");
    setError(null);
    setStatus("connecting");

    const microphone = new AgentMicrophone((audio) => {
      if (generationRef.current !== generation) return;
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(audio);
        return;
      }

      const frames = bufferedAudioRef.current;
      frames.push(audio);
      if (frames.length > MAX_BUFFERED_AUDIO_FRAMES) frames.shift();
    }, {
      sampleRate: 16_000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    microphoneRef.current = microphone;
    microphone.on("error", fail);

    // Begin microphone access directly inside the click gesture while the
    // short-lived browser token is fetched in parallel.
    const microphoneStart = microphone.start();
    const tokenRequest = fetch(tokenEndpoint, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "text/plain" },
    });

    try {
      const [tokenResponse] = await Promise.all([tokenRequest, microphoneStart]);
      if (generationRef.current !== generation || !mountedRef.current) return;
      if (!tokenResponse.ok) {
        throw new Error(
          tokenResponse.status === 429
            ? "Voice input is busy. Wait a moment, then try again."
            : "Voice input is temporarily unavailable.",
        );
      }

      const token = (await tokenResponse.text()).trim();
      if (!token) throw new Error("Voice input returned an invalid credential.");
      if (generationRef.current !== generation || !mountedRef.current) return;

      const socket = new WebSocket(createDeepgramDictationUrl(), ["bearer", token]);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (generationRef.current !== generation) return;
        for (const frame of bufferedAudioRef.current) socket.send(frame);
        bufferedAudioRef.current = [];
        if (mountedRef.current) setStatus("listening");
      });

      socket.addEventListener("message", (event) => {
        if (generationRef.current !== generation) return;
        const result = parseDeepgramDictationMessage(event.data);
        if (!result) return;

        if (result.isFinal) {
          if (result.transcript) {
            committedTranscriptRef.current = joinDictationText(
              committedTranscriptRef.current,
              result.transcript,
            );
          }
          setTranscript(committedTranscriptRef.current);
          return;
        }

        setTranscript(
          joinDictationText(committedTranscriptRef.current, result.transcript),
        );
      });

      socket.addEventListener("error", () => {
        if (generationRef.current === generation && !manualStopRef.current) {
          fail(new Error("Voice input lost its connection. Please try again."));
        }
      });

      socket.addEventListener("close", (event) => {
        if (generationRef.current !== generation) return;
        socketRef.current = null;
        microphoneRef.current?.stop();
        microphoneRef.current = null;
        clearFinalizeTimer();

        if (!manualStopRef.current && event.code !== 1000) {
          fail(new Error("Voice input ended unexpectedly. Please try again."));
          return;
        }
        if (mountedRef.current) setStatus("idle");
      });
    } catch (reason) {
      if (generationRef.current === generation) fail(reason);
    }
  }, [clearFinalizeTimer, fail, status, tokenEndpoint]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      dispose();
    };
  }, [dispose]);

  return {
    status,
    transcript,
    error,
    isActive:
      status === "connecting" ||
      status === "listening" ||
      status === "finalizing",
    start,
    stop,
  };
}
