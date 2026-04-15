// Shared domain types for Keepr.

export type Provider = "slack" | "github" | "jira" | "linear" | "anthropic" | "openai" | "openrouter" | "custom" | "claude-code";
export type WorkflowType = "team_pulse" | "one_on_one_prep" | "weekly_update" | "perf_evaluation" | "promo_readiness";
export type SessionStatus = "pending" | "processing" | "complete" | "failed";
export type EvidenceSource = "github_pr" | "github_review" | "slack_message" | "jira_issue" | "jira_comment" | "linear_issue" | "linear_comment";

export interface TeamMember {
  id: number;
  display_name: string;
  github_handle: string | null;
  slack_user_id: string | null;
  jira_username: string | null;
  linear_username: string | null;
  slug: string;
}

export interface SessionRow {
  id: number;
  workflow_type: WorkflowType;
  target_member_id: number | null;
  time_range_start: string;
  time_range_end: string;
  status: SessionStatus;
  error_message: string | null;
  output_file_path: string | null;
  token_usage: string | null;
  created_at: string;
  completed_at: string | null;
  archived_at: string | null;
}

export interface EvidenceItem {
  id: number;
  session_id: number;
  source: EvidenceSource;
  source_url: string;
  source_id: string;
  actor_member_id: number | null;
  timestamp_at: string;
  content: string;
}

// What Sonnet sees in the evidence JSON.
export interface EvidencePromptItem {
  id: string; // "ev_42"
  source: EvidenceSource;
  actor_id: string | null; // "tm_1"
  timestamp: string;
  url: string;
  content: string;
}

export interface Integration {
  id: number;
  provider: Provider;
  metadata: string | null;
  status: "active" | "reauth_required";
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
}

export interface AppConfig {
  memory_dir: string;
  selected_slack_channels: Array<{ id: string; name: string }>;
  selected_github_repos: Array<{ owner: string; repo: string }>;
  selected_jira_projects: JiraProject[];
  selected_linear_teams: LinearTeam[];
  jira_cloud_url: string;
  llm_provider: "anthropic" | "openai" | "openrouter" | "custom" | "claude-code";
  synthesis_model: string;
  classifier_model: string;
  custom_llm_base_url: string;
  custom_llm_synthesis_model: string;
  custom_llm_classifier_model: string;
  privacy_consent_at: string | null;
  onboarded_at: string | null;
  engineering_rubric: string | null;
}

export interface PersonFact {
  id: number;
  member_id: number;
  session_id: number;
  fact_type: "shipped" | "reviewed" | "discussed" | "blocked" | "collaborated" | "led";
  summary: string;
  evidence_ids: number[];
  extracted_at: string;
}

export interface QueryHistoryItem {
  id: number;
  member_id: number;
  query: string;
  answer: string;
  created_at: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  memory_dir: "",
  selected_slack_channels: [],
  selected_github_repos: [],
  selected_jira_projects: [],
  selected_linear_teams: [],
  jira_cloud_url: "",
  llm_provider: "anthropic",
  synthesis_model: "claude-sonnet-4-6",
  classifier_model: "claude-haiku-4-5-20251001",
  custom_llm_base_url: "",
  custom_llm_synthesis_model: "",
  custom_llm_classifier_model: "",
  privacy_consent_at: null,
  onboarded_at: null,
  engineering_rubric: null,
};
