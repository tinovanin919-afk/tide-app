import type { State } from "@/lib/store";

export type Reminder = { key: string; title: string; dueAt: number; category: "scuola" | "vita" };

// Reminder windows are absolute dates: stale demo times never become daily alarms.
export function dueReminders(state: State, now: number): Reminder[] {
  const candidates = [
    ...state.tasks.filter((t) => t.status !== "completato").map((t) => ({ ...t, kind: "task" })),
    ...state.todos.filter((t) => !t.done).map((t) => ({ ...t, kind: "todo" })),
    ...state.meetings.filter((m) => !m.done).map((m) => ({ ...m, kind: "meeting" })),
  ];
  return candidates.flatMap((item) => {
    const dueAt = item.dueAt;
    if (typeof dueAt !== "number" || !Number.isFinite(dueAt) || dueAt > now || dueAt < now - 86400000) return [];
    return [{ key: `${item.kind}:${item.id}:${dueAt}`, title: item.title, dueAt, category: item.category ?? "scuola" }];
  }).sort((a, b) => a.dueAt - b.dueAt);
}