import { useEffect, useSyncExternalStore } from "react";

export type Resource = { id: string; title: string; url: string };
type Notebook = { notes: Record<string, string>; links: Record<string, Resource[]>; schoolUrl: string; habits: Record<string, string[]> };
export const NOTEBOOK_KEY = "tide-study-notebook-v1";
const empty: Notebook = { notes: {}, links: {}, schoolUrl: "", habits: {} };
let snapshot = empty;
let loaded = false;
let writable = true;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(NOTEBOOK_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Invalid notebook");
      snapshot = { ...empty, ...saved };
    }
  } catch { writable = false; }
  notify();
}
export function safeUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; }
}
function update(fn: (old: Notebook) => Notebook) {
  snapshot = fn(snapshot);
  if (writable) { try { localStorage.setItem(NOTEBOOK_KEY, JSON.stringify(snapshot)); } catch { /* Keep in-memory changes available. */ } }
  notify();
}
export function useNotebook() {
  const data = useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => snapshot, () => empty);
  useEffect(load, []);
  return {
    data,
    setNote: (subject: string, text: string) => update(old => ({ ...old, notes: { ...old.notes, [subject]: text } })),
    setSchoolUrl: (url: string) => update(old => ({ ...old, schoolUrl: url })),
    addLink: (subject: string, title: string, value: string) => {
      const url = safeUrl(value); if (!url) return false;
      update(old => ({ ...old, links: { ...old.links, [subject]: [...(old.links[subject] ?? []), { id: crypto.randomUUID(), title: title.trim() || new URL(url).hostname, url }] } }));
      return true;
    },
    removeLink: (subject: string, id: string) => update(old => ({ ...old, links: { ...old.links, [subject]: (old.links[subject] ?? []).filter(l => l.id !== id) } })),
    toggleHabit: (day: string, id: string) => update(old => {
      const done = old.habits[day] ?? [];
      return { ...old, habits: { ...old.habits, [day]: done.includes(id) ? done.filter(x => x !== id) : [...done, id] } };
    }),
  };
}