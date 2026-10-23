import type { State, Task, Todo } from "@/lib/store";
import { media, type Registro } from "@/lib/grades";

export const DAY = 86400000;
export type StudyItem = Task | Todo;
export const subjectOf = (item: StudyItem) => item.subject || ("project" in item ? item.project : "");
export const isDone = (item: StudyItem) => "status" in item ? item.status === "completato" : item.done;
export const blocksOf = (item: StudyItem) => Math.max(1, Math.min(48, item.estimatedBlocks ?? 2));
export const progressOf = (item: StudyItem) => isDone(item) ? 100 : Math.max(0, Math.min(100, item.progress ?? ("status" in item && item.status === "in-revisione" ? 75 : 0)));
export const remainingBlocks = (item: StudyItem) => blocksOf(item) * (1 - progressOf(item) / 100);
export const normalizeSubject = (s: string) => s.trim().toLocaleLowerCase("it-IT");
export function subjectAverage(reg: Registro, subject: string) {
  return media(reg.voti.filter(v => normalizeSubject(v.materia) === normalizeSubject(subject)));
}
export function weakestSubjects(reg: Registro, limit = 3) {
  return reg.materie.map(name => ({ name, average: subjectAverage(reg, name) }))
    .filter((s): s is { name: string; average: number } => s.average !== null)
    .sort((a, b) => a.average - b.average)
    .slice(0, Math.max(1, limit));
}
export function weakestSubject(reg: Registro) {
  return weakestSubjects(reg, 1)[0] ?? null;
}
// Deterministic local heuristic, not an AI service: urgency 0–60, effort 0–20,
// grade gap 0–20, remaining progress multiplier. Unscheduled work starts at 10.
export function priorityScore(item: StudyItem, reg: Registro, now: number) {
  if (isDone(item)) return 1;
  const days = item.dueAt === undefined ? Infinity : (item.dueAt - now) / DAY;
  const urgency = days < 2 ? 60 : days <= 5 ? 40 : days <= 7 ? 25 : days <= 14 ? 15 : 10;
  const avg = subjectAverage(reg, subjectOf(item));
  const weakness = avg === null ? 0 : Math.max(0, Math.min(20, (7 - avg) * 10));
  return Math.max(1, Math.min(100, Math.round((urgency + Math.min(20, blocksOf(item) * 5) + weakness) * (1 - progressOf(item) * 0.0075))));
}
export const priorityBand = (score: number) => score >= 95 ? "high" : score >= 40 ? "medium" : "low";
export const deadlineBand = (dueAt: number, now: number) => dueAt - now < 2 * DAY ? "high" : dueAt - now <= 5 * DAY ? "medium" : "low";
export function weekBounds(now: number) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return { start: start.getTime(), end: end.getTime() };
}
export function workload(items: StudyItem[], now: number) {
  const { end } = weekBounds(now);
  const due = items.filter(t => !isDone(t) && t.dueAt !== undefined && t.dueAt >= now && t.dueAt < end);
  // A cluster is at least 3 deadlines within a rolling 48-hour window.
  const sorted = [...due].sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  const clustered = sorted.some((t, i) => (sorted[i + 2]?.dueAt ?? Infinity) - (t.dueAt ?? 0) <= 2 * DAY);
  const hours = due.reduce((sum, t) => sum + remainingBlocks(t) * 25 / 60, 0);
  // Transparent capacity estimate: two available study hours per remaining day.
  const capacity = Math.max(2, Math.ceil((end - now) / DAY) * 2);
  const risk = Math.max(0, Math.min(100, Math.round(hours / capacity * 100)));
  return { due, clustered, hours, risk, capacity };
}
export function recoverySchedule(mode: "tomorrow" | "split", now: number) {
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(17, 0, 0, 0);
  const first = tomorrow.getTime();
  return mode === "tomorrow" ? [first] : [first, first + 30 * 60000];
}
export const localDay = (time: number) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function weeklyReport(state: State, reg: Registro, habits: Record<string, string[]>, now: number) {
  const { start, end } = weekBounds(now);
  const sessions = (state.focusLog ?? []).filter(s => s.at >= start && s.at < end);
  const seconds = sessions.reduce((sum, s) => sum + s.seconds, 0);
  const blocks = sessions.reduce((sum, s) => sum + s.blocks, 0);
  const habitCount = Object.entries(habits).filter(([day]) => day >= localDay(start) && day < localDay(end)).reduce((sum, [, ids]) => sum + ids.length, 0);
  const roi = reg.materie.map(name => {
    const hours = sessions.filter(s => normalizeSubject(s.subject) === normalizeSubject(name)).reduce((sum, s) => sum + s.seconds, 0) / 3600;
    const grades = reg.voti.filter(v => normalizeSubject(v.materia) === normalizeSubject(name) && v.data >= localDay(start) && v.data < localDay(end));
    return { name, hours: Math.round(hours * 100) / 100, grade: media(grades), average: subjectAverage(reg, name) };
  });
  return { start, end, seconds, blocks, habitCount, roi, neglected: roi.filter(r => r.hours === 0).map(r => r.name) };
}