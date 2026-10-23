import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Download,
  FileJson,
  Image as ImageIcon,
  Pencil,
  ShieldCheck,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BAND_CLASS,
  BAND_LABEL,
  canApprove,
  confidenceBand,
  editedProposal,
  exportProposals,
  lastUndoableImport,
  toVoto,
  validateProposal,
  type ImportLogEntry,
  type PendingGradeImport,
  type ReviewBatch,
} from "@/lib/grade-import";
import { parseVoto, TIPI, type Tipo, type Voto } from "@/lib/grades";

const field =
  "rounded-xl border border-input bg-muted px-3 py-2 text-sm outline-none focus:border-primary";

const dataIt = (iso: string) => {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
};

const timeIt = (at: number) =>
  new Date(at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });

const shortSource: Record<ReviewBatch["source"], string> = {
  screenshot: "Screenshot",
  csv: "CSV / Excel",
};

type Draft = {
  subject: string;
  grade: string;
  date: string;
  type: Tipo;
  weight: string;
  note: string;
};

const draftOf = (proposal: PendingGradeImport): Draft => ({
  subject: proposal.subject,
  grade: proposal.grade === null ? "" : String(proposal.grade).replace(".", ","),
  date: proposal.date ?? "",
  type: (proposal.type as Tipo | null) ?? "Scritto",
  weight: proposal.weight === null ? "" : String(proposal.weight).replace(".", ","),
  note: proposal.note ?? "",
});

type ReviewProps = {
  batch: ReviewBatch | null;
  subjects: string[];
  /** Aggiunge i voti al registro e restituisce gli id creati. */
  onSave: (voti: Omit<Voto, "id">[]) => string[];
  onRemove: (ids: string[]) => void;
  onProgress: (
    batchId: string,
    source: ReviewBatch["source"],
    approvedIds: string[],
    rejected: number,
  ) => void;
  onUndoLast: () => ImportLogEntry | null;
  undoable: ImportLogEntry | null;
  onClose: () => void;
};

/**
 * Revisione delle proposte lette dall'OCR. Nessuna riga finisce nel registro
 * finché non viene approvata qui; le righe dubbie restano rosse e si correggono
 * a mano prima di salvare.
 */
export function GradeImportReview({
  batch,
  subjects,
  onSave,
  onRemove,
  onProgress,
  onUndoLast,
  undoable,
  onClose,
}: ReviewProps) {
  const reduced = useReducedMotion();
  const [rows, setRows] = useState<PendingGradeImport[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDuplicate, setConfirmDuplicate] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!batch) return;
    setRows(batch.proposals);
    setSaved(batch.autoApproved ?? {});
    setEditingId(null);
    setDraft(null);
    setErrors({});
    setConfirmDuplicate(null);
    setNotice("");
  }, [batch]);

  const pending = rows.filter((row) => row.status === "pending" || row.status === "edited");
  const rejected = rows.filter((row) => row.status === "rejected").length;
  const high = pending.filter(
    (row) => row.confidence >= 90 && !row.duplicate && canApprove(row),
  ).length;
  const low = pending.filter((row) => row.confidence < 70).length;
  const approvedIds = useMemo(() => Object.values(saved), [saved]);

  useEffect(() => {
    if (batch) onProgress(batch.batchId, batch.source, approvedIds, rejected);
  }, [batch, approvedIds, rejected, onProgress]);

  if (!batch) return null;

  const updateRow = (id: string, changes: Partial<PendingGradeImport>) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)));

  function approve(row: PendingGradeImport) {
    const problems = validateProposal(row);
    if (Object.keys(problems).length > 0) {
      startEdit(row);
      setErrors(problems);
      setNotice("Mancano dei dati: completali prima di approvare.");
      return;
    }
    if (row.duplicate && confirmDuplicate !== row.id) {
      setConfirmDuplicate(row.id);
      return;
    }
    const voto = toVoto(row);
    if (!voto) return;
    const [voteId] = onSave([voto]);
    if (!voteId) return;
    setSaved((current) => ({ ...current, [row.id]: voteId }));
    updateRow(row.id, { status: "approved" });
    setConfirmDuplicate(null);
    setEditingId(null);
    setNotice("");
  }

  function approveHighConfidence() {
    const eligible = rows.filter(
      (row) =>
        (row.status === "pending" || row.status === "edited") &&
        row.confidence >= 90 &&
        !row.duplicate &&
        canApprove(row),
    );
    const voti = eligible.map(toVoto).filter((voto): voto is Omit<Voto, "id"> => voto !== null);
    if (voti.length === 0) {
      setNotice("Nessuna riga sopra il 90% è pronta: correggi le proposte gialle e rosse.");
      return;
    }
    const ids = onSave(voti);
    const map: Record<string, string> = {};
    eligible.forEach((row, index) => {
      const id = ids[index];
      if (id) map[row.id] = id;
    });
    setSaved((current) => ({ ...current, ...map }));
    setRows((current) =>
      current.map((row) => (map[row.id] ? { ...row, status: "approved" } : row)),
    );
    setNotice(`Approvati ${ids.length} ${ids.length === 1 ? "voto" : "voti"} ad alta confidenza.`);
  }

  function rejectLowConfidence() {
    const targets = rows.filter(
      (row) => (row.status === "pending" || row.status === "edited") && row.confidence < 70,
    );
    const ids = new Set(targets.map((row) => row.id));
    setRows((current) =>
      current.map((row) => (ids.has(row.id) ? { ...row, status: "rejected" } : row)),
    );
    setNotice(
      targets.length === 0
        ? "Nessuna proposta sotto il 70%."
        : `Rifiutate ${targets.length} ${targets.length === 1 ? "proposta" : "proposte"} a bassa confidenza.`,
    );
  }

  function startEdit(row: PendingGradeImport) {
    setEditingId(row.id);
    setDraft(draftOf(row));
    setErrors({});
    setConfirmDuplicate(null);
  }

  function saveEdit(row: PendingGradeImport) {
    if (!draft) return;
    const grade = draft.grade.trim() ? parseVoto(draft.grade) : null;
    const rawWeight = draft.weight.trim().replace(",", ".");
    const weight = rawWeight === "" ? null : Number(rawWeight);
    const next = editedProposal(row, {
      subject: draft.subject.trim(),
      grade,
      date: draft.date || null,
      type: draft.type,
      weight: Number.isFinite(weight) ? weight : null,
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    });
    const problems = validateProposal(next);
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    setRows((current) => current.map((item) => (item.id === row.id ? next : item)));
    setEditingId(null);
    setDraft(null);
    setErrors({});
    setNotice("Proposta aggiornata: controlla e approva quando è giusta.");
  }

  function removeProposal(row: PendingGradeImport) {
    const voteId = saved[row.id];
    if (voteId) onRemove([voteId]);
    setSaved((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    setRows((current) => current.filter((item) => item.id !== row.id));
    setEditingId(null);
  }

  function undoSaved(row: PendingGradeImport) {
    const voteId = saved[row.id];
    if (!voteId) return;
    onRemove([voteId]);
    setSaved((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    updateRow(row.id, { status: "pending" });
  }

  function undoBatch() {
    const entry = onUndoLast();
    if (!entry) return;
    setRows((current) =>
      current.map((row) => {
        const voteId = saved[row.id];
        return voteId && entry.voteIds.includes(voteId) ? { ...row, status: "pending" } : row;
      }),
    );
    setSaved((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([, voteId]) => !entry.voteIds.includes(voteId)),
      ),
    );
    setNotice(`Annullato l'ultimo import: rimossi ${entry.voteIds.length} voti.`);
  }

  function downloadJson() {
    const blob = new Blob([exportProposals(rows)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tide-voti-proposti-${batch!.batchId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass max-h-[92vh] max-w-3xl gap-0 overflow-y-auto border-glass-border bg-background/95 p-0">
        <div className="sticky top-0 z-10 border-b border-glass-border bg-background/90 px-5 py-4 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Revisione voti importati
            </DialogTitle>
            <DialogDescription>
              {shortSource[batch.source]} · {batch.fileName} · nessun voto viene salvato finché non
              lo approvi.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">{rows.length} proposte</Badge>
            <Badge className="border-high/30 bg-high/15 text-high">
              {pending.length} da decidere
            </Badge>
            {high > 0 && (
              <Badge className="border-low/30 bg-low/15 text-low">{high} ad alta confidenza</Badge>
            )}
            {low > 0 && (
              <Badge className="border-urgent/30 bg-urgent/15 text-urgent">
                {low} a bassa confidenza
              </Badge>
            )}
            {batch.thumbnail && (
              <img
                src={batch.thumbnail}
                alt="Miniatura dello screenshot importato"
                className="ml-auto h-12 w-16 rounded-lg border border-glass-border object-cover"
              />
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={approveHighConfidence}
              disabled={high === 0}
            >
              <CheckCheck className="mr-1.5 h-4 w-4" /> Approva tutto ≥ 90
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={rejectLowConfidence}
              disabled={low === 0}
            >
              <X className="mr-1.5 h-4 w-4" /> Rifiuta tutto &lt; 70
            </Button>
            <Button size="sm" variant="ghost" onClick={downloadJson}>
              <Download className="mr-1.5 h-4 w-4" /> Esporta JSON
            </Button>
            {undoable && (
              <Button size="sm" variant="ghost" onClick={undoBatch}>
                <Undo2 className="mr-1.5 h-4 w-4" /> Annulla ultimo batch
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2 px-5 py-4">
          {rows.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nessuna proposta: chiudi pure la revisione.
            </p>
          )}
          <AnimatePresence initial={false}>
            {rows.map((row) => {
              const band = confidenceBand(row.confidence);
              const isEditing = editingId === row.id;
              const isSaved = Boolean(saved[row.id]);
              return (
                <motion.div
                  key={row.id}
                  initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.18 }}
                  className="overflow-hidden rounded-2xl border border-glass-border bg-card/60 p-3"
                >
                  <div className="flex gap-3">
                    {row.sourceImage ? (
                      <img
                        src={row.sourceImage}
                        alt=""
                        className="mt-0.5 h-14 w-16 shrink-0 rounded-lg border border-glass-border object-cover"
                      />
                    ) : (
                      <span className="mt-0.5 grid h-14 w-16 shrink-0 place-items-center rounded-lg border border-glass-border bg-muted text-muted-foreground">
                        <FileJson className="h-5 w-5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-semibold">
                          {row.subject || "Materia da completare"}
                        </span>
                        <Badge variant="secondary" className="font-display">
                          {row.grade === null
                            ? "Voto ?"
                            : `Voto ${String(row.grade).replace(".", ",")}`}
                        </Badge>
                        <Badge className={BAND_CLASS[band]}>
                          {row.confidence}% · {BAND_LABEL[band]}
                        </Badge>
                        {row.duplicate && (
                          <Badge className="border-medium/30 bg-medium/15 text-medium">
                            <AlertTriangle className="mr-1 h-3 w-3" /> Possibile duplicato
                          </Badge>
                        )}
                        {row.status === "edited" && (
                          <Badge className="border-ring-2/30 bg-ring-2/15 text-ring-2">
                            Modificato
                          </Badge>
                        )}
                        {isSaved && (
                          <Badge className="border-low/30 bg-low/15 text-low">
                            <Check className="mr-1 h-3 w-3" /> Approvato
                          </Badge>
                        )}
                        {row.status === "rejected" && (
                          <Badge variant="secondary" className="text-muted-foreground">
                            Rifiutato
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.date ? dataIt(row.date) : "Data da inserire"} ·{" "}
                        {row.type ?? "Tipo da scegliere"}
                        {row.weight === null
                          ? ""
                          : ` · peso ${String(row.weight).replace(".", ",")}`}
                      </p>
                      {row.note && <p className="mt-1 text-xs text-foreground/80">{row.note}</p>}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Materia {row.fieldConfidence.subject}% · Voto {row.fieldConfidence.grade}% ·
                        Data {row.fieldConfidence.date}% · Tipo {row.fieldConfidence.type}%
                        {row.weight === null ? "" : ` · Peso ${row.fieldConfidence.weight}%`}
                      </p>

                      {isEditing && draft ? (
                        <form
                          className="mt-3 grid grid-cols-2 gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveEdit(row);
                          }}
                        >
                          <label className="col-span-2 text-xs text-muted-foreground">
                            Materia
                            <input
                              list="tide-materie-import"
                              value={draft.subject}
                              onChange={(event) =>
                                setDraft({ ...draft, subject: event.target.value })
                              }
                              className={`${field} mt-1 w-full`}
                              aria-label="Materia della proposta"
                            />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Voto (1–10)
                            <input
                              inputMode="decimal"
                              value={draft.grade}
                              onChange={(event) =>
                                setDraft({ ...draft, grade: event.target.value })
                              }
                              className={`${field} mt-1 w-full`}
                              aria-label="Voto della proposta"
                            />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Data
                            <input
                              type="date"
                              value={draft.date}
                              onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                              className={`${field} mt-1 w-full [color-scheme:dark]`}
                              aria-label="Data della proposta"
                            />
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Tipo
                            <select
                              value={draft.type}
                              onChange={(event) =>
                                setDraft({ ...draft, type: event.target.value as Tipo })
                              }
                              className={`${field} mt-1 w-full`}
                              aria-label="Tipo della proposta"
                            >
                              {TIPI.map((tipo) => (
                                <option key={tipo}>{tipo}</option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs text-muted-foreground">
                            Peso (opzionale)
                            <input
                              inputMode="decimal"
                              value={draft.weight}
                              onChange={(event) =>
                                setDraft({ ...draft, weight: event.target.value })
                              }
                              className={`${field} mt-1 w-full`}
                              aria-label="Peso della proposta"
                            />
                          </label>
                          <label className="col-span-2 text-xs text-muted-foreground">
                            Nota del prof (opzionale)
                            <input
                              value={draft.note}
                              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                              className={`${field} mt-1 w-full`}
                              aria-label="Nota della proposta"
                            />
                          </label>
                          {Object.values(errors).length > 0 && (
                            <ul
                              className="col-span-2 space-y-1 text-xs text-destructive"
                              role="alert"
                            >
                              {Object.values(errors).map((message) => (
                                <li key={message}>{message}</li>
                              ))}
                            </ul>
                          )}
                          <div className="col-span-2 flex gap-2">
                            <Button type="submit" size="sm">
                              Salva modifica
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingId(null);
                                setDraft(null);
                                setErrors({});
                              }}
                            >
                              Annulla
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {isSaved ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`Annulla approvazione ${row.subject || "proposta"}`}
                              onClick={() => undoSaved(row)}
                            >
                              <Undo2 className="mr-1 h-3.5 w-3.5" /> Annulla
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                aria-label={`Approva ${row.subject || "proposta"}`}
                                onClick={() => approve(row)}
                              >
                                <Check className="mr-1 h-3.5 w-3.5" /> Approva
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                aria-label={`Modifica ${row.subject || "proposta"}`}
                                onClick={() => startEdit(row)}
                              >
                                <Pencil className="mr-1 h-3.5 w-3.5" /> Modifica
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Rifiuta ${row.subject || "proposta"}`}
                                onClick={() => updateRow(row.id, { status: "rejected" })}
                              >
                                <X className="mr-1 h-3.5 w-3.5" /> Rifiuta
                              </Button>
                            </>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Elimina proposta"
                            onClick={() => removeProposal(row)}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      )}

                      {confirmDuplicate === row.id && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-medium/40 bg-medium/10 p-2 text-xs">
                          <AlertTriangle className="h-4 w-4 shrink-0 text-medium" />
                          <span className="min-w-0 flex-1">
                            Sembra già presente nel registro (stessa materia, voto, data e tipo).
                            Vuoi aggiungerlo comunque?
                          </span>
                          <Button size="sm" onClick={() => approve({ ...row, duplicate: false })}>
                            Aggiungi comunque
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmDuplicate(null)}
                          >
                            No
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          <datalist id="tide-materie-import">
            {subjects.map((subject) => (
              <option key={subject} value={subject} />
            ))}
          </datalist>
          {notice && (
            <p role="status" className="pt-1 text-xs text-primary">
              {notice}
            </p>
          )}
        </div>

        <DialogFooter className="sticky bottom-0 flex-col items-stretch gap-2 border-t border-glass-border bg-background/90 px-5 py-3 backdrop-blur-xl sm:flex-col sm:items-stretch">
          <p className="text-xs text-muted-foreground">
            Le righe approvate restano nel registro; le proposte non decise vengono scartate.
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Chiudi senza salvare le proposte
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Storico compatto: ultimi import con la possibilità di annullare l'ultimo approvato. */
export function ImportHistory({
  entries,
  onUndo,
}: {
  entries: ImportLogEntry[];
  onUndo: (batchId: string) => void;
}) {
  if (entries.length === 0) return null;
  const undoable = lastUndoableImport(entries);
  return (
    <Card title="Import recenti">
      <ul className="space-y-2">
        {entries.slice(0, 4).map((entry) => (
          <li
            key={entry.batchId}
            className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs"
          >
            {entry.source === "screenshot" ? (
              <ImageIcon className="h-3.5 w-3.5 text-primary" />
            ) : (
              <FileJson className="h-3.5 w-3.5 text-primary" />
            )}
            <span className="text-muted-foreground">{timeIt(entry.at)}</span>
            <span className="font-medium">
              {entry.approved} {entry.approved === 1 ? "approvato" : "approvati"}
              {entry.rejected > 0 ? ` · ${entry.rejected} rifiutati` : ""}
            </span>
            {entry.undone ? (
              <Badge variant="secondary" className="ml-auto text-muted-foreground">
                Annullato
              </Badge>
            ) : undoable?.batchId === entry.batchId ? (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => onUndo(entry.batchId)}
              >
                <Undo2 className="mr-1 h-3.5 w-3.5" /> Annulla
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
