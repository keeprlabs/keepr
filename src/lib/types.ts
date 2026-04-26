// Shared domain types for Keepr.

export type Provider = "slack" | "github" | "gitlab" | "jira" | "linear" | "anthropic" | "openai" | "openrouter" | "custom" | "claude-code" | "codex";
export type WorkflowType = "team_pulse" | "one_on_one_prep" | "weekly_update" | "perf_evaluation" | "promo_readiness";
export type SessionStatus = "pending" | "processing" | "complete" | "failed";
export type EvidenceSource =
  | "github_pr"
  | "github_review"
  | "gitlab_mr"
  | "gitlab_review"
  | "slack_message"
  | "jira_issue"
  | "jira_comment"
  | "linear_issue"
  | "linear_comment";

export interface TeamMember {
  id: number;
  display_name: string;
  github_handle: string | null;
  gitlab_username: string | null;
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

export interface FeatureFlags {
  evidence_cards: boolean;
  citation_sync: boolean;
  confidence: boolean;
  timeline: boolean;
  followups: boolean;
  team_heatmap: boolean;
  thread_graph: boolean;
}

export interface GitLabProject {
  id: number;
  path_with_namespace: string;
}

export interface AppConfig {
  memory_dir: string;
  selected_slack_channels: Array<{ id: string; name: string }>;
  selected_github_repos: Array<{ owner: string; repo: string }>;
  selected_gitlab_projects: GitLabProject[];
  selected_jira_projects: JiraProject[];
  selected_linear_teams: LinearTeam[];
  gitlab_instance_url: string;
  jira_cloud_url: string;
  llm_provider: "anthropic" | "openai" | "openrouter" | "custom" | "claude-code" | "codex";
  synthesis_model: string;
  classifier_model: string;
  custom_llm_base_url: string;
  custom_llm_synthesis_model: string;
  custom_llm_classifier_model: string;
  privacy_consent_at: string | null;
  onboarded_at: string | null;
  engineering_rubric: string | null;
  feature_flags: FeatureFlags;
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

export interface FollowUp {
  id: number;
  file_path: string;
  subject: string;
  description: string;
  state: "open" | "carried" | "resolved";
  origin_session: number | null;
  origin_member_id: number | null;
  created_at: string;
  resolved_at: string | null;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  evidence_cards: true,
  citation_sync: true,
  confidence: true,
  timeline: true,
  followups: true,
  team_heatmap: true,
  thread_graph: true,
};

export const DEFAULT_CONFIG: AppConfig = {
  memory_dir: "",
  selected_slack_channels: [],
  selected_github_repos: [],
  selected_gitlab_projects: [],
  selected_jira_projects: [],
  selected_linear_teams: [],
  gitlab_instance_url: "https://gitlab.com",
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
  feature_flags: DEFAULT_FEATURE_FLAGS,
};
