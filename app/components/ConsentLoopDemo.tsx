"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Headphones,
  Send,
  ShieldCheck,
  Square,
  Stethoscope,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { useConsentVoiceAgent, type VoiceTranscriptEntry } from "../hooks/useConsentVoiceAgent";
import { careOptions, getDemoAnswer, patient, type OptionId } from "../lib/demo-data";
import {
  isVisualizationVoiceToolCall,
  voiceToolToVisualizationCommand,
  type VoiceToolCall,
  type VoiceToolExecutionResult,
} from "../lib/voice-agent";
import {
  kneeArthroscopyProcedure,
  type VisualizationCommand,
} from "../lib/procedure-visualization";

const KneeViewer = dynamic(
  () => import("./KneeViewer").then((module) => module.KneeViewer),
  {
    ssr: false,
    loading: () => (
      <div className="simple-viewer-loading" role="status">
        Preparing the anatomy model…
      </div>
    ),
  },
);

type FlowStep = "diagnosis" | "options" | "procedure" | "questions";

const flowSteps: Array<{ id: FlowStep; label: string }> = [
  { id: "diagnosis", label: "Your knee" },
  { id: "options", label: "Options" },
  { id: "procedure", label: "Procedure" },
  { id: "questions", label: "Questions" },
];

const procedureSteps = [
  {
    id: "affected-knee",
    label: "Locate the problem",
    body: "Confirm the right knee and move into the joint.",
  },
  {
    id: "damaged-structure",
    label: "See the tear",
    body: "Highlight the torn meniscus—the cushioning tissue inside the knee.",
  },
  {
    id: "access-point",
    label: "Enter the joint",
    body: "Two small portals allow a camera and instruments into the knee.",
  },
  {
    id: "treatment-action",
    label: "Repair or trim",
    body: "The surgeon inspects the tissue, then preserves or removes only what is appropriate.",
  },
  {
    id: "important-risk",
    label: "Review limits and risks",
    body: "The illustration explains the plan; your surgeon explains personal risks and recovery.",
  },
] as const;

const questionPrompts = [
  "What happens during meniscus repair?",
  "How is repair different from trimming?",
  "What is known about stem-cell injections?",
  "What should I ask my surgeon?",
];

const optionEvidence: Record<OptionId, string> = {
  therapy: "Established non-surgical care",
  repair: "Established surgical option",
  trim: "Established surgical option",
  regenerative: "Investigational · not FDA-approved for orthopedic conditions",
};

function Logo() {
  return (
    <div className="simple-brand" aria-label="ConsentLoop home">
      <span className="simple-brand-mark" aria-hidden="true"><i /><i /></span>
      <span>ConsentLoop</span>
    </div>
  );
}

async function waitForViewer(timeoutMs = 4_000) {
  const startedAt = Date.now();
  while (!window.consentLoopVisualization) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("The 3D model is still loading. Try again in a moment.");
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  return window.consentLoopVisualization;
}

async function waitForScreenChange() {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

export function ConsentLoopDemo() {
  const [activeStep, setActiveStep] = useState<FlowStep>("diagnosis");
  const [selectedOption, setSelectedOption] = useState<OptionId>("repair");
  const [activeProcedureStep, setActiveProcedureStep] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [typedQuestion, setTypedQuestion] = useState("");
  const [demoTranscript, setDemoTranscript] = useState<VoiceTranscriptEntry[]>([]);
  const [demoSpeaking, setDemoSpeaking] = useState(false);
  const [guideNotice, setGuideNotice] = useState<string | null>(null);
  const [visualError, setVisualError] = useState<string | null>(null);

  const selected = useMemo(
    () => careOptions.find((option) => option.id === selectedOption) ?? careOptions[0],
    [selectedOption],
  );

  const showProcedureStep = async (index: number) => {
    if (activeStep !== "procedure") {
      setActiveStep("procedure");
      await waitForScreenChange();
    }
    setActiveProcedureStep(index);
    setVisualError(null);
    try {
      const viewer = await waitForViewer();
      await viewer.execute({ type: "ENTER_PROCEDURE", procedureId: "knee-arthroscopy" });
      const result = await viewer.execute({
        type: "PLAY_PROCEDURE_STEP",
        procedureId: "knee-arthroscopy",
        stepId: procedureSteps[index].id,
      });
      if (result.status !== "completed") setVisualError(result.message);
    } catch (error) {
      setVisualError(error instanceof Error ? error.message : "The 3D view could not change.");
    }
  };

  const executeVisualization = async (
    command: VisualizationCommand,
  ): Promise<VoiceToolExecutionResult> => {
    if (activeStep !== "procedure") {
      setActiveStep("procedure");
      await waitForScreenChange();
    }
    if (command.type === "PLAY_PROCEDURE_STEP") {
      const visibleStep = procedureSteps.findIndex((step) => step.id === command.stepId);
      if (visibleStep >= 0) setActiveProcedureStep(visibleStep);
    }
    try {
      const viewer = await waitForViewer();
      const result = await viewer.execute(command);
      return result.status === "completed"
        ? { ok: true, message: result.message }
        : { ok: false, error: result.message };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "The 3D view could not change.",
      };
    }
  };

  const handleVoiceToolCall = async (
    call: VoiceToolCall,
  ): Promise<VoiceToolExecutionResult> => {
    if (isVisualizationVoiceToolCall(call)) {
      return executeVisualization(voiceToolToVisualizationCommand(call));
    }

    switch (call.name) {
      case "open_consent_section": {
        const destination: FlowStep =
          call.arguments.section === "anatomy"
            ? "procedure"
            : call.arguments.section === "options"
              ? "options"
              : "diagnosis";
        setActiveStep(destination);
        return { ok: true, message: `${flowSteps.find((item) => item.id === destination)?.label} is open.` };
      }
      case "focus_option":
        setSelectedOption(call.arguments.option);
        setActiveStep("options");
        return { ok: true, message: "The requested option is in focus. No choice was recorded." };
      case "request_human":
        setGuideOpen(true);
        setGuideNotice("A question for the care team is ready to review. Nothing was sent.");
        return { ok: true, message: "The care-team question is ready to review. Nothing was sent." };
    }
  };

  const voice = useConsentVoiceAgent({ onToolCall: handleVoiceToolCall });

  const playDemoAnswer = (question: string) => {
    const answer = getDemoAnswer(question);
    const now = Date.now();
    setDemoTranscript([
      { id: `demo-user-${now}`, role: "user", content: question, createdAt: now },
      { id: `demo-guide-${now}`, role: "assistant", content: answer, createdAt: now },
    ]);
    setGuideNotice("Browser demo voice · live microphone still needs a permitted Deepgram key");
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(answer);
    utterance.rate = 0.96;
    utterance.onstart = () => setDemoSpeaking(true);
    utterance.onend = () => setDemoSpeaking(false);
    utterance.onerror = () => setDemoSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const askQuestion = (question: string) => {
    const normalized = question.trim();
    if (!normalized) return;
    setGuideOpen(true);
    setGuideNotice(null);
    setTypedQuestion("");
    if (voice.sendText(normalized)) return;
    playDemoAnswer(normalized);
  };

  const visibleTranscript = voice.transcript.length > 0 ? voice.transcript : demoTranscript;

  const nextStep = () => {
    const index = flowSteps.findIndex((item) => item.id === activeStep);
    setActiveStep(flowSteps[Math.min(index + 1, flowSteps.length - 1)].id);
  };

  const previousStep = () => {
    const index = flowSteps.findIndex((item) => item.id === activeStep);
    setActiveStep(flowSteps[Math.max(index - 1, 0)].id);
  };

  return (
    <div className="consent-simple">
      <header className="simple-header">
        <Logo />
        <div className="simple-case">
          <span>Right knee meniscus tear</span>
          <small>{patient.clinician}</small>
        </div>
        <button className="simple-ask" onClick={() => setActiveStep("questions")}>
          <Headphones size={17} /> Ask the guide
        </button>
      </header>

      <main className="simple-main">
        <section className="simple-intro" aria-labelledby="case-title">
          <div>
            <span className="simple-context"><Stethoscope size={15} /> Your doctor’s assessment</span>
            <h1 id="case-title">You have a tear in your right meniscus.</h1>
            <p>
              See where it is, compare the paths your care team may discuss, and watch arthroscopy one step at a time.
            </p>
          </div>
          <span className="simple-demo-note"><ShieldCheck size={14} /> Synthetic education demo</span>
        </section>

        <nav className="simple-flow" aria-label="Understanding workflow">
          {flowSteps.map((item, index) => (
            <button
              key={item.id}
              className={activeStep === item.id ? "active" : ""}
              onClick={() => setActiveStep(item.id)}
              aria-current={activeStep === item.id ? "step" : undefined}
            >
              <span>{index + 1}</span>{item.label}
            </button>
          ))}
        </nav>

        <div className="simple-content">
          {activeStep === "diagnosis" && (
            <section className="diagnosis-layout">
              <div className="diagnosis-copy">
                <h2>What is torn?</h2>
                <p>
                  The meniscus is a crescent-shaped cushion between the thighbone and shinbone. This example marks the tear in the right knee—not the whole joint.
                </p>
                <dl>
                  <div><dt>Problem</dt><dd>Meniscus tear</dd></div>
                  <div><dt>Side</dt><dd>Right knee</dd></div>
                  <div><dt>Next decision</dt><dd>Rehabilitation, surgery, or an investigational path</dd></div>
                </dl>
                <button className="simple-primary" onClick={() => setActiveStep("options")}>
                  Compare options <ArrowRight size={17} />
                </button>
              </div>
              <div className="simple-model-frame diagnosis-model">
                <KneeViewer compact />
              </div>
            </section>
          )}

          {activeStep === "options" && (
            <section className="options-layout">
              <div className="section-heading">
                <h2>Ways this may be managed</h2>
                <p>Your surgeon decides what is medically reasonable for your tear. This app does not recommend a treatment.</p>
              </div>
              <div className="option-list" role="radiogroup" aria-label="Meniscus care options">
                {careOptions.map((option) => {
                  const active = option.id === selectedOption;
                  return (
                    <button
                      key={option.id}
                      role="radio"
                      aria-checked={active}
                      className={`option-row ${active ? "selected" : ""}`}
                      onClick={() => setSelectedOption(option.id)}
                    >
                      <span className="option-radio" aria-hidden="true">{active && <Check size={14} />}</span>
                      <span className="option-main">
                        <span className="option-meta">{option.eyebrow} · {optionEvidence[option.id]}</span>
                        <strong>{option.title}</strong>
                        <span>{option.summary}</span>
                      </span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <aside className="option-detail" aria-live="polite">
                <div>
                  <span>Selected for comparison</span>
                  <h3>{selected.title}</h3>
                  <p>{selected.benefit}</p>
                </div>
                <ul>{selected.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
                {selected.id === "repair" || selected.id === "trim" ? (
                  <button className="simple-primary" onClick={() => void showProcedureStep(0)}>
                    See arthroscopy steps <ArrowRight size={17} />
                  </button>
                ) : (
                  <button className="simple-secondary" onClick={() => askQuestion(`Explain ${selected.title} for this meniscus tear.`)}>
                    Ask about this option <Headphones size={16} />
                  </button>
                )}
              </aside>
            </section>
          )}

          {activeStep === "procedure" && (
            <section className="procedure-layout">
              <div className="simple-model-frame procedure-model">
                <KneeViewer compact />
              </div>
              <aside className="procedure-copy">
                <span className="procedure-label">Educational arthroscopy walkthrough</span>
                <h2>{procedureSteps[activeProcedureStep].label}</h2>
                <p>{procedureSteps[activeProcedureStep].body}</p>
                {visualError && <p className="simple-error" role="alert">{visualError}</p>}
                <ol className="procedure-step-list">
                  {procedureSteps.map((item, index) => (
                    <li key={item.id}>
                      <button
                        className={index === activeProcedureStep ? "active" : ""}
                        onClick={() => void showProcedureStep(index)}
                        aria-current={index === activeProcedureStep ? "step" : undefined}
                      >
                        <span>{index + 1}</span>{item.label}
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="procedure-controls">
                  <button
                    className="simple-secondary"
                    disabled={activeProcedureStep === 0}
                    onClick={() => void showProcedureStep(Math.max(0, activeProcedureStep - 1))}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                  {activeProcedureStep < procedureSteps.length - 1 ? (
                    <button className="simple-primary" onClick={() => void showProcedureStep(activeProcedureStep + 1)}>
                      Next step <ArrowRight size={16} />
                    </button>
                  ) : (
                    <button className="simple-primary" onClick={() => setActiveStep("questions")}>
                      Ask questions <Headphones size={16} />
                    </button>
                  )}
                </div>
                <button
                  className="simple-text-action"
                  onClick={() => askQuestion(`Explain the step called ${procedureSteps[activeProcedureStep].label}.`)}
                >
                  Ask the guide about this step
                </button>
              </aside>
            </section>
          )}

          {activeStep === "questions" && (
            <section className="questions-layout">
              <div className="section-heading">
                <h2>Ask about what you just saw</h2>
                <p>The guide answers from the approved demo facts. It does not diagnose, recommend, or replace your surgeon.</p>
              </div>
              <div className="question-prompts">
                {questionPrompts.map((prompt) => (
                  <button key={prompt} onClick={() => askQuestion(prompt)}>{prompt}<ArrowRight size={16} /></button>
                ))}
              </div>
              <div className="guide-panel">
                <div className="guide-panel-head">
                  <div><Headphones size={19} /><span><strong>Consent guide</strong><small>{demoSpeaking ? "speaking" : voice.status === "error" ? "demo ready" : voice.status}</small></span></div>
                  {voice.isActive ? (
                    <button className="simple-secondary" onClick={voice.stop}><Square size={14} /> Stop</button>
                  ) : (
                    <button className="simple-primary" onClick={() => { setGuideOpen(true); playDemoAnswer(questionPrompts[0]); }}><Headphones size={16} /> Play voice demo</button>
                  )}
                </div>
                {(guideOpen || visibleTranscript.length > 0 || voice.error) && (
                  <div className="guide-conversation">
                    {visibleTranscript.length > 0 ? visibleTranscript.slice(-6).map((entry) => (
                      <p key={entry.id} className={entry.role}><strong>{entry.role === "assistant" ? "Guide" : "You"}</strong>{entry.content}</p>
                    )) : <p className="guide-empty">Choose a question, type one, or start voice.</p>}
                    {(guideNotice || voice.error || voice.warning) && (
                      <p className={voice.error && !guideNotice ? "guide-error" : "guide-notice"} role="status">
                        {guideNotice ?? voice.error ?? voice.warning}
                      </p>
                    )}
                  </div>
                )}
                <form className="guide-input" onSubmit={(event) => { event.preventDefault(); askQuestion(typedQuestion); }}>
                  <label className="sr-only" htmlFor="guide-question">Question for the consent guide</label>
                  <input
                    id="guide-question"
                    value={typedQuestion}
                    onChange={(event) => setTypedQuestion(event.target.value)}
                    placeholder="Ask about the tear, options, or procedure"
                  />
                  <button type="submit" aria-label="Send question" disabled={!typedQuestion.trim()}><Send size={17} /></button>
                </form>
              </div>
            </section>
          )}
        </div>

        <footer className="simple-footer">
          <button className="simple-text-action" onClick={previousStep} disabled={activeStep === "diagnosis"}>
            <ArrowLeft size={15} /> Previous
          </button>
          <span>{kneeArthroscopyProcedure.educationalLabel}</span>
          <button className="simple-text-action" onClick={nextStep} disabled={activeStep === "questions"}>
            Continue <ArrowRight size={15} />
          </button>
        </footer>
      </main>
    </div>
  );
}
