import type React from "react";
import { createContext, useContext, useEffect, useReducer, useState, type ReactNode } from "react";

export type Status = "in-corso" | "in-revisione" | "completato";
export type Priority = "urgente" | "alta" | "media" | "bassa";
export type Category = "scuola" | "vita";
type Categorized = { category?: Category | undefined; dueAt?: number | undefined; subject?: string | undefined; estimatedBlocks?: number | undefined; progress?: number | undefined; sessions?: number[] | undefined; skipped?: boolean | undefined };
export type Task = Categorized & {
  id: string;
  title: string;
  project: string;
  priority: Priority;
  status: Status;
  completedAt?: number | undefined;
};
export type Todo = Categorized & { id: string; title: string; done: boolean };
export type Meeting = Categorized & { id: string; title: string; time: string; done: boolean };
export type Timer = { duration: number; remaining: number; endsAt: number | null; itemId?: string | undefined; kind?: "task" | "todo" | undefined; subject?: string | undefined; plannedBlocks?: number | undefined; credited?: number | undefined };
export type FocusEntry = { at: number; seconds: number; blocks: number; subject: string; itemId?: string | undefined };

export type State = {
  todos: Todo[];
  meetings: Meeting[];
  tasks: Task[];
  focusSeconds: number;
  timer: Timer;
  wallpaper: string;
  accent: string;
  category: Category;
  notificationsEnabled: boolean;
  /** Durata scelta nel Time Boxing per il timer libero, in minuti. */
  sessionMinutes: number;
  focusLog?: FocusEntry[] | undefined;
};

export const WALLPAPERS = ["ash", "sand", "sage", "aurora", "smoke", "tide", "bloom", "ember", "grove", "dusk"];
export const ACCENTS = ["rosa", "rosso", "arancione", "verde", "blu"];

const uid = () => Math.random().toString(36).slice(2, 10);
const DAY = 86400000;

export function makeInitial(): State {
  const now = Date.now();
  return {
    todos: [
      { id: uid(), title: "Rivedi la proposta di design Tide", done: true },
      { id: uid(), title: "Rispondi ai feedback del cliente", done: true },
      { id: uid(), title: "Prepara la demo del venerdì", done: true },
      { id: uid(), title: "Aggiorna la roadmap Q4", done: false },
      { id: uid(), title: "Scrivi le note di rilascio", done: false },
      { id: uid(), title: "Organizza la retrospettiva", done: false },
      { id: uid(), title: "Controlla le metriche settimanali", done: false },
      { id: uid(), title: "Pulisci la casella email", done: false },
    ],
    meetings: [
      { id: uid(), title: "Standup del mattino", time: "09:30", done: true },
      { id: uid(), title: "Revisione sincrona Tide", time: "In 20 min", done: false },
      { id: uid(), title: "Pranzo e impara: materiali vetrati", time: "13:00", done: false },
      { id: uid(), title: "1:1 con Marco", time: "16:30", done: false },
    ],
    tasks: [
      { id: uid(), title: "Approva kit Orbit", project: "Orbit", priority: "urgente", status: "in-corso" },
      { id: uid(), title: "Pianifica prossimi obiettivi", project: "Strategia", priority: "alta", status: "in-corso" },
      { id: uid(), title: "Ridisegna onboarding", project: "Tide", priority: "media", status: "in-corso" },
      { id: uid(), title: "Test di usabilità mobile", project: "Tide", priority: "alta", status: "in-revisione" },
      { id: uid(), title: "Revisione testi landing", project: "Marketing", priority: "bassa", status: "in-revisione" },
      { id: uid(), title: "Icone sistema Orbit", project: "Orbit", priority: "media", status: "completato", completedAt: now - DAY },
      { id: uid(), title: "Report mensile", project: "Strategia", priority: "alta", status: "completato", completedAt: now - 2 * DAY },
      { id: uid(), title: "Campagna newsletter", project: "Marketing", priority: "bassa", status: "completato", completedAt: now - 4 * DAY },
      { id: uid(), title: "Palette colori Tide", project: "Tide", priority: "media", status: "completato", completedAt: now - 4 * DAY },
    ],
    focusSeconds: 66 * 60,
    timer: { duration: 25 * 60, remaining: 25 * 60, endsAt: null },
    wallpaper: "tide",
    accent: "rosa",
    category: "scuola",
    notificationsEnabled: false,
    sessionMinutes: 25,
  };
}

type Action =
  | { type: "hydrate"; state: State }
  | { type: "toggleTodo"; id: string }
  | { type: "addTodo"; title: string; dueAt?: number | undefined }
  | {
      type: "addTodos";
      items: {
        title: string;
        dueAt?: number | undefined;
        subject?: string | undefined;
        estimatedBlocks?: number | undefined;
        category?: Category | undefined;
      }[];
    }
  | { type: "removeTodo"; id: string }
  | { type: "toggleMeeting"; id: string }
  | { type: "addMeeting"; title: string; dueAt: number }
  | { type: "addTask"; task: Omit<Task, "id">; id?: string }
  | { type: "moveTask"; id: string; status: Status }
  | { type: "removeTask"; id: string }
  | { type: "timerStart" }
  | { type: "timerPause" }
  | { type: "timerAdd5" }
  | { type: "timerReset" }
  | { type: "timerTick" }
  | { type: "setWallpaper"; value: string }
  | { type: "setAccent"; value: string }
  | { type: "setCategory"; value: Category }
  | { type: "setNotifications"; value: boolean }
  | { type: "setSessionMinutes"; value: number };
type StudyAction =
  | { type: "updateStudy"; kind: "task" | "todo"; id: string; changes: Partial<Categorized> }
  | { type: "recoverStudy"; kind: "task" | "todo"; id: string; sessions: number[]; split: boolean }
  | { type: "startStudy"; kind: "task" | "todo"; id: string; blocks: number };

export const remainingOf = (t: Timer) =>
  t.endsAt ? Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) : t.remaining;

function logFocus(s: State, seconds: number, finished = false): State {
  const timer = s.timer;
  if (seconds <= 0) return s;
  const at = finished && timer.endsAt ? timer.endsAt : Date.now();
  const blocks = finished ? timer.plannedBlocks ?? (timer.duration === 1500 ? 1 : Math.floor(timer.duration / 1500)) : 0;
  return { ...s, focusSeconds: s.focusSeconds + seconds, focusLog: [...(s.focusLog ?? []), { at, seconds, blocks, subject: timer.subject ?? "", itemId: timer.itemId }] };
}
export function reducer(s: State, a: Action | StudyAction): State {
  switch (a.type) {
    case "updateStudy": {
      const key = a.kind === "task" ? "tasks" : "todos";
      return { ...s, [key]: s[key].map(t => t.id === a.id ? { ...t, ...a.changes } : t) };
    }
    case "recoverStudy": {
      const key = a.kind === "task" ? "tasks" : "todos";
      const dueAt = a.sessions[a.sessions.length - 1];
      if (dueAt === undefined) return s;
      return { ...s, [key]: s[key].map(t => t.id === a.id ? { ...t, sessions: a.sessions, dueAt, skipped: false, ...(a.split ? { estimatedBlocks: 2, progress: 0 } : {}) } : t) };
    }
    case "startStudy": {
      if (s.timer.endsAt) return s;
      const item = (a.kind === "task" ? s.tasks : s.todos).find(t => t.id === a.id);
      if (!item || ("status" in item ? item.status === "completato" : item.done)) return s;
      const blocks = Math.max(1, Math.min(48, Math.round(a.blocks)));
      const duration = blocks * 1500;
      return { ...s, timer: { duration, remaining: duration, endsAt: Date.now() + duration * 1000, itemId: item.id, kind: a.kind, subject: item.subject || ("project" in item ? item.project : ""), plannedBlocks: blocks, credited: 0 } };
    }
    case "hydrate":
      return a.state;
    case "toggleTodo":
      return { ...s, todos: s.todos.map((t) => (t.id === a.id ? { ...t, done: !t.done } : t)) };
    case "addTodo":
      return { ...s, todos: [...s.todos, { id: uid(), title: a.title, done: false, category: s.category, dueAt: a.dueAt }] };
    case "addTodos":
      return {
        ...s,
        todos: [
          ...s.todos,
          ...a.items.map((item) => ({
            id: uid(),
            title: item.title,
            done: false,
            category: item.category ?? s.category,
            subject: item.subject,
            dueAt: item.dueAt,
            estimatedBlocks: item.estimatedBlocks,
          })),
        ],
      };
    case "removeTodo":
      return { ...s, todos: s.todos.filter((t) => t.id !== a.id) };
    case "toggleMeeting":
      return { ...s, meetings: s.meetings.map((m) => (m.id === a.id ? { ...m, done: !m.done } : m)) };
    case "addMeeting":
      return { ...s, meetings: [...s.meetings, { id: uid(), title: a.title, dueAt: a.dueAt, time: new Date(a.dueAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }), done: false, category: s.category }] };
    case "addTask":
      // L'id esplicito serve alle azioni che devono poter annullare l'inserimento (Inbox AI).
      return { ...s, tasks: [...s.tasks, { ...a.task, category: a.task.category ?? s.category, id: a.id ?? uid(), completedAt: a.task.status === "completato" ? Date.now() : undefined }] };
    case "moveTask":
      return {
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === a.id ? { ...t, status: a.status, completedAt: a.status === "completato" ? t.completedAt ?? Date.now() : undefined } : t,
        ),
      };
    case "removeTask":
      return { ...s, tasks: s.tasks.filter((t) => t.id !== a.id) };
    case "timerStart": {
      if (s.timer.endsAt) return s;
      const rem = s.timer.remaining > 0 ? s.timer.remaining : s.timer.duration;
      return { ...s, timer: { ...s.timer, remaining: rem, endsAt: Date.now() + rem * 1000 } };
    }
    case "timerPause": {
      if (!s.timer.endsAt) return s;
      const rem = remainingOf(s.timer);
      const used = s.timer.remaining - rem;
      return { ...logFocus(s, used), timer: { ...s.timer, remaining: rem, endsAt: null, ...(s.timer.itemId ? { credited: (s.timer.credited ?? 0) + used } : {}) } };
    }
    case "timerAdd5":
      if (s.timer.itemId) return s;
      return {
        ...s,
        timer: {
          duration: s.timer.duration + 300,
          remaining: s.timer.remaining + 300,
          endsAt: s.timer.endsAt ? s.timer.endsAt + 300000 : null,
        },
      };
    case "timerReset": {
      const used = s.timer.endsAt ? s.timer.remaining - remainingOf(s.timer) : 0;
      const duration = s.sessionMinutes * 60;
      return { ...logFocus(s, used), timer: { duration, remaining: duration, endsAt: null } };
    }
    case "timerTick": {
      if (!s.timer.endsAt || remainingOf(s.timer) > 0) return s;
      let next = logFocus(s, s.timer.remaining, true);
      if (s.timer.itemId && s.timer.kind) {
        const key = s.timer.kind === "task" ? "tasks" : "todos";
        next = { ...next, [key]: next[key].map(t => t.id === s.timer.itemId ? { ...t, progress: Math.min(100, (t.progress ?? 0) + (s.timer.plannedBlocks ?? 1) / Math.max(1, t.estimatedBlocks ?? 2) * 100) } : t) };
      }
      const duration = s.sessionMinutes * 60;
      return { ...next, timer: { duration, remaining: duration, endsAt: null } };
    }
    case "setWallpaper":
      return { ...s, wallpaper: a.value };
    case "setAccent":
      return { ...s, accent: a.value };
    case "setCategory":
      return { ...s, category: a.value };
    case "setNotifications":
      return { ...s, notificationsEnabled: a.value };
    case "setSessionMinutes": {
      const sessionMinutes = Math.max(5, Math.min(180, Math.round(a.value)));
      // Una sessione di studio in corso o in pausa resta intatta: il preset vale per il timer libero.
      if (s.timer.endsAt || s.timer.itemId) return { ...s, sessionMinutes };
      const duration = sessionMinutes * 60;
      return { ...s, sessionMinutes, timer: { duration, remaining: duration, endsAt: null } };
    }
  }
}

export const KEY = "tide-cruscotto-v1";
export const categoryOf = (item: Categorized): Category => item.category ?? "scuola";
export const inCategory = <T extends Categorized>(items: T[], category: Category): T[] => items.filter((item) => categoryOf(item) === category);

export function restoreState(raw: string): State {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Salvataggio non valido");
  const saved = parsed as Partial<State>;
  const initial = makeInitial();
  return {
    ...initial, ...saved,
    todos: Array.isArray(saved.todos) ? saved.todos : initial.todos,
    meetings: Array.isArray(saved.meetings) ? saved.meetings : initial.meetings,
    tasks: Array.isArray(saved.tasks) ? saved.tasks : initial.tasks,
    timer: saved.timer && typeof saved.timer === "object" ? { ...initial.timer, ...saved.timer } : initial.timer,
    category: saved.category === "vita" ? "vita" : "scuola",
    notificationsEnabled: saved.notificationsEnabled === true,
    sessionMinutes:
      typeof saved.sessionMinutes === "number" && saved.sessionMinutes >= 5 && saved.sessionMinutes <= 180
        ? saved.sessionMinutes
        : initial.sessionMinutes,
  };
}

type CtxValue = { state: State; dispatch: (a: Action | StudyAction) => void; ready: boolean } | null;
// Keep one context instance across hot reloads so provider and consumers always match.
const g = globalThis as unknown as { __tideStoreCtx?: React.Context<CtxValue> };
const Ctx = (g.__tideStoreCtx ??= createContext<CtxValue>(null));

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, makeInitial);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) dispatch({ type: "hydrate", state: restoreState(raw) });
      setWritable(true);
    } catch {
      // Keep unreadable originals untouched rather than replacing user data.
      setWritable(false);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready && writable) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* Storage may be full or disabled. */ }
    }
    document.documentElement.dataset["wallpaper"] = state.wallpaper;
    document.documentElement.dataset["accent"] = state.accent;
  }, [state, ready, writable]);

  return <Ctx.Provider value={{ state, dispatch, ready }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore fuori dal provider");
  return c;
}

export function useNow(active: boolean) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!active) return;
    const i = setInterval(force, 1000);
    return () => clearInterval(i);
  }, [active]);
}

export const fmt = (sec: number) =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
