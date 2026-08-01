import type { ComponentType } from "react";

export type JourneyView =
  | "overview"
  | "anatomy"
  | "options"
  | "plan"
  | "costs"
  | "teachback"
  | "review";

export type Preference = "preferred" | "unsure" | "not-preferred" | null;

export type OptionId = "therapy" | "trim" | "repair";

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
  name: "Jordan Lee",
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
    title: "Continue physical therapy",
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
    id: "trim",
    eyebrow: "Surgical pathway",
    title: "Arthroscopy · possible trim",
    summary:
      "The surgeon examines the meniscus through two small portals and may remove only unstable damaged tissue.",
    benefit: "May reduce catching and pain from unstable tissue",
    recovery: "Often earlier weight bearing than repair",
    work: "Desk work often returns before standing work",
    estimate: "$1,850–$2,650",
    confidence: "Moderate confidence",
    accent: "coral",
    recommended: true,
    details: [
      "Final action depends on the tissue seen during surgery",
      "Crutches may be used for comfort initially",
      "Physical therapy is commonly part of recovery",
    ],
  },
  {
    id: "repair",
    eyebrow: "Surgical pathway",
    title: "Arthroscopy · possible repair",
    summary:
      "If the tear has enough healthy blood supply, the surgeon may place sutures to preserve the meniscus.",
    benefit: "Preserves more meniscus tissue when repair is possible",
    recovery: "Longer protected recovery",
    work: "Standing work may require 4–6+ weeks of planning",
    estimate: "$2,400–$3,600",
    confidence: "Range estimate",
    accent: "violet",
    details: [
      "Brace and protected weight bearing may be required",
      "More therapy visits are likely",
      "Repair cannot be confirmed until the surgeon sees the tear",
    ],
  },
];

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

export const teachBackConcepts = [
  {
    id: "target",
    title: "What part is treated?",
    prompt: "Explain which part of your knee may be trimmed or repaired.",
    status: "understood",
    response: "The torn meniscus—not my whole knee—is the area being treated.",
  },
  {
    id: "uncertainty",
    title: "What is decided during surgery?",
    prompt: "Why can’t the surgeon promise trim versus repair today?",
    status: "partial",
    response: "They need to see whether the torn tissue is healthy enough to repair.",
  },
  {
    id: "recovery",
    title: "How could recovery change?",
    prompt: "Describe how recovery may differ if the meniscus is repaired.",
    status: "not-started",
    response: "",
  },
];
