import { beforeEach, describe, expect, it } from "vitest";
import {
  IMPORT_LOG_LIMIT,
  autoApprovable,
  canAutoApprove,
  confidenceBand,
  editedProposal,
  exportProposals,
  lastUndoableImport,
  loadImportLog,
  loadImportSettings,
  markDuplicates,
  markImportUndone,
  proposalsFromVoti,
  sanitizeImportSettings,
  saveImportSettings,
  toPendingGrades,
  toVoto,
  upsertImportLog,
  validateProposal,
  type ImportLogEntry,
  type PendingGradeImport,
} from "@/lib/grade-import";
import type { Voto } from "@/lib/grades";
import { parseVotiGrades, type OcrDocument } from "@/lib/vision";

const ocrDocument = (lines: string[], confidence = 95): OcrDocument => ({
  text: lines.join("\n"),
  confidence,
  lines: lines.map((text) => ({ text, confidence })),
  preprocess: "soft",
});

const table = ocrDocument([
  "Registro elettronico · Voti",
  "Materia      Voto   Data        Tipo      Peso",
  "ITALIANO     7      12/10/2026  Scritto   1",
  "STORIA       8+     09/10/2026  Orale     2",
]);

const existingVoto: Voto = {
  id: "v1",
  materia: "Italiano",
  valore: 7,
  data: "2026-10-12",
  tipo: "Scritto",
};

const baseProposal = (changes: Partial<PendingGradeImport> = {}): PendingGradeImport => ({
  id: "p1",
  subject: "Italiano",
  grade: 7,
  date: "2026-10-12",
  type: "Scritto",
  weight: null,
  confidence: 95,
  fieldConfidence: { subject: 95, grade: 95, date: 95, type: 95, weight: 0 },
  status: "pending",
  createdAt: "2026-10-23T10:00:00.000Z",
  batchId: "b1",
  ...changes,
});

describe("Proposte di voto lette dallo screenshot", () => {
  it("conserva confidenza per campo e per riga", () => {
    const grades = parseVotiGrades(table, { knownSubjects: ["Italiano", "Storia"] });
    expect(grades).toHaveLength(2);
    expect(grades[0]).toMatchObject({
      materia: "Italiano",
      valore: 7,
      data: "2026-10-12",
      tipo: "Scritto",
      peso: 1,
    });
    expect(grades[0]!.confidence).toBeGreaterThanOrEqual(90);
    expect(grades[0]!.fieldConfidence.grade).toBeGreaterThanOrEqual(90);
    expect(grades[1]!.data).toBe("2026-10-09");
  });

  it("non inventa la data mancante e abbassa la confidenza", () => {
    const document = ocrDocument(["Scienze Motorie", "Voto: 9", "Tipo: Orale"]);
    const [grade] = parseVotiGrades(document, { knownSubjects: ["Scienze Motorie"] });
    expect(grade?.data).toBeNull();
    expect(grade?.fieldConfidence.date).toBe(0);
    expect(grade!.confidence).toBeLessThan(90);
    expect(validateProposal({ ...baseProposal(), date: null }).date).toBeTruthy();
  });

  it("segnala rossa una lettura con OCR poco sicuro", () => {
    const document = ocrDocument(["Astronomia", "Voto: 8", "Data: 12/10/2026"], 35);
    const [grade] = parseVotiGrades(document);
    expect(grade!.confidence).toBeLessThan(70);
    expect(confidenceBand(grade!.confidence)).toBe("low");
  });

  it("distingue verde, giallo e rosso", () => {
    expect(confidenceBand(90)).toBe("high");
    expect(confidenceBand(89)).toBe("medium");
    expect(confidenceBand(70)).toBe("medium");
    expect(confidenceBand(69)).toBe("low");
  });

  it("converte in proposte temporanee senza salvare nulla", () => {
    const grades = parseVotiGrades(table, { knownSubjects: ["Italiano"] });
    const proposals = toPendingGrades(grades, "batch-1", "data:image/jpeg;base64,mini");
    expect(proposals.every((proposal) => proposal.status === "pending")).toBe(true);
    expect(proposals[0]!.sourceImage).toBe("data:image/jpeg;base64,mini");
    expect(proposals[0]!.batchId).toBe("batch-1");
  });

  it("legge un CSV con confidenza alta ma sempre come proposta", () => {
    const proposals = proposalsFromVoti([existingVoto], "batch-2");
    expect(proposals[0]).toMatchObject({ subject: "Italiano", grade: 7, status: "pending" });
    expect(proposals[0]!.confidence).toBeGreaterThanOrEqual(90);
  });

  it("senza colonna Data nel CSV la data resta vuota, non diventa oggi", () => {
    const proposals = proposalsFromVoti([existingVoto], "batch-3", undefined, { dateKnown: false });
    expect(proposals[0]!.date).toBeNull();
    expect(proposals[0]!.confidence).toBeLessThan(90);
    expect(validateProposal(proposals[0]!).date).toBeTruthy();
  });
});

describe("Validazione e modifica sicura", () => {
  it("accetta solo voti da 1 a 10 e date reali", () => {
    expect(validateProposal(baseProposal())).toEqual({});
    expect(validateProposal(baseProposal({ grade: 11 })).grade).toBeTruthy();
    expect(validateProposal(baseProposal({ grade: 0 })).grade).toBeTruthy();
    expect(validateProposal(baseProposal({ date: "2026-02-31" })).date).toBeTruthy();
    expect(validateProposal(baseProposal({ subject: " " })).subject).toBeTruthy();
    expect(validateProposal(baseProposal({ weight: 12 })).weight).toBeTruthy();
  });

  it("converte il voto approvato nel formato del registro", () => {
    const voto = toVoto(baseProposal({ subject: "italiano", weight: 2, note: "Ottimo" }));
    expect(voto).toEqual({
      materia: "Italiano",
      valore: 7,
      data: "2026-10-12",
      tipo: "Scritto",
      peso: 2,
      nota: "Ottimo",
    });
  });

  it("dopo la modifica manuale la confidenza sale e i campi toccati sono verificati", () => {
    const edited = editedProposal(baseProposal({ date: null }), {
      subject: "Italiano",
      grade: 7.5,
      date: "2026-10-20",
      type: "Orale",
      weight: 2,
    });
    expect(edited.status).toBe("edited");
    expect(edited.confidence).toBe(100);
    expect(edited.duplicate).toBe(false);
    expect(edited.fieldConfidence).toMatchObject({ grade: 100, date: 100, weight: 100 });
  });

  it("rimuove davvero la nota quando si svuota", () => {
    const edited = editedProposal(baseProposal({ note: "Da rivedere" }), {
      subject: "Italiano",
      grade: 7,
      date: "2026-10-12",
      type: "Scritto",
      weight: null,
    });
    expect(edited.note).toBeUndefined();
  });
});

describe("Doppioni", () => {
  it("segnala un voto già presente nel registro", () => {
    const grades = parseVotiGrades(table, { knownSubjects: ["Italiano", "Storia"] });
    const proposals = markDuplicates(toPendingGrades(grades, "b1"), [existingVoto]);
    expect(proposals[0]!.duplicate).toBe(true);
    expect(proposals[1]!.duplicate).toBe(false);
  });

  it("segnala anche due righe identiche nello stesso batch", () => {
    const proposals = markDuplicates([baseProposal(), baseProposal({ id: "p2" })], []);
    expect(proposals[0]!.duplicate).not.toBe(true);
    expect(proposals[1]!.duplicate).toBe(true);
  });

  it("non confronta proposte senza data", () => {
    const proposals = markDuplicates([baseProposal({ date: null })], [existingVoto]);
    expect(proposals[0]!.duplicate).not.toBe(true);
  });
});

describe("Auto-approvazione opt-in", () => {
  const proposals = [baseProposal({ confidence: 96 }), baseProposal({ id: "p2", confidence: 82 })];

  it("è spenta di default", () => {
    expect(canAutoApprove({ autoApprove: false, threshold: 90, alwaysReview: false })).toBe(false);
    expect(
      autoApprovable(proposals, { autoApprove: false, threshold: 90, alwaysReview: true }),
    ).toEqual([]);
  });

  it("non scatta se la revisione obbligatoria è attiva", () => {
    expect(
      autoApprovable(proposals, { autoApprove: true, threshold: 90, alwaysReview: true }),
    ).toEqual([]);
  });

  it("approva solo le righe sopra soglia, complete e non duplicate", () => {
    const eligible = autoApprovable(proposals, {
      autoApprove: true,
      threshold: 90,
      alwaysReview: false,
    });
    expect(eligible.map((proposal) => proposal.id)).toEqual(["p1"]);

    expect(
      autoApprovable([baseProposal({ duplicate: true, confidence: 99 })], {
        autoApprove: true,
        threshold: 90,
        alwaysReview: false,
      }),
    ).toEqual([]);
    expect(
      autoApprovable([baseProposal({ date: null, confidence: 99 })], {
        autoApprove: true,
        threshold: 90,
        alwaysReview: false,
      }),
    ).toEqual([]);
  });

  it("sanity-check delle impostazioni salvate", () => {
    expect(
      sanitizeImportSettings({ autoApprove: "yes", threshold: 300, alwaysReview: "no" }),
    ).toEqual({ autoApprove: false, threshold: 90, alwaysReview: true });
    expect(loadImportSettings()).toEqual({ autoApprove: false, threshold: 90, alwaysReview: true });
    saveImportSettings({ autoApprove: true, threshold: 95, alwaysReview: false });
    expect(loadImportSettings()).toEqual({ autoApprove: true, threshold: 95, alwaysReview: false });
  });
});

describe("Storico import e undo", () => {
  beforeEach(() => localStorage.clear());

  const entry = (batchId: string, voteIds: string[] = ["voto-1"]): ImportLogEntry => ({
    batchId,
    at: Date.now(),
    source: "screenshot",
    approved: voteIds.length,
    rejected: 0,
    voteIds,
  });

  it("tiene solo gli ultimi import e aggiorna lo stesso batch", () => {
    for (let index = 0; index < IMPORT_LOG_LIMIT + 5; index += 1) {
      upsertImportLog(entry(`batch-${index}`));
    }
    const log = loadImportLog();
    expect(log).toHaveLength(IMPORT_LOG_LIMIT);
    expect(log[0]!.batchId).toBe(`batch-${IMPORT_LOG_LIMIT + 4}`);

    upsertImportLog({ ...entry("batch-recente"), approved: 2, voteIds: ["a", "b"] });
    const updated = loadImportLog().filter((item) => item.batchId === "batch-recente");
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ approved: 2, voteIds: ["a", "b"] });
  });

  it("annulla l'ultimo batch ancora attivo", () => {
    upsertImportLog(entry("b1"));
    upsertImportLog(entry("b2", []));
    expect(lastUndoableImport(loadImportLog())?.batchId).toBe("b1");

    markImportUndone("b1");
    expect(lastUndoableImport(loadImportLog())).toBeNull();
  });

  it("esporta JSON senza miniature", () => {
    const json = exportProposals([baseProposal({ sourceImage: "data:image/jpeg;base64,abc" })]);
    const parsed = JSON.parse(json) as { proposte: Record<string, unknown>[] };
    expect(parsed.proposte[0]).not.toHaveProperty("sourceImage");
    expect(parsed.proposte[0]).toMatchObject({ subject: "Italiano", grade: 7 });
  });
});
