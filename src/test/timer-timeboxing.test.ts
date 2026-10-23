import { afterEach, describe, expect, it, vi } from "vitest";
import { makeInitial, reducer, restoreState, type Task } from "@/lib/store";

const now = new Date(2026, 9, 19, 12).getTime();
const task: Task = {
  id: "math",
  title: "Verifica",
  project: "Matematica",
  status: "in-corso",
  priority: "media",
  category: "scuola",
  dueAt: now + 86400000,
  estimatedBlocks: 4,
};

afterEach(() => vi.useRealTimers());

describe("Time Boxing", () => {
  it("il preset definisce la durata del timer libero e resta dopo reset e fine sessione", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const initial = makeInitial();
    const preset = reducer(initial, { type: "setSessionMinutes", value: 50 });
    expect(preset.sessionMinutes).toBe(50);
    expect(preset.timer).toMatchObject({ duration: 3000, remaining: 3000, endsAt: null });

    const started = reducer(preset, { type: "timerStart" });
    vi.setSystemTime(now + 3000 * 1000);
    const finished = reducer(started, { type: "timerTick" });
    expect(finished.timer).toMatchObject({ duration: 3000, remaining: 3000, endsAt: null });
    expect(finished.focusSeconds - initial.focusSeconds).toBe(3000);
    expect(reducer(finished, { type: "timerReset" }).timer.duration).toBe(3000);
  });

  it("cambiare preset durante una sessione di studio non sovrascrive la sessione", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const running = reducer({ ...makeInitial(), tasks: [task] }, { type: "startStudy", kind: "task", id: task.id, blocks: 4 });
    const changed = reducer(running, { type: "setSessionMinutes", value: 90 });
    expect(changed.sessionMinutes).toBe(90);
    expect(changed.timer.duration).toBe(6000);
    expect(changed.timer.itemId).toBe(task.id);
  });

  it("ripristina il preset salvato e ignora valori fuori scala", () => {
    expect(restoreState(JSON.stringify({ ...makeInitial(), sessionMinutes: 90 })).sessionMinutes).toBe(90);
    expect(restoreState(JSON.stringify({ ...makeInitial(), sessionMinutes: 999 })).sessionMinutes).toBe(25);
    expect(restoreState(JSON.stringify({ ...makeInitial(), todos: [] })).sessionMinutes).toBe(25);
  });

  it("limita il preset tra 5 e 180 minuti", () => {
    const initial = makeInitial();
    expect(reducer(initial, { type: "setSessionMinutes", value: 1 }).sessionMinutes).toBe(5);
    expect(reducer(initial, { type: "setSessionMinutes", value: 600 }).sessionMinutes).toBe(180);
    expect(reducer(initial, { type: "setSessionMinutes", value: 45.6 }).timer.duration).toBe(46 * 60);
  });
});
