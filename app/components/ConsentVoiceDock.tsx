"use client";

import {
  ChevronDown,
  CircleAlert,
  Headphones,
  LoaderCircle,
  MessageSquareText,
  Mic,
  MicOff,
  Send,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";

export type ConsentVoiceDockStatus =
  | "idle"
  | "text"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface ConsentVoiceTranscriptItem {
  id: string;
  speaker: "patient" | "guide";
  text: string;
}

export interface ConsentVoicePrompt {
  id: string;
  label: string;
  message?: string;
}

export interface ConsentVoiceDockProps {
  status: ConsentVoiceDockStatus;
  caption?: string | null;
  transcript?: readonly ConsentVoiceTranscriptItem[];
  error?: string | null;
  active: boolean;
  expanded: boolean;
  muted: boolean;
  promptChips?: readonly (string | ConsentVoicePrompt)[];
  onStart: () => void;
  onStop: () => void;
  onToggleExpanded: () => void;
  onToggleMute: () => void;
  onSendTyped: (message: string) => void;
  onPrompt: (message: string) => void;
  onHumanRequest: () => void;
  className?: string;
}

const statusCopy: Record<
  ConsentVoiceDockStatus,
  { label: string; fallbackCaption: string }
> = {
  idle: {
    label: "Voice guide ready",
    fallbackCaption: "Ask about the procedure, choices, recovery, or costs.",
  },
  text: {
    label: "Text mode ready",
    fallbackCaption: "Microphone is off. Type a question whenever you are ready.",
  },
  connecting: {
    label: "Connecting",
    fallbackCaption: "Getting the consent guide ready…",
  },
  listening: {
    label: "Listening",
    fallbackCaption: "I’m listening. You can pause or interrupt at any time.",
  },
  thinking: {
    label: "Preparing an answer",
    fallbackCaption: "Checking the information prepared for this demo…",
  },
  speaking: {
    label: "Explaining",
    fallbackCaption: "The consent guide is speaking. Start talking to interrupt.",
  },
  error: {
    label: "Voice needs attention",
    fallbackCaption: "Voice is unavailable right now. You can try again or type instead.",
  },
};

function StatusIcon({ status }: { status: ConsentVoiceDockStatus }) {
  if (status === "connecting" || status === "thinking") {
    return <LoaderCircle className="cl-voice-dock__spinner" size={19} aria-hidden="true" />;
  }

  if (status === "listening") {
    return <Mic size={19} aria-hidden="true" />;
  }

  if (status === "text") {
    return <MessageSquareText size={19} aria-hidden="true" />;
  }

  if (status === "speaking") {
    return <Volume2 size={19} aria-hidden="true" />;
  }

  if (status === "error") {
    return <CircleAlert size={19} aria-hidden="true" />;
  }

  return <Headphones size={19} aria-hidden="true" />;
}

function normalizePrompt(
  prompt: string | ConsentVoicePrompt,
  index: number,
): Required<ConsentVoicePrompt> {
  if (typeof prompt === "string") {
    return { id: `${index}-${prompt}`, label: prompt, message: prompt };
  }

  return {
    id: prompt.id,
    label: prompt.label,
    message: prompt.message ?? prompt.label,
  };
}

export function ConsentVoiceDock({
  status,
  caption,
  transcript = [],
  error,
  active,
  expanded,
  muted,
  promptChips = [],
  onStart,
  onStop,
  onToggleExpanded,
  onToggleMute,
  onSendTyped,
  onPrompt,
  onHumanRequest,
  className,
}: ConsentVoiceDockProps) {
  const [typingOpen, setTypingOpen] = useState(false);
  const [typedMessage, setTypedMessage] = useState("");
  const regionId = useId();
  const inputId = useId();
  const statusDetails = statusCopy[status];
  const resolvedCaption = error || caption || statusDetails.fallbackCaption;
  const normalizedPrompts = useMemo(
    () => promptChips.map(normalizePrompt),
    [promptChips],
  );
  const visibleTranscript = transcript.slice(-4);
  const isBusy = status === "connecting";

  function submitTypedMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = typedMessage.trim();

    if (!message || isBusy) return;

    onSendTyped(message);
    setTypedMessage("");
  }

  return (
    <aside
      className={["cl-voice-dock", className].filter(Boolean).join(" ")}
      data-expanded={expanded}
      data-status={status}
      aria-label="Consent voice guide"
    >
      <div className="cl-voice-dock__surface">
        <header className="cl-voice-dock__header">
          <span className="cl-voice-dock__status-icon" aria-hidden="true">
            <StatusIcon status={status} />
          </span>
          <button
            className="cl-voice-dock__summary"
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-controls={regionId}
          >
            <span className="cl-voice-dock__title-row">
              <strong>Consent guide</strong>
              <span className="cl-voice-dock__status-label">
                <i aria-hidden="true" />
                {statusDetails.label}
              </span>
            </span>
            <span className="cl-voice-dock__summary-caption">{resolvedCaption}</span>
          </button>
          <button
            className="cl-voice-dock__icon-button cl-voice-dock__expand-button"
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-controls={regionId}
            aria-label={expanded ? "Collapse consent guide" : "Open consent guide"}
          >
            <ChevronDown size={18} aria-hidden="true" />
          </button>
        </header>

        <div
          className="cl-voice-dock__content"
          id={regionId}
          hidden={!expanded}
        >
          <div className="cl-voice-dock__caption-card">
            <div className="cl-voice-dock__audio-mark" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((bar) => <i key={bar} />)}
            </div>
            <div className="cl-voice-dock__caption-copy">
              <span>{status === "listening" ? "You can speak now" : "Live caption"}</span>
              <p
                className={status === "error" ? "cl-voice-dock__error" : undefined}
                role={status === "error" ? "alert" : "status"}
                aria-live={status === "error" ? "assertive" : "polite"}
                aria-atomic="true"
              >
                {resolvedCaption}
              </p>
            </div>
          </div>

          {visibleTranscript.length > 0 ? (
            <ol className="cl-voice-dock__transcript" aria-label="Recent conversation">
              {visibleTranscript.map((item) => (
                <li key={item.id} data-speaker={item.speaker}>
                  <span>{item.speaker === "guide" ? "Guide" : "You"}</span>
                  <p>{item.text}</p>
                </li>
              ))}
            </ol>
          ) : null}

          {normalizedPrompts.length > 0 ? (
            <div className="cl-voice-dock__prompts" aria-label="Suggested questions">
              <span>Try asking</span>
              <div>
                {normalizedPrompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    onClick={() => onPrompt(prompt.message)}
                    disabled={isBusy}
                  >
                    {prompt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="cl-voice-dock__actions">
            <button
              className="cl-voice-dock__primary-action"
              type="button"
              onClick={active ? onStop : onStart}
              disabled={isBusy}
            >
              {active ? <MicOff size={17} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}
              {isBusy ? "Connecting…" : active ? "Stop" : status === "error" ? "Try voice again" : "Start voice"}
            </button>
            <button
              className="cl-voice-dock__secondary-action"
              type="button"
              onClick={() => setTypingOpen((open) => !open)}
              aria-expanded={typingOpen}
              aria-controls={`${regionId}-type`}
            >
              <MessageSquareText size={17} aria-hidden="true" />
              Type instead
            </button>
            <button
              className="cl-voice-dock__icon-button"
              type="button"
              onClick={onToggleMute}
              disabled={!active}
              aria-pressed={muted}
              aria-label={muted ? "Unmute guide audio" : "Mute guide audio"}
              title={muted ? "Unmute guide audio" : "Mute guide audio"}
            >
              {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
            </button>
          </div>

          <form
            className="cl-voice-dock__type-form"
            id={`${regionId}-type`}
            onSubmit={submitTypedMessage}
            hidden={!typingOpen}
          >
            <label htmlFor={inputId}>Message the consent guide</label>
            <div>
              <input
                id={inputId}
                type="text"
                value={typedMessage}
                onChange={(event) => setTypedMessage(event.target.value)}
                placeholder="Ask about recovery, costs, or a procedure step"
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={!typedMessage.trim() || isBusy}
                aria-label="Send message"
              >
                <Send size={17} aria-hidden="true" />
              </button>
            </div>
          </form>

          <button
            className="cl-voice-dock__human-action"
            type="button"
            onClick={onHumanRequest}
          >
            <UserRound size={17} aria-hidden="true" />
            <span>
              <strong>Talk to a person</strong>
              <small>Ask the care team to follow up</small>
            </span>
          </button>

          <p className="cl-voice-dock__notice">
            This guide explains the synthetic demo. It does not diagnose, recommend a treatment,
            or record consent.
          </p>
        </div>
      </div>
    </aside>
  );
}
