import { useEffect, useState } from "react";
import { Play, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { blocksOf, deadlineBand, isDone, priorityBand, priorityScore, progressOf, recoverySchedule, type StudyItem } from "@/lib/study-engine";
import { useRegistro } from "@/lib/grades";
import { categoryOf, useNow, useStore } from "@/lib/store";

const bandStyle = { high: "text-urgent bg-urgent/15", medium: "text-medium bg-medium/15", low: "text-low bg-low/15" };
const bandLabel = { high: "🔴 Alta Priorità", medium: "🟡 Media Priorità", low: "🟢 Bassa Priorità" };
const barStyle = { high: "bg-urgent", medium: "bg-medium", low: "bg-low" };
export function StudyTaskTools({ item, kind }: { item: StudyItem; kind: "task" | "todo" }) {
  const { state, dispatch } = useStore();
  const { reg } = useRegistro();
  const estimate = blocksOf(item);
  // Il time boxing parte dai pomodori stimati del compito, non da un valore fisso.
  const [blocks, setBlocks] = useState(estimate);
  useEffect(() => setBlocks(estimate), [item.id, estimate]);
  useNow(true);
  const now = Date.now();
  const score = priorityScore(item, reg, now);
  const band = priorityBand(score);
  const done = isDone(item);
  const deadline = item.dueAt === undefined ? null : deadlineBand(item.dueAt, now);
  const needsRecovery = !done && categoryOf(item) === "scuola" && (item.skipped || (item.dueAt !== undefined && item.dueAt < now));
  const active = state.timer.itemId === item.id;
  // Un timer di studio in pausa occupa ancora lo slot: non va sovrascritto in silenzio.
  const paused = state.timer.itemId !== undefined && state.timer.endsAt === null && state.timer.remaining < state.timer.duration;
  return <div className="mt-2 space-y-2" draggable={false} onDragStart={e => e.stopPropagation()}>
    {deadline && <div className={`space-y-1 ${deadline === "high" && progressOf(item) === 0 && !done ? "motion-safe:animate-pulse" : ""}`}>
      <div className="h-1 overflow-hidden rounded-full bg-muted"><div className={`h-full w-full ${barStyle[deadline]}`} /></div>
      <p className="text-xs text-muted-foreground">{item.dueAt !== undefined && item.dueAt < now ? "Scadenza superata" : `Scadenza: ${new Date(item.dueAt ?? now).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}`}</p>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-md px-2 py-1 text-xs font-medium ${bandStyle[band]}`}>{bandLabel[band]} · {score}/100</span>
      <span className="text-xs text-muted-foreground">{estimate} pomodori · {Math.round(progressOf(item))}%</span>
    </div>
    {!done && <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Blocchi <input aria-label={`Blocchi per ${item.title}`} type="number" min="1" max="48" value={blocks} onChange={e => setBlocks(Math.max(1, Math.min(48, Number(e.target.value) || 1)))} className="w-12 rounded-md border border-input bg-muted px-1 py-1" /></label>
        <Button size="sm" variant="secondary" disabled={!!state.timer.endsAt || active || paused} title={paused ? "Riprendi o reimposta la sessione in pausa" : undefined} onClick={() => dispatch({ type: "startStudy", kind, id: item.id, blocks })}><Play className="h-3 w-3" />{active ? "Sessione associata" : "Studia"}</Button>
        {categoryOf(item) === "scuola" && <Button size="icon" variant="ghost" aria-label={`Segna saltato: ${item.title}`} title="Segna come saltato" onClick={() => dispatch({ type: "updateStudy", kind, id: item.id, changes: { skipped: true } })}><SkipForward className="h-4 w-4" /></Button>}
      </div>
      {needsRecovery && <div className="border-l-2 border-medium pl-3 space-y-2">
        <p className="text-xs font-medium">Piano di recupero</p>
        <Button size="sm" variant="secondary" className="h-auto max-w-full whitespace-normal text-left" onClick={() => dispatch({ type: "recoverStudy", kind, id: item.id, sessions: recoverySchedule("tomorrow", now), split: false })}>📌 Recupera domani ore 17:00</Button>
        <Button size="sm" variant="secondary" className="h-auto max-w-full whitespace-normal text-left" onClick={() => dispatch({ type: "recoverStudy", kind, id: item.id, sessions: recoverySchedule("split", now), split: true })}>📌 Dividi in 2 sessioni corte da 25 minuti</Button>
      </div>}
      {item.sessions && <ul className="text-xs text-muted-foreground">{item.sessions.map(at => <li key={at}>📌 {new Date(at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</li>)}</ul>}
    </>}
  </div>;
}