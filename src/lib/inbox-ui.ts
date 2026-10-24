// Stato locale e lettura dei dati per la pagina Inbox AI.
//
// Il browser legge `public/inbox-candidates.json` ma non lo scrive: l'overlay in
// localStorage (`tide-inbox-ui-state-v1`) registra modifiche e stati della UI.
// Dal 2C l'approvazione di voti e compiti passa dalle server function in
// `inbox-archive.functions.ts`, che archiviano la proposta e spostano il file.
// Se lo storage è corrotto o pieno la UI continua a funzionare sui dati del JSON.

import {
  parseInboxCandidates,
  type InboxCandidate,
  type InboxCandidateField,
  type InboxCandidateStatus,
  type InboxCandidateType,
} from "@/lib/inbox";

export const INBOX_OVERLAY_KEY = "tide-inbox-ui-state-v1";
export const INBOX_CANDIDATES_URL = "/inbox-candidates.json";
export const INBOX_STATUS_URL = "/inbox-status.json";
export const INBOX_POLL_MS = 5000;

/** Campi che l'utente può correggere a mano dalla UI. */
export type InboxOverrides = Partial<
  Pick<
    InboxCandidate,
    | "title"
    | "subject"
    | "description"
    | "dueDate"
    | "examDate"
    | "grade"
    | "gradeType"
    | "weight"
    | "url"
  >
>;

export type InboxOverlayEntry = {
  status?: InboxCandidateStatus;
  type?: InboxCandidateType;
  overrides?: InboxOverrides;
  updatedAt: string;
};

/** Chiave: id della proposta. */
export type InboxOverlay = Record<string, InboxOverlayEntry>;

export type InboxHelperStatus = {
  helperActive: boolean;
  updatedAt: string | null;
  pid: number | null;
  note: string | null;
};

const TYPES: readonly string[] = ["task", "exam", "grade", "note", "link", "unknown"];
const STATUSES: readonly string[] = ["pending", "approved", "rejected", "edited"];
const EDITABLE_TEXT: readonly InboxCandidateField[] = [
  "title",
  "subject",
  "description",
  "dueDate",
  "examDate",
  "url",
];
const EDITABLE_NUMBER: readonly InboxCandidateField[] = ["grade", "weight"];

export const INBOX_TYPE_LABEL: Record<InboxCandidateType, string> = {
  task: "Compiti",
  grade: "Voti",
  exam: "Verifiche",
  note: "Note",
  link: "Link",
  unknown: "Altro",
};

/** Colori richiesti dal 2B, coerenti col tema scuro di Tide. */
export const INBOX_TYPE_COLOR: Record<InboxCandidateType, string> = {
  task: "#3B82F6",
  grade: "#EF4444",
  exam: "#EAB308",
  note: "#22C55E",
  link: "#A855F7",
  unknown: "#94A3B8",
};

export type InboxFilter = "all" | Exclude<InboxCandidateType, "unknown">;

export const INBOX_FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "Tutti" },
  { id: "task", label: "Compiti" },
  { id: "grade", label: "Voti" },
  { id: "exam", label: "Verifiche" },
  { id: "note", label: "Note" },
  { id: "link", label: "Link" },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown) => typeof value === "string" || value === undefined;
const isNumber = (value: unknown) =>
  value === undefined || (typeof value === "number" && Number.isFinite(value));

function parseOverrides(raw: unknown): InboxOverrides | undefined {
  if (!isRecord(raw)) return undefined;
  const overrides: Record<string, string | number> = {};
  for (const field of EDITABLE_TEXT) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== "string") return undefined;
    overrides[field] = value;
  }
  for (const field of EDITABLE_NUMBER) {
    const value = raw[field];
    if (value === undefined) continue;
    if (!isNumber(value)) return undefined;
    overrides[field] = value as number;
  }
  const gradeType = raw["gradeType"];
  if (gradeType !== undefined) {
    if (gradeType !== "Scritto" && gradeType !== "Orale" && gradeType !== "Pratico") {
      return undefined;
    }
    overrides["gradeType"] = gradeType;
  }
  return overrides as InboxOverrides;
}

function parseEntry(raw: unknown): InboxOverlayEntry | null {
  if (!isRecord(raw)) return null;
  const entry: InboxOverlayEntry = {
    updatedAt: typeof raw["updatedAt"] === "string" ? raw["updatedAt"] : new Date().toISOString(),
  };
  const status = raw["status"];
  if (typeof status === "string" && STATUSES.includes(status)) {
    entry.status = status as InboxCandidateStatus;
  }
  const type = raw["type"];
  if (typeof type === "string" && TYPES.includes(type)) {
    entry.type = type as InboxCandidateType;
  }
  const overrides = parseOverrides(raw["overrides"]);
  if (overrides && Object.keys(overrides).length > 0) entry.overrides = overrides;
  if (!entry.status && !entry.type && !entry.overrides) return null;
  return entry;
}

/** Rilegge l'overlay; qualunque problema restituisce `{}` con un warning. */
export function readInboxOverlay(): InboxOverlay {
  if (typeof window === "undefined") return {};
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(INBOX_OVERLAY_KEY);
  } catch (error) {
    console.warn("[inbox] localStorage non leggibile, uso i dati originali", error);
    return {};
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const overlay: InboxOverlay = {};
    for (const [id, value] of Object.entries(parsed)) {
      const entry = parseEntry(value);
      if (entry) overlay[id] = entry;
    }
    return overlay;
  } catch (error) {
    console.warn("[inbox] overlay locale corrotto, lo ignoro", error);
    return {};
  }
}

/** Salva l'overlay. `false` se lo storage non è disponibile o è pieno. */
export function writeInboxOverlay(overlay: InboxOverlay): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(INBOX_OVERLAY_KEY, JSON.stringify(overlay));
    return true;
  } catch (error) {
    console.warn("[inbox] impossibile salvare l'overlay locale", error);
    return false;
  }
}

/** Applica tipo, campi corretti e stato dell'overlay alla proposta originale. */
export function applyInboxOverlay(
  candidate: InboxCandidate,
  entry: InboxOverlayEntry | undefined,
): InboxCandidate {
  if (!entry) return candidate;
  return {
    ...candidate,
    ...entry.overrides,
    type: entry.type ?? candidate.type,
    status: entry.status ?? candidate.status,
  };
}

/** Confidenza residua: un campo modificato a mano non è più “estratto”. */
export function editedFields(entry: InboxOverlayEntry | undefined): Set<string> {
  return new Set(Object.keys(entry?.overrides ?? {}));
}

export async function fetchInboxCandidates(signal?: AbortSignal): Promise<InboxCandidate[]> {
  const response = await fetch(`${INBOX_CANDIDATES_URL}?t=${Date.now()}`, {
    cache: "no-store",
    signal: signal ?? null,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} su ${INBOX_CANDIDATES_URL}`);
  const raw: unknown = await response.json();
  return parseInboxCandidates(raw);
}

export async function fetchInboxHelperStatus(signal?: AbortSignal): Promise<InboxHelperStatus> {
  try {
    const response = await fetch(`${INBOX_STATUS_URL}?t=${Date.now()}`, {
      cache: "no-store",
      signal: signal ?? null,
    });
    if (!response.ok) return { helperActive: false, updatedAt: null, pid: null, note: null };
    const raw: unknown = await response.json();
    if (!isRecord(raw)) return { helperActive: false, updatedAt: null, pid: null, note: null };
    return {
      helperActive: raw["helperActive"] === true,
      updatedAt: typeof raw["updatedAt"] === "string" ? raw["updatedAt"] : null,
      pid: typeof raw["pid"] === "number" && Number.isFinite(raw["pid"]) ? raw["pid"] : null,
      note: typeof raw["note"] === "string" ? raw["note"] : null,
    };
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") throw error;
    return { helperActive: false, updatedAt: null, pid: null, note: null };
  }
}

const DATE_FMT = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const TIME_FMT = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });

/** `2026-10-30` → `30 ott 2026`; stringhe non valide tornano invariate. */
export function formatInboxDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return iso;
  return DATE_FMT.format(date);
}

/** Giorni mancanti rispetto a oggi (negativo = passato). */
export function daysUntil(iso: string | undefined): number | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function formatInboxTime(at: Date | number | null | undefined): string | null {
  if (at === null || at === undefined) return null;
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? null : TIME_FMT.format(date);
}

/** Data della proposta: `examDate` per le verifiche, altrimenti `dueDate`. */
export function primaryDateOf(candidate: InboxCandidate): string | undefined {
  return candidate.type === "exam" ? (candidate.examDate ?? candidate.dueDate) : candidate.dueDate;
}

export function confidenceTone(confidence: number): {
  label: string;
  color: string;
  className: string;
} {
  if (confidence >= 90) {
    return { label: "alta", color: "#22C55E", className: "text-[#22C55E] bg-[#22C55E]/12" };
  }
  if (confidence >= 70) {
    return { label: "media", color: "#EAB308", className: "text-[#EAB308] bg-[#EAB308]/12" };
  }
  return { label: "bassa", color: "#EF4444", className: "text-[#EF4444] bg-[#EF4444]/12" };
}

export type InboxCounts = Record<InboxFilter, number>;

/** Conta solo le proposte ancora pending, stato effettivo (overlay incluso). */
export function countPending(candidates: InboxCandidate[]): InboxCounts {
  const counts: InboxCounts = { all: 0, task: 0, grade: 0, exam: 0, note: 0, link: 0 };
  for (const candidate of candidates) {
    if (candidate.status !== "pending") continue;
    counts.all += 1;
    if (candidate.type !== "unknown") counts[candidate.type] += 1;
  }
  return counts;
}

/** Ordina: pending prima (più recenti in alto), poi le decise in fondo. */
export function sortCandidates(candidates: InboxCandidate[]): InboxCandidate[] {
  const weight = (candidate: InboxCandidate) => (candidate.status === "pending" ? 0 : 1);
  return [...candidates].sort((a, b) => {
    const byStatus = weight(a) - weight(b);
    if (byStatus !== 0) return byStatus;
    return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
  });
}

export const HELPER_COMMAND = "cd ~/Desktop/tide-app && node scripts/tide-inbox.mjs";

/** Il watcher riscrive lo stato ogni 60 s: oltre 3 minuti il processo è considerato fermo. */
export const INBOX_HELPER_STALE_MS = 3 * 60 * 1000;

export function helperIsStale(status: InboxHelperStatus): boolean {
  if (!status.helperActive || !status.updatedAt) return false;
  const at = Date.parse(status.updatedAt);
  return Number.isFinite(at) && Date.now() - at > INBOX_HELPER_STALE_MS;
}
