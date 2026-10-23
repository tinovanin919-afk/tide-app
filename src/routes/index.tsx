import { createFileRoute } from "@tanstack/react-router";
import { Check, Pause, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { CategorySwitcher } from "@/components/CategorySwitcher";
import { HomeworkImport } from "@/components/HomeworkImport";
import { HabitTracker, PriorityCenter, RecoveryBox, WorkloadBanner } from "@/components/StudyDashboard";
import { StudyTaskTools } from "@/components/StudyTaskTools";
import { WeeklyReport } from "@/components/WeeklyReport";
import { Flashcards, FlashcardToggle } from "@/components/Flashcards";
import { Button } from "@/components/ui/button";
import { buildFlashcards } from "@/lib/flashcards";
import { Card } from "@/components/AppShell";
import { categoryOf, fmt, inCategory, remainingOf, useNow, useStore } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Dashboard — Tide" },
      { name: "description", content: "Il tuo cruscotto di produttività: compiti, focus e riunioni di oggi." },
      { property: "og:title", content: "Dashboard — Tide" },
      { property: "og:description", content: "Il tuo cruscotto di produttività: compiti, focus e riunioni di oggi." },
    ],
  }),
  component: Dashboard,
});

function Ring({ value, max, label, sub, color, onClick }: { value: number; max: number; label: string; sub: string; color: string; onClick?: () => void }) {
  const r = 36, c = 2 * Math.PI * r;
  const p = Math.min(1, max ? value / max : 0);
  return (
    <Button variant="ghost" onClick={onClick} className="group h-auto whitespace-normal flex flex-col items-center gap-2 rounded-2xl p-2 transition hover:bg-accent">
      <svg viewBox="0 0 90 90" className="h-20! w-20! shrink-0 -rotate-90 transition motion-reduce:transition-none group-hover:scale-105 md:h-24! md:w-24!">
        <circle cx="45" cy="45" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted" />
        <circle cx="45" cy="45" r={r} fill="none" strokeWidth="8" strokeLinecap="round" className={color} stroke="currentColor"
          strokeDasharray={c} strokeDashoffset={c * (1 - p)} style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <div className="text-center">
        <div className="font-display text-lg font-semibold">{sub}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </Button>
  );
}

function Dashboard() {
  const { state, dispatch } = useStore();
  const [newTodo, setNewTodo] = useState("");
  const [todoDue, setTodoDue] = useState("");
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDue, setMeetingDue] = useState("");
  // Quale compito ha le flashcard aperte; l'Area Ripasso è solo per i compiti di Scuola.
  const [openCards, setOpenCards] = useState<string | null>(null);
  const todos = inCategory(state.todos, state.category);
  const meetings = inCategory(state.meetings, state.category);
  const done = todos.filter((t) => t.done).length;
  const meetDone = meetings.filter((m) => m.done).length;
  const running = !!state.timer.endsAt;
  useNow(running);
  const rem = remainingOf(state.timer);
  const liveFocus = state.focusSeconds + (running ? state.timer.remaining - rem : 0);
  const hours = liveFocus / 3600;
  const today = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const next = meetings.find((m) => !m.done);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Buon mattino, Martino</h1>
        <p className="mt-1 capitalize text-muted-foreground" suppressHydrationWarning>{today}</p>
      </header>

      <CategorySwitcher />
      <WorkloadBanner />
      <PriorityCenter />
      <HomeworkImport />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Oggi" className="lg:col-span-2">
          <div className="grid grid-cols-3 gap-2">
            <Ring value={done} max={todos.length} sub={`${done}/${todos.length}`} label="Compiti" color="text-primary" />
            <Ring value={hours} max={4} sub={`${hours.toFixed(1)}h`} label="Ore di Focus" color="text-ring-2"
              onClick={() => dispatch({ type: running ? "timerPause" : "timerStart" })} />
            <Ring value={meetDone} max={meetings.length} sub={`${meetDone}/${meetings.length}`} label={state.category === "vita" ? "Impegni" : "Riunioni"} color="text-ring-3"
              onClick={() => next && dispatch({ type: "toggleMeeting", id: next.id })} />
          </div>
        </Card>

        <Card title="Focus">
          <div className="text-center">
            {state.timer.itemId && <p className="mb-2 text-sm text-primary">{[...state.tasks, ...state.todos].find(t => t.id === state.timer.itemId)?.title ?? "Sessione di studio"} · {state.timer.plannedBlocks} blocchi</p>}
            <div className="font-display text-6xl font-semibold tabular-nums">{fmt(rem)}</div>
            <div className="mx-auto mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${state.timer.duration > 0 ? (1 - rem / state.timer.duration) * 100 : 0}%` }} />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-muted-foreground">Time Boxing</span>
              {[25, 50, 90].map((minutes) => (
                <Button
                  key={minutes}
                  size="sm"
                  variant={state.sessionMinutes === minutes ? "default" : "secondary"}
                  aria-pressed={state.sessionMinutes === minutes}
                  className="rounded-full"
                  onClick={() => dispatch({ type: "setSessionMinutes", value: minutes })}
                >
                  {minutes} min
                </Button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {running ? (
                <Button onClick={() => dispatch({ type: "timerPause" })} className="flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-sm font-medium hover:bg-accent">
                  <Pause className="h-4 w-4" /> Pausa
                </Button>
              ) : (
                <Button onClick={() => dispatch({ type: "timerStart" })} className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
                  <Play className="h-4 w-4" /> Avvia
                </Button>
              )}
              <Button disabled={!!state.timer.itemId} onClick={() => dispatch({ type: "timerAdd5" })} className="flex items-center gap-1.5 rounded-full bg-secondary px-4 py-2 text-sm hover:bg-accent">
                <Plus className="h-4 w-4" /> 5 min
              </Button>
              <Button onClick={() => dispatch({ type: "timerReset" })} aria-label="Reimposta" className="rounded-full bg-secondary p-2 hover:bg-accent">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>

        <Card title={state.category === "vita" ? "I miei promemoria" : "I miei compiti"} className="lg:col-span-2">
          <form className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 xl:flex" onSubmit={(e) => { e.preventDefault(); if (newTodo.trim()) { dispatch({ type: "addTodo", title: newTodo.trim(), dueAt: todoDue ? new Date(todoDue).getTime() : undefined }); setNewTodo(""); setTodoDue(""); } }}>
            <input value={newTodo} onChange={(e) => setNewTodo(e.target.value)} placeholder="Aggiungi un compito…"
              className="min-w-0 flex-1 rounded-xl border border-input bg-muted px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary" />
            <input type="datetime-local" aria-label="Scadenza del compito (facoltativa)" value={todoDue} onChange={(e) => setTodoDue(e.target.value)} className="col-span-2 row-start-2 min-w-0 max-w-full rounded-xl border border-input bg-muted px-2 py-2 text-xs [color-scheme:dark]" />
            <Button className="col-start-2 row-start-1 rounded-xl bg-primary px-3 text-primary-foreground" aria-label="Aggiungi"><Plus className="h-4 w-4" /></Button>
          </form>
          <ul className="space-y-1">
            {todos.length === 0 && <li className="py-4 text-sm text-muted-foreground">Nessun compito in questo ambito.</li>}
            {todos.map((t) => {
              const open = openCards === t.id;
              const studio = categoryOf(t) === "scuola";
              return (
                <li key={t.id} className="group rounded-xl px-2 py-2 transition hover:bg-accent">
                  <div className="flex items-center gap-3">
                    <Button onClick={() => dispatch({ type: "toggleTodo", id: t.id })}
                      variant="ghost" size="icon" aria-label={`Segna ${t.title}`} className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border transition ${t.done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"}`}>
                      {t.done && <Check className="h-3.5 w-3.5" />}
                    </Button>
                    <span className={`flex-1 text-sm transition ${t.done ? "text-muted-foreground line-through" : ""}`}>{t.title}{t.dueAt && <span className="mt-1 block text-xs text-muted-foreground">{new Date(t.dueAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</span>}</span>
                    {studio && (
                      <FlashcardToggle open={open} label={t.title} onToggle={() => setOpenCards(open ? null : t.id)} />
                    )}
                    <Button variant="ghost" size="icon" onClick={() => dispatch({ type: "removeTodo", id: t.id })} className="shrink-0 md:opacity-0 transition md:group-hover:opacity-100 focus-visible:opacity-100" aria-label="Elimina">
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                  <StudyTaskTools item={t} kind="todo" />
                  {studio && (
                    <Flashcards
                      open={open}
                      taskId={t.id}
                      cards={buildFlashcards({ title: t.title, dueAt: t.dueAt })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Prossimi impegni" action={<Button variant="ghost" size="icon" aria-label="Nuovo impegno" title="Nuovo impegno" onClick={() => setMeetingOpen(!meetingOpen)}><Plus /></Button>}>
          {meetingOpen && <form className="mb-4 space-y-2" onSubmit={(e) => {
            e.preventDefault();
            if (!meetingTitle.trim() || !meetingDue) return;
            dispatch({ type: "addMeeting", title: meetingTitle.trim(), dueAt: new Date(meetingDue).getTime() });
            setMeetingTitle(""); setMeetingDue(""); setMeetingOpen(false);
          }}>
            <input required aria-label="Titolo dell'impegno" placeholder="Titolo dell'impegno" value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} className="w-full rounded-xl border border-input bg-muted px-3 py-2 text-sm" />
            <input required type="datetime-local" aria-label="Data e ora dell'impegno" value={meetingDue} onChange={(e) => setMeetingDue(e.target.value)} className="w-full min-w-0 rounded-xl border border-input bg-muted px-3 py-2 text-sm [color-scheme:dark]" />
            <Button type="submit" className="w-full">Aggiungi impegno</Button>
          </form>}
          <ul className="space-y-2">
            {meetings.length === 0 && <li className="py-4 text-sm text-muted-foreground">Nessun impegno in questo ambito.</li>}
            {meetings.map((m) => (
              <li key={m.id}>
                <Button onClick={() => dispatch({ type: "toggleMeeting", id: m.id })} variant="ghost" className="flex h-auto whitespace-normal w-full justify-start items-start gap-3 rounded-xl p-2 text-left hover:bg-accent">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${m.done ? "bg-muted-foreground" : "bg-primary"}`} />
                  <div>
                    <div className="text-xs text-muted-foreground">{m.time}</div>
                    <div className={`text-sm ${m.done ? "text-muted-foreground line-through" : ""}`}>{m.title}</div>
                  </div>
                </Button>
              </li>
            ))}
          </ul>
        </Card>
        <HabitTracker />
        <RecoveryBox />
      </div>
      <WeeklyReport />
    </div>
  );
}
