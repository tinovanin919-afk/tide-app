import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { CategorySwitcher } from "@/components/CategorySwitcher";
import { StudyTaskTools } from "@/components/StudyTaskTools";
import { Flashcards, FlashcardToggle } from "@/components/Flashcards";
import { Button } from "@/components/ui/button";
import { buildFlashcards } from "@/lib/flashcards";
import { type Category, categoryOf, inCategory, type Priority, type Status, useStore } from "@/lib/store";

export const Route = createFileRoute("/bacheca")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Bacheca — Tide" },
      { name: "description", content: "Bacheca Kanban per organizzare i tuoi task per stato e priorità." },
      { property: "og:title", content: "Bacheca — Tide" },
      { property: "og:description", content: "Bacheca Kanban per organizzare i tuoi task per stato e priorità." },
    ],
  }),
  component: Bacheca,
});

const COLS: { id: Status; label: string }[] = [
  { id: "in-corso", label: "In corso" },
  { id: "in-revisione", label: "In revisione" },
  { id: "completato", label: "Completato" },
];
const PRI: Record<Priority, { label: string; cls: string }> = {
  urgente: { label: "Urgente", cls: "bg-urgent/20 text-urgent" },
  alta: { label: "Alta", cls: "bg-high/20 text-high" },
  media: { label: "Media", cls: "bg-medium/20 text-medium" },
  bassa: { label: "Bassa", cls: "bg-low/20 text-low" },
};
const field = "w-full rounded-xl border border-input bg-muted px-3 py-2 text-sm outline-none focus:border-primary";

function Bacheca() {
  const { state, dispatch } = useStore();
  const [over, setOver] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  // Quale card ha l'Area Ripasso aperta; le flashcard valgono solo per i compiti di Scuola.
  const [openCards, setOpenCards] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", project: "", priority: "media" as Priority, status: "in-corso" as Status, category: state.category, due: "", blocks: 2 });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Bacheca</h1>
        <Button onClick={() => { setForm({ ...form, category: state.category }); setOpen(true); }} className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> Nuovo Task
        </Button>
      </div>
      <CategorySwitcher />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {COLS.map((col) => {
          const items = inCategory(state.tasks, state.category).filter((t) => t.status === col.id);
          return (
            <div key={col.id}
              onDragOver={(e) => { e.preventDefault(); setOver(col.id); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); dispatch({ type: "moveTask", id: e.dataTransfer.getData("text/plain"), status: col.id }); setOver(null); }}
              className={`glass min-h-[300px] rounded-3xl p-4 transition ${over === col.id ? "ring-2 ring-primary" : ""}`}>
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="font-semibold">{col.label}</h2>
                <span className="rounded-full bg-muted px-2 text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((t) => {
                  const openDeck = openCards === t.id;
                  const studio = categoryOf(t) === "scuola";
                  return (
                    <div key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                      className="group cursor-grab rounded-2xl border border-glass-border bg-secondary p-3 active:cursor-grabbing">
                      <div className="flex items-start justify-between gap-2">
                        <div className={`text-sm font-medium ${t.status === "completato" ? "text-muted-foreground line-through" : ""}`}>{t.title}</div>
                        <div className="flex shrink-0 items-center gap-1">
                          {studio && (
                            <FlashcardToggle
                              open={openDeck}
                              label={t.title}
                              onToggle={() => setOpenCards(openDeck ? null : t.id)}
                            />
                          )}
                          <Button variant="ghost" size="icon" onClick={() => dispatch({ type: "removeTask", id: t.id })} className="h-6 w-6 shrink-0 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100" aria-label="Elimina">
                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </div>
                      <StudyTaskTools item={t} kind="task" />
                      <div className="mt-1 text-xs text-muted-foreground">{t.project}</div>
                      {t.dueAt && <div className="mt-1 text-xs text-muted-foreground">{new Date(t.dueAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</div>}
                      <div className="mt-3 flex items-center justify-between">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRI[t.priority].cls}`}>{PRI[t.priority].label}</span>
                        <select value={t.status} onChange={(e) => dispatch({ type: "moveTask", id: t.id, status: e.target.value as Status })}
                          className="rounded-lg border border-input bg-popover px-1.5 py-0.5 text-xs text-muted-foreground outline-none">
                          {COLS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </div>
                      {studio && (
                        <Flashcards
                          open={openDeck}
                          taskId={t.id}
                          cards={buildFlashcards({ title: t.title, subject: t.project, dueAt: t.dueAt })}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/60 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-3 rounded-3xl border border-glass-border bg-popover p-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.title.trim()) return;
              dispatch({ type: "addTask", task: { title: form.title.trim(), project: form.project.trim() || "Generale", subject: form.project.trim(), estimatedBlocks: form.blocks, progress: 0, status: form.status, priority: form.priority, category: form.category, dueAt: form.due ? new Date(form.due).getTime() : undefined } });
              setForm({ title: "", project: "", priority: "media", status: "in-corso", category: state.category, due: "", blocks: 2 });
              setOpen(false);
            }}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Nuovo Task</h2>
              <Button variant="ghost" size="icon" type="button" onClick={() => setOpen(false)} aria-label="Chiudi"><X className="h-5 w-5" /></Button>
            </div>
            <input autoFocus className={field} placeholder="Titolo del task" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className={field} placeholder="Materia / Progetto" aria-label="Materia o progetto" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} />
            <label className="block text-sm">Pomodori stimati<input type="number" min="1" max="48" aria-label="Pomodori stimati" className={`${field} mt-1`} value={form.blocks} onChange={e => setForm({ ...form, blocks: Math.max(1, Math.min(48, Number(e.target.value) || 1)) })} /></label>
            <label className="block text-sm">Ambito
              <select aria-label="Ambito del task" className={`${field} mt-1`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
                <option value="scuola">Scuola 📚</option><option value="vita">Vita Quotidiana 🏠</option>
              </select>
            </label>
            <label className="block text-sm">Scadenza (facoltativa)
              <input type="datetime-local" className={`${field} mt-1 [color-scheme:dark]`} value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select className={field} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
                {Object.entries(PRI).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select className={field} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })}>
                {COLS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <Button className="w-full rounded-xl bg-primary py-2 font-semibold text-primary-foreground">Aggiungi</Button>
          </form>
        </div>
      )}
    </div>
  );
}
