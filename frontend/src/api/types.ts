export type Role = "admin" | "faculty" | "student";

export interface Profile {
  employee_id?: string; department?: string; designation?: string; phone?: string;
  roll_number?: string; program?: string; batch?: string;
}
export interface User {
  id: string; email: string; full_name: string; role: Role;
  status: "active" | "discontinued" | "locked"; must_change_password: boolean;
  profile?: Profile | null; created_at?: string;
}
export interface LoginResponse {
  access: string; refresh: string; user: User; must_change_password: boolean; session_id: string | null;
}
export interface Paginated<T> { count: number; next: string | null; previous: string | null; results: T[] }

export interface Subject {
  id: string; name: string; code: string; description?: string;
  status: "active" | "discontinued" | "archived"; created_at?: string;
  /** Active faculty for the subject (student subject list only). */
  faculty_names?: string[];
}
export type ModuleAvailability = "locked" | "open";
export type ProgressStatus = "not_started" | "in_progress" | "completed" | "needs_review";
export interface Progress {
  sync_pending?: boolean;
  status: ProgressStatus; best_quiz_percentage: number | null; quiz_attempts: number; learning_seconds: number;
}
export interface ModuleBrief {
  id: string; title: string; order: number; availability: ModuleAvailability; source_missing?: boolean;
  start_page?: number | null; end_page?: number | null; progress?: Progress | null;
}
export interface ModuleFull extends ModuleBrief {
  chapter_id: string; source_text: string; source_heading_index?: number | null; is_user_edited?: boolean;
  document_id?: string; document_title?: string; chapter_title?: string;
  /** Position in the book and who teaches it (student module detail). */
  module_number?: number | null; module_count?: number; faculty_names?: string[];
}
export interface Chapter { id: string; title: string; order: number; modules: ModuleBrief[]; status?: string }
export type DocumentStatus = "uploaded" | "processing" | "under_review" | "ready" | "published" | "unpublished" | "archived" | "error";
export interface Document {
  background_job?: { id: string; status: string; attempts: number; error: string } | null;
  outline_strategy?: "source" | "ai";
  id: string; title: string; original_name: string; subject_id: string; subject_code?: string; status: DocumentStatus;
  file_type: string; file_size?: number; error_message?: string; content_version: number;
  chapter_count?: number; module_count?: number; outline_source?: string;
  /** Ids of modules kept without text only because student work refers to them (hidden from students). */
  missing_source_modules?: string[];
  /** Lesson generation counts over modules with text (detail endpoint only). */
  lessons?: LessonSummary;
  /** Automatic module quiz counts (detail endpoint only). */
  auto_quizzes?: { total: number; ready: number; checking?: number; held?: number; pending: number; generating: number; failed: number;
    dismissed: number; short?: number; min_chars?: number; enabled: boolean };
  /** Detail endpoint only: chapters with each module's lesson_status. */
  chapters?: OutlineChapter[];
  uploaded_by_name?: string; published_by_name?: string; created_at: string; updated_at?: string; published_at?: string | null; archived_at?: string | null;
  processing_started_at?: string | null;
  /** Present only while a processing run is in flight. */
  progress?: { step: number; total_steps: number; stage: string; detail: string; percent: number } | null;
}
export interface DocumentTree { id: string; title: string; subject_id: string; content_version: number; chapters: Chapter[] }
export interface Heading { index: number; level: number; title: string; start_page?: number; end_page?: number }
export interface OutlineModule {
  id?: string; title: string; order: number; source_heading_index: number | null; source_text?: string;
  source_missing?: boolean; availability?: ModuleAvailability; lesson_status?: LessonStatus;
  /** The module's automatic quiz: ready, checking (waiting for the AI monitor), held (flagged; needs review), pending,
   * generating, failed, dismissed (deleted by faculty), short (module too short), none or off. */
  quiz_status?: string; auto_quiz_id?: string | null;
}
export interface OutlineChapter { id?: string; title: string; order: number; source_heading_index?: number | null; modules: OutlineModule[] }
export interface Outline { document_id: string; status: DocumentStatus; content_version: number; headings: Heading[]; outline_source?: string; document_title: string; chapters: OutlineChapter[] }

export interface QuizOption { key: string; text: string }
export interface Question {
  id: string; type: "mcq" | "subjective"; question: string; options?: QuizOption[];
  correct_answer?: string; explanation?: string; expected_rubric?: string; source_reference?: string;
  /** The chosen module a generated question was written from. */
  source_module_id?: string | null;
}
export interface Quiz {
  id: string; title: string; instructions?: string; kind: "module" | "chapter" | "selection"; subject_id: string; module_id: string | null;
  chapter_id: string | null; status: "draft" | "published" | "closed" | "superseded"; generator: "ai" | "fallback" | "manual";
  pass_percentage: number; max_attempts: number | null; time_limit_minutes: number | null; available_from: string | null; due_at: string | null;
  version: number; question_count?: number; attempt_count?: number; questions?: Question[];
  /** Modules the questions were written from, when the quiz targets a chosen set. */
  source_module_ids?: string[];
  /** Written automatically for its module; see held_for_review. */
  auto_generated?: boolean;
  /** An automatic quiz the AI monitor flagged: kept as a draft until faculty publish it or clear the incident. */
  held_for_review?: boolean; hold_reason?: string; checked_at?: string | null;
  /** The AI monitor incident a held quiz waits on (faculty and admin views). */
  hold_incident_id?: string | null;
  hold_details?: { question_ids: string[]; evidence: { ref: string; text: string }[]; findings: { name: string; detail: string }[]; reason?: string } | null;
  /** Returned by generation only: what fell short of the request, or null. */
  generation_warning?: string | null;
  results_release?: "immediate" | "held" | "scheduled";
  results_release_at?: string | null;
  results_released_at?: string | null;
  pending_release_count?: number;
  offline_pending?: number;
  attempts_used?: number; results_pending?: number; best_percentage?: number | null; passed?: boolean | null; created_by_name?: string; created_at: string;
}
export interface DetailedResult {
  question_id: string; type: "mcq" | "subjective"; question: string; selected_option?: string; correct_option?: string;
  student_answer?: string; is_correct: boolean | null; score_awarded: number | null; explanation?: string; feedback?: string; missing_points?: string[];
}
export interface Attempt {
  id: string; assessment_id: string; assessment_title?: string; student_id?: string; student_email?: string; student_name?: string; attempt_number: number;
  status: "in_progress" | "submitted" | "pending_evaluation" | "evaluated"; started_at: string; submitted_at: string | null;
  time_taken_seconds: number; score: number | null; total_questions: number; percentage: number | null; passed: boolean | null;
  detailed_results: DetailedResult[];
  /** Set once this attempt's result has been released to the student. */
  results_released_at?: string | null;
}
export interface StartAttempt { attempt_id: string; attempt_number: number; started_at: string; resumed: boolean; time_limit_minutes: number | null; questions: Question[] }

export interface RubricItem { criterion: string; points: number }
export interface Assignment {
  id: string; title: string; description?: string; instructions?: string; subject_id: string; module_id: string | null; chapter_id: string | null;
  rubric: RubricItem[]; max_score: number; generator: string; status: "draft" | "published" | "closed";
  available_from: string | null; due_at: string | null; allow_late: boolean; allow_resubmission: boolean; max_attempts?: number | null;
  submission_count?: number; my_submission?: Submission | null; created_at: string;
  /** Modules the brief and rubric were drafted from, when a set was chosen. */
  source_module_ids?: string[];
  results_release?: "immediate" | "held" | "scheduled";
  results_release_at?: string | null;
  results_released_at?: string | null;
  pending_release_count?: number;
}
export interface Submission {
  id: string; assignment_id: string; assignment_title?: string; student_id?: string; student_email?: string; student_name?: string; attempt_number: number;
  content: string; submitted_at: string; is_late: boolean; time_spent_seconds: number; status: "submitted" | "evaluated" | "returned";
  score: number | null; feedback: string; rubric_scores: { criterion: string; points: number }[]; evaluated_at: string | null;
  results_released_at?: string | null;
}

export interface LessonSection { heading: string; explanation: string; source_reference: string }
export interface Lesson { title: string; learning_objectives: string[]; sections: LessonSection[]; key_terms: { term: string; definition: string }[]; summary: string }
/**
 * The Lesson tab. Lessons are generated in the background and stored, so this
 * never waits for the model. ready: the tutor's lesson. preparing: queued or
 * being generated, lesson is null, ask again shortly. unavailable: generation
 * failed or AI is off, lesson is a plain version built from the source text.
 */
export interface TeachResponse {
  module_id: string; status: "ready" | "preparing" | "unavailable"; lesson: Lesson | null;
  generator: "ai" | "fallback" | null; cached: boolean; ai_error?: string;
  queue_position?: number | null; retry_scheduled?: boolean; generated_at?: string | null;
}
export type LessonStatus = "ready" | "pending" | "generating" | "failed" | "none";
export interface LessonSummary { total: number; ready: number; pending: number; generating: number; failed: number; auto_generate: boolean }
export interface LessonDetail {
  module_id: string; status: LessonStatus; lesson: Lesson | null; model: string; generated_at: string | null;
  attempts: number; last_error: string; next_attempt_at: string | null; queue_position: number | null; auto_generate: boolean;
}
export interface OutlineReport {
  removed_empty_modules: { id: string | null; title: string; chapter: string }[];
  hidden_empty_modules: { id: string; title: string; chapter: string }[];
  removed_empty_chapters: { id: string | null; title: string }[];
}
export interface Message { id: string; role: "user" | "assistant"; content: string; grounded: boolean; source_reference: string; created_at: string }
export interface AskResponse { conversation_id: string; message: Message; follow_up_suggestions: string[] }
export interface Conversation { id: string; module_id: string; title: string; last_message_at: string | null; messages?: Message[] }

export interface AuditLog { id: string; actor_email: string; actor_role: string; action: string; target_type: string; target_id: string; target_label: string; summary: Record<string, unknown>; created_at: string }
/** unique: each account gets its own one-time password, returned once. shared: every account starts on the server's INITIAL_USER_PASSWORD. */
export type InitialPasswordMode = "unique" | "shared";
export interface IssuedPassword { initial_password?: string | null; initial_password_mode?: InitialPasswordMode }
export type CreatedUser = User & IssuedPassword;
export interface PasswordReset extends IssuedPassword { detail: string }
export interface ImportReport {
  total_rows: number; created: number; already_existing: number; invalid: number;
  errors: { row: number; email?: string | null; errors: string[] }[];
  created_users?: { row: number; id: string; email: string; full_name?: string; initial_password?: string | null }[];
  initial_password_mode?: InitialPasswordMode;
}

export interface AIModelStatus { name: string; present: boolean }
export type ComponentStatus = "READY" | "ERROR" | "MISSING";
export interface SystemComponent { component: string; status: ComponentStatus; summary: string; [k: string]: unknown }
export interface SystemStatus { status: ComponentStatus; components: SystemComponent[] }
export interface AIStatus {
  enabled: boolean; provider: string; runtime?: string; reachable: boolean; ready: boolean;
  tutor_model: AIModelStatus; outline_model: AIModelStatus; error: string;
  details?: { runtime?: { name: string; ready: boolean; error: string }; model_file?: { name: string; found: boolean; valid: boolean; size_mb: number; error: string }; loaded?: boolean; display_name?: string };
  system?: SystemStatus;
}

/* ---------------------------------------------------------------- */
/* AI Monitoring & Guard                                              */
/* ---------------------------------------------------------------- */

export type MonitorSeverity = "low" | "medium" | "high" | "critical";
export type MonitorVerdict = "pass" | "issue" | "abstain";
export type MonitorIssueType = "none" | "hallucination" | "factual_error" | "unsupported_claim" | "instruction_violation" | "quiz_error" | "safety" | "irrelevant" | "other";
export type IncidentStatus = "open" | "confirmed" | "false_positive" | "needs_investigation" | "escalated" | "closed";
export type ReviewAction = "confirm" | "false_positive" | "needs_investigation" | "escalate" | "close" | "reopen";

export interface MonitorPerson { id: string; email: string; full_name: string; role: Role }
export interface MonitorSubject { id: string; code: string; name: string }

export interface ValidatorResult { name: string; passed: boolean | null; issue_type: MonitorIssueType; severity: MonitorSeverity; confidence: number; detail: string; evidence: string[] }
export interface EvidencePassage { kind: string; ref: string; id?: string; text: string; truncated?: boolean }
export interface JudgeVerdict { is_issue: boolean; issue_type: MonitorIssueType; severity: MonitorSeverity; confidence: number; reason: string; evidence: string[]; recommended_action: string }

export interface MonitorFeedback { id: string; label: "correct" | "false_positive" | "needs_investigation"; note: string; reviewer: MonitorPerson | null; created_at: string }

export interface EvaluationSummary {
  id: string; interaction_kind: "tutor_answer" | "quiz"; interaction_id: string;
  user: MonitorPerson | null; subject: MonitorSubject | null; module_title: string; app_model_name: string;
  verdict: MonitorVerdict; issue_type: MonitorIssueType; severity: MonitorSeverity; confidence: number; reason: string;
  recommended_action: string; judge_invoked: boolean; judge_reason: string; judge_model: string; stage: "pending" | "done" | "failed"; error: string;
  evaluator_version: string; duration_ms: number; has_incident: boolean; created_at: string;
}

export interface EvaluationDetail extends EvaluationSummary {
  prompt_excerpt: string; response_excerpt: string; evidence_json: EvidencePassage[]; validators_json: ValidatorResult[];
  judge_json: Partial<JudgeVerdict>; judge_latency_ms: number | null; judge_error: string; feedback: MonitorFeedback[]; incident_id: string | null;
}

export interface MonitorIncident {
  id: string; issue_type: MonitorIssueType; severity: MonitorSeverity; status: IncidentStatus;
  user: MonitorPerson | null; subject: MonitorSubject | null; assigned_to: MonitorPerson | null; reviewer_note: string; recurrence: number;
  resolved_by: MonitorPerson | null; resolved_at: string | null; evaluation: EvaluationSummary; created_at: string; updated_at: string;
}
export interface MonitorIncidentDetail extends Omit<MonitorIncident, "evaluation"> { evaluation: EvaluationDetail }

export interface MonitorPolicy { id: string; issue_type: MonitorIssueType; enabled: boolean; min_confidence: number; min_severity: MonitorSeverity; description: string; version: number; updated_by: MonitorPerson | null; updated_at: string }

export interface MonitorStatus {
  enabled: boolean; mode: string; judge_enabled: boolean; judge_ready: boolean; judge_detail: string; judge_model: string;
  sample_percent: number; evaluator_version: string; queue_depth: number; retention_days: number; pending_backlog: number;
}

export interface MonitorModelHealth { model: string; evaluated: number; issues: number; issue_rate_percent: number; incidents: number; high_severity: number }

export interface MonitorOverview {
  window_days: number; interactions: number; evaluated: number; failed_evaluations: number; coverage_percent: number | null; judge_invocations: number;
  verdicts: Record<MonitorVerdict, number>; incidents: number; open_incidents: number; high_severity_incidents: number;
  by_severity: Record<MonitorSeverity, number>; by_issue_type: Record<string, number>; by_status: Record<IncidentStatus, number>;
  false_positive_rate_percent: number | null; high_severity_precision_percent: number | null; feedback_count: number; queue_depth: number;
  evaluator_version: string; models: MonitorModelHealth[]; status: MonitorStatus;
}

export interface MonitorTrendDay { day: string; total: number; by_severity: Record<MonitorSeverity, number>; by_issue_type: Record<string, number>; evaluated?: number; issues?: number }
export interface MonitorSubjectHealth { subject_id: string; code: string; name: string; evaluated: number; issues: number; incidents: number; incident_rate_percent: number; common_failures: { issue_type: MonitorIssueType; count: number }[] }
export interface MonitorUserImpact { user_id: string; email: string; full_name: string; role: Role; incidents: number; high_severity: number; open: number }
