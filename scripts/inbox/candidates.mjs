// Proposte dell'Inbox: costruzione dell'entry, confidenza complessiva e store JSON.
// Il file è la fonte condivisa con l'app: viene riletto prima di ogni scrittura
// (l'UI 2B potrà cambiare gli stati) e riscritto in modo atomico.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

export const CANDIDATE_TYPES = ["task", "exam", "grade", "note", "link", "unknown"];
export const CANDIDATE_STATUSES = ["pending", "approved", "rejected", "edited"];

/** Quanto pesa ogni campo nella confidenza complessiva. Un campo mancante pesa 0. */
const TYPE_WEIGHTS = {
  task: { title: 55, subject: 20, dueDate: 25 },
  exam: { title: 45, subject: 25, examDate: 30 },
  grade: { subject: 40, grade: 55, gradeType: 5 },
  // Per note e voti il contenuto essenziale è già completo senza i campi extra.
  note: { title: 70, subject: 20, description: 10 },
  link: { url: 70, title: 25, description: 5 },
  unknown: { title: 35, subject: 20, description: 15, dueDate: 15, grade: 15 },
};

export const newCandidateId = () =>
  `inbox-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;

export function overallConfidence(type, fieldConfidence) {
  const weights = TYPE_WEIGHTS[type] ?? TYPE_WEIGHTS.unknown;
  let weightSum = 0;
  let total = 0;
  for (const [field, weight] of Object.entries(weights)) {
    weightSum += weight;
    total += (fieldConfidence?.[field] ?? 0) * weight;
  }
  return weightSum === 0 ? 0 : clamp(total / weightSum);
}

const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));

const cleanText = (value, max) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);

/**
 * Costruisce una InboxCandidate valida. Ordine dei campi = schema proposto.
 * I campi assenti sono omessi (mai `undefined` nel JSON).
 */
export function buildCandidate({
  id,
  createdAt,
  type,
  folder,
  sourcePath,
  ocrText,
  values,
  fieldConfidence,
  thumbnail,
}) {
  if (!CANDIDATE_TYPES.includes(type)) throw new Error(`tipo non valido: ${type}`);
  const v = values ?? {};
  const scores = fieldConfidence ?? {};
  const fields = {};

  const title = cleanText(v.title, 140);
  if (title) fields.title = title;
  const subject = cleanText(v.subject, 60);
  if (subject) fields.subject = subject;
  const description = cleanText(v.description, 400);
  if (description) fields.description = description;
  if (isIsoDate(v.dueDate)) fields.dueDate = v.dueDate;
  if (isIsoDate(v.examDate)) fields.examDate = v.examDate;
  if (typeof v.grade === "number" && Number.isFinite(v.grade) && v.grade >= 1 && v.grade <= 10)
    fields.grade = v.grade;
  if (["Scritto", "Orale", "Pratico"].includes(v.gradeType)) fields.gradeType = v.gradeType;
  if (typeof v.weight === "number" && Number.isFinite(v.weight) && v.weight > 0 && v.weight <= 10)
    fields.weight = v.weight;
  if (typeof v.url === "string" && /^https?:\/\//i.test(v.url)) fields.url = v.url;

  const scoresOut = {};
  for (const key of Object.keys(fields)) {
    const value = Number(scores[key]);
    if (Number.isFinite(value)) scoresOut[key] = clamp(value);
  }

  const candidate = {
    id,
    type,
    ...fields,
    sourcePath,
    ...(thumbnail ? { thumbnail } : {}),
    ocrText: String(ocrText ?? "").slice(0, 20000),
    confidence: overallConfidence(type, scoresOut),
    ...(Object.keys(scoresOut).length > 0 ? { fieldConfidence: scoresOut } : {}),
    status: "pending",
    createdAt,
    folderHint: folder,
  };
  return candidate;
}

const isCandidate = (value) =>
  Boolean(
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.sourcePath === "string" &&
    typeof value.ocrText === "string" &&
    typeof value.confidence === "number" &&
    CANDIDATE_TYPES.includes(value.type) &&
    CANDIDATE_STATUSES.includes(value.status),
  );

const emptyStore = () => ({ version: 1, updatedAt: new Date().toISOString(), candidates: [] });

/** Legge il file condiviso; un JSON rotto viene messo da parte, non cancellato. */
export async function readStore(outputPath, logger) {
  try {
    const raw = await fs.promises.readFile(outputPath, "utf8");
    if (!raw.trim()) return emptyStore();
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed?.candidates;
    if (!Array.isArray(list)) throw new Error("struttura non valida");
    return {
      version: 1,
      updatedAt:
        typeof parsed?.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      candidates: list.filter(isCandidate),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return emptyStore();
    logger?.warn(
      `inbox-candidates.json illeggibile: ${String(error?.message ?? error).slice(0, 160)}`,
    );
    try {
      const backup = `${outputPath}.bak-${Date.now()}`;
      await fs.promises.copyFile(outputPath, backup);
      logger?.warn(`copia di sicurezza salvata in ${backup}`);
    } catch {
      // Il file potrebbe essere sparito nel frattempo: riparto da uno store vuoto.
    }
    return emptyStore();
  }
}

async function writeStore(outputPath, candidates) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    candidates: candidates.slice(0, 500),
  };
  const tmp = `${outputPath}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.rename(tmp, outputPath);
  return payload;
}

/**
 * Inserisce o aggiorna la proposta. Se lo stesso file era già stato approvato o
 * rifiutato dall'utente, la decisione non viene sovrascritta.
 */
export async function saveCandidate(outputPath, candidate, logger) {
  const store = await readStore(outputPath, logger);
  const index = store.candidates.findIndex((entry) => entry.sourcePath === candidate.sourcePath);
  if (index >= 0) {
    const existing = store.candidates[index];
    if (existing && existing.status !== "pending") {
      logger?.info(
        `proposta già ${existing.status}, non la sovrascrivo: ${path.basename(candidate.sourcePath)}`,
      );
      return { saved: false, updated: false, reason: existing.status };
    }
    const replacement = {
      ...candidate,
      id: existing?.id ?? candidate.id,
      createdAt: existing?.createdAt ?? candidate.createdAt,
    };
    store.candidates.splice(index, 1);
    store.candidates.unshift(replacement);
  } else {
    store.candidates.unshift(candidate);
  }
  await writeStore(outputPath, store.candidates);
  return { saved: true, updated: index >= 0 };
}
