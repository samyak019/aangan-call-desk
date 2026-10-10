export type Speaker = "agent" | "caller";
export interface Turn {
  speaker: Speaker;
  text: string;
}

export interface CallInput {
  externalCallId: string;
  callerPhone: string | null;
  startedAt: Date;
  durationSeconds: number;
  turns: Turn[];
  bookedSlot?: string | null; // ISO, if the agent booked via the Cal.com tool mid-call
}

// What the LLM extracts. Facts only — the LLM never decides qualification.
export interface ExtractedCall {
  intent:
    | "NEW_ENQUIRY"
    | "EXISTING_PROJECT_COMPLAINT"
    | "EXISTING_PROJECT_QUERY"
    | "VENDOR_OR_JOB"
    | "SPAM_OR_WRONG_NUMBER"
    | "NO_CONVERSATION";
  caller_name: string | null;
  caller_role: string | null;
  segment: "RESIDENTIAL" | "COMMERCIAL_OFFICE" | "COMMERCIAL_OTHER" | "UNKNOWN";
  commercial_category: string | null;
  property_type: string | null;
  bhk: number | null;
  locality: string | null;
  city: string | null;
  carpet_area_sqft: number | null;
  full_home: boolean | null;
  rooms_in_scope: string[];
  service_requested:
    | "DESIGN_AND_EXECUTION"
    | "ADVICE_ONLY"
    | "DESIGN_ONLY_DIY_EXECUTION"
    | "VASTU_ONLY"
    | "FURNITURE_SOURCING_ONLY"
    | "STRUCTURAL_OR_ARCHITECTURE"
    | "UNCLEAR";
  just_exploring: boolean;
  rented: boolean | null;
  timeline_text: string | null;
  timeline_flexible: boolean;
  weeks_until_completion_needed: number | null;
  weeks_until_execution_can_start: number | null;
  budget_text: string | null;
  budget_max_inr: number | null;
  decision_authority:
    | "DECISION_MAKER"
    | "AUTHORISED_REPRESENTATIVE"
    | "RESEARCHING_FOR_OTHERS"
    | "NO_AUTHORITY"
    | "UNKNOWN";
  decision_notes: string | null;
  asked_for_pricing: boolean;
  preferred_consultation_time: string | null;
  site_visit_requested: boolean;
  referral_source: string | null;
  preferences: string | null;
  sentiment: "POSITIVE" | "NEUTRAL" | "FRUSTRATED" | "ANGRY";
  complaint_summary: string | null;
  summary: string;
}

export type GateName = "scope" | "geography" | "timeline" | "budget" | "authority";
export type GateStatus = "PASS" | "FAIL" | "UNCLEAR";
export interface GateResult {
  status: GateStatus;
  reason: string;
}

export type Outcome =
  | "QUALIFIED"
  | "NOT_QUALIFIED"
  | "NEEDS_FOLLOW_UP"
  | "ESCALATE"
  | "EXISTING_CLIENT"
  | "NOT_AN_ENQUIRY"
  | "MISSED";

export interface Decision {
  outcome: Outcome;
  gates: Record<GateName, GateResult> | null;
  failedGates: GateName[];
  followUpQuestion: string | null;
  notes: string[]; // goes into the handoff "Key Notes"
}

export interface Classification {
  facts: ExtractedCall;
  decision: Decision;
  usage: { provider: string; model: string; inputTokens: number; outputTokens: number; latencyMs: number };
}
