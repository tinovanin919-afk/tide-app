import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { GradeImportReview } from "@/components/GradeImportReview";
import type { ImportLogEntry, PendingGradeImport, ReviewBatch } from "@/lib/grade-import";
import type { Voto } from "@/lib/grades";

const proposal = (changes: Partial<PendingGradeImport>): PendingGradeImport => ({
  id: "p1",
  subject: "Italiano",
  grade: 7,
  date: "2026-10-12",
  type: "Scritto",
  weight: null,
  confidence: 96,
  fieldConfidence: { subject: 96, grade: 96, date: 96, type: 94, weight: 0 },
  status: "pending",
  createdAt: "2026-10-23T10:00:00.000Z",
  batchId: "b1",
  ...changes,
});

const batch: ReviewBatch = {
  batchId: "b1",
  source: "screenshot",
  fileName: "registro.png",
  createdAt: Date.now(),
  proposals: [
    proposal({ id: "p1", subject: "Italiano" }),
    proposal({
      id: "p2",
      subject: "Fisica",
      grade: 6,
      date: null,
      confidence: 58,
      fieldConfidence: { subject: 70, grade: 64, date: 0, type: 60, weight: 0 },
    }),
    proposal({ id: "p3", subject: "Storia", grade: 8, confidence: 95, duplicate: true }),
  ],
};

const renderReview = (overrides: Partial<ComponentProps<typeof GradeImportReview>> = {}) => {
  const onSave = vi.fn((voti: Omit<Voto, "id">[]) => voti.map((_, index) => `voto-${index}`));
  const onRemove = vi.fn();
  const onProgress = vi.fn();
  const onUndoLast = vi.fn(() => null as ImportLogEntry | null);
  const onClose = vi.fn();
  render(
    <GradeImportReview
      batch={batch}
      subjects={["Italiano", "Fisica", "Storia"]}
      onSave={onSave}
      onRemove={onRemove}
      onProgress={onProgress}
      onUndoLast={onUndoLast}
      undoable={null}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSave, onRemove, onProgress, onUndoLast, onClose };
};

describe("Revisione voti importati", () => {
  it("mostra le proposte senza salvarle e segnala la bassa confidenza", () => {
    const { onSave } = renderReview();
    expect(screen.getByText("Revisione voti importati")).toBeInTheDocument();
    expect(screen.getAllByText(/possibile duplicato/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/58% · Poco chiara/)).toBeInTheDocument();
    expect(screen.getByText(/Data da inserire/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("approva la riga scelta e la segna come approvata", async () => {
    const { onSave } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Approva Italiano" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toEqual([
      {
        materia: "Italiano",
        valore: 7,
        data: "2026-10-12",
        tipo: "Scritto",
      },
    ]);
    expect(await screen.findByText("Approvato")).toBeInTheDocument();
  });

  it("non approva una riga senza data: apre la modifica e chiede di completarla", async () => {
    const { onSave } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Approva Fisica" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("Data della proposta")).toBeInTheDocument();
    expect(screen.getByText(/Mancano dei dati/)).toBeInTheDocument();
  });

  it("salva la correzione manuale e poi approva il voto corretto", async () => {
    const { onSave } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Modifica Fisica" }));
    fireEvent.change(screen.getByLabelText("Data della proposta"), {
      target: { value: "2026-10-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva modifica" }));
    expect(await screen.findByText("Modificato")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approva Fisica" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]?.[0]).toMatchObject({
      materia: "Fisica",
      valore: 6,
      data: "2026-10-20",
    });
  });

  it("chiede conferma prima di aggiungere un possibile doppione", async () => {
    const { onSave } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Approva Storia" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByText(/Sembra già presente nel registro/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi comunque" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("rifiuta in blocco le proposte sotto il 70%", async () => {
    const { onSave } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: /Rifiuta tutto < 70/ }));
    expect(await screen.findByText("Rifiutato")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Rifiutate 1 proposta/)).toBeInTheDocument();
  });

  it("approva in blocco solo le righe sopra il 90%", async () => {
    const { onSave } = renderReview();
    fireEvent.click(screen.getByRole("button", { name: /Approva tutto ≥ 90/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toHaveLength(1);
    expect(onSave.mock.calls[0]?.[0]?.[0]).toMatchObject({ materia: "Italiano" });
  });

  it("annulla l'ultimo batch e riporta le righe in attesa", async () => {
    const undoable: ImportLogEntry = {
      batchId: "b1",
      at: Date.now(),
      source: "screenshot",
      approved: 1,
      rejected: 0,
      voteIds: ["voto-0"],
    };
    const onUndoLast = vi.fn(() => undoable);
    const { onRemove } = renderReview({ undoable, onUndoLast });
    fireEvent.click(screen.getByRole("button", { name: "Approva Italiano" }));
    await waitFor(() => expect(screen.getByText("Approvato")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Annulla ultimo batch/ }));
    expect(onUndoLast).toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Approva Italiano" })).toBeInTheDocument();
  });
});
