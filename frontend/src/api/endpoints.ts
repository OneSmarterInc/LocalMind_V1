import { ApiError, api } from "./client";
import type * as T from "./types";

type Q = Record<string, string | number | undefined | null>;
const list = <X>(d: T.Paginated<X> | X[]): X[] => (Array.isArray(d) ? d : d.results);

/** A list that could not be fully loaded (offline, or an unusually large result). */
export type ListRows<X> = X[] & { incomplete?: { loaded: number; total: number | null; reason: "offline" | "limit" } };

/**
 * Every row of a paginated list. The first page is requested exactly as before, so its offline copy still
 * answers without a connection. Later pages are fetched only while online; if one cannot be loaded (for
 * example the device went offline, where only the first page was saved), the rows already loaded are
 * returned and marked `incomplete` so the screen can say so, instead of the whole list failing.
 */
async function allPages<X>(path: string, query: Q = {}): Promise<ListRows<X>> {
  const first = await api<T.Paginated<X> | X[]>(path, { query });
  if (Array.isArray(first)) return first;
  const rows: ListRows<X> = [...first.results];
  let next = first.next;
  const MAX_PAGES = 2000;
  for (let page = 2; next; page += 1) {
    if (page > MAX_PAGES) { rows.incomplete = { loaded: rows.length, total: first.count ?? null, reason: "limit" }; break; }
    let more: T.Paginated<X>;
    try { more = await api<T.Paginated<X>>(path, { query: { ...query, page }, cacheOffline: false }); }
    catch (e) {
      if (e instanceof ApiError && e.code === "NETWORK") { rows.incomplete = { loaded: rows.length, total: first.count ?? null, reason: "offline" }; break; }
      throw e;
    }
    rows.push(...more.results);
    next = more.next;
  }
  return rows;
}

export const auth = {
  login: (role: T.Role, email: string, password: string) =>
    api<T.LoginResponse>(`/auth/login/${role}/`, { method: "POST", body: { email, password }, auth: false }),
  me: () => api<T.User>("/auth/me/"),
  changePassword: (current_password: string, new_password: string) =>
    api<T.LoginResponse>("/auth/password/change/", { method: "POST", body: { current_password, new_password } }),
  heartbeat: (session_id: string | null) => api<{ session_id: string }>("/auth/heartbeat/", { method: "POST", body: { session_id } }),
  logout: (refresh: string, session_id: string | null) => api("/auth/logout/", { method: "POST", body: { refresh, session_id } }),
};

/** Reference data the screens read instead of restating the models. */
export const meta = {
  choices: () => api<Record<string, { value: string; label: string }[]>>("/meta/choices/"),
};

export const student = {
  subjects: () => api<T.Subject[]>("/student/subjects/").then(list),
  documents: (subjectId: string) => api<(T.Document & { open_module_count: number; completed_modules: number; progress_percent: number })[]>(`/student/subjects/${subjectId}/documents/`),
  document: (id: string) => api<T.DocumentTree>(`/student/documents/${id}/`),
  module: (id: string) => api<T.ModuleFull>(`/student/modules/${id}/`),
  reportTime: (moduleId: string, seconds: number) => api<{ learning_seconds: number }>(`/student/modules/${moduleId}/time/`, { method: "POST", body: { seconds } }),
  teach: (moduleId: string) => api<T.TeachResponse>(`/student/modules/${moduleId}/teach/`),
  ask: (moduleId: string, question: string, conversation_id?: string) =>
    api<T.AskResponse>(`/student/modules/${moduleId}/ask/`, { method: "POST", body: { question, conversation_id } }),
  conversations: (module?: string) => api<T.Conversation[]>("/student/conversations/", { query: { module } }).then(list),
  conversation: (id: string) => api<T.Conversation>(`/student/conversations/${id}/`),
  quizzes: (q: Q = {}) => api<T.Quiz[]>("/student/quizzes/", { query: q }),
  startAttempt: (quizId: string) => api<T.StartAttempt>(`/student/quizzes/${quizId}/attempts/`, { method: "POST" }),
  submitAttempt: (attemptId: string, submitted_answers: Record<string, string>) =>
    api<T.Attempt>(`/student/quiz-attempts/${attemptId}/submit/`, { method: "POST", body: { submitted_answers } }),
  attempt: (id: string) => api<T.Attempt>(`/student/quiz-attempts/${id}/`),
  scores: (q: Q = {}) => allPages<T.Attempt>("/student/scores/", q),
  remediation: (attemptId: string) => api<{ overview: string; items: { question: string; explanation: string; source_reference?: string }[]; generator: string }>(`/student/quiz-attempts/${attemptId}/remediation/`, { method: "POST" }),
  assignments: (q: Q = {}) => api<T.Assignment[]>("/student/assignments/", { query: q }),
  submitAssignment: (id: string, content: string, time_spent_seconds: number) =>
    api<T.Submission>(`/student/assignments/${id}/submissions/`, { method: "POST", body: { content, time_spent_seconds } }),
  submissions: () => allPages<T.Submission>("/student/assignment-submissions/"),
  overview: () => api<any>("/student/analytics/overview/"),
  subjectAnalytics: (id: string) => api<any>(`/student/analytics/subjects/${id}/`),
};

// Faculty portal; admins may use it too, so every manage screen calls these.
export const manage = {
  subjects: () => api<(T.Subject & { active_students: number; assignment_status: string })[]>("/faculty/subjects/"),
  subjectStudents: (id: string) => api<{ id: string; student_id: string; student_email: string; student_name: string; status: string; enrolled_at: string }[]>(`/faculty/subjects/${id}/students/`),
  enroll: (id: string, student_ids: string[]) => api<{ results: { student_id: string; status: string }[] }>(`/faculty/subjects/${id}/students/`, { method: "POST", body: { student_ids } }),
  discontinueEnrollment: (subjectId: string, studentId: string) => api(`/faculty/subjects/${subjectId}/students/${studentId}/discontinue/`, { method: "POST" }),
  searchStudents: (q: string, subject?: string) => api<{ id: string; email: string; full_name: string; roll_number: string }[]>("/faculty/students/search/", { query: { q, subject } }),

  documents: (q: Q = {}) => allPages<T.Document>("/faculty/documents/", q),
  document: (id: string) => api<T.Document>(`/faculty/documents/${id}/`),
  upload: (form: FormData) => api<T.Document>("/faculty/documents/", { method: "POST", form }),
  process: (id: string) => api<T.Document>(`/faculty/documents/${id}/process/`, { method: "POST" }),
  outline: (id: string) => api<T.Outline>(`/faculty/documents/${id}/outline/`),
  saveOutline: (id: string, chapters: T.OutlineChapter[], document_title?: string) =>
    api<T.Document & { outline_report?: T.OutlineReport }>(`/faculty/documents/${id}/outline/`, { method: "PUT", body: { chapters, document_title } }),
  moduleLesson: (id: string) => api<T.LessonDetail>(`/faculty/modules/${id}/lesson/`),
  regenerateLesson: (id: string) => api<T.LessonDetail>(`/faculty/modules/${id}/lesson/`, { method: "POST", body: {} }),
  /** Faculty-side incident review (their own subjects), used to release a held quiz as a false alarm. */
  reviewIncident: (id: string, action: "false_positive" | "confirm", note = "") =>
    api<unknown>(`/faculty/monitor/incidents/${id}/review/`, { method: "POST", body: { action, note } }),
  regenerateAutoQuiz: (moduleId: string) => api<{ module_id: string; quiz_status: string }>(`/faculty/modules/${moduleId}/auto-quiz/`, { method: "POST", body: {} }),
  generateAutoQuizzes: (documentId: string) => api<{ queued: number }>(`/faculty/documents/${documentId}/auto-quizzes/`, { method: "POST", body: {} }),
  generateLessons: (documentId: string, force = false) =>
    api<T.LessonSummary & { queued: number }>(`/faculty/documents/${documentId}/lessons/`, { method: "POST", body: { force } }),
  transition: (id: string, action: "ready" | "publish" | "unpublish" | "archive") => api<T.Document>(`/faculty/documents/${id}/${action}/`, { method: "POST" }),
  deleteDocument: (id: string) => api<{ detail: string }>(`/faculty/documents/${id}/`, { method: "DELETE" }),
  module: (id: string) => api<T.ModuleFull & { chapter_title?: string; document_id?: string; document_title?: string }>(`/faculty/modules/${id}/`),
  editModule: (id: string, body: { title?: string; source_text?: string }) => api<T.ModuleFull>(`/faculty/modules/${id}/`, { method: "PATCH", body }),
  moduleAvailability: (id: string, availability: T.ModuleAvailability) => api<T.ModuleFull>(`/faculty/modules/${id}/availability/`, { method: "POST", body: { availability } }),
  chapterAvailability: (id: string, availability: T.ModuleAvailability) => api(`/faculty/chapters/${id}/availability/`, { method: "POST", body: { availability } }),

  quizzes: (q: Q = {}) => allPages<T.Quiz>("/faculty/quizzes/", q),
  quiz: (id: string) => api<T.Quiz>(`/faculty/quizzes/${id}/`),
  createQuiz: (body: Record<string, unknown>) => api<T.Quiz>("/faculty/quizzes/", { method: "POST", body }),
  generateQuiz: (body: Record<string, unknown>) => api<T.Quiz>("/faculty/quizzes/generate/", { method: "POST", body }),
  updateQuiz: (id: string, body: Record<string, unknown>) => api<T.Quiz>(`/faculty/quizzes/${id}/`, { method: "PATCH", body }),
  quizStatus: (id: string, status: string) => api<T.Quiz>(`/faculty/quizzes/${id}/status/`, { method: "POST", body: { status } }),
  deleteQuiz: (id: string) => api<{ detail: string }>(`/faculty/quizzes/${id}/`, { method: "DELETE" }),
  quizAttempts: (id: string) => allPages<T.Attempt>(`/faculty/quizzes/${id}/attempts/`),
  releaseQuizResults: (id: string, attemptId?: string) =>
    api<{ released: number; pending: number }>(`/faculty/quizzes/${id}/release-results/`, { method: "POST", body: attemptId ? { attempt_id: attemptId } : {} }),
  reEvaluate: (attemptId: string, overrides?: Record<string, { score_awarded: number; feedback?: string }>) =>
    api<T.Attempt>(`/faculty/quiz-attempts/${attemptId}/re-evaluate/`, { method: "POST", body: overrides ? { overrides } : {} }),

  assignments: (q: Q = {}) => allPages<T.Assignment>("/faculty/assignments/", q),
  assignment: (id: string) => api<T.Assignment>(`/faculty/assignments/${id}/`),
  createAssignment: (body: Record<string, unknown>) => api<T.Assignment>("/faculty/assignments/", { method: "POST", body }),
  generateAssignment: (body: Record<string, unknown>) => api<T.Assignment>("/faculty/assignments/generate/", { method: "POST", body }),
  updateAssignment: (id: string, body: Record<string, unknown>) => api<T.Assignment>(`/faculty/assignments/${id}/`, { method: "PATCH", body }),
  assignmentStatus: (id: string, status: string) => api<T.Assignment>(`/faculty/assignments/${id}/status/`, { method: "POST", body: { status } }),
  deleteAssignment: (id: string) => api<{ detail: string }>(`/faculty/assignments/${id}/`, { method: "DELETE" }),
  submissions: (id: string) => allPages<T.Submission>(`/faculty/assignments/${id}/submissions/`),
  releaseAssignmentResults: (id: string, submissionId?: string) =>
    api<{ released: number; pending: number }>(`/faculty/assignments/${id}/release-results/`, { method: "POST", body: submissionId ? { submission_id: submissionId } : {} }),
  evaluate: (submissionId: string, body: { score: number; feedback: string }) => api<T.Submission>(`/faculty/assignment-submissions/${submissionId}/evaluate/`, { method: "POST", body }),

  overview: () => api<any>("/faculty/analytics/overview/"),
  subjectSummary: (id: string) => api<any>(`/faculty/analytics/subjects/${id}/`),
  subjectStudentsAnalytics: (id: string) => api<any>(`/faculty/analytics/subjects/${id}/students/`),
  subjectModules: (id: string) => api<any>(`/faculty/analytics/subjects/${id}/modules/`),
  studentAnalytics: (id: string) => api<any>(`/faculty/analytics/students/${id}/`),
  studentSubjectAnalytics: (id: string, subjectId: string) => api<any>(`/faculty/analytics/students/${id}/subjects/${subjectId}/`),
  teachingActivity: () => api<{ items: { kind: string; title: string; detail: string; subject: string; at: string; target_id: string }[]; window_days: number }>("/faculty/analytics/activity/"),
};

export const admin = {
  subjects: (q: Q = {}) => allPages<T.Subject>("/admin/subjects/", q),
  subject: (id: string) => api<T.Subject & { faculty: { faculty_id: string; email: string; full_name: string; status: string }[]; active_students?: number }>(`/admin/subjects/${id}/`),
  createSubject: (body: { name: string; code: string; description?: string }) => api<T.Subject>("/admin/subjects/", { method: "POST", body }),
  updateSubject: (id: string, body: Record<string, unknown>) => api<T.Subject>(`/admin/subjects/${id}/`, { method: "PATCH", body }),
  subjectStatus: (id: string, status: string) => api<T.Subject>(`/admin/subjects/${id}/status/`, { method: "POST", body: { status } }),
  deleteSubject: (id: string) => api<{ detail: string }>(`/admin/subjects/${id}/`, { method: "DELETE" }),
  assignFaculty: (id: string, faculty_ids: string[]) => api(`/admin/subjects/${id}/faculty/`, { method: "POST", body: { faculty_ids } }),
  unassignFaculty: (id: string, facultyId: string) => api(`/admin/subjects/${id}/faculty/${facultyId}/`, { method: "DELETE" }),
  subjectStudents: (id: string) => manage.subjectStudents(id),
  enroll: (id: string, student_ids: string[]) => api<{ results: { student_id: string; status: string }[] }>(`/admin/subjects/${id}/students/`, { method: "POST", body: { student_ids } }),
  discontinueEnrollment: (subjectId: string, studentId: string) => api(`/admin/subjects/${subjectId}/students/${studentId}/discontinue/`, { method: "POST" }),
  searchStudents: (q: string, subject?: string) => api<{ id: string; email: string; full_name: string; roll_number: string }[]>("/admin/students/search/", { query: { q, subject } }),

  users: (kind: "faculty" | "students", q: Q = {}) => allPages<T.User>(`/admin/${kind}/`, q),
  user: (kind: "faculty" | "students", id: string) => api<T.User>(`/admin/${kind}/${id}/`),
  createUser: (kind: "faculty" | "students", body: Record<string, unknown>) => api<T.CreatedUser>(`/admin/${kind}/`, { method: "POST", body }),
  resetPassword: (kind: "faculty" | "students", id: string) => api<T.PasswordReset>(`/admin/${kind}/${id}/reset-password/`, { method: "POST", body: {} }),
  updateUser: (kind: "faculty" | "students", id: string, body: Record<string, unknown>) => api<T.User>(`/admin/${kind}/${id}/`, { method: "PATCH", body }),
  userAction: (kind: "faculty" | "students", id: string, action: "discontinue" | "reactivate" | "reset-password", body: Record<string, unknown> = {}) =>
    api<T.User>(`/admin/${kind}/${id}/${action}/`, { method: "POST", body }),
  deleteUser: (kind: "faculty" | "students", id: string, reason = "") =>
    api<{ detail: string }>(`/admin/${kind}/${id}/`, { method: "DELETE", body: { reason } }),
  importUsers: (kind: "faculty" | "students", form: FormData) => api<T.ImportReport>(`/admin/${kind}/import/`, { method: "POST", form }),
  importTemplate: (kind: "faculty" | "students") =>
    api<{ columns: { name: string; required: boolean; example: string; aliases: string[] }[]; filename: string; content_base64: string }>(`/admin/${kind}/import/template/`),
  auditLogs: (q: Q = {}) => api<T.Paginated<T.AuditLog>>("/admin/audit-logs/", { query: q }),
  auditActions: () => api<{ actions: { value: string; count: number }[]; targets: string[] }>("/admin/audit-logs/actions/"),
  platform: () => api<any>("/admin/analytics/platform/"),
  platformSubjects: () => api<any>("/admin/analytics/platform/subjects/"),
  aiStatus: (refresh = false) => api<T.AIStatus>("/admin/ai/status/", { query: { refresh: refresh ? 1 : undefined } }),

  // AI Monitoring & Guard (admin incident centre).
  monitorOverview: (days = 30) => api<T.MonitorOverview>("/admin/monitor/overview/", { query: { days } }),
  monitorTrends: (days = 30) => api<{ window_days: number; days: T.MonitorTrendDay[] }>("/admin/monitor/trends/", { query: { days } }),
  monitorSubjects: (days = 30) => api<{ subjects: T.MonitorSubjectHealth[] }>("/admin/monitor/subjects/", { query: { days } }),
  monitorImpact: (days = 30) => api<{ users: T.MonitorUserImpact[] }>("/admin/monitor/impact/users/", { query: { days } }),
  monitorStatus: () => api<T.MonitorStatus>("/admin/monitor/status/"),
  monitorIncidents: (q: Q = {}) => api<T.Paginated<T.MonitorIncident>>("/admin/monitor/incidents/", { query: q }),
  monitorIncident: (id: string) => api<T.MonitorIncidentDetail>(`/admin/monitor/incidents/${id}/`),
  reviewIncident: (id: string, action: T.ReviewAction, note = "") => api<T.MonitorIncidentDetail>(`/admin/monitor/incidents/${id}/review/`, { method: "POST", body: { action, note } }),
  assignIncident: (id: string, assigned_to: string | null) => api<T.MonitorIncidentDetail>(`/admin/monitor/incidents/${id}/assign/`, { method: "POST", body: { assigned_to } }),
  monitorEvaluations: (q: Q = {}) => api<T.Paginated<T.EvaluationSummary>>("/admin/monitor/evaluations/", { query: q }),
  monitorEvaluation: (id: string) => api<T.EvaluationDetail>(`/admin/monitor/evaluations/${id}/`),
  evaluationFeedback: (id: string, label: T.MonitorFeedback["label"], note = "") => api<T.MonitorFeedback>(`/admin/monitor/evaluations/${id}/feedback/`, { method: "POST", body: { label, note } }),
  reevaluate: (id: string) => api<T.EvaluationDetail>(`/admin/monitor/evaluations/${id}/reevaluate/`, { method: "POST" }),
  monitorBacklog: () => api<{ pending: number }>("/admin/monitor/backlog/"),
  runBacklog: (limit = 25) => api<{ evaluated: number; remaining: number; results: T.EvaluationSummary[] }>("/admin/monitor/backlog/", { method: "POST", body: { limit } }),
  monitorPolicies: () => api<T.MonitorPolicy[]>("/admin/monitor/policies/"),
  updatePolicy: (issueType: string, body: Partial<Pick<T.MonitorPolicy, "enabled" | "min_confidence" | "min_severity" | "description">>) =>
    api<T.MonitorPolicy>(`/admin/monitor/policies/${issueType}/`, { method: "PATCH", body }),
};
