import { describe, expect, it, vi, afterEach } from "vitest";
import { inCategory, makeInitial, reducer, restoreState } from "@/lib/store";
import { dueReminders } from "@/lib/reminders";

afterEach(() => vi.useRealTimers());

describe("Dati Scuola e Vita Quotidiana", () => {
  it("conserva i dati precedenti, timer e preferenze e li mostra in Scuola", () => {
    const legacy = { ...makeInitial(), todos: [{ id: "fisica", title: "Fisica", done: false }], tasks: [{ id: "chimica", title: "Chimica", project: "Chimica", priority: "alta", status: "in-corso" }], timer: { duration: 1800, remaining: 1200, endsAt: 5000 }, wallpaper: "dusk", accent: "verde" };
    const saved = JSON.parse(JSON.stringify(legacy));
    delete saved.category; delete saved.notificationsEnabled;
    const restored = restoreState(JSON.stringify(saved));
    expect(restored.todos).toEqual(legacy.todos);
    expect(restored.tasks).toEqual(legacy.tasks);
    expect(restored.timer).toEqual(legacy.timer);
    expect(restored.wallpaper).toBe("dusk");
    expect(restored.accent).toBe("verde");
    expect(inCategory(restored.todos, "scuola")).toHaveLength(1);
    expect(inCategory(restored.tasks, "vita")).toHaveLength(0);
  });

  it("salva permanentemente la categoria esplicita dei nuovi task", () => {
    const next = reducer(makeInitial(), { type: "addTask", task: { title: "Calcio", project: "Sport", priority: "media", status: "in-corso", category: "vita", dueAt: 2000 } });
    const restored = restoreState(JSON.stringify(next));
    expect(inCategory(restored.tasks, "vita").map((t) => t.title)).toEqual(["Calcio"]);
    expect(inCategory(restored.tasks, "scuola").some((t) => t.title === "Calcio")).toBe(false);
    expect(inCategory(restored.tasks, "vita")[0]?.dueAt).toBe(2000);
  });

  it("separa compiti e appuntamenti ma mantiene il timer Focus globale", () => {
    const initial = makeInitial();
    let next = reducer(initial, { type: "setCategory", value: "vita" });
    next = reducer(next, { type: "addTodo", title: "Allenamento" });
    next = reducer(next, { type: "addMeeting", title: "Dentista", dueAt: 2000 });
    expect(inCategory(next.todos, "vita").map((t) => t.title)).toEqual(["Allenamento"]);
    expect(inCategory(next.meetings, "vita").map((t) => t.title)).toEqual(["Dentista"]);
    expect(next.timer).toEqual(initial.timer);
    expect(next.focusSeconds).toBe(initial.focusSeconds);
    expect(restoreState(JSON.stringify(next)).category).toBe("vita");
  });

  it("non sostituisce silenziosamente un salvataggio illeggibile", () => {
    expect(() => restoreState("{broken")).toThrow();
  });
});

describe("Promemoria locali", () => {
  it("le notifiche sono disattivate per default e il consenso viene salvato", () => {
    const initial = makeInitial();
    expect(initial.notificationsEnabled).toBe(false);
    const enabled = reducer(initial, { type: "setNotifications", value: true });
    expect(restoreState(JSON.stringify(enabled)).notificationsEnabled).toBe(true);
    expect(reducer(enabled, { type: "setNotifications", value: false }).notificationsEnabled).toBe(false);
  });

  it("ricorda solo scadenze raggiunte di elementi non completati in entrambi gli ambiti", () => {
    const now = 200000000;
    const state = { ...makeInitial(), todos: [
      { id: "due", title: "Fisica", done: false, dueAt: now, category: "scuola" as const },
      { id: "done", title: "Terminato", done: true, dueAt: now },
      { id: "future", title: "Domani", done: false, dueAt: now + 1 },
      { id: "old", title: "Vecchio", done: false, dueAt: now - 86400001 },
    ], tasks: [{ id: "sport", title: "Calcio", project: "Sport", priority: "media" as const, status: "in-corso" as const, category: "vita" as const, dueAt: now - 1000 }], meetings: [{ id: "relative", title: "Demo", time: "In 20 min", done: false }] };
    expect(dueReminders(state, now).map((r) => r.title)).toEqual(["Calcio", "Fisica"]);
    expect(dueReminders(state, now)[0]?.category).toBe("vita");
    const completed = { ...state, tasks: state.tasks.map((t) => ({ ...t, status: "completato" as const })) };
    expect(dueReminders(completed, now).map((r) => r.title)).toEqual(["Fisica"]);
  });
});