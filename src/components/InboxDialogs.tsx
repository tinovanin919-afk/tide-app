import { Check, Clipboard, Image as ImageIcon, ShieldCheck, Terminal, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { InboxCandidate, InboxCandidateField } from "@/lib/inbox";
import {
  HELPER_COMMAND,
  helperIsStale,
  type InboxHelperStatus,
  type InboxOverrides,
} from "@/lib/inbox-ui";

const FIELD =
  "rounded-xl border border-input bg-muted px-3 py-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-ring";
const SELECT = `${FIELD} h-9 w-full appearance-none`;
const HINT = "text-[11px] text-muted-foreground/80";
const DIALOG =
  "glass max-h-[92vh] max-w-xl gap-0 overflow-y-auto border-glass-border bg-background/95 p-0 data-[state=open]:slide-in-from-bottom-2";

const GRADE_TYPES = ["Scritto", "Orale", "Pratico"] as const;

function sourceName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function confidenceOf(candidate: InboxCandidate, field: InboxCandidateField): number | null {
  const value = candidate.fieldConfidence?.[field];
  return typeof value === "number" ? value : null;
}

function ConfidenceChip({
  candidate,
  field,
  label,
}: {
  candidate: InboxCandidate;
  field: InboxCandidateField;
  label: string;
}) {
  const value = confidenceOf(candidate, field);
  if (value === null) {
    return <span className={`${HINT} italic`}>{label}: non letto</span>;
  }
  const color = value >= 90 ? "#22C55E" : value >= 70 ? "#EAB308" : "#EF4444";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      {label}
      <span className="font-semibold tabular-nums" style={{ color }}>
        {Math.round(value)}%
      </span>
    </span>
  );
}

/**
 * Modale di modifica: pre-compila i valori effettivi (proposta + overlay) e
 * restituisce solo i campi corretti, che restano nell'overlay locale.
 */
export function InboxEditDialog({
  candidate,
  onClose,
  onSave,
}: {
  candidate: InboxCandidate;
  onClose: () => void;
  onSave: (overrides: InboxOverrides) => void;
}) {
  const [title, setTitle] = useState(candidate.title ?? "");
  const [subject, setSubject] = useState(candidate.subject ?? "");
  const [description, setDescription] = useState(candidate.description ?? "");
  const [dueDate, setDueDate] = useState(candidate.dueDate ?? "");
  const [examDate, setExamDate] = useState(candidate.examDate ?? "");
  const [url, setUrl] = useState(candidate.url ?? "");
  const [grade, setGrade] = useState(candidate.grade !== undefined ? String(candidate.grade) : "");
  const [gradeType, setGradeType] = useState(candidate.gradeType ?? "Scritto");
  const [weight, setWeight] = useState(
    candidate.weight !== undefined ? String(candidate.weight) : "",
  );
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedUrl = url.trim();
    if (trimmedUrl) {
      try {
        const parsed = new URL(trimmedUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          setError("Il link deve iniziare con http:// o https://");
          return;
        }
      } catch {
        setError("Il link non è un URL valido.");
        return;
      }
    }
    const gradeValue = grade.trim() === "" ? undefined : Number(grade.replace(",", "."));
    if (
      gradeValue !== undefined &&
      (!Number.isFinite(gradeValue) || gradeValue < 0 || gradeValue > 10)
    ) {
      setError("Il voto deve essere un numero tra 0 e 10.");
      return;
    }
    const weightValue = weight.trim() === "" ? undefined : Number(weight.replace(",", "."));
    if (
      weightValue !== undefined &&
      (!Number.isFinite(weightValue) || weightValue <= 0 || weightValue > 10)
    ) {
      setError("Il peso deve essere un numero tra 0,1 e 10.");
      return;
    }

    const overrides: InboxOverrides = {
      title: title.trim(),
      subject: subject.trim(),
      description: description.trim(),
      url: trimmedUrl,
    };
    // Solo i campi mostrati: una data non visibile non va cancellata di nascosto.
    if (candidate.type === "task" || candidate.type === "note") overrides.dueDate = dueDate.trim();
    if (candidate.type === "exam") overrides.examDate = examDate.trim();
    if (candidate.type === "grade") {
      overrides.gradeType = gradeType;
      if (gradeValue !== undefined) overrides.grade = gradeValue;
      if (weightValue !== undefined) overrides.weight = weightValue;
    }
    onSave(overrides);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={DIALOG}>
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-glass-border px-5 py-4">
            <DialogTitle className="text-lg">Modifica proposta</DialogTitle>
            <DialogDescription>
              Le correzioni restano nell'overlay locale: il file letto dall'helper non viene
              toccato.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
            <div className="grid gap-2">
              <Label htmlFor="inbox-title">Titolo</Label>
              <Input
                id="inbox-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={FIELD}
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="inbox-subject">Materia</Label>
              <Input
                id="inbox-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className={FIELD}
                placeholder="es. Matematica"
              />
            </div>

            {(candidate.type === "task" || candidate.type === "note") && (
              <div className="grid gap-2">
                <Label htmlFor="inbox-due">Scadenza</Label>
                <Input
                  id="inbox-due"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className={FIELD}
                />
              </div>
            )}

            {candidate.type === "exam" && (
              <div className="grid gap-2">
                <Label htmlFor="inbox-exam">Data della verifica</Label>
                <Input
                  id="inbox-exam"
                  type="date"
                  value={examDate}
                  onChange={(event) => setExamDate(event.target.value)}
                  className={FIELD}
                />
              </div>
            )}

            {candidate.type === "grade" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="inbox-grade">Voto</Label>
                  <Input
                    id="inbox-grade"
                    inputMode="decimal"
                    value={grade}
                    onChange={(event) => setGrade(event.target.value)}
                    className={FIELD}
                    placeholder="es. 8"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="inbox-gradetype">Tipo</Label>
                  <select
                    id="inbox-gradetype"
                    value={gradeType}
                    onChange={(event) =>
                      setGradeType(event.target.value as NonNullable<InboxCandidate["gradeType"]>)
                    }
                    className={SELECT}
                  >
                    {GRADE_TYPES.map((type) => (
                      <option key={type} value={type} className="bg-background">
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="inbox-weight">Peso</Label>
                  <Input
                    id="inbox-weight"
                    inputMode="decimal"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                    className={FIELD}
                    placeholder="es. 2"
                  />
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="inbox-url">Link</Label>
              <Input
                id="inbox-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className={FIELD}
                placeholder="https://classroom.google.com/…"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="inbox-description">Note</Label>
              <Textarea
                id="inbox-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className={`${FIELD} min-h-[80px]`}
                rows={3}
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-xl bg-destructive/12 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="flex-row justify-end gap-2 border-t border-glass-border px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annulla
            </Button>
            <Button type="submit">Salva modifiche</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Revisione del voto prima dell'approvazione: i valori estratti si confermano
 * (o si correggono) e solo dopo la proposta diventa approvata nell'overlay.
 */
export function InboxGradeReviewDialog({
  candidate,
  onClose,
  onApprove,
  onReject,
}: {
  candidate: InboxCandidate;
  onClose: () => void;
  onApprove: (overrides: InboxOverrides) => void;
  onReject: () => void;
}) {
  const [subject, setSubject] = useState(candidate.subject ?? "");
  const [grade, setGrade] = useState(candidate.grade !== undefined ? String(candidate.grade) : "");
  const [gradeType, setGradeType] = useState(candidate.gradeType ?? "Scritto");
  const [weight, setWeight] = useState(
    candidate.weight !== undefined ? String(candidate.weight) : "",
  );
  const [date, setDate] = useState(candidate.dueDate ?? candidate.examDate ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const gradeValue = Number(grade.replace(",", "."));
    if (grade.trim() === "" || !Number.isFinite(gradeValue) || gradeValue < 0 || gradeValue > 10) {
      setError("Inserisci un voto tra 0 e 10 prima di approvare.");
      return;
    }
    if (subject.trim() === "") {
      setError("La materia è obbligatoria per registrare un voto.");
      return;
    }
    const weightValue = weight.trim() === "" ? undefined : Number(weight.replace(",", "."));
    if (
      weightValue !== undefined &&
      (!Number.isFinite(weightValue) || weightValue <= 0 || weightValue > 10)
    ) {
      setError("Il peso deve essere un numero tra 0,1 e 10.");
      return;
    }
    const overrides: InboxOverrides = {
      subject: subject.trim(),
      grade: gradeValue,
      gradeType,
    };
    if (weightValue !== undefined) overrides.weight = weightValue;
    if (date) overrides.dueDate = date;
    onApprove(overrides);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={DIALOG}>
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-glass-border px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              Revisione voto
            </DialogTitle>
            <DialogDescription>
              Controlla i dati letti dallo screenshot. Nessun voto viene registrato: l'approvazione
              resta locale finché non collegheremo il Registro Voti.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
            <div className="grid gap-2">
              <Label htmlFor="review-subject">Materia</Label>
              <Input
                id="review-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className={FIELD}
                autoFocus
              />
              <ConfidenceChip candidate={candidate} field="subject" label="Confidenza materia" />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="review-grade">Voto</Label>
                <Input
                  id="review-grade"
                  inputMode="decimal"
                  value={grade}
                  onChange={(event) => setGrade(event.target.value)}
                  className={FIELD}
                  placeholder="/10"
                />
                <ConfidenceChip candidate={candidate} field="grade" label="Voto" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="review-gradetype">Tipo</Label>
                <select
                  id="review-gradetype"
                  value={gradeType}
                  onChange={(event) =>
                    setGradeType(event.target.value as NonNullable<InboxCandidate["gradeType"]>)
                  }
                  className={SELECT}
                >
                  {GRADE_TYPES.map((type) => (
                    <option key={type} value={type} className="bg-background">
                      {type}
                    </option>
                  ))}
                </select>
                <ConfidenceChip candidate={candidate} field="gradeType" label="Tipo" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="review-weight">Peso</Label>
                <Input
                  id="review-weight"
                  inputMode="decimal"
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                  className={FIELD}
                  placeholder="opzionale"
                />
                <ConfidenceChip candidate={candidate} field="weight" label="Peso" />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="review-date">Data</Label>
              <Input
                id="review-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={FIELD}
              />
              <span className={HINT}>Facoltativa: lasciala vuota se non era leggibile.</span>
            </div>

            <div className="rounded-2xl border border-glass-border bg-background/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Testo OCR</p>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-sans text-xs text-muted-foreground">
                {candidate.ocrText.trim() || "Nessun testo riconosciuto."}
              </pre>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-xl bg-destructive/12 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="flex-row flex-wrap justify-end gap-2 border-t border-glass-border px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annulla
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onReject}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Rifiuta
            </Button>
            <Button type="submit">
              <Check className="h-4 w-4" aria-hidden="true" />
              Conferma e approva
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Ingrandimento dello screenshot: click sulla miniatura. */
export function InboxLightbox({
  candidate,
  onClose,
}: {
  candidate: InboxCandidate;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass max-w-3xl gap-0 border-glass-border bg-background/95 p-3">
        <DialogHeader className="px-1 pb-2">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <ImageIcon className="h-4 w-4 text-primary" aria-hidden="true" />
            {candidate.title?.trim() || sourceName(candidate.sourcePath)}
          </DialogTitle>
          <DialogDescription className="break-all text-[11px]">
            {candidate.sourcePath}
          </DialogDescription>
        </DialogHeader>
        {candidate.thumbnail ? (
          <img
            src={candidate.thumbnail}
            alt={`Screenshot originale di ${candidate.title ?? "proposta"}`}
            className="max-h-[75vh] w-full rounded-xl object-contain"
          />
        ) : (
          <p className="grid h-40 place-items-center text-sm text-muted-foreground">
            Nessuna anteprima disponibile.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Istruzioni per avviare l'helper: la web app non può eseguire shell. */
export function InboxHelperDialog({
  status,
  onClose,
}: {
  status: InboxHelperStatus;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const stale = helperIsStale(status);
  const active = status.helperActive && !stale;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(HELPER_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.warn("[inbox] copia non disponibile", error);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={DIALOG}>
        <DialogHeader className="border-b border-glass-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Terminal className="h-5 w-5 text-primary" aria-hidden="true" />
            Avviare l'helper
          </DialogTitle>
          <DialogDescription>
            Il browser non può lanciare processi locali: apri il Terminale, incolla il comando e
            lascialo aperto mentre lavori.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-2xl border border-glass-border bg-background/60 p-3">
            <code className="block break-all font-mono text-xs text-foreground">
              {HELPER_COMMAND}
            </code>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => void copy()}>
              <Clipboard className="h-4 w-4" aria-hidden="true" />
              {copied ? "Comando copiato" : "Copia comando"}
            </Button>
          </div>

          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>1. Metti gli screenshot o i PDF in una delle cartelle di ~/Tide/Inbox.</li>
            <li>2. Avvia l'helper: propone i file uno alla volta e li archivia in Processati.</li>
            <li>
              3. Le proposte compaiono qui entro pochi secondi (la pagina si aggiorna da sola).
            </li>
          </ul>

          <p className="text-xs text-muted-foreground">
            Stato attuale:{" "}
            <span className={active ? "text-[#22C55E]" : "text-[#EAB308]"}>
              {active ? "helper attivo" : stale ? "helper non risponde più" : "helper non attivo"}
            </span>
            {status.pid ? ` · PID ${status.pid}` : ""}. Nessun file lascia il tuo Mac.
          </p>
        </div>

        <DialogFooter className="flex-row justify-end border-t border-glass-border px-5 py-3">
          <Button onClick={onClose}>Ho capito</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
