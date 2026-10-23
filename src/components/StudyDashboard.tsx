import { AlertTriangle, Check, Clock } from "lucide-react";
import { Card } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { inCategory, useNow, useStore } from "@/lib/store";
import {
  blocksOf,
  deadlineBand,
  isDone,
  localDay,
  priorityBand,
  priorityScore,
  recoverySchedule,
  subjectOf,
  weakestSubjects,
  workload,
  type StudyItem,
} from "@/lib/study-engine";
import { useRegistro } from "@/lib/grades";
import { useNotebook } from "@/lib/study-notebook";

const BAND = {
  high: { label: "🔴 Alta", cls: "bg-urgent/15 text-urgent", bar: "bg-urgent" },
  medium: { label: "🟡 Media", cls: "bg-medium/15 text-medium", bar: "bg-medium" },
  low: { label: "🟢 Bassa", cls: "bg-low/15 text-low", bar: "bg-low" },
} as const;

const shortDate = (at: number) => new Date(at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
const f1 = (n: number) => n.toLocaleString("it-IT", { maximumFractionDigits: 2 });

type Entry = { item: StudyItem; kind: "task" | "todo" };

/** Compiti e promemoria dell'ambito attivo, con il tipo necessario alle azioni di studio. */
function openSchoolItems(tasks: Entry["item"][], todos: Entry["item"][]): Entry[] {
  return [
    ...tasks.map((item) => ({ item, kind: "task" as const })),
    ...todos.map((item) => ({ item, kind: "todo" as const })),
  ];
}

export function WorkloadBanner() {
  const { state } = useStore();
  const { reg } = useRegistro();
  useNow(true);
  if (state.category !== "scuola") return null;
  const load = workload(
    [...inCategory(state.tasks, state.category), ...inCategory(state.todos, state.category)],
    Date.now(),
  );
  const weak = weakestSubjects(reg);
  const over = load.risk >= 70;
  return (
    <section
      aria-label="Predittore di sovraccarico"
      className={`glass rounded-3xl p-5 ${load.clustered || over ? "ring-1 ring-medium/40" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            {load.clustered || over ? <AlertTriangle className="h-4 w-4 text-medium" /> : <Clock className="h-4 w-4 text-low" />}
            {load.clustered ? "Settimana ad alto carico" : "Carico della settimana sotto controllo"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Predittore di sovraccarico · stima locale basata sulle scadenze della settimana.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm">
          <span
            aria-hidden
            className={`h-2.5 w-2.5 rounded-full ${over ? "bg-urgent motion-safe:animate-pulse" : "bg-low"}`}
          />
          Rischio ritardi: <strong className="text-primary">{load.risk}%</strong>
        </span>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div
          className={`h-full rounded-full ${over ? "bg-urgent" : load.risk >= 40 ? "bg-medium" : "bg-low"}`}
          style={{ width: `${load.risk}%` }}
        />
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Ore stimate</dt>
          <dd className="font-display text-lg font-semibold">{f1(load.hours)}h</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Capacità prevista</dt>
          <dd className="font-display text-lg font-semibold">{load.capacity}h</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Scadenze entro domenica</dt>
          <dd className="font-display text-lg font-semibold">{load.due.length}</dd>
        </div>
      </dl>

      <div className="mt-4 border-t border-input pt-3">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Materie fragili</p>
        {weak.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Registra i voti nel Registro Voti per individuare le materie da rinforzare.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {weak.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {s.name}
                  <span className="text-muted-foreground"> · media {f1(s.average)}</span>
                </span>
                <span className={`text-xs ${s.average < reg.obiettivo ? "text-destructive" : "text-low"}`}>
                  {s.average < reg.obiettivo ? `sotto l'obiettivo ${reg.obiettivo}` : `obiettivo ${reg.obiettivo} raggiunto`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {weak[0] && (
          <p className="mt-2 text-xs text-muted-foreground">
            Suggerimento: inizia il ripasso di {weak[0].name} prima delle altre materie.
          </p>
        )}
      </div>
    </section>
  );
}

export function PriorityCenter() {
  const { state } = useStore();
  const { reg } = useRegistro();
  useNow(true);
  const now = Date.now();
  const ranked = openSchoolItems(
    inCategory(state.tasks, state.category),
    inCategory(state.todos, state.category),
  )
    .filter(({ item }) => !isDone(item))
    .map((entry) => ({ ...entry, score: priorityScore(entry.item, reg, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return (
    <Card
      title="Centro Priorità"
      action={
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          1–100 · automatico
        </span>
      }
    >
      {ranked.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nessun compito aperto in questo ambito.</p>
      ) : (
        <ul className="space-y-3">
          {ranked.map(({ item, score }) => {
            const band = priorityBand(score);
            const urgent =
              band === "high" ||
              (item.dueAt !== undefined && deadlineBand(item.dueAt, now) === "high");
            return (
              <li key={item.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{item.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {subjectOf(item) || "Scuola"}
                      {item.dueAt !== undefined ? ` · ${shortDate(item.dueAt)}` : " · senza scadenza"}
                      {` · ${blocksOf(item)} pomodori`}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${BAND[band].cls}`}>
                    {BAND[band].label} · {score}/100
                  </span>
                </div>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                  role="meter"
                  aria-label={`Priorità di ${item.title}`}
                  aria-valuemin={1}
                  aria-valuemax={100}
                  aria-valuenow={score}
                >
                  <div
                    className={`h-full rounded-full ${BAND[band].bar} ${urgent ? "motion-safe:animate-pulse" : ""}`}
                    style={{ width: `${score}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        La barra pulsa quando la scadenza è entro 48 ore: serve a calmare il carico, non a metterti fretta.
      </p>
    </Card>
  );
}

export function RecoveryBox() {
  const { state, dispatch } = useStore();
  useNow(true);
  if (state.category !== "scuola") return null;
  const now = Date.now();
  const all = openSchoolItems(
    inCategory(state.tasks, "scuola"),
    inCategory(state.todos, "scuola"),
  ).filter(({ item }) => !isDone(item));
  const pending = all.filter(
    ({ item }) =>
      (item.skipped === true || (item.dueAt !== undefined && item.dueAt < now)) &&
      !(item.sessions && item.sessions.length > 0),
  );
  const planned = all.filter(({ item }) => item.sessions && item.sessions.length > 0);

  return (
    <Card
      title="Recupero Automatico"
      action={
        <span className="text-xs text-muted-foreground">
          {pending.length === 0 ? "tutto in pari" : `${pending.length} da recuperare`}
        </span>
      }
    >
      {pending.length === 0 && planned.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nessun compito saltato o scaduto: non c'è nulla da recuperare.
        </p>
      )}
      {pending.length > 0 && (
        <ul className="space-y-3">
          {pending.map(({ item, kind }) => (
            <li key={`${kind}-${item.id}`} className="rounded-2xl bg-muted/60 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {subjectOf(item) || "Scuola"}
                    {item.dueAt !== undefined ? ` · era il ${shortDate(item.dueAt)}` : " · senza scadenza"}
                  </div>
                </div>
                <span className="rounded-md bg-medium/15 px-2 py-1 text-xs font-medium text-medium">
                  Da recuperare
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-auto whitespace-normal text-left"
                  onClick={() =>
                    dispatch({
                      type: "recoverStudy",
                      kind,
                      id: item.id,
                      sessions: recoverySchedule("tomorrow", now),
                      split: false,
                    })
                  }
                >
                  Recupera domani alle 17:00
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-auto whitespace-normal text-left"
                  onClick={() =>
                    dispatch({
                      type: "recoverStudy",
                      kind,
                      id: item.id,
                      sessions: recoverySchedule("split", now),
                      split: true,
                    })
                  }
                >
                  Dividi in 2 sessioni da 25 min
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {planned.length > 0 && (
        <div className={pending.length > 0 ? "mt-4 border-t border-input pt-3" : ""}>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Pianificati</p>
          <ul className="mt-2 space-y-1">
            {planned.map(({ item, kind }) => (
              <li key={`${kind}-${item.id}`} className="text-xs text-muted-foreground">
                <span className="text-foreground">{item.title}</span> ·{" "}
                {(item.sessions ?? []).map(shortDate).join(" → ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Le nuove date vengono salvate nel browser: restano anche dopo il riavvio del Mac.
      </p>
    </Card>
  );
}

const routines = [
  { id: "bag", title: "Preparare lo zaino" },
  { id: "read", title: "Leggere 10 pagine" },
  { id: "words", title: "Ripassare vocaboli" },
];

export function HabitTracker() {
  const { data, toggleHabit } = useNotebook();
  useNow(true);
  const day = localDay(Date.now());
  const checked = data.habits[day] ?? [];
  const energy = routines.filter((r) => checked.includes(r.id)).length;
  return (
    <Card
      title="Le mie Routine"
      action={
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-label={`Tide Dot: livello ${energy}`}
            className={`h-3 w-3 rounded-full transition duration-500 ${
              energy === 0 ? "bg-muted-foreground" : energy === 3 ? "bg-low ring-4 ring-low/20" : "bg-primary ring-2 ring-primary/20"
            }`}
          />
          Energia {energy}/3
        </span>
      }
    >
      <ul className="space-y-2">
        {routines.map((r) => (
          <li key={r.id}>
            <Button
              variant="ghost"
              className="h-auto w-full justify-start gap-3 whitespace-normal"
              onClick={() => toggleHabit(day, r.id)}
              role="checkbox"
              aria-checked={checked.includes(r.id)}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${
                  checked.includes(r.id) ? "border-primary bg-primary text-primary-foreground" : "border-input"
                }`}
              >
                {checked.includes(r.id) && <Check className="h-4 w-4" />}
              </span>
              {r.title}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
