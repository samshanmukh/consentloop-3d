"use client";

import {
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  Bell,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  GitCompareArrows,
  HandHeart,
  Headphones,
  HeartPulse,
  HelpCircle,
  Home,
  Info,
  Layers3,
  LifeBuoy,
  LockKeyhole,
  Menu,
  MessageCircleQuestion,
  Mic,
  Moon,
  MoveRight,
  PanelLeftClose,
  Play,
  ReceiptText,
  ScanLine,
  Search,
  Send,
  ShieldCheck,
  Stethoscope,
  Sun,
  UserRound,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ComprehensionConceptId,
  ComprehensionStatus,
} from "@consentloop/shared";
import type {
  AnatomyState,
} from "../lib/anatomy-commands";
import {
  getNextApprovedVoiceAction,
  getVoiceNarrationCue,
  getVoiceVisualizationSequenceError,
  isVisualizationVoiceToolCall,
  voiceToolToVisualizationCommand,
  type VoiceToolCall,
  type VoiceToolExecutionResult,
  type VisualizationVoiceToolCall,
} from "../lib/voice-agent";
import {
  useConsentVoiceAgent,
  type VoiceTranscriptEntry,
} from "../hooks/useConsentVoiceAgent";
import {
  ConsentVoiceDock,
  type ConsentVoiceDockStatus,
} from "./ConsentVoiceDock";
import {
  careOptions,
  costBreakdown,
  patient,
  teachBackConcepts,
  timeline,
  type JourneyView,
  type OptionId,
  type Preference,
} from "../lib/demo-data";
import {
  createDefaultWorkflowSnapshot,
  loadConsentWorkflow,
  persistTeachBackUpdate,
  type ConsentWorkflowSnapshot,
  type TeachBackUpdate,
} from "../lib/consent-workflow";
import {
  kneeArthroscopyProcedure,
  type VisualizationCommand,
} from "../lib/procedure-visualization";
import type { VisualizationSnapshot } from "../lib/visualization-controller";

const KneeViewer = dynamic(
  () => import("./KneeViewer").then((module) => module.KneeViewer),
  {
    ssr: false,
    loading: () => (
      <div className="knee-viewer viewer-loading" aria-label="Interactive 3D anatomy loading">
        <span className="model-loading-orb" />
        <strong>Preparing interactive anatomy…</strong>
      </div>
    ),
  },
);

type ConceptStatus = ComprehensionStatus;

const navItems: Array<{
  id: JourneyView;
  label: string;
  icon: typeof Home;
}> = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "anatomy", label: "Procedure", icon: ScanLine },
  { id: "options", label: "Options", icon: GitCompareArrows },
  { id: "plan", label: "Plan", icon: CalendarDays },
  { id: "costs", label: "Costs", icon: WalletCards },
  { id: "teachback", label: "Teach back", icon: MessageCircleQuestion },
  { id: "review", label: "Review", icon: ClipboardCheck },
];

const pageCopy: Record<JourneyView, { eyebrow: string; title: string; body: string }> = {
  overview: {
    eyebrow: "Your consent journey",
    title: "Make the decision clear, one step at a time.",
    body: "Explore the procedure, compare your approved options, and bring the right questions back to your care team.",
  },
  anatomy: {
    eyebrow: "Interactive procedure guide",
    title: "See exactly what may happen inside your knee.",
    body: "Rotate the model, select a guided scene, or ask the live voice guide to move it with you. Every control is available without speech.",
  },
  options: {
    eyebrow: "Clinician-approved choices",
    title: "Compare the paths that are reasonable for you.",
    body: "Your preference records what matters to you. It is not a prescription and it is not yet consent.",
  },
  plan: {
    eyebrow: "Timeline and recovery",
    title: "Fit recovery into your real life—not the other way around.",
    body: "Plan around work, caregiving, transportation, and the support you may need at home.",
  },
  costs: {
    eyebrow: "Financial clarity",
    title: "Understand the estimate and what could still change.",
    body: "This synthetic estimate separates eligibility, expected charges, and the amount you may owe.",
  },
  teachback: {
    eyebrow: "Check your understanding",
    title: "Explain it back in your own words.",
    body: "Teach-back is not a test. It helps the care team find anything that needs a clearer explanation.",
  },
  review: {
    eyebrow: "Review and handoff",
    title: "See what is understood—and what still needs a person.",
    body: "Consent remains blocked until critical questions are resolved and the treating clinician confirms the final plan.",
  },
};

const preferenceLabels: Record<Exclude<Preference, null>, string> = {
  preferred: "Preferred",
  unsure: "Unsure",
  "not-preferred": "Not preferred",
};

function Logo() {
  return (
    <div className="brand" aria-label="ConsentLoop home">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span>ConsentLoop</span>
      <small>3D</small>
    </div>
  );
}

function ProgressRing({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="progress-ring"
      style={{ "--progress": `${value * 3.6}deg` } as React.CSSProperties}
      role="img"
      aria-label={`${label}: ${value}%`}
    >
      <div>
        <strong>{value}%</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function StatusPill({
  tone = "blue",
  children,
}: {
  tone?: "blue" | "green" | "amber" | "coral" | "neutral";
  children: React.ReactNode;
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

function MiniSparkline({ color = "blue" }: { color?: "blue" | "coral" }) {
  return (
    <div className={`mini-sparkline spark-${color}`} aria-hidden="true">
      {[34, 58, 42, 76, 62, 88, 73, 94].map((height, index) => (
        <i key={index} style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

function OverviewView({ onNavigate }: { onNavigate: (view: JourneyView) => void }) {
  return (
    <div className="overview-grid view-enter">
      <section className="glass-card overview-hero">
        <div className="hero-copy">
          <StatusPill tone="green">
            <ShieldCheck size={14} /> Synthetic demo · no real patient data
          </StatusPill>
          <h2>Good morning, Jordan.</h2>
          <p>
            Dr. Chen has prepared three care paths for your right meniscus tear.
            Start with the 3D explanation, then compare what each path means for
            your work, wedding, childcare, and expected costs.
          </p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={() => onNavigate("anatomy")}>
              <Play size={17} fill="currentColor" /> Start guided session
            </button>
            <button className="button button-secondary" onClick={() => onNavigate("options")}>
              Compare options <ArrowRight size={17} />
            </button>
          </div>
          <div className="trust-row">
            <div className="avatar-stack" aria-label="Care team">
              <span>MC</span><span>AR</span><span>PT</span>
            </div>
            <div>
              <strong>Your care team is available</strong>
              <span>Questions route to the right person</span>
            </div>
          </div>
        </div>
        <div className="hero-model-wrap">
          <KneeViewer compact />
          <button className="model-expand" onClick={() => onNavigate("anatomy")}>
            <ScanLine size={16} /> Open interactive model
          </button>
        </div>
      </section>

      <section className="glass-card journey-progress-card">
        <div className="card-heading-row">
          <div>
            <span className="card-kicker">Session progress</span>
            <h3>2 of 6 steps explored</h3>
          </div>
          <ProgressRing value={38} label="explored" />
        </div>
        <div className="journey-step-list">
          {[
            ["Procedure", "See the anatomy and possible treatment", "complete"],
            ["Options", "Compare all three reasonable care paths", "active"],
            ["Plan", "Resolve recovery support and timing", "pending"],
            ["Costs", "Review estimate assumptions", "pending"],
            ["Teach back", "Explain three critical concepts", "pending"],
          ].map(([title, description, state], index) => (
            <button
              key={title}
              className={`journey-step ${state}`}
              onClick={() => onNavigate(navItems[index + 1].id)}
            >
              <span className="step-marker">
                {state === "complete" ? <Check size={15} /> : index + 1}
              </span>
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      </section>

      <section className="glass-card next-appointment-card">
        <div className="card-icon blue"><CalendarCheck2 size={20} /></div>
        <div className="card-heading-row">
          <div>
            <span className="card-kicker">If you choose surgery</span>
            <h3>Held appointment</h3>
          </div>
          <StatusPill tone="amber">Not confirmed</StatusPill>
        </div>
        <div className="appointment-date">
          <strong>18</strong>
          <span>August<br />Tuesday</span>
        </div>
        <dl className="detail-list compact-details">
          <div><dt>Arrival</dt><dd>7:30 AM</dd></div>
          <div><dt>Location</dt><dd>Bayview Orthopedics</dd></div>
          <div><dt>Support</dt><dd className="warning-text">Adult needed overnight</dd></div>
        </dl>
        <button className="text-button" onClick={() => onNavigate("plan")}>
          Review timeline <MoveRight size={16} />
        </button>
      </section>

      <section className="glass-card clarity-card">
        <div className="card-heading-row">
          <div>
            <span className="card-kicker">Understanding</span>
            <h3>Two concepts need review</h3>
          </div>
          <div className="card-icon coral"><HeartPulse size={20} /></div>
        </div>
        <MiniSparkline color="coral" />
        <div className="clarity-stats">
          <div><strong>1</strong><span>understood</span></div>
          <div><strong>1</strong><span>partial</span></div>
          <div><strong>1</strong><span>not started</span></div>
        </div>
        <button className="button button-soft full-width" onClick={() => onNavigate("teachback")}>
          Continue teach-back <ArrowRight size={16} />
        </button>
      </section>
    </div>
  );
}

function VoiceGuidePanel({
  onOpen,
  onPrompt,
}: {
  onOpen: () => void;
  onPrompt: (prompt: string) => void;
}) {
  const prompts = [
    "Show me the damaged part",
    "How does the camera enter?",
    "What might be trimmed?",
    "Show the longer recovery",
  ];
  return (
    <section className="glass-card voice-panel">
      <div className="voice-panel-head">
        <div className="voice-orb"><Mic size={22} /></div>
        <div>
          <span className="card-kicker">Live Deepgram guide</span>
          <h3>Ask and watch the model respond</h3>
        </div>
      </div>
      <p className="voice-caption">
        The guide can explain this synthetic case, open any consent step, and
        focus approved anatomy. It cannot recommend a treatment or record consent.
      </p>
      <div className="prompt-list">
        {prompts.map((prompt) => (
          <button key={prompt} onClick={() => onPrompt(prompt)}>
            <span>{prompt}</span><ArrowRight size={15} />
          </button>
        ))}
      </div>
      <div className="voice-actions">
        <button className="button button-primary" onClick={onOpen}>
          <Mic size={17} /> Open voice guide
        </button>
        <button className="icon-button" aria-label="A human is always available" onClick={onOpen}>
          <Headphones size={18} />
        </button>
      </div>
    </section>
  );
}

function ConsentVisualizationStatus({
  workflow,
  visualization,
}: {
  workflow: ConsentWorkflowSnapshot;
  visualization: VisualizationSnapshot | null;
}) {
  const conceptRecords = Object.values(workflow.concepts);
  const explained = conceptRecords.filter(
    (concept) => concept.status !== "not-discussed",
  ).length;
  const understood = conceptRecords.filter(
    (concept) => concept.status === "understood",
  ).length;
  const currentStep = kneeArthroscopyProcedure.steps.find(
    (procedureStep) => procedureStep.id === visualization?.stepId,
  );
  const currentStepIndex = Math.max(
    0,
    kneeArthroscopyProcedure.steps.findIndex(
      (procedureStep) => procedureStep.id === visualization?.stepId,
    ),
  );
  const teachBackStatus = workflow.concepts["tissue-treated"].status;

  return (
    <section className="glass-card consent-visual-status">
      <div className="card-heading-row">
        <div>
          <span className="card-kicker">Consent workflow</span>
          <h3>{workflow.procedureName}</h3>
        </div>
        <StatusPill tone={workflow.taskStatus === "on-hold" ? "amber" : "blue"}>
          {workflow.taskStatus.replace("-", " ")}
        </StatusPill>
      </div>

      <div className="consent-status-grid">
        <article>
          <span>Visual state</span>
          <strong>{(visualization?.visualState ?? "loading").replaceAll("-", " ")}</strong>
          <small>{currentStep?.title ?? "Preparing body overview"}</small>
        </article>
        <article>
          <span>Concepts explained</span>
          <strong>{explained} / 3</strong>
          <small>{understood} understood</small>
        </article>
        <article>
          <span>Teach-back</span>
          <strong>{teachBackStatus.replace("-", " ")}</strong>
          <small>QuestionnaireResponse</small>
        </article>
        <article>
          <span>Open questions</span>
          <strong>{workflow.unresolvedQuestions.length}</strong>
          <small>Visible to care team</small>
        </article>
      </div>

      <div className="workflow-step-progress" aria-label={`Visualization step ${currentStepIndex + 1} of ${kneeArthroscopyProcedure.steps.length}`}>
        <div><span>Approved walkthrough</span><strong>{currentStepIndex + 1} / {kneeArthroscopyProcedure.steps.length}</strong></div>
        <i><span style={{ width: `${((currentStepIndex + 1) / kneeArthroscopyProcedure.steps.length) * 100}%` }} /></i>
      </div>

      <dl className="workflow-detail-list">
        <div>
          <dt>Consent</dt>
          <dd><i className="workflow-dot workflow-dot-amber" />{workflow.consentStatus}</dd>
        </div>
        <div>
          <dt>Clinician escalation</dt>
          <dd>
            <i className={`workflow-dot workflow-dot-${workflow.clinicianEscalation === "requested" ? "red" : "green"}`} />
            {workflow.clinicianEscalation}
          </dd>
        </div>
        <div>
          <dt>Medplum</dt>
          <dd>
            <i className={`workflow-dot workflow-dot-${workflow.connected ? "green" : "neutral"}`} />
            {workflow.connected ? "FHIR synchronized" : "Demo cache · reconnectable"}
          </dd>
        </div>
      </dl>

      <div className="education-safety-note">
        <ShieldCheck size={17} />
        <span><strong>Educational illustration</strong>Not patient imaging or surgical navigation.</span>
      </div>
    </section>
  );
}

function AnatomyView({
  anatomyState,
  visualizationState,
  workflow,
  onAnatomyState,
  onVisualizationState,
  onVisualizationCommand,
  onVoiceOpen,
  onVoicePrompt,
}: {
  anatomyState: AnatomyState | null;
  visualizationState: VisualizationSnapshot | null;
  workflow: ConsentWorkflowSnapshot;
  onAnatomyState: (state: AnatomyState) => void;
  onVisualizationState: (state: VisualizationSnapshot) => void;
  onVisualizationCommand: (command: VisualizationCommand) => void;
  onVoiceOpen: () => void;
  onVoicePrompt: (prompt: string) => void;
}) {
  const isBodyOverview = visualizationState?.viewMode !== "knee";
  const rightKneeFocused =
    isBodyOverview && visualizationState?.target === "knee";
  const visualTransitionActive =
    visualizationState?.visualState === "loading" ||
    visualizationState?.visualState === "focusing-region" ||
    visualizationState?.visualState === "entering-procedure" ||
    visualizationState?.visualState === "returning-to-overview";
  const currentStepIndex = kneeArthroscopyProcedure.steps.findIndex(
    (step) => step.id === visualizationState?.stepId,
  );
  const nextProcedureStep =
    currentStepIndex >= 0
      ? kneeArthroscopyProcedure.steps[currentStepIndex + 1]
      : undefined;
  const primaryCommand: VisualizationCommand = isBodyOverview
    ? rightKneeFocused
      ? { type: "ENTER_PROCEDURE", procedureId: "knee-arthroscopy" }
      : { type: "FOCUS_BODY_REGION", regionId: "right-knee" }
    : nextProcedureStep
      ? {
          type: "PLAY_PROCEDURE_STEP",
          procedureId: "knee-arthroscopy",
          stepId: nextProcedureStep.id,
        }
      : { type: "RETURN_TO_OVERVIEW" };
  const primaryLabel = isBodyOverview
    ? rightKneeFocused
      ? "Zoom into the highlighted knee"
      : "Highlight the right knee"
    : nextProcedureStep
      ? nextProcedureStep.id === "completion" &&
        workflow.concepts["tissue-treated"].status !== "understood"
        ? "Complete teach-back before finishing"
        : `Next: ${nextProcedureStep.title}`
      : "Return to whole-body view";
  const completionBlocked =
    nextProcedureStep?.id === "completion" &&
    workflow.concepts["tissue-treated"].status !== "understood";
  const hotspotCommands: Array<{
    label: string;
    target: AnatomyState["target"];
    command: VisualizationCommand;
  }> = isBodyOverview
    ? [
        {
          label: "Whole body",
          target: "body",
          command: { type: "SHOW_BODY_OVERVIEW", view: "three-quarter" },
        },
        {
          label: "Right knee",
          target: "knee",
          command: { type: "FOCUS_BODY_REGION", regionId: "right-knee" },
        },
      ]
    : [
        {
          label: "Whole body",
          target: "body",
          command: { type: "RETURN_TO_OVERVIEW" },
        },
        {
          label: "Damaged meniscus",
          target: "tear",
          command: {
            type: "PLAY_PROCEDURE_STEP",
            procedureId: "knee-arthroscopy",
            stepId: "damaged-structure",
          },
        },
        {
          label: "Cruciate ligaments",
          target: "ligaments",
          command: {
            type: "HIGHLIGHT_STRUCTURE",
            structureId: "cruciate-ligaments",
            color: "blue",
          },
        },
        {
          label: "Camera portals",
          target: "portals",
          command: {
            type: "PLAY_PROCEDURE_STEP",
            procedureId: "knee-arthroscopy",
            stepId: "access-point",
          },
        },
      ];

  return (
    <div className="anatomy-layout view-enter">
      <div className="anatomy-main">
        <KneeViewer
          onStateChange={onAnatomyState}
          onVisualizationStateChange={onVisualizationState}
        />
        <div className="anatomy-accessible-list glass-card">
          <span className="card-kicker">Model hotspots</span>
          <div>
            {hotspotCommands.map(({ label, target, command }) => (
              <button
                key={target}
                className={anatomyState?.target === target ? "active" : ""}
                onClick={() => onVisualizationCommand(command)}
                disabled={visualTransitionActive}
              >
                <span /><strong>{label}</strong><ArrowRight size={15} />
              </button>
            ))}
          </div>
        </div>
      </div>
      <aside className="anatomy-sidebar">
        <ConsentVisualizationStatus workflow={workflow} visualization={visualizationState} />
        <section className="glass-card explanation-card">
          <div className="card-heading-row">
            <StatusPill tone={visualizationState?.comparison ? "amber" : "coral"}>
              {visualizationState?.comparison ? "Clarification view" : isBodyOverview ? "Body overview" : "Procedure detail"}
            </StatusPill>
            <button className="icon-button" aria-label="More information"><Info size={17} /></button>
          </div>
          <h3>
            {visualizationState?.comparison
              ? "The whole knee is not being replaced."
              : isBodyOverview
                ? "Your procedure is localized to the right knee."
                : "The tear is in the meniscus—not the whole knee."}
          </h3>
          <p>
            {visualizationState?.comparison
              ? "The complete joint is faint red for comparison. The much smaller meniscus area that may be repaired or trimmed is orange."
              : isBodyOverview
                ? "Start with the whole person for orientation, then select the marked knee to travel into the existing detailed procedure model."
                : "The surgeon first inspects the tissue before deciding whether an unstable edge may be repaired or needs limited trimming."}
          </p>
          <div className="why-card">
            <div className="card-icon coral"><Layers3 size={19} /></div>
            <div>
              <strong>Why this matters</strong>
              <span>The final action depends on tissue quality seen during surgery.</span>
            </div>
          </div>
          <button
            className="text-button"
            onClick={() => onVisualizationCommand(primaryCommand)}
            disabled={visualTransitionActive || completionBlocked}
          >
            {primaryLabel} <ArrowRight size={16} />
          </button>
        </section>
        <VoiceGuidePanel onOpen={onVoiceOpen} onPrompt={onVoicePrompt} />
      </aside>
    </div>
  );
}

function OptionCard({
  option,
  preference,
  selected,
  onSelect,
  onPreference,
}: {
  option: (typeof careOptions)[number];
  preference: Preference;
  selected: boolean;
  onSelect: () => void;
  onPreference: (preference: Exclude<Preference, null>) => void;
}) {
  return (
    <article className={`option-card glass-card accent-${option.accent} ${selected ? "selected" : ""}`}>
      <button className="option-card-select" onClick={onSelect} aria-label={`View ${option.title}`}>
        <div className="option-topline">
          <span className="option-number">0{careOptions.indexOf(option) + 1}</span>
          <StatusPill tone={option.accent === "coral" ? "coral" : option.accent === "blue" ? "blue" : "neutral"}>
            {option.eyebrow}
          </StatusPill>
        </div>
        <h3>{option.title}</h3>
        <p>{option.summary}</p>
      </button>
      <dl className="option-facts">
        <div><dt>Expected benefit</dt><dd>{option.benefit}</dd></div>
        <div><dt>Recovery</dt><dd>{option.recovery}</dd></div>
        <div><dt>Work planning</dt><dd>{option.work}</dd></div>
      </dl>
      <div className="option-estimate">
        <span><BadgeDollarSign size={16} /> Demo estimate</span>
        <strong>{option.estimate}</strong>
        <small>{option.confidence}</small>
      </div>
      <div className="preference-control" role="group" aria-label={`Preference for ${option.title}`}>
        {(["preferred", "unsure", "not-preferred"] as const).map((value) => (
          <button
            key={value}
            className={preference === value ? "active" : ""}
            aria-pressed={preference === value}
            onClick={() => onPreference(value)}
          >
            {value === "preferred" && <Check size={14} />}
            {preferenceLabels[value]}
          </button>
        ))}
      </div>
    </article>
  );
}

function OptionsView({
  preferences,
  onPreference,
  selected,
  onSelect,
}: {
  preferences: Record<OptionId, Preference>;
  onPreference: (option: OptionId, preference: Exclude<Preference, null>) => void;
  selected: OptionId;
  onSelect: (option: OptionId) => void;
}) {
  const activeOption = careOptions.find((option) => option.id === selected)!;

  return (
    <div className="options-view view-enter">
      <div className="options-banner glass-card">
        <div className="card-icon blue"><GitCompareArrows size={20} /></div>
        <div><strong>Equal-weight comparison</strong><span>No option is hidden or ranked by cost. These paths were prepared by Dr. Chen for this synthetic case.</span></div>
        <StatusPill tone="green"><ShieldCheck size={14} /> Clinician reviewed</StatusPill>
      </div>
      <div className="option-card-grid">
        {careOptions.map((option) => (
          <OptionCard
            key={option.id}
            option={option}
            preference={preferences[option.id]}
            selected={selected === option.id}
            onSelect={() => onSelect(option.id)}
            onPreference={(preference) => onPreference(option.id, preference)}
          />
        ))}
      </div>
      <section className="glass-card option-detail-drawer">
        <div>
          <span className="card-kicker">Important details · {activeOption.title}</span>
          <h3>What the estimate and timeline do not decide</h3>
        </div>
        <ul>
          {activeOption.details.map((detail) => <li key={detail}><CheckCircle2 size={17} />{detail}</li>)}
        </ul>
        <button className="button button-secondary">Ask Dr. Chen about this option <Send size={16} /></button>
      </section>
    </div>
  );
}

function PlanView() {
  const [conflictResolved, setConflictResolved] = useState(false);
  return (
    <div className="plan-layout view-enter">
      <section className="glass-card timeline-card">
        <div className="card-heading-row">
          <div><span className="card-kicker">Possible surgical timeline</span><h3>Tuesday, August 18 pathway</h3></div>
          <button className="button button-secondary"><CalendarDays size={16} /> Compare dates</button>
        </div>
        <div className="timeline-list">
          {timeline.map((item, index) => (
            <article key={item.id} className={`timeline-item ${item.state}`}>
              <div className="timeline-marker"><span>{index + 1}</span><i /></div>
              <time>{item.date}</time>
              <div><h4>{item.title}</h4><p>{item.description}</p></div>
              {index === 0 && <StatusPill tone="blue">You are here</StatusPill>}
            </article>
          ))}
        </div>
      </section>

      <aside className="plan-sidebar">
        <section className="glass-card constraints-card">
          <div className="card-heading-row"><div><span className="card-kicker">What matters to you</span><h3>Life constraints</h3></div><button className="icon-button"><Menu size={17} /></button></div>
          <div className="constraint-chips">
            <span><Users size={15} /> Alternate-week childcare</span>
            <span><CalendarDays size={15} /> Wedding in 5 weeks</span>
            <span><UserRound size={15} /> Standing job</span>
            <span><Clock3 size={15} /> Morning appointments</span>
          </div>
          <button className="text-button">Add something that matters <ArrowRight size={15} /></button>
        </section>

        <section className={`glass-card conflict-card ${conflictResolved ? "resolved" : ""}`}>
          <div className="conflict-icon">{conflictResolved ? <CheckCircle2 size={22} /> : <CircleAlert size={22} />}</div>
          <span className="card-kicker">Recovery support</span>
          <h3>{conflictResolved ? "Question sent to your care team" : "No adult is available the first night"}</h3>
          <p>{conflictResolved ? "The scheduler will help compare another date or identify approved support options." : "The current plan requires a trusted adult to take you home and stay overnight."}</p>
          <button className="button button-primary full-width" onClick={() => setConflictResolved(true)} disabled={conflictResolved}>
            {conflictResolved ? <><Check size={17} /> Sent</> : <>Ask the scheduler <Send size={16} /></>}
          </button>
        </section>

        <section className="glass-card recovery-card">
          <span className="card-kicker">Recovery range</span>
          <h3>Trim and repair can look different</h3>
          <div className="recovery-track">
            <div><span>Possible trim</span><i style={{ width: "38%" }} /><strong>1–3 weeks</strong></div>
            <div><span>Possible repair</span><i style={{ width: "82%" }} /><strong>4–8+ weeks</strong></div>
          </div>
          <p className="fine-print">Ranges are clinician-approved examples, not promises about an individual recovery.</p>
        </section>
      </aside>
    </div>
  );
}

function CostsView({
  acknowledged,
  onAcknowledge,
}: {
  acknowledged: boolean;
  onAcknowledge: () => void;
}) {
  return (
    <div className="cost-layout view-enter">
      <section className="glass-card cost-summary-card">
        <div className="estimate-topline">
          <div>
            <StatusPill tone="blue"><ReceiptText size={14} /> Demo estimate · Aug 1, 2026</StatusPill>
            <span>Estimated patient responsibility</span>
            <strong>$2,045–$3,120</strong>
            <small>Arthroscopy range · not a bill or guarantee</small>
          </div>
          <div className="coverage-ring"><span>62%</span><small>deductible met</small></div>
        </div>
        <div className="coverage-metrics">
          <div><span>Plan deductible</span><strong>$3,000</strong></div>
          <div><span>Met to date</span><strong>$1,860</strong></div>
          <div><span>Coinsurance</span><strong>20%</strong></div>
          <div><span>Out-of-pocket remaining</span><strong>$4,240</strong></div>
        </div>
        <div className="estimate-table-wrap">
          <table className="estimate-table">
            <caption>Estimated charges and patient responsibility</caption>
            <thead><tr><th>Service</th><th>Estimated charge</th><th>You may owe</th><th>Assumption</th></tr></thead>
            <tbody>
              {costBreakdown.map((row) => (
                <tr key={row.label}><td>{row.label}</td><td>{row.value}</td><td><strong>{row.patient}</strong></td><td><StatusPill tone={row.status.includes("pending") ? "amber" : "neutral"}>{row.status}</StatusPill></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="cost-sidebar">
        <section className="glass-card estimate-assumptions">
          <div className="card-heading-row"><div><span className="card-kicker">Estimate confidence</span><h3>What could change</h3></div><StatusPill tone="amber">Medium</StatusPill></div>
          <ul>
            <li><CircleAlert size={17} /><span><strong>Trim vs. repair</strong>The exact procedure is known only after the tissue is examined.</span></li>
            <li><CircleAlert size={17} /><span><strong>Anesthesia network</strong>Provider network status is still being confirmed.</span></li>
            <li><Info size={17} /><span><strong>Therapy visits</strong>The estimate assumes 12 post-op sessions.</span></li>
          </ul>
        </section>
        <section className="glass-card acknowledgement-card">
          <LockKeyhole size={22} />
          <h3>Financial details never change your clinical explanation.</h3>
          <p>Clinically reasonable options remain visible regardless of cost or availability.</p>
          <label className="acknowledge-check">
            <input type="checkbox" checked={acknowledged} onChange={onAcknowledge} />
            <span><Check size={15} /></span>
            I understand this is an estimate, not a final bill.
          </label>
          <button className="button button-secondary full-width"><Headphones size={16} /> Ask financial counseling</button>
        </section>
      </aside>
    </div>
  );
}

function TeachBackView({
  statuses,
  workflow,
  onResult,
  onVisualizationState,
}: {
  statuses: Record<ComprehensionConceptId, ConceptStatus>;
  workflow: ConsentWorkflowSnapshot;
  onResult: (update: TeachBackUpdate) => Promise<void>;
  onVisualizationState: (state: VisualizationSnapshot) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"idle" | "misconception" | "corrected" | "uncertain">("idle");

  const playTeachBackVisualization = async (
    stepId: "misconception-comparison" | "completion",
  ) => {
    const bridge =
      window.consentLoopVisualization ??
      await waitForVisualizationController();
    const snapshot = bridge.getSnapshot();

    if (snapshot.viewMode !== "knee") {
      const alreadyFocused =
        snapshot.target === "knee" && snapshot.stepId === "affected-knee";
      if (!alreadyFocused) {
        const focused = await bridge.execute({
          type: "FOCUS_BODY_REGION",
          regionId: "right-knee",
        });
        if (focused.status !== "completed") return;
      }

      const entered = await bridge.execute({
        type: "ENTER_PROCEDURE",
        procedureId: "knee-arthroscopy",
      });
      if (entered.status !== "completed") return;
    }

    const result = await bridge.execute({
      type: "PLAY_PROCEDURE_STEP",
      procedureId: "knee-arthroscopy",
      stepId,
    });
    if (result.status === "completed") onVisualizationState(result.snapshot);
  };

  const submitAnswer = async () => {
    const normalized = answer.toLowerCase();
    const identifiesMeniscus = normalized.includes("meniscus") || normalized.includes("torn tissue");
    const describesWholeReplacement = normalized.includes("whole knee") || normalized.includes("entire knee") || normalized.includes("replac");
    setBusy(true);
    if (identifiesMeniscus) {
      setFeedback("corrected");
      await onResult({
        conceptId: "tissue-treated",
        status: "understood",
        evidence: answer,
        clarification: "Compared the whole joint with the smaller treated meniscus area.",
      });
      await playTeachBackVisualization("completion");
      setBusy(false);
      return;
    }
    if (describesWholeReplacement) {
      setFeedback("misconception");
      await onResult({
        conceptId: "tissue-treated",
        status: "contradicted",
        evidence: answer,
        misconception: "Patient described the plan as a whole-knee replacement.",
      });
      await playTeachBackVisualization("misconception-comparison");
      setBusy(false);
      return;
    }
    setFeedback("uncertain");
    await onResult({
      conceptId: "tissue-treated",
      status: "uncertain",
      evidence: answer,
      clarification: "The patient requested another explanation of the treatment target.",
    });
    setBusy(false);
  };

  return (
    <div className="teachback-layout view-enter">
      <section className="glass-card teachback-session">
        <div className="teachback-model">
          <KneeViewer compact onVisualizationStateChange={onVisualizationState} />
          <div className="teachback-prompt-orb"><Mic size={22} /><span>Voice optional</span></div>
        </div>
        <div className="teachback-composer">
          <div className="teachback-status-row">
            <StatusPill tone="blue">Concept 1 · treatment target</StatusPill>
            <StatusPill tone={workflow.connected ? "green" : "neutral"}>
              {workflow.connected ? "Medplum connected" : "Demo cache"}
            </StatusPill>
          </div>
          <h3>In your own words, what part of your knee may be treated?</h3>
          <p>Try the planned misconception for the demo, or answer correctly.</p>
          <div className="demo-answer-chips">
            <button onClick={() => setAnswer("The surgeon is replacing my whole knee.")}>Use misconception</button>
            <button onClick={() => setAnswer("The surgeon may trim or repair the torn meniscus, not replace my whole knee.")}>Use corrected answer</button>
          </div>
          <label className="answer-field">
            <span>Your answer</span>
            <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type or speak your answer…" />
            <button className="mic-inline" aria-label="Speak answer"><Mic size={18} /></button>
          </label>
          <button className="button button-primary" onClick={() => { void submitAnswer(); }} disabled={!answer.trim() || busy}>
            {busy ? "Recording…" : "Check my explanation"} <ArrowRight size={17} />
          </button>
          {feedback === "misconception" && (
            <div className="feedback-card feedback-warning" role="status">
              <CircleAlert size={20} /><div><strong>Let’s clarify one important point.</strong><span>This is not a whole-knee replacement. The model now highlights only the torn meniscus.</span></div>
            </div>
          )}
          {feedback === "corrected" && (
            <div className="feedback-card feedback-success" role="status">
              <CheckCircle2 size={20} /><div><strong>That captures the key distinction.</strong><span>You identified the meniscus and the uncertainty between limited trimming and repair.</span></div>
            </div>
          )}
          {feedback === "uncertain" && (
            <div className="feedback-card feedback-warning" role="status">
              <CircleAlert size={20} /><div><strong>Let’s review that with a person.</strong><span>The education Task remains unresolved and clinician review is visible in the workflow.</span></div>
            </div>
          )}
        </div>
      </section>

      <aside className="glass-card concept-list-card">
        <span className="card-kicker">Critical concepts</span>
        <h3>Understanding checklist</h3>
        <div className="concept-list">
          {teachBackConcepts.map((concept) => {
            const status = statuses[concept.id];
            return (
              <article key={concept.id} className={`concept-card concept-${status}`}>
                <div className="concept-status-icon">
                  {status === "understood" ? <Check size={16} /> : status === "contradicted" ? <X size={16} /> : <span />}
                </div>
                <div><strong>{concept.title}</strong><span>{status.replace("-", " ")}</span><p>{concept.prompt}</p></div>
                {concept.id !== "tissue-treated" && (
                  <button onClick={() => { void onResult({
                    conceptId: concept.id,
                    status: "understood",
                    evidence: concept.response || `I understand ${concept.title.toLowerCase()}.`,
                  }); }}>Use demo answer</button>
                )}
              </article>
            );
          })}
        </div>
        <div className="human-help-card"><LifeBuoy size={20} /><div><strong>Prefer a person?</strong><span>Ask for a clinician at any point.</span></div><button>Request help</button></div>
      </aside>
    </div>
  );
}

function ReviewView({
  preferences,
  statuses,
  workflow,
  estimateAcknowledged,
  onNavigate,
}: {
  preferences: Record<OptionId, Preference>;
  statuses: Record<ComprehensionConceptId, ConceptStatus>;
  workflow: ConsentWorkflowSnapshot;
  estimateAcknowledged: boolean;
  onNavigate: (view: JourneyView) => void;
}) {
  const understood = Object.values(statuses).filter((status) => status === "understood").length;
  const selectedPreference = Object.entries(preferences).find(([, value]) => value === "preferred");
  const ready = understood === 3 && estimateAcknowledged && workflow.clinicianEscalation !== "requested";

  return (
    <div className="review-layout view-enter">
      <section className="glass-card review-summary-card">
        <div className="review-hero">
          <div className={`review-status-orb ${ready ? "ready" : "blocked"}`}>
            {ready ? <CheckCircle2 size={34} /> : <LockKeyhole size={32} />}
          </div>
          <div>
            <StatusPill tone={ready ? "green" : "amber"}>{ready ? "Ready for clinician review" : "Consent still blocked"}</StatusPill>
            <h2>{ready ? "Your learning summary is ready." : "Two things still need attention."}</h2>
            <p>{ready ? "This demo can now hand the preference and comprehension summary to the care team. A clinician still confirms the final plan." : "Complete the remaining critical concept and acknowledge the financial estimate before review."}</p>
          </div>
        </div>
        <div className="review-grid">
          <article><span className="card-kicker">Recorded preference</span><strong>{selectedPreference ? careOptions.find((option) => option.id === selectedPreference[0])?.title : "No preferred path yet"}</strong><button onClick={() => onNavigate("options")}>Review options <ArrowRight size={15} /></button></article>
          <article><span className="card-kicker">Critical concepts</span><strong>{understood} of 3 understood</strong><button onClick={() => onNavigate("teachback")}>Continue teach-back <ArrowRight size={15} /></button></article>
          <article><span className="card-kicker">Estimate</span><strong>{estimateAcknowledged ? "Uncertainty acknowledged" : "Acknowledgement needed"}</strong><button onClick={() => onNavigate("costs")}>Review cost details <ArrowRight size={15} /></button></article>
          <article><span className="card-kicker">Open support need</span><strong>Adult needed after surgery</strong><button onClick={() => onNavigate("plan")}>Review recovery plan <ArrowRight size={15} /></button></article>
        </div>
        <div className="review-actions">
          <button className="button button-primary" disabled={!ready}><FileCheck2 size={17} /> Send demo summary to care team</button>
          <button className="button button-secondary"><Headphones size={17} /> Talk to a person</button>
        </div>
      </section>

      <aside className="glass-card audit-card">
        <div className="card-heading-row">
          <div><span className="card-kicker">FHIR event stream</span><h3>{workflow.connected ? "Medplum audit trail" : "Reconnectable demo trail"}</h3></div>
          <span className={workflow.connected ? "live-dot" : "workflow-offline-dot"} />
        </div>
        <div className="audit-list">
          {workflow.events.slice(0, 7).map((event) => (
            <article key={event.id}>
              <i />
              <div><strong>{event.action}</strong><span>{event.resourceType} · {event.summary}</span></div>
              <time>{new Date(event.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
            </article>
          ))}
        </div>
        <button className="text-button">View {workflow.connected ? "FHIR resources" : "synthetic snapshot"} <ArrowRight size={15} /></button>
      </aside>
    </div>
  );
}

const voicePromptChips = [
  {
    id: "procedure",
    label: "Show the damaged part",
    message: "Show me the damaged part in the 3D model and explain it.",
  },
  {
    id: "options",
    label: "Compare my options",
    message: "Explain all three available options with equal weight.",
  },
  {
    id: "recovery",
    label: "Compare recovery",
    message: "Compare the recovery ranges for therapy, possible trim, and possible repair.",
  },
  {
    id: "costs",
    label: "Explain the estimate",
    message: "Open the cost details and explain what could change the estimate.",
  },
] as const;

function waitForVisualizationController(
  previousBridge?: Window["consentLoopVisualization"],
  timeoutMs = 4_000,
): Promise<NonNullable<Window["consentLoopVisualization"]>> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();

    const check = () => {
      const bridge = window.consentLoopVisualization;
      if (bridge && (!previousBridge || bridge !== previousBridge)) {
        resolve(bridge);
        return;
      }
      if (performance.now() - startedAt >= timeoutMs) {
        reject(new Error("The interactive anatomy viewer did not become ready."));
        return;
      }
      window.setTimeout(check, 50);
    };

    check();
  });
}

export function ConsentLoopDemo() {
  const [activeView, setActiveView] = useState<JourneyView>("overview");
  const [railOpen, setRailOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [voiceExpanded, setVoiceExpanded] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("Patient dashboard loaded");
  const [anatomyState, setAnatomyState] = useState<AnatomyState | null>(null);
  const [visualizationState, setVisualizationState] = useState<VisualizationSnapshot | null>(null);
  const [workflow, setWorkflow] = useState<ConsentWorkflowSnapshot>(() =>
    createDefaultWorkflowSnapshot(),
  );
  const [selectedOption, setSelectedOption] = useState<OptionId>("trim");
  const [preferences, setPreferences] = useState<Record<OptionId, Preference>>({
    therapy: null,
    trim: "preferred",
    repair: "unsure",
  });
  const [estimateAcknowledged, setEstimateAcknowledged] = useState(false);
  const pendingVoiceMessage = useRef<string | null>(null);
  const activeViewRef = useRef<JourneyView>("overview");
  const workflowRef = useRef(workflow);
  const workflowWriteRef = useRef<Promise<void>>(Promise.resolve());
  const visualizationStateRef = useRef<VisualizationSnapshot | null>(null);
  const assessedVoiceEntries = useRef(new Set<string>());
  const voiceViewerBridgeRef = useRef<Window["consentLoopVisualization"]>(undefined);
  const voiceViewerTransitionRef = useRef<
    Promise<NonNullable<Window["consentLoopVisualization"]>> | null
  >(null);
  const mainHeading = useRef<HTMLHeadingElement>(null);

  const currentIndex = navItems.findIndex((item) => item.id === activeView);
  const progress = Math.round(((currentIndex + 1) / navItems.length) * 100);
  const copy = pageCopy[activeView];
  const conceptStatuses = useMemo<Record<ComprehensionConceptId, ConceptStatus>>(
    () => ({
      "procedure-identity": workflow.concepts["procedure-identity"].status,
      "tissue-treated": workflow.concepts["tissue-treated"].status,
      "risk-limitation": workflow.concepts["risk-limitation"].status,
    }),
    [workflow.concepts],
  );

  useEffect(() => {
    workflowRef.current = workflow;
  }, [workflow]);

  useEffect(() => {
    visualizationStateRef.current = visualizationState;
  }, [visualizationState]);

  useEffect(() => {
    let cancelled = false;
    void loadConsentWorkflow({ storage: window.localStorage }).then((snapshot) => {
      if (cancelled) return;
      workflowRef.current = snapshot;
      setWorkflow(snapshot);
      setAnnouncement(
        snapshot.connected
          ? "Consent workflow synchronized from Medplum"
          : "Synthetic workflow restored from this browser",
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    mainHeading.current?.focus({ preventScroll: true });
  }, [activeView]);

  const navigate = (view: JourneyView) => {
    const previousView = activeViewRef.current;
    const previousBridge = window.consentLoopVisualization;
    activeViewRef.current = view;

    if (view === "anatomy" && previousView !== "anatomy") {
      const transition = waitForVisualizationController(previousBridge);
      voiceViewerTransitionRef.current = transition;
      void transition
        .then((bridge) => {
          if (
            activeViewRef.current === "anatomy" &&
            voiceViewerTransitionRef.current === transition
          ) {
            voiceViewerBridgeRef.current = bridge;
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (voiceViewerTransitionRef.current === transition) {
            voiceViewerTransitionRef.current = null;
          }
        });
    } else if (view !== "anatomy") {
      voiceViewerBridgeRef.current = undefined;
      voiceViewerTransitionRef.current = null;
    }

    setActiveView(view);
    setRailOpen(false);
    setAnnouncement(`${pageCopy[view].title} view opened`);
  };

  const executeVisualization = async (
    command: VisualizationCommand,
    voiceCall?: VisualizationVoiceToolCall,
  ): Promise<VoiceToolExecutionResult> => {
    if (activeViewRef.current !== "anatomy") {
      navigate("anatomy");
    }

    const pendingBridge = voiceViewerTransitionRef.current;
    const bridge = pendingBridge
      ? await pendingBridge
      : voiceViewerBridgeRef.current ??
        window.consentLoopVisualization ??
        await waitForVisualizationController();
    voiceViewerBridgeRef.current = bridge;

    const result = await bridge.execute(command);
    if (result.status !== "completed") {
      return { ok: false, error: result.message };
    }
    visualizationStateRef.current = result.snapshot;
    setVisualizationState(result.snapshot);
    setAnnouncement("Voice guide updated the interactive anatomy");
    const narration = voiceCall ? getVoiceNarrationCue(voiceCall) : undefined;
    const nextApprovedAction = voiceCall
      ? getNextApprovedVoiceAction(voiceCall)
      : undefined;
    return {
      ok: true,
      message: `${result.message} The visual transition has finished.`,
      settled: {
        transitionCompleted: true,
        stateRevision: result.stateRevision,
        visualState: result.snapshot.visualState,
        viewMode: result.snapshot.viewMode,
        activeRegionId: result.snapshot.activeRegionId,
        procedureId: result.snapshot.procedureId,
        stepId: result.snapshot.stepId,
        stage: result.snapshot.stage,
      },
      ...(narration ? { narration } : {}),
      ...(nextApprovedAction ? { nextApprovedAction } : {}),
      ...(voiceCall?.name === "play_procedure_step" &&
      voiceCall.arguments.stepId === "patient-teachback"
        ? { waitForPatientResponse: true as const }
        : {}),
    };
  };

  const recordTeachBack = async (update: TeachBackUpdate): Promise<void> => {
    const write = workflowWriteRef.current.then(async () => {
      const snapshot = await persistTeachBackUpdate(
        workflowRef.current,
        update,
        { storage: window.localStorage },
      );
      workflowRef.current = snapshot;
      setWorkflow(snapshot);
      const message = snapshot.connected
        ? "Teach-back recorded in Medplum and the consent workflow was recomputed."
        : "Teach-back saved in the reconnectable synthetic demo cache.";
      setVoiceNotice(message);
      setAnnouncement(message);
    });
    workflowWriteRef.current = write.catch(() => undefined);
    await write;
  };

  const handleVoiceToolCall = async (
    call: VoiceToolCall,
  ): Promise<VoiceToolExecutionResult> => {
    if (isVisualizationVoiceToolCall(call)) {
      const sequenceError = getVoiceVisualizationSequenceError(
        call,
        visualizationStateRef.current,
      );
      if (sequenceError) return { ok: false, error: sequenceError };
      return executeVisualization(voiceToolToVisualizationCommand(call), call);
    }

    switch (call.name) {
      case "open_consent_section":
        navigate(call.arguments.section);
        return {
          ok: true,
          message: `${navItems.find((item) => item.id === call.arguments.section)?.label ?? "The requested"} section is open.`,
        };
      case "focus_option": {
        setSelectedOption(call.arguments.option);
        navigate("options");
        const option = careOptions.find((item) => item.id === call.arguments.option);
        return {
          ok: true,
          message: `${option?.title ?? "The requested option"} is in focus. No preference was recorded.`,
        };
      }
      case "request_human": {
        const destinationLabels = {
          clinician: "care-team",
          scheduler: "scheduling",
          financial: "financial-counseling",
        } as const;
        const message = `A ${destinationLabels[call.arguments.destination]} handoff is ready to review. Nothing has been sent in this demo.`;
        setVoiceExpanded(true);
        setVoiceNotice(message);
        setAnnouncement(message);
        return { ok: true, message };
      }
    }
  };

  const handleVoiceTranscript = (entry: VoiceTranscriptEntry) => {
    if (
      entry.role !== "user" ||
      assessedVoiceEntries.current.has(entry.id) ||
      visualizationStateRef.current?.visualState !== "asking-teachback"
    ) {
      return;
    }
    assessedVoiceEntries.current.add(entry.id);
    const normalized = entry.content.toLowerCase();
    const identifiesMeniscus =
      normalized.includes("meniscus") || normalized.includes("torn tissue");
    const describesWholeReplacement =
      normalized.includes("whole knee") || normalized.includes("entire knee") || normalized.includes("replac");

    if (identifiesMeniscus) {
      void recordTeachBack({
        conceptId: "tissue-treated",
        status: "understood",
        evidence: entry.content,
        clarification: "Voice teach-back distinguished the meniscus from the complete knee joint.",
      }).then(() => executeVisualization({
        type: "PLAY_PROCEDURE_STEP",
        procedureId: "knee-arthroscopy",
        stepId: "completion",
      }));
      return;
    }

    if (describesWholeReplacement) {
      void recordTeachBack({
        conceptId: "tissue-treated",
        status: "contradicted",
        evidence: entry.content,
        misconception: "Patient described the plan as a whole-knee replacement.",
      }).then(() => executeVisualization({
        type: "PLAY_PROCEDURE_STEP",
        procedureId: "knee-arthroscopy",
        stepId: "misconception-comparison",
      }));
      return;
    }

    void recordTeachBack({
      conceptId: "tissue-treated",
      status: "uncertain",
      evidence: entry.content,
      clarification: "Patient needs another treatment-target explanation.",
    });
  };

  const voice = useConsentVoiceAgent({
    onToolCall: handleVoiceToolCall,
    onTranscript: handleVoiceTranscript,
  });
  const voiceStatus = voice.status;
  const sendVoiceText = voice.sendText;

  useEffect(() => {
    if (voiceStatus !== "listening" || !pendingVoiceMessage.current) return;
    const message = pendingVoiceMessage.current;
    const timer = window.setTimeout(() => {
      if (sendVoiceText(message)) pendingVoiceMessage.current = null;
    }, 250);
    return () => window.clearTimeout(timer);
  }, [sendVoiceText, voiceStatus]);

  const startVoice = async (withMicrophone = true) => {
    setVoiceExpanded(true);
    setVoiceNotice(null);
    if (voice.status === "error") voice.stop();
    await voice.start({ microphone: withMicrophone });
  };

  const stopVoice = () => {
    pendingVoiceMessage.current = null;
    voice.stop();
    setVoiceNotice("Voice stopped. You can still use every control without speech.");
    setAnnouncement("Voice guide stopped");
  };

  const sendVoiceMessage = (message: string) => {
    const normalized = message.trim();
    if (!normalized) return;
    setVoiceExpanded(true);
    setVoiceNotice(null);
    if (voice.sendText(normalized)) return;
    pendingVoiceMessage.current = normalized;
    void startVoice(false);
  };

  const prepareHumanHelp = () => {
    const message = "Human help is ready to review. This synthetic demo has not sent a request.";
    setVoiceExpanded(true);
    setVoiceNotice(message);
    setAnnouncement(message);
  };

  const nextView = () => navigate(navItems[Math.min(navItems.length - 1, currentIndex + 1)].id);
  const previousView = () => navigate(navItems[Math.max(0, currentIndex - 1)].id);

  const preferredLabel = useMemo(() => {
    const id = (Object.entries(preferences) as Array<[OptionId, Preference]>).find(([, preference]) => preference === "preferred")?.[0];
    return id ? careOptions.find((option) => option.id === id)?.title : null;
  }, [preferences]);

  const voiceTranscript = useMemo(
    () =>
      voice.transcript.map((entry) => ({
        id: entry.id,
        speaker: entry.role === "assistant" ? "guide" as const : "patient" as const,
        text: entry.content,
      })),
    [voice.transcript],
  );
  const latestGuideLine = [...voice.transcript]
    .reverse()
    .find((entry) => entry.role === "assistant")?.content;
  const voiceDockStatus: ConsentVoiceDockStatus =
    voice.status === "reconnecting"
      ? "connecting"
      : voice.status === "listening" && voice.isActive && !voice.microphoneEnabled
        ? "text"
        : voice.status;
  const voiceCaption =
    voiceNotice ??
    (voice.status === "reconnecting" ? "The connection paused. Reconnecting the guide…" : null) ??
    voice.warning ??
    (voice.microphoneMuted ? "Microphone paused. Resume it when you are ready." : null) ??
    latestGuideLine ??
    (!voice.microphoneEnabled && voice.isActive
      ? "Microphone is off. Type a question or stop the guide."
      : null);

  return (
    <div className={`consent-app ${darkMode ? "theme-dark" : ""}`}>
      <div className="ambient-orb ambient-one" />
      <div className="ambient-orb ambient-two" />
      <div className="app-shell">
        <header className="app-header">
          <button className="mobile-menu-button" onClick={() => setRailOpen(!railOpen)} aria-label="Toggle navigation"><Menu size={20} /></button>
          <Logo />
          <div className="session-context">
            <span className="session-kicker">Current session</span>
            <strong>{patient.procedure}</strong>
            <span>{patient.clinician}</span>
          </div>
          <div className="header-progress" aria-label={`Journey progress ${progress}%`}>
            <span>Journey progress</span><div><i style={{ width: `${progress}%` }} /></div><strong>{progress}%</strong>
          </div>
          <div className="header-actions">
            <button className="help-button" onClick={prepareHumanHelp}><Headphones size={17} /><span>Ask for help</span></button>
            <button className="icon-button" aria-label="Search"><Search size={18} /></button>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <button className="theme-toggle icon-button" onClick={() => setDarkMode(!darkMode)} aria-label={darkMode ? "Use light theme" : "Use dark theme"}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="patient-avatar" aria-label="Open patient menu"><span>{patient.initials}</span><i className="online-dot" /></button>
          </div>
        </header>

        <nav className={`step-rail ${railOpen ? "open" : ""}`} aria-label="Consent journey">
          <div className="rail-patient-card">
            <span className="patient-avatar large">{patient.initials}</span>
            <div><strong>{patient.name}</strong><span>MRN {patient.mrn}</span></div>
            <button onClick={() => setRailOpen(false)} aria-label="Close navigation"><PanelLeftClose size={17} /></button>
          </div>
          <div className="rail-items">
            {navItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => navigate(item.id)} aria-current={activeView === item.id ? "step" : undefined}>
                  <span className="rail-icon"><Icon size={19} /><i>{index + 1}</i></span>
                  <span>{item.label}</span>
                  {index < currentIndex && <Check size={14} className="rail-check" />}
                </button>
              );
            })}
          </div>
          <div className="rail-footer">
            <div className="privacy-chip"><LockKeyhole size={15} /><span><strong>Private session</strong><small>Synthetic demo only</small></span></div>
            <button><HelpCircle size={18} /><span>Help &amp; accessibility</span></button>
          </div>
        </nav>
        {railOpen && <button className="rail-scrim" onClick={() => setRailOpen(false)} aria-label="Close navigation overlay" />}

        <main className="app-main">
          <div className="page-header">
            <div>
              <span className="page-eyebrow">{copy.eyebrow}</span>
              <h1 ref={mainHeading} tabIndex={-1}>{copy.title}</h1>
              <p>{copy.body}</p>
            </div>
            <div className="page-header-meta">
              <StatusPill tone="neutral"><Stethoscope size={14} /> {patient.clinician}</StatusPill>
              <StatusPill tone={workflow.connected ? "green" : "neutral"}>
                <span className={workflow.connected ? "live-dot" : "workflow-offline-dot"} />
                {workflow.connected ? "Medplum live" : "Demo cache"}
              </StatusPill>
              {preferredLabel && <StatusPill tone="blue"><HandHeart size={14} /> Preference: {preferredLabel.replace("Arthroscopy · ", "")}</StatusPill>}
            </div>
          </div>

          <div className="view-container">
            {activeView === "overview" && <OverviewView onNavigate={navigate} />}
            {activeView === "anatomy" && (
              <AnatomyView
                anatomyState={anatomyState}
                visualizationState={visualizationState}
                workflow={workflow}
                onAnatomyState={setAnatomyState}
                onVisualizationState={(state) => {
                  visualizationStateRef.current = state;
                  setVisualizationState(state);
                }}
                onVisualizationCommand={(command) => { void executeVisualization(command); }}
                onVoiceOpen={() => setVoiceExpanded(true)}
                onVoicePrompt={sendVoiceMessage}
              />
            )}
            {activeView === "options" && <OptionsView preferences={preferences} selected={selectedOption} onSelect={setSelectedOption} onPreference={(option, preference) => setPreferences((current) => ({ ...current, [option]: current[option] === preference ? null : preference }))} />}
            {activeView === "plan" && <PlanView />}
            {activeView === "costs" && <CostsView acknowledged={estimateAcknowledged} onAcknowledge={() => setEstimateAcknowledged((value) => !value)} />}
            {activeView === "teachback" && (
              <TeachBackView
                statuses={conceptStatuses}
                workflow={workflow}
                onResult={recordTeachBack}
                onVisualizationState={(state) => {
                  visualizationStateRef.current = state;
                  setVisualizationState(state);
                }}
              />
            )}
            {activeView === "review" && <ReviewView preferences={preferences} statuses={conceptStatuses} workflow={workflow} estimateAcknowledged={estimateAcknowledged} onNavigate={navigate} />}
          </div>

          <footer className="step-footer">
            <button className="button button-secondary" onClick={previousView} disabled={currentIndex === 0}><ArrowLeft size={16} /> Previous</button>
            <div><span>Step {currentIndex + 1} of {navItems.length}</span><strong>{navItems[currentIndex].label}</strong></div>
            <button className="button button-primary" onClick={nextView} disabled={currentIndex === navItems.length - 1}>Continue <ArrowRight size={16} /></button>
          </footer>
        </main>
      </div>
      <ConsentVoiceDock
        status={voiceDockStatus}
        caption={voiceCaption}
        transcript={voiceTranscript}
        error={voice.error}
        active={voice.isActive}
        expanded={voiceExpanded}
        muted={voice.outputMuted}
        promptChips={voicePromptChips}
        onStart={() => { void startVoice(); }}
        onStop={stopVoice}
        onToggleExpanded={() => setVoiceExpanded((value) => !value)}
        onToggleMute={() => { voice.toggleOutput(); }}
        onSendTyped={sendVoiceMessage}
        onPrompt={sendVoiceMessage}
        onHumanRequest={prepareHumanHelp}
      />
      <div className="sr-only" aria-live="polite">{announcement}</div>
    </div>
  );
}
