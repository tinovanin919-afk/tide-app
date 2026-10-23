// Import voti in due tempi: l'OCR propone, la persona conferma.
// Qui vivono i tipi, le regole di fiducia, la deduplicazione, le impostazioni e il
// registro locale degli import. Nulla viene salvato nel registro senza approvazione.
import { useCallback, useEffect, useState } from "react";
import { cap, tipoOf, type Tipo, type Voto } from "@/lib/grades";
import { rowConfidence, type GradeFieldConfidence, type ParsedGrade } from "@/lib/vision";

export type ImportSource = "screenshot" | "csv";
export type ProposalStatus = "pending" | "approved" | "rejected" | "edited";

export type PendingGradeImport = {
  id: string;
  subject: string;
  grade: number | null;
  date: string | null;
  type: string | null;
  weight: number | null;
  note?: string;
  confidence: number;
  fieldConfidence: GradeFieldConfidence;
  /** Miniatura solo in memoria: non viene salvata né caricata online. */
  sourceImage?: string;
  status: ProposalStatus;
  createdAt: string;
  batchId: string;
  /** Possibile doppione già presente nel registro: l'approvazione chiede conferma. */
  duplicate?: boolean;
};

export type ReviewBatch = {
  batchId: string;
  source: ImportSource;
  fileName: string;
  thumbnail?: string;
  proposals: PendingGradeImport[];
  createdAt: number;
  /** Proposte già salvate dall'auto-approvazione: id proposta → id voto. */
  autoApproved?: Record<string, string>;
};

const uid = () => Math.random().toString(36).slice(2, 10);
const FOLD = (value: string) =>
  value
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const newBatchId = () => `batch-${Date.now().toString(36)}-${uid()}`;

/** Converte le righe lette dall'OCR in proposte ancora non salvate. */
export function toPendingGrades(
  grades: ParsedGrade[],
  batchId: string,
  sourceImage?: string,
): PendingGradeImport[] {
  const createdAt = new Date().toISOString();
  return grades.map((grade) => ({
    id: uid(),
    subject: grade.materia,
    grade: grade.valore,
    date: grade.data,
    type: grade.tipo,
    weight: grade.peso ?? null,
    ...(grade.nota ? { note: grade.nota } : {}),
    confidence: grade.confidence,
    fieldConfidence: grade.fieldConfidence,
    ...(sourceImage ? { sourceImage } : {}),
    status: "pending",
    createdAt,
    batchId,
  }));
}

/**
 * CSV/Excel è deterministico: colonne lette una per una, nessuna interpretazione
 * visiva. La confidenza resta alta ma non al 100%, perché il file può avere
 * colonne fuori posto e l'approvazione resta comunque richiesta.
 */
export function proposalsFromVoti(
  voti: Voto[],
  batchId: string,
  sourceImage?: string,
  options: { dateKnown?: boolean } = {},
): PendingGradeImport[] {
  const createdAt = new Date().toISOString();
  const dateKnown = options.dateKnown !== false;
  const field: GradeFieldConfidence = { subject: 99, grade: 99, date: 96, type: 94, weight: 95 };
  if (!dateKnown) field.date = 0;
  return voti.map((voto) => ({
    id: uid(),
    subject: voto.materia,
    grade: voto.valore,
    // Senza colonna Data nel file non si usa "oggi": la data va scelta a mano.
    date: dateKnown ? voto.data : null,
    type: voto.tipo,
    weight: voto.peso ?? null,
    confidence: rowConfidence(field),
    fieldConfidence: { ...field },
    ...(sourceImage ? { sourceImage } : {}),
    status: "pending",
    createdAt,
    batchId,
  }));
}

/* ------------------------------------------------------------ fiducia --- */

export type ConfidenceBand = "high" | "medium" | "low";

/** Verde ≥ 90, giallo 70–89, rosso < 70. */
export const confidenceBand = (confidence: number): ConfidenceBand =>
  confidence >= 90 ? "high" : confidence >= 70 ? "medium" : "low";

export const BAND_LABEL: Record<ConfidenceBand, string> = {
  high: "Affidabile",
  medium: "Da controllare",
  low: "Poco chiara",
};

export const BAND_CLASS: Record<ConfidenceBand, string> = {
  high: "bg-low/15 text-low border-low/30",
  medium: "bg-medium/15 text-medium border-medium/30",
  low: "bg-urgent/15 text-urgent border-urgent/30",
};

/* -------------------------------------------------------- validazione --- */

export type ProposalField = "subject" | "grade" | "date" | "weight";
export type ProposalErrors = Partial<Record<ProposalField, string>>;

const isRealDate = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

/** Un voto è approvabile solo se materia, voto 1–10 e data sono validi. */
export function validateProposal(proposal: PendingGradeImport): ProposalErrors {
  const errors: ProposalErrors = {};
  if (!proposal.subject.trim() || proposal.subject.trim().length < 2)
    errors.subject = "Scegli o scrivi la materia.";
  if (proposal.grade === null || !Number.isFinite(proposal.grade))
    errors.grade = "Inserisci il voto.";
  else if (proposal.grade < 1 || proposal.grade > 10)
    errors.grade = "Il voto deve essere tra 1 e 10.";
  if (!proposal.date) errors.date = "Inserisci la data della prova.";
  else if (!isRealDate(proposal.date)) errors.date = "La data non è valida.";
  if (
    proposal.weight !== null &&
    (!Number.isFinite(proposal.weight) || proposal.weight <= 0 || proposal.weight > 10)
  )
    errors.weight = "Il peso va da 0,1 a 10.";
  return errors;
}

export const canApprove = (proposal: PendingGradeImport) =>
  Object.keys(validateProposal(proposal)).length === 0;

/** Voto pronto per il registro esistente; null se la proposta non è valida. */
export function toVoto(proposal: PendingGradeImport): Omit<Voto, "id"> | null {
  if (!canApprove(proposal)) return null;
  return {
    materia: cap(proposal.subject),
    valore: proposal.grade as number,
    data: proposal.date as string,
    tipo: tipoOf(proposal.type ?? "") as Tipo,
    ...(proposal.weight === null ? {} : { peso: proposal.weight }),
    ...(proposal.note?.trim() ? { nota: proposal.note.trim() } : {}),
  };
}

export function editedProposal(
  proposal: PendingGradeImport,
  changes: {
    subject: string;
    grade: number | null;
    date: string | null;
    type: string | null;
    weight: number | null;
    note?: string;
  },
): PendingGradeImport {
  // I campi toccati a mano sono verificati: la confidenza sale a 100.
  const fieldConfidence: GradeFieldConfidence = {
    subject: 100,
    grade: 100,
    date: 100,
    type: 100,
    weight: changes.weight === null ? 0 : 100,
  };
  const next: PendingGradeImport = {
    ...proposal,
    ...changes,
    fieldConfidence,
    confidence: rowConfidence(fieldConfidence),
    status: "edited",
    duplicate: false,
  };
  // Cancellare la nota deve davvero rimuoverla, non lasciare quella vecchia.
  if (!changes.note?.trim()) delete next.note;
  return next;
}

/* -------------------------------------------------------- duplicati --- */

const voteKey = (materia: string, valore: number, data: string, tipo: string) =>
  `${FOLD(materia)}|${valore}|${data}|${FOLD(tipo)}`;

const proposalKey = (proposal: PendingGradeImport) =>
  proposal.date
    ? voteKey(proposal.subject, proposal.grade ?? -1, proposal.date, proposal.type ?? "")
    : null;

/** Segna le proposte che sembrano già presenti, anche tra loro. */
export function markDuplicates(
  proposals: PendingGradeImport[],
  voti: Voto[],
): PendingGradeImport[] {
  const seen = new Set(
    voti.map((voto) => voteKey(voto.materia, voto.valore, voto.data, voto.tipo)),
  );
  return proposals.map((proposal) => {
    const key = proposalKey(proposal);
    if (!key || proposal.grade === null) return { ...proposal, duplicate: false };
    const duplicate = seen.has(key);
    seen.add(key);
    return { ...proposal, duplicate };
  });
}

/* ------------------------------------------------------ auto-approvazione --- */

export type ImportSettings = {
  autoApprove: boolean;
  threshold: number;
  alwaysReview: boolean;
};

export const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
  autoApprove: false,
  threshold: 90,
  alwaysReview: true,
};

export const IMPORT_SETTINGS_KEY = "tide-voti-import-settings-v1";

export function sanitizeImportSettings(raw: unknown): ImportSettings {
  const value = raw && typeof raw === "object" ? (raw as Partial<ImportSettings>) : {};
  const threshold =
    typeof value.threshold === "number" && value.threshold >= 70 && value.threshold <= 99
      ? Math.round(value.threshold)
      : DEFAULT_IMPORT_SETTINGS.threshold;
  return {
    autoApprove: value.autoApprove === true,
    threshold,
    alwaysReview: value.alwaysReview !== false,
  };
}

export function loadImportSettings(): ImportSettings {
  if (typeof localStorage === "undefined") return DEFAULT_IMPORT_SETTINGS;
  try {
    const raw = localStorage.getItem(IMPORT_SETTINGS_KEY);
    return raw ? sanitizeImportSettings(JSON.parse(raw)) : DEFAULT_IMPORT_SETTINGS;
  } catch {
    // Un salvataggio illeggibile non deve attivare l'auto-approvazione.
    return DEFAULT_IMPORT_SETTINGS;
  }
}

export function saveImportSettings(settings: ImportSettings): ImportSettings {
  const next = sanitizeImportSettings(settings);
  try {
    localStorage.setItem(IMPORT_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* storage pieno o disattivato */
  }
  return next;
}

export function useImportSettings() {
  const [settings, setSettings] = useState<ImportSettings>(DEFAULT_IMPORT_SETTINGS);
  useEffect(() => {
    setSettings(loadImportSettings());
    const sync = () => setSettings(loadImportSettings());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const update = useCallback((patch: Partial<ImportSettings>) => {
    setSettings((current) => saveImportSettings({ ...current, ...patch }));
  }, []);
  return { settings, update };
}

/** "Mostra sempre revisione" ha la precedenza: l'auto-approvazione è opt-in doppio. */
export const canAutoApprove = (settings: ImportSettings) =>
  settings.autoApprove && !settings.alwaysReview;

/** Solo righe pulite, non duplicate e sopra la soglia scelta. */
export function autoApprovable(
  proposals: PendingGradeImport[],
  settings: ImportSettings,
): PendingGradeImport[] {
  if (!canAutoApprove(settings)) return [];
  return proposals.filter(
    (proposal) =>
      proposal.status === "pending" &&
      !proposal.duplicate &&
      proposal.confidence >= settings.threshold &&
      canApprove(proposal),
  );
}

/* ------------------------------------------------------ storico import --- */

export type ImportLogEntry = {
  batchId: string;
  at: number;
  source: ImportSource;
  approved: number;
  rejected: number;
  voteIds: string[];
  undone?: boolean;
};

export const IMPORT_LOG_KEY = "tide-voti-import-log-v1";
export const IMPORT_LOG_LIMIT = 20;

export function loadImportLog(): ImportLogEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(IMPORT_LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ImportLogEntry => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as Partial<ImportLogEntry>;
      return (
        typeof value.batchId === "string" &&
        typeof value.at === "number" &&
        Array.isArray(value.voteIds)
      );
    });
  } catch {
    return [];
  }
}

function persistLog(entries: ImportLogEntry[]): ImportLogEntry[] {
  const next = entries.slice(0, IMPORT_LOG_LIMIT);
  try {
    localStorage.setItem(IMPORT_LOG_KEY, JSON.stringify(next));
  } catch {
    /* storage pieno o disattivato */
  }
  return next;
}

/** Inserisce o aggiorna il batch in testa allo storico. */
export function upsertImportLog(entry: ImportLogEntry): ImportLogEntry[] {
  const entries = loadImportLog().filter((item) => item.batchId !== entry.batchId);
  return persistLog([entry, ...entries]);
}

export function markImportUndone(batchId: string): ImportLogEntry[] {
  return persistLog(
    loadImportLog().map((entry) =>
      entry.batchId === batchId ? { ...entry, undone: true } : entry,
    ),
  );
}

export function lastUndoableImport(entries: ImportLogEntry[]): ImportLogEntry | null {
  return entries.find((entry) => !entry.undone && entry.voteIds.length > 0) ?? null;
}

/** JSON delle proposte, senza miniature, da conservare o rileggere. */
export function exportProposals(proposals: PendingGradeImport[]) {
  return JSON.stringify(
    {
      app: "Tide",
      tipo: "voti-proposti",
      esportato: new Date().toISOString(),
      proposte: proposals.map((proposal) => {
        const copy: PendingGradeImport = { ...proposal };
        delete copy.sourceImage;
        return copy;
      }),
    },
    null,
    2,
  );
}
