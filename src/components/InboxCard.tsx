import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeftRight,
  Calendar,
  Check,
  ChevronDown,
  ClipboardList,
  FileQuestion,
  GraduationCap,
  Image as ImageIcon,
  Link2,
  ListChecks,
  Pencil,
  RotateCcw,
  StickyNote,
  Weight,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { InboxCandidate, InboxCandidateType } from "@/lib/inbox";
import {
  INBOX_FILTERS,
  INBOX_TYPE_COLOR,
  INBOX_TYPE_LABEL,
  confidenceTone,
  daysUntil,
  formatInboxDate,
  formatInboxTime,
  primaryDateOf,
} from "@/lib/inbox-ui";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<InboxCandidateType, typeof ListChecks> = {
  task: ListChecks,
  grade: GraduationCap,
  exam: ClipboardList,
  note: StickyNote,
  link: Link2,
  unknown: FileQuestion,
};

const MOVE_TARGETS = INBOX_FILTERS.filter((filter) => filter.id !== "all");

const STATUS_LABEL = {
  approved: "Approvato",
  rejected: "Rifiutato",
  edited: "Modificato",
  pending: "Da rivedere",
} as const;

function safeUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

function relativeDay(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "oggi";
  if (days === 1) return "domani";
  if (days > 1) return `tra ${days} giorni`;
  if (days === -1) return "ieri";
  return `${Math.abs(days)} giorni fa`;
}

export type InboxCardProps = {
  candidate: InboxCandidate;
  /** Campi corretti a mano nell'overlay: non sono più “estratti”. */
  edited: Set<string>;
  onApprove: (candidate: InboxCandidate) => void;
  onEdit: (candidate: InboxCandidate) => void;
  onReject: (candidate: InboxCandidate) => void;
  onMove: (candidate: InboxCandidate, type: InboxCandidateType) => void;
  onZoom: (candidate: InboxCandidate) => void;
  onRestore: (candidate: InboxCandidate) => void;
};

export function InboxCard({
  candidate,
  edited,
  onApprove,
  onEdit,
  onReject,
  onMove,
  onZoom,
  onRestore,
}: InboxCardProps) {
  const reduce = useReducedMotion();
  const [ocrOpen, setOcrOpen] = useState(false);
  const tone = confidenceTone(candidate.confidence);
  const color = INBOX_TYPE_COLOR[candidate.type];
  const TypeIcon = TYPE_ICON[candidate.type];
  const pending = candidate.status === "pending";
  const isoDate = primaryDateOf(candidate);
  const dateLabel = formatInboxDate(isoDate);
  const days = daysUntil(isoDate);
  const url = safeUrl(candidate.url);
  const subject = candidate.subject?.trim();
  const fallbackTitle =
    candidate.type === "grade"
      ? `Voto${subject ? ` di ${subject}` : ""}`
      : candidate.type === "link" && url
        ? url.hostname
        : "Proposta senza titolo";
  const title = candidate.title?.trim() || candidate.description?.trim() || fallbackTitle;
  const description =
    candidate.title?.trim() && candidate.description?.trim() ? candidate.description.trim() : null;
  const createdAt = formatInboxTime(
    Number.isNaN(Date.parse(candidate.createdAt)) ? null : new Date(candidate.createdAt),
  );
  const statusLabel = STATUS_LABEL[candidate.status];

  return (
    <motion.article
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: pending ? 1 : 0.6, y: 0 }}
      exit={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: reduce ? 0 : 0.18, ease: "easeOut" }}
      className={cn(
        "glass overflow-hidden rounded-3xl p-4 transition-colors sm:p-5",
        !pending && "saturate-50",
      )}
      aria-label={`Proposta ${INBOX_TYPE_LABEL[candidate.type]}: ${title}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex shrink-0 items-start gap-3">
          {candidate.thumbnail ? (
            <button
              type="button"
              onClick={() => onZoom(candidate)}
              aria-label="Ingrandisci lo screenshot originale"
              className="group relative h-20 w-20 overflow-hidden rounded-2xl border border-glass-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-24 sm:w-24"
            >
              <img
                src={candidate.thumbnail}
                alt={`Screenshot di ${title}`}
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
              />
            </button>
          ) : (
            <div
              className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border border-glass-border bg-muted text-muted-foreground sm:h-24 sm:w-24"
              aria-hidden="true"
            >
              <ImageIcon className="h-7 w-7" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
              style={{ borderColor: `${color}55`, backgroundColor: `${color}1a`, color }}
            >
              <TypeIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {INBOX_TYPE_LABEL[candidate.type]}
            </span>
            {candidate.subject && (
              <span className="rounded-full border border-glass-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                {candidate.subject}
              </span>
            )}
            {!pending && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  candidate.status === "approved"
                    ? "bg-[#22C55E]/12 text-[#22C55E]"
                    : candidate.status === "rejected"
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary/12 text-primary",
                )}
              >
                {candidate.status === "approved" ? (
                  <Check className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <X className="h-3 w-3" aria-hidden="true" />
                )}
                {statusLabel}
              </span>
            )}
            {pending && edited.size > 0 && (
              <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-xs font-medium text-primary">
                modificata a mano
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-base font-semibold leading-snug break-words">{title}</h3>
              {description && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums"
              style={{
                borderColor: `${tone.color}55`,
                backgroundColor: `${tone.color}14`,
                color: tone.color,
              }}
              aria-label={`Confidenza ${candidate.confidence} per cento, ${tone.label}`}
              title={`Confidenza ${tone.label}`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone.color }} />
              {candidate.confidence}%
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            {dateLabel && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{candidate.type === "exam" ? "Verifica" : "Scadenza"}:</span>
                <span className="text-foreground">{dateLabel}</span>
                {days !== null && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[11px]",
                      days < 0 ? "bg-destructive/15 text-destructive" : "bg-muted",
                    )}
                  >
                    {relativeDay(days)}
                  </span>
                )}
              </span>
            )}
            {candidate.type === "grade" && candidate.grade !== undefined && (
              <span className="inline-flex items-center gap-1.5">
                <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-semibold text-foreground">{candidate.grade}/10</span>
                {candidate.gradeType && <span>· {candidate.gradeType}</span>}
                {candidate.weight !== undefined && (
                  <span className="inline-flex items-center gap-1">
                    <Weight className="h-3.5 w-3.5" aria-hidden="true" />
                    peso {candidate.weight}
                  </span>
                )}
              </span>
            )}
            {url && (
              <a
                href={url.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1.5 text-primary underline-offset-4 hover:underline"
              >
                <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{url.hostname}</span>
              </a>
            )}
            {createdAt && <span className="text-xs">letta alle {createdAt}</span>}
          </div>

          <Collapsible open={ocrOpen} onOpenChange={setOcrOpen}>
            <CollapsibleTrigger className="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", ocrOpen && "rotate-180")}
                aria-hidden="true"
              />
              {ocrOpen ? "Nascondi dettagli OCR" : "Mostra dettagli OCR"}
            </CollapsibleTrigger>
            <AnimatePresence initial={false}>
              {ocrOpen && (
                <CollapsibleContent forceMount asChild>
                  <motion.div
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduce ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.18, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 space-y-2 rounded-2xl border border-glass-border bg-background/40 p-3">
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted-foreground">
                        {candidate.ocrText.trim() ||
                          "Nessun testo riconosciuto: la proposta va completata a mano."}
                      </pre>
                      <p className="break-all text-[11px] text-muted-foreground/70">
                        Sorgente: {candidate.sourcePath}
                      </p>
                    </div>
                  </motion.div>
                </CollapsibleContent>
              )}
            </AnimatePresence>
          </Collapsible>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t border-glass-border pt-3">
        {pending ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onApprove(candidate)}
              aria-label={
                candidate.type === "grade" ? "Rivedi e approva il voto" : "Approva proposta"
              }
              className="h-8 gap-1.5 px-2.5 text-[#22C55E] hover:bg-[#22C55E]/10 hover:text-[#22C55E]"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Approva</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEdit(candidate)}
              aria-label="Modifica proposta"
              className="h-8 gap-1.5 px-2.5"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Modifica</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Sposta in un'altra categoria"
                  className="h-8 gap-1.5 px-2.5"
                >
                  <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Sposta</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="glass border-glass-border">
                <DropdownMenuLabel>Sposta in</DropdownMenuLabel>
                {MOVE_TARGETS.map((target) => (
                  <DropdownMenuItem
                    key={target.id}
                    disabled={target.id === candidate.type}
                    onClick={() => onMove(candidate, target.id as InboxCandidateType)}
                  >
                    {target.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onReject(candidate)}
              aria-label="Rifiuta proposta"
              className="h-8 gap-1.5 px-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Rifiuta</span>
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRestore(candidate)}
            aria-label="Ripristina proposta"
            className="h-8 gap-1.5 px-2.5"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Ripristina
          </Button>
        )}
      </div>
    </motion.article>
  );
}
