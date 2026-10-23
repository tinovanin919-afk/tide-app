// Tipi condivisi dell'Inbox AI (fondamenta locali).
//
// Il file è prodotto da `scripts/tide-inbox.mjs` in `public/inbox-candidates.json`:
// l'app lo legge con `fetch("/inbox-candidates.json")`, senza servizi esterni.
// Qui vive solo lo schema condiviso e un parser difensivo: la UI arriva nel 2B.

export type InboxCandidateType = "task" | "exam" | "grade" | "note" | "link" | "unknown";
export type InboxCandidateStatus = "pending" | "approved" | "rejected" | "edited";
export type InboxGradeType = "Scritto" | "Orale" | "Pratico";

export const INBOX_FOLDERS = ["Compiti", "Voti", "Verifiche", "Note", "Link"] as const;
export type InboxFolder = (typeof INBOX_FOLDERS)[number];

/** La cartella di provenienza forza il tipo: è la regola condivisa col watcher. */
export const INBOX_FOLDER_TYPES: Record<InboxFolder, InboxCandidateType> = {
  Compiti: "task",
  Voti: "grade",
  Verifiche: "exam",
  Note: "note",
  Link: "link",
};

/** Campo per cui è disponibile una confidenza (0–100). */
export type InboxCandidateField =
  | "title"
  | "subject"
  | "description"
  | "dueDate"
  | "examDate"
  | "grade"
  | "gradeType"
  | "weight"
  | "url";

export type InboxFieldConfidence = Partial<Record<InboxCandidateField, number>>;

/** Proposta letta dall'Inbox: l'utente la approva, modifica o rifiuta. */
export type InboxCandidate = {
  id: string;
  type: InboxCandidateType;
  title?: string;
  subject?: string;
  description?: string;
  /** ISO YYYY-MM-DD; assente se la data non era leggibile (mai inventata). */
  dueDate?: string;
  /** ISO YYYY-MM-DD; assente se la data non era leggibile (mai inventata). */
  examDate?: string;
  grade?: number;
  gradeType?: InboxGradeType;
  weight?: number;
  url?: string;
  sourcePath: string;
  thumbnail?: string;
  ocrText: string;
  confidence: number;
  fieldConfidence?: InboxFieldConfidence;
  status: InboxCandidateStatus;
  createdAt: string;
  folderHint: string;
};

export type InboxCandidatesFile = {
  version: 1;
  updatedAt: string;
  candidates: InboxCandidate[];
};

const TYPES: readonly string[] = ["task", "exam", "grade", "note", "link", "unknown"];
const STATUSES: readonly string[] = ["pending", "approved", "rejected", "edited"];
const GRADE_TYPES: readonly string[] = ["Scritto", "Orale", "Pratico"];
const TEXT_FIELDS = ["title", "subject", "description", "dueDate", "examDate", "url", "thumbnail"];
const NUMBER_FIELDS = ["grade", "weight"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOptionalText = (value: unknown) => value === undefined || typeof value === "string";
const isOptionalNumber = (value: unknown) =>
  value === undefined || (typeof value === "number" && Number.isFinite(value));

/** Il file è locale ma scrivibile: non fidarsi della forma senza controllarla. */
export function isInboxCandidate(value: unknown): value is InboxCandidate {
  if (!isRecord(value)) return false;
  const id = value["id"];
  const type = value["type"];
  const gradeType = value["gradeType"];
  const sourcePath = value["sourcePath"];
  const ocrText = value["ocrText"];
  const confidence = value["confidence"];
  const fieldConfidence = value["fieldConfidence"];
  const status = value["status"];
  const createdAt = value["createdAt"];
  const folderHint = value["folderHint"];

  if (typeof id !== "string" || !id) return false;
  if (typeof type !== "string" || !TYPES.includes(type)) return false;
  if (!TEXT_FIELDS.every((field) => isOptionalText(value[field]))) return false;
  if (!NUMBER_FIELDS.every((field) => isOptionalNumber(value[field]))) return false;
  if (
    gradeType !== undefined &&
    (typeof gradeType !== "string" || !GRADE_TYPES.includes(gradeType))
  )
    return false;
  if (typeof sourcePath !== "string" || typeof ocrText !== "string") return false;
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 100
  )
    return false;
  if (fieldConfidence !== undefined) {
    if (!isRecord(fieldConfidence)) return false;
    if (!Object.values(fieldConfidence).every(isOptionalNumber)) return false;
  }
  if (typeof status !== "string" || !STATUSES.includes(status)) return false;
  if (typeof createdAt !== "string" || !createdAt) return false;
  if (typeof folderHint !== "string" || !folderHint) return false;
  return true;
}

/**
 * Accetta sia `{ version, updatedAt, candidates }` sia un array semplice.
 * Le entry non valide vengono scartate invece di rompere la dashboard.
 */
export function parseInboxCandidates(raw: unknown): InboxCandidate[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw["candidates"])
      ? raw["candidates"]
      : [];
  return list.filter(isInboxCandidate);
}
