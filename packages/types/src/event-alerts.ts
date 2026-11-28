export type IntentAlert = {
  intent_id: string;
  symbol: string;
  horizon_minutes: number;
  direction: string;
  score: number;
  created_at: string;
  queued_at: string;
  expires_at: string;
  actionable: boolean;
  execution_enabled: boolean;
  push_status: "none" | "queued" | "accepted" | "failed" | "expired" | "cancelled";
  opened_at: string | null;
  dispatch_ms: number | null;
  accepted_ms: number | null;
};

export type PushDevice = {
  id: string;
  label: string;
  detailed: boolean;
  enabled: boolean;
  last_success_at: string | null;
};

export type AlertConfiguration = { vapid_public_key: string | null };
