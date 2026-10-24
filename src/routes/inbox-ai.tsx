import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Inbox as InboxIcon,
  RefreshCw,
  Terminal,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { InboxCard } from "@/components/InboxCard";
import {
  InboxEditDialog,
  InboxGradeReviewDialog,
  InboxHelperDialog,
  InboxLightbox,
} from "@/components/InboxDialogs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { cap, tipoOf, useRegistro } from "@/lib/grades";
import { archiveInboxCandidateFn, restoreInboxCandidateFn } from "@/lib/inbox-archive.functions";
import type { InboxCandidate, InboxCandidateType } from "@/lib/inbox";
import {
  INBOX_FILTERS,
  INBOX_HELPER_STALE_MS,
  INBOX_POLL_MS,
  INBOX_TYPE_LABEL,
  applyInboxOverlay,
  countPending,
  editedFields,
  fetchInboxCandidates,
  fetchInboxHelperStatus,
  formatInboxTime,
  helperIsStale,
  readInboxOverlay,
  sortCandidates,
  writeInboxOverlay,
  type InboxFilter,
  type InboxHelperStatus,
  type InboxOverlay,
  type InboxOverlayEntry,
  type InboxOverrides,
} from "@/lib/inbox-ui";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inbox-ai")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Inbox AI — Tide" },
      { name: "description", content: "Le proposte automatiche dall'Inbox locale di Tide." },
      { property: "og:title", content: "Inbox AI — Tide" },
      { property: "og:description", content: "Le proposte automatiche dall'Inbox locale di Tide." },
    ],
  }),
  component: InboxAiPage,
});

const EMPTY_HELPER: InboxHelperStatus = {
  helperActive: false,
  updatedAt: null,
  pid: null,
  note: null,
};

const LOAD_ERROR = "Errore lettura inbox-candidates.json. Ricontrolla il formato.";

function isRealIsoDate(value: string | undefined | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** La Bacheca salva un timestamp: mezzogiorno locale non sposta mai il giorno. */
function dueTimestamp(iso: string | undefined): number | undefined {
  if (!isRealIsoDate(iso)) return undefined;
  const [year, month, day] = iso.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return undefined;
  return new Date(year, month - 1, day, 12, 0, 0).getTime();
}

const newInboxTaskId = () =>
  `inbox-task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function InboxAiPage() {
  const reduce = useReducedMotion();
  const { state, dispatch } = useStore();
  const { reg, addVoti, removeVotiByIds } = useRegistro();
  const [candidates, setCandidates] = useState<InboxCandidate[]>([]);
  const [overlay, setOverlay] = useState<InboxOverlay>({});
  const [helper, setHelper] = useState<InboxHelperStatus>(EMPTY_HELPER);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  const [editing, setEditing] = useState<InboxCandidate | null>(null);
  const [reviewing, setReviewing] = useState<InboxCandidate | null>(null);
  const [zoomed, setZoomed] = useState<InboxCandidate | null>(null);
  const [helperOpen, setHelperOpen] = useState(false);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (mode: "initial" | "manual" | "poll") => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (mode !== "poll") setRefreshing(true);
    try {
      const [list, status] = await Promise.all([
        fetchInboxCandidates(controller.signal),
        fetchInboxHelperStatus(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setCandidates(list);
      setHelper(status);
      setError(null);
      setLastRefresh(new Date());
    } catch (reason) {
      if ((reason as { name?: string }).name === "AbortError") return;
      console.warn("[inbox] lettura proposte non riuscita", reason);
      setError(LOAD_ERROR);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    setOverlay(readInboxOverlay());
    void load("initial");
    return () => abortRef.current?.abort();
  }, [load]);

  // Polling leggero: solo a pagina visibile, mai due letture in parallelo.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load("poll");
    }, INBOX_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const merged = useMemo(
    () => candidates.map((candidate) => applyInboxOverlay(candidate, overlay[candidate.id])),
    [candidates, overlay],
  );
  const sorted = useMemo(() => sortCandidates(merged), [merged]);
  const pending = useMemo(
    () => sorted.filter((candidate) => candidate.status === "pending"),
    [sorted],
  );
  const decided = useMemo(
    () => sorted.filter((candidate) => candidate.status !== "pending"),
    [sorted],
  );
  const counts = useMemo(() => countPending(merged), [merged]);
  const visible = useMemo(() => {
    const source = showDecided ? sorted : pending;
    return filter === "all" ? source : source.filter((candidate) => candidate.type === filter);
  }, [showDecided, sorted, pending, filter]);

  const storeOverlay = (next: InboxOverlay, previous: InboxOverlay, message: string) => {
    setOverlay(next);
    if (!writeInboxOverlay(next)) {
      setOverlay(previous);
      toast.error("Impossibile salvare localmente. Lo storage del browser è pieno o bloccato.");
      return;
    }
    toast.success(message, {
      duration: 5000,
      action: {
        label: "Annulla",
        onClick: () => {
          setOverlay(previous);
          if (!writeInboxOverlay(previous)) {
            toast.error("Impossibile annullare: storage locale non disponibile.");
          }
        },
      },
    });
  };

  const patchCandidate = (
    candidate: InboxCandidate,
    patch: Partial<InboxOverlayEntry>,
    message: string,
  ) => {
    const previous = overlay;
    const current = previous[candidate.id];
    const entry: InboxOverlayEntry = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    if (patch.overrides) entry.overrides = { ...current?.overrides, ...patch.overrides };
    storeOverlay({ ...previous, [candidate.id]: entry }, previous, message);
  };

  /**
   * 2C: la decisione viene scritta nello storage reale prima di archiviare la
   * proposta. Se il JSON non si riesce ad aggiornare, l'inserimento viene
   * annullato per non lasciare un voto senza la sua proposta archiviata.
   */
  const commitApproval = async ({
    candidate,
    overrides,
    createdVoteId,
    createdTaskId,
    message,
  }: {
    candidate: InboxCandidate;
    overrides: InboxOverrides;
    createdVoteId: string | null;
    createdTaskId: string | null;
    message: string;
  }) => {
    setBusyIds((ids) => (ids.includes(candidate.id) ? ids : [...ids, candidate.id]));
    try {
      const result = await archiveInboxCandidateFn({ data: { id: candidate.id } });
      if (!result.removed) throw new Error(result.warning ?? "Archiviazione non riuscita");

      const current = readInboxOverlay();
      const next: InboxOverlay = {
        ...current,
        [candidate.id]: {
          ...current[candidate.id],
          status: "approved",
          overrides: { ...current[candidate.id]?.overrides, ...overrides },
          updatedAt: new Date().toISOString(),
        },
      };
      setOverlay(next);
      if (!writeInboxOverlay(next)) {
        console.warn("[inbox] overlay non salvato dopo l'approvazione");
      }
      setCandidates((list) => list.filter((item) => item.id !== candidate.id));

      toast.success(message, {
        duration: 6000,
        action: {
          label: "Annulla",
          onClick: () => void undoApproval({ candidate, createdVoteId, createdTaskId }),
        },
      });
      if (result.warning) toast.warning(result.warning, { duration: 7000 });
    } catch (error) {
      console.warn("[inbox] approvazione non completata", error);
      if (createdVoteId) removeVotiByIds([createdVoteId]);
      if (createdTaskId) dispatch({ type: "removeTask", id: createdTaskId });
      toast.error(
        "Approvazione non completata: inbox-candidates.json non è raggiungibile. La proposta resta in attesa.",
      );
    } finally {
      setBusyIds((ids) => ids.filter((id) => id !== candidate.id));
    }
  };

  /** Undo: rimette la proposta nel JSON e toglie la voce creata nello storage. */
  const undoApproval = async ({
    candidate,
    createdVoteId,
    createdTaskId,
  }: {
    candidate: InboxCandidate;
    createdVoteId: string | null;
    createdTaskId: string | null;
  }) => {
    try {
      const result = await restoreInboxCandidateFn({ data: { candidate } });
      if (!result.restored) {
        toast.error(result.warning ?? "Impossibile ripristinare la proposta.");
        return;
      }
      if (createdVoteId) removeVotiByIds([createdVoteId]);
      if (createdTaskId) dispatch({ type: "removeTask", id: createdTaskId });

      const next = readInboxOverlay();
      delete next[candidate.id];
      setOverlay(next);
      writeInboxOverlay(next);
      setCandidates((list) =>
        list.some((item) => item.id === candidate.id) ? list : [candidate, ...list],
      );
      toast.success("Approvazione annullata");
    } catch (error) {
      console.warn("[inbox] undo non riuscito", error);
      toast.error("Impossibile annullare: il server locale non risponde.");
    }
  };

  const approveTask = async (candidate: InboxCandidate) => {
    const title = candidate.title?.trim() || candidate.description?.trim() || "Compito dall'Inbox";
    const subject = candidate.subject?.trim() || "Inbox";
    const taskId = newInboxTaskId();
    dispatch({
      type: "addTask",
      id: taskId,
      task: {
        title,
        project: subject,
        subject,
        priority: "media",
        status: "in-corso",
        category: state.category,
        estimatedBlocks: 2,
        progress: 0,
        dueAt: dueTimestamp(candidate.dueDate),
      },
    });
    await commitApproval({
      candidate,
      overrides: {},
      createdVoteId: null,
      createdTaskId: taskId,
      message: `Task aggiunto in Bacheca · ${subject}`,
    });
  };

  const confirmGrade = async (candidate: InboxCandidate, overrides: InboxOverrides) => {
    setReviewing(null);
    const subject = (overrides.subject ?? candidate.subject ?? "").trim();
    const grade = overrides.grade ?? candidate.grade;
    const date = overrides.dueDate ?? candidate.dueDate ?? "";
    const gradeType = overrides.gradeType ?? candidate.gradeType ?? "Scritto";
    const weight = overrides.weight ?? candidate.weight;

    if (!subject || grade === undefined || !isRealIsoDate(date)) {
      toast.error("Per registrare il voto servono materia, voto e data validi.");
      return;
    }

    const voto = {
      materia: cap(subject),
      valore: grade,
      data: date,
      tipo: tipoOf(gradeType),
      ...(weight === undefined ? {} : { peso: weight }),
    };
    const duplicate = reg.voti.some(
      (existing) =>
        existing.materia.toLocaleLowerCase("it-IT") === voto.materia.toLocaleLowerCase("it-IT") &&
        existing.valore === voto.valore &&
        existing.data === voto.data &&
        existing.tipo === voto.tipo,
    );
    // addVoti restituisce subito l'id: serve all'Undo per togliere il voto giusto.
    const createdVoteId = duplicate ? null : (addVoti([voto])[0] ?? null);

    await commitApproval({
      candidate,
      overrides: {
        ...overrides,
        subject: voto.materia,
        grade: voto.valore,
        gradeType: voto.tipo,
        dueDate: voto.data,
      },
      createdVoteId,
      createdTaskId: null,
      message: duplicate
        ? `Voto già presente nel Registro · ${voto.materia} ${voto.valore}`
        : `Voto registrato · ${voto.materia} ${voto.valore}`,
    });
  };

  const approve = (candidate: InboxCandidate) => {
    if (candidate.type === "grade") {
      setReviewing(candidate);
      return;
    }
    if (candidate.type === "task") {
      void approveTask(candidate);
      return;
    }
    patchCandidate(candidate, { status: "approved" }, "Proposta approvata");
  };

  const reject = (candidate: InboxCandidate) => {
    setEditing(null);
    setReviewing(null);
    patchCandidate(candidate, { status: "rejected" }, "Proposta rifiutata");
  };

  const saveEdit = (candidate: InboxCandidate, overrides: InboxOverrides) => {
    setEditing(null);
    patchCandidate(candidate, { overrides }, "Proposta aggiornata");
  };

  const move = (candidate: InboxCandidate, type: InboxCandidateType) => {
    patchCandidate(candidate, { type }, `Spostata in ${INBOX_TYPE_LABEL[type]}`);
  };

  const restore = (candidate: InboxCandidate) => {
    const previous = overlay;
    const next = { ...previous };
    delete next[candidate.id];
    storeOverlay(next, previous, "Proposta ripristinata");
  };

  const helperStale = helperIsStale(helper);
  const helperActive = helper.helperActive && !helperStale;
  const helperUpdated = formatInboxTime(helper.updatedAt ? new Date(helper.updatedAt) : null);
  const allEmpty = merged.length === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Toaster position="bottom-right" theme="dark" />

      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Inbox AI</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Le tue proposte automatiche dall'Inbox locale.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {pending.length} in attesa · {candidates.length} totali
          </p>
          <Button
            variant="secondary"
            onClick={() => void load("manual")}
            disabled={loading || refreshing}
            aria-label="Aggiorna la lista delle proposte"
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && !reduce && "animate-spin")}
              aria-hidden="true"
            />
            Aggiorna lista
          </Button>
        </div>
      </header>

      <section
        className={cn(
          "glass flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-3 text-sm",
          !helperActive && "border-[#EAB308]/30",
        )}
        aria-label="Stato dell'helper locale"
      >
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            helperActive ? "bg-[#22C55E]" : "bg-[#EAB308]",
            helperActive && !reduce && "animate-pulse",
          )}
          aria-hidden="true"
        />
        <span role="status" className="min-w-0">
          {helperActive ? (
            <>
              <span className="font-medium text-[#22C55E]">Helper attivo</span>
              <span className="text-muted-foreground">
                {helper.pid ? ` · PID ${helper.pid}` : ""}
                {helperUpdated ? ` · segnale delle ${helperUpdated}` : ""}
              </span>
            </>
          ) : helperStale ? (
            <>
              <span className="font-medium text-[#EAB308]">L'helper non risponde più</span>
              <span className="text-muted-foreground">
                {helperUpdated ? ` · ultimo segnale alle ${helperUpdated}` : ""}
              </span>
            </>
          ) : (
            <>
              <span className="font-medium text-[#EAB308]">Helper non attivo</span>
              <span className="text-muted-foreground">
                {" "}
                · le proposte non arrivano finché non avvii il watcher
              </span>
            </>
          )}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto gap-1.5"
          onClick={() => setHelperOpen(true)}
        >
          <Terminal className="h-4 w-4" aria-hidden="true" />
          Come avviare l'helper?
        </Button>
      </section>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/12 px-4 py-3 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <Button size="sm" variant="ghost" onClick={() => void load("manual")}>
            Riprova
          </Button>
        </div>
      )}

      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
        <div
          role="tablist"
          aria-label="Filtra le proposte per categoria"
          className="flex shrink-0 items-center gap-1.5"
        >
          {INBOX_FILTERS.map((item) => {
            const selected = filter === item.id;
            const count = counts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setFilter(item.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "border-primary/50 bg-primary/15 text-foreground"
                    : "border-glass-border bg-glass text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                    selected ? "bg-primary/25 text-foreground" : "bg-muted text-muted-foreground",
                    count === 0 && "opacity-60",
                  )}
                  aria-label={`${count} proposte in attesa`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        {decided.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto shrink-0 gap-1.5"
            onClick={() => setShowDecided((value) => !value)}
            aria-pressed={showDecided}
          >
            {showDecided ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
            {showDecided ? "Nascondi decise" : `Mostra decise (${decided.length})`}
          </Button>
        )}
      </div>

      {loading ? (
        <div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-busy="true"
          aria-label="Caricamento proposte"
        >
          {[0, 1].map((index) => (
            <div key={index} className="glass rounded-3xl p-5">
              <div className="flex gap-4">
                <Skeleton className="h-20 w-20 shrink-0 rounded-2xl sm:h-24 sm:w-24" />
                <div className="flex-1 space-y-2.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error && merged.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-glass-border bg-glass/50 px-6 py-12 text-center backdrop-blur-md">
          <AlertTriangle className="mb-3 h-10 w-10 text-destructive" aria-hidden="true" />
          <p className="text-base font-medium">Impossibile leggere le proposte</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Controlla che public/inbox-candidates.json sia un JSON valido e riprova.
          </p>
          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => void load("manual")}
            disabled={refreshing}
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && !reduce && "animate-spin")}
              aria-hidden="true"
            />
            Riprova
          </Button>
        </div>
      ) : allEmpty ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-glass-border bg-glass/50 px-6 py-12 text-center backdrop-blur-md">
          <div className="relative mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-primary/15 text-primary">
            <InboxIcon className="h-10 w-10" aria-hidden="true" />
            <span className="absolute -bottom-2 -right-2 grid h-8 w-8 place-items-center rounded-full bg-background text-primary shadow-lg">
              <WandSparkles className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <p className="max-w-md text-base font-medium">
            Nessuna proposta. Metti screenshot in ~/Tide/Inbox/Compiti e avvia l'helper.
          </p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            L'helper legge PNG, JPG, HEIC e PDF in locale e prepara le proposte da rivedere qui.
            Nessun file lascia il tuo Mac.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => setHelperOpen(true)}>
              <Terminal className="h-4 w-4" aria-hidden="true" />
              Come avviare l'helper?
            </Button>
            <Button variant="secondary" onClick={() => void load("manual")} disabled={refreshing}>
              <RefreshCw
                className={cn("h-4 w-4", refreshing && !reduce && "animate-spin")}
                aria-hidden="true"
              />
              Aggiorna lista
            </Button>
          </div>
          {lastRefresh && (
            <p className="mt-4 text-xs text-muted-foreground">
              Ultima lettura alle {formatInboxTime(lastRefresh) ?? "—"} · la pagina si aggiorna da
              sola ogni {INBOX_POLL_MS / 1000} secondi
            </p>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-glass-border bg-glass/50 px-6 py-12 text-center backdrop-blur-md">
          <InboxIcon className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {filter === "all"
              ? "Nessuna proposta in attesa: controlla “Mostra decise” per rivedere le decisioni."
              : `Nessuna proposta in attesa per ${INBOX_TYPE_LABEL[filter]}.`}
          </p>
          <Button size="sm" variant="ghost" className="mt-3" onClick={() => setFilter("all")}>
            Mostra tutte
          </Button>
        </div>
      ) : (
        <motion.div layout={!reduce} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((candidate) => (
              <InboxCard
                key={candidate.id}
                candidate={candidate}
                edited={editedFields(overlay[candidate.id])}
                onApprove={approve}
                onEdit={setEditing}
                onReject={reject}
                onMove={move}
                onZoom={setZoomed}
                onRestore={restore}
                busy={busyIds.includes(candidate.id)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 pb-2 text-xs text-muted-foreground">
        <span>
          {pending.length} in attesa · {decided.length} decise · nessun file lascia il Mac
        </span>
        {lastRefresh && (
          <span>
            Aggiornata alle {formatInboxTime(lastRefresh) ?? "—"} · polling {INBOX_POLL_MS / 1000}s
            {helperActive ? "" : " · helper fermo"}
          </span>
        )}
      </footer>

      {editing && (
        <InboxEditDialog
          candidate={editing}
          onClose={() => setEditing(null)}
          onSave={(overrides) => saveEdit(editing, overrides)}
        />
      )}
      {reviewing && (
        <InboxGradeReviewDialog
          candidate={reviewing}
          onClose={() => setReviewing(null)}
          onApprove={(overrides) => void confirmGrade(reviewing, overrides)}
          onReject={() => reject(reviewing)}
        />
      )}
      {zoomed && <InboxLightbox candidate={zoomed} onClose={() => setZoomed(null)} />}
      {helperOpen && <InboxHelperDialog status={helper} onClose={() => setHelperOpen(false)} />}

      <p className="sr-only">
        Le proposte con confidenza sotto il 70 per cento vanno controllate prima dell'approvazione.
        L'helper aggiorna lo stato ogni minuto; oltre {Math.round(INBOX_HELPER_STALE_MS / 60000)}{" "}
        minuti senza segnale viene considerato fermo.
      </p>
    </div>
  );
}
