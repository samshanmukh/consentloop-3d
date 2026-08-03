import type { ComponentType } from "react";
import type {
  ComprehensionConceptId,
  ComprehensionStatus,
} from "@consentloop/shared";

export type JourneyView =
  | "overview"
  | "anatomy"
  | "options"
  | "plan"
  | "costs"
  | "teachback"
  | "review";

export type Preference = "preferred" | "unsure" | "not-preferred" | null;

export type OptionId = "therapy" | "repair" | "trim" | "regenerative";

export interface CareOption {
  id: OptionId;
  eyebrow: string;
  title: string;
  summary: string;
  benefit: string;
  recovery: string;
  work: string;
  estimate: string;
  confidence: string;
  accent: "blue" | "coral" | "violet";
  recommended?: boolean;
  details: string[];
}

export interface JourneyNavItem {
  id: JourneyView;
  label: string;
  shortLabel: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

export const patient = {
  name: "Sam Lee",
  initials: "JL",
  procedure: "Right knee arthroscopy",
  clinician: "Dr. Maya Chen",
  mrn: "CL-2048",
  location: "Bayview Orthopedics",
  appointment: "Tue, Aug 18 · 7:30 AM",
  sessionId: "DEMO-CL-042",
};

export const careOptions: CareOption[] = [
  {
    id: "therapy",
    eyebrow: "Non-surgical",
    title: "Rehabilitation first",
    summary:
      "Continue guided strengthening and mobility work for six weeks, then reassess symptoms with your care team.",
    benefit: "Avoids surgery while testing whether symptoms improve",
    recovery: "No surgical downtime",
    work: "Work may continue with modified standing",
    estimate: "$180–$420",
    confidence: "High confidence",
    accent: "blue",
    details: [
      "2 visits per week for 6 weeks",
      "Clinical review after the sixth week",
      "Symptoms may continue during therapy",
    ],
  },
  {
    id: "repair",
    eyebrow: "Surgical pathway",
    title: "Arthroscopic meniscus repair",
    summary:
      "If the tear pattern, tissue quality, and blood supply allow it, the surgeon may place sutures to preserve the meniscus.",
    benefit: "Preserves more meniscus tissue when repair is possible",
    recovery: "Longer protected recovery",
    work: "Standing work may require 4–6+ weeks of planning",
    estimate: "$2,400–$3,600",
    confidence: "Range estimate",
    accent: "violet",
    details: [
      "Repair depends on the tear pattern and blood supply",
      "A brace and protected weight bearing may be required",
      "More rehabilitation is usually needed than after trimming",
    ],
  },
  {
    id: "trim",
    eyebrow: "Surgical pathway",
    title: "Arthroscopic partial meniscectomy",
    summary:
      "The surgeon examines the meniscus through two small portals and removes only unstable damaged tissue that cannot be repaired.",
    benefit: "May reduce catching and pain from unstable tissue",
    recovery: "Often earlier weight bearing than repair",
    work: "Desk work often returns before standing work",
    estimate: "$1,850–$2,650",
    confidence: "Moderate confidence",
    accent: "coral",
    details: [
      "Only unstable tissue is removed; this is not a knee replacement",
      "The final action depends on what the surgeon sees",
      "Physical therapy is commonly part of recovery",
    ],
  },
  {
    id: "regenerative",
    eyebrow: "Investigational pathway",
    title: "Stem-cell or regenerative injection",
    summary:
      "Some clinics offer cell-based or other regenerative injections, but they are not FDA-approved for orthopedic conditions and are not proven to regrow a torn meniscus.",
    benefit: "A potential meniscus-healing benefit has not been established",
    recovery: "Protocols and outcomes are uncertain",
    work: "Discuss only with an orthopedic specialist or regulated clinical trial team",
    estimate: "Often self-pay",
    confidence: "Insufficient evidence",
    accent: "blue",
    details: [
      "Not an established substitute for repair or rehabilitation",
      "Ask whether a product is FDA-approved or used in an FDA-overseen trial",
      "Review known risks, costs, and evidence with your clinician",
    ],
  },
];

export function getDemoAnswer(question: string): string {
  const normalized = question.toLowerCase();
  if (normalized.includes("stem") || normalized.includes("regenerative")) {
    return "Stem-cell and regenerative injections are investigational for a torn meniscus. They are not FDA-approved for orthopedic conditions or proven to regrow the tear, so discuss evidence and regulated trials with your clinician.";
  }
  if (normalized.includes("different") || normalized.includes("trimming")) {
    return "A repair uses sutures to preserve suitable meniscus tissue. Trimming removes only unstable damaged tissue that cannot be repaired, and recovery is often shorter, but the surgeon decides after inspecting the tear.";
  }
  if (normalized.includes("repair")) {
    return "During arthroscopic repair, the surgeon enters through small portals, inspects the tear, and places sutures only when the pattern, tissue quality, and blood supply make repair possible.";
  }
  if (normalized.includes("surgeon") || normalized.includes("ask")) {
    return "Ask whether your tear can be repaired, what may change during arthroscopy, what recovery restrictions to expect, and which personal risks matter most for you.";
  }
  return "This educational demo can explain the meniscus tear, rehabilitation, repair, trimming, and the illustrated arthroscopy steps. Your surgeon should answer patient-specific questions.";
}

export const timeline = [
  {
    id: "prepare",
    date: "Today",
    title: "Understand and choose",
    description: "Review options, ask questions, and record what matters most.",
    state: "active",
  },
  {
    id: "preop",
    date: "Aug 12",
    title: "Pre-op check-in",
    description: "Medication review, arrival plan, and recovery-support check.",
    state: "upcoming",
  },
  {
    id: "procedure",
    date: "Aug 18",
    title: "Procedure day",
    description: "Arrive at 7:30 AM. A trusted adult must take you home.",
    state: "upcoming",
  },
  {
    id: "first-week",
    date: "Days 1–7",
    title: "Protect and recover",
    description: "Pain plan, swelling checks, mobility support, and wound care.",
    state: "upcoming",
  },
  {
    id: "followup",
    date: "Aug 29",
    title: "First follow-up",
    description: "Review the operative finding and confirm the therapy plan.",
    state: "upcoming",
  },
];

export const costBreakdown = [
  { label: "Facility", value: "$8,400", patient: "$1,180", status: "In network" },
  { label: "Surgeon", value: "$2,750", patient: "$420", status: "In network" },
  { label: "Anesthesia", value: "$1,380", patient: "$205", status: "Network pending" },
  { label: "Post-op therapy", value: "$960", patient: "$240", status: "12 visits assumed" },
];

export const teachBackConcepts: Array<{
  id: ComprehensionConceptId;
  title: string;
  prompt: string;
  status: ComprehensionStatus;
  response: string;
}> = [
  {
    id: "tissue-treated",
    title: "What part is treated?",
    prompt: "Explain which part of your knee may be trimmed or repaired.",
    status: "understood",
    response: "The torn meniscus—not my whole knee—is the area being treated.",
  },
  {
    id: "procedure-identity",
    title: "What procedure is planned?",
    prompt: "Describe what arthroscopy does and what is decided during surgery.",
    status: "partial",
    response: "They need to see whether the torn tissue is healthy enough to repair.",
  },
  {
    id: "risk-limitation",
    title: "What is one important limitation?",
    prompt: "Describe how the uncertain treatment choice may change recovery.",
    status: "not-discussed",
    response: "",
  },
];
