import { describe, expect, it, afterEach, vi } from "vitest";
import { deadlineBand, localDay, priorityBand, priorityScore, recoverySchedule, weakestSubject, weeklyReport, workload } from "@/lib/study-engine";
import { makeInitial, reducer, restoreState, type Task } from "@/lib/store";
import { safeUrl } from "@/lib/study-notebook";
const now = new Date(2026, 9, 19, 12).getTime();
const day = 86400000;
const task: Task = { id: "math", title: "Verifica", project: "Matematica", status: "in-corso", priority: "media", category: "scuola", dueAt: now + day, estimatedBlocks: 4 };
const reg = { materie: ["Matematica", "Fisica"], obiettivo: 6, voti: [{ id: "v1", materia: "Matematica", valore: 5.8, data: "2026-10-19", tipo: "Scritto" as const }, { id: "v2", materia: "Fisica", valore: 6.2, data: "2026-10-19", tipo: "Orale" as const }] };
afterEach(() => vi.useRealTimers());
describe("Priorità e carico locali", () => {
  it("rispetta i tre scaglioni 95, 40 e sotto 40", () => {
    expect(priorityBand(95)).toBe("high"); expect(priorityBand(94)).toBe("medium"); expect(priorityBand(40)).toBe("medium"); expect(priorityBand(39)).toBe("low");
  });
  it("considera scadenza, pomodori, materia, avanzamento e media senza superare 100", () => {
    expect(priorityScore(task, reg, now)).toBe(92);
    expect(priorityScore({ ...task, project: "Fisica" }, reg, now)).toBe(88);
    expect(priorityScore({ ...task, estimatedBlocks: 1 }, reg, now)).toBe(77);
    expect(priorityScore({ ...task, dueAt: now + 6 * day }, reg, now)).toBe(57);
    expect(priorityScore({ ...task, progress: 50 }, reg, now)).toBe(58);
    expect(priorityScore(task, { ...reg, voti: [{ ...reg.voti[0], id: "x", materia: "Matematica", valore: 3, data: "2026-10-19", tipo: "Scritto" }] }, now)).toBe(100);
    expect(priorityScore({ ...task, status: "completato" }, reg, now)).toBe(1);
  });
  it("barra verde oltre 5 giorni, gialla da 48 ore a 5 giorni, rossa sotto 48 ore", () => {
    expect(deadlineBand(now + 5 * day + 1, now)).toBe("low"); expect(deadlineBand(now + 5 * day, now)).toBe("medium"); expect(deadlineBand(now + 2 * day, now)).toBe("medium"); expect(deadlineBand(now + 2 * day - 1, now)).toBe("high");
  });
  it("segnala solo più di 2 scadenze entro 48 ore e calcola ore e rischio", () => {
    const tasks = [task, { ...task, id: "2", dueAt: now + 2 * day }, { ...task, id: "3", dueAt: now + 3 * day }];
    expect(workload(tasks.slice(0, 2), now).clustered).toBe(false);
    const result = workload(tasks, now); expect(result.clustered).toBe(true); expect(result.hours).toBe(5); expect(result.risk).toBe(36);
    expect(workload(tasks.map(t => ({ ...t, status: "completato" })), now).hours).toBe(0);
  });
  it("sceglie la materia più fragile dai voti reali", () => { expect(weakestSubject(reg)).toEqual({ name: "Matematica", average: 5.8 }); expect(weakestSubject({ ...reg, voti: [] })).toBeNull(); });
});
describe("Recupero e time boxing", () => {
  it("recupera domani alle 17 oppure due blocchi da 25 minuti separati da 5 minuti", () => {
    const times = recoverySchedule("split", now); const first = new Date(times[0] ?? 0);
    expect(first.getDate()).toBe(20); expect(first.getHours()).toBe(17); expect(first.getMinutes()).toBe(0);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBe(30 * 60000);
    expect(recoverySchedule("tomorrow", now)).toHaveLength(1);
    const s = reducer({ ...makeInitial(), tasks: [{ ...task, skipped: true }] }, { type: "recoverStudy", kind: "task", id: task.id, sessions: times, split: true });
    expect(s.tasks[0]?.estimatedBlocks).toBe(2); expect(s.tasks[0]?.dueAt).toBe(times[1]); expect(s.tasks[0]?.skipped).toBe(false);
  });
  it("due blocchi durano 50 minuti e il progresso viene salvato solo alla fine una volta", () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const initial = { ...makeInitial(), tasks: [task] };
    const running = reducer(initial, { type: "startStudy", kind: "task", id: task.id, blocks: 2 });
    expect(running.timer.duration).toBe(3000); expect(running.tasks[0]?.progress).toBeUndefined();
    vi.setSystemTime(now + 3000000);
    const done = reducer(running, { type: "timerTick" });
    expect(done.tasks[0]?.progress).toBe(50); expect(done.tasks[0]?.status).toBe("in-corso");
    expect(done.focusLog?.[0]?.blocks).toBe(2); expect(done.focusLog?.[0]?.subject).toBe("Matematica"); expect(done.focusSeconds).toBe(initial.focusSeconds + 3000);
    expect(reducer(done, { type: "timerTick" })).toEqual(done);
    expect(restoreState(JSON.stringify(done)).focusLog).toEqual(done.focusLog);
  });
  it("pausa registra lo sforzo senza completare i progressi né duplicare le ore", () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const initial = { ...makeInitial(), tasks: [task] };
    const running = reducer(initial, { type: "startStudy", kind: "task", id: task.id, blocks: 2 });
    vi.setSystemTime(now + 600000); const paused = reducer(running, { type: "timerPause" });
    expect(paused.tasks[0]?.progress).toBeUndefined(); expect(paused.focusLog?.[0]?.seconds).toBe(600);
    const resumed = reducer(paused, { type: "timerStart" }); vi.setSystemTime(now + 3000000);
    const done = reducer(resumed, { type: "timerTick" }); expect(done.focusSeconds - initial.focusSeconds).toBe(3000);
  });
});
describe("Routine, report e risorse", () => {
  it("usa un nuovo giorno a mezzanotte mantenendo lo storico delle routine", () => {
    expect(localDay(new Date(2026, 9, 19, 23, 59).getTime())).toBe("2026-10-19"); expect(localDay(new Date(2026, 9, 20, 0, 0).getTime())).toBe("2026-10-20");
  });
  it("report usa solo sessioni, voti e routine della settimana senza inventare lo storico", () => {
    const s = { ...makeInitial(), focusLog: [{ at: now, seconds: 14400, blocks: 9, subject: "Matematica" }, { at: now - 8 * day, seconds: 200, blocks: 1, subject: "Fisica" }] };
    const report = weeklyReport(s, reg, { "2026-10-19": ["bag", "read"], "2026-10-11": ["bag"] }, now);
    expect(report.seconds).toBe(14400); expect(report.blocks).toBe(9); expect(report.habitCount).toBe(2); expect(report.neglected).toEqual(["Fisica"]); expect(report.roi[0]?.hours).toBe(4); expect(report.roi[0]?.grade).toBe(5.8);
    expect(weeklyReport(makeInitial(), reg, {}, now).seconds).toBe(0);
  });
  it("permette solo risorse http e https", () => { expect(safeUrl("javascript:alert(1)")).toBeNull(); expect(safeUrl("https://classroom.google.com/")).toBe("https://classroom.google.com/"); });
});