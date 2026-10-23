import { Camera, Loader2 } from "lucide-react";
import { useState } from "react";
import { useRegistro } from "@/lib/grades";
import { blocksOf, priorityScore } from "@/lib/study-engine";
import { useStore, type Todo } from "@/lib/store";
import { imageToText, isImageFile, parseHomeworkScreenshot, type HomeworkItem } from "@/lib/vision";

const shortDue = (at: number) =>
  new Date(at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });

/** Oggetto temporaneo solo per mostrare subito priorità e blocchi stimati della nuova task. */
const asTodo = (item: HomeworkItem, index: number): Todo => ({
  id: `foto-${index}`,
  title: item.title,
  done: false,
  category: "scuola",
  subject: item.subject || undefined,
  dueAt: item.dueAt ?? undefined,
  estimatedBlocks: item.estimatedBlocks,
});

/**
 * "Invia foto compiti": screenshot di Classroom o foto della lavagna.
 * L'OCR gira nel browser e crea direttamente le attività con materia, scadenza,
 * priorità (Study Engine) e pomodori stimati per il Time Boxing.
 */
export function HomeworkImport() {
  const { state, dispatch } = useStore();
  const { reg } = useRegistro();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"loading" | "recognizing">("loading");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [imported, setImported] = useState<HomeworkItem[]>([]);

  async function onFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || busy) return;
    if (!isImageFile(file)) {
      setStatus({
        kind: "error",
        text: "Trascina un'immagine PNG o JPG dello screenshot di Classroom o della lavagna.",
      });
      return;
    }
    setBusy(true);
    setProgress(0);
    setStage("loading");
    setStatus(null);
    setImported([]);
    try {
      const text = await imageToText(file, (update) => {
        setStage(update.stage);
        setProgress(update.progress);
      });
      const items = parseHomeworkScreenshot(text, Date.now(), reg.materie);
      if (items.length === 0) {
        setStatus({
          kind: "error",
          text: "Non ho trovato compiti nella foto: inquadra il titolo dell'attività e la data di consegna.",
        });
        return;
      }
      dispatch({
        type: "addTodos",
        items: items.map((item) => ({
          title: item.title,
          subject: item.subject || undefined,
          dueAt: item.dueAt ?? undefined,
          estimatedBlocks: item.estimatedBlocks,
          category: "scuola",
        })),
      });
      // Le nuove task vivono in Scuola: si mostrano subito nella lista dei compiti.
      if (state.category !== "scuola") dispatch({ type: "setCategory", value: "scuola" });
      setImported(items);
      setStatus({
        kind: "ok",
        text: `Aggiunti ${items.length} ${items.length === 1 ? "compito" : "compiti"} in Scuola con priorità e blocchi di studio stimati.`,
      });
    } catch {
      setStatus({
        kind: "error",
        text: "Non riesco a leggere l'immagine: il motore OCR locale (gratuito) si scarica al primo uso. Controlla la connessione e riprova.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="foto-compiti"
      aria-busy={busy}
      onDragOver={(event) => {
        event.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDrag(false);
        void onFiles(event.dataTransfer.files);
      }}
      className={`glass rounded-3xl border-2 border-dashed p-5 transition ${drag ? "border-primary bg-accent" : "border-input"}`}
    >
      <label className="flex cursor-pointer flex-col items-center gap-2 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 text-primary">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        </span>
        <span id="foto-compiti" className="font-display text-lg font-semibold">
          Invia foto compiti
        </span>
        <span className="max-w-xl text-sm text-muted-foreground">
          Trascina lo screenshot di Classroom o la foto della lavagna: leggo materia e scadenza, poi
          creo le task con priorità e blocchi di Time Boxing.
        </span>
        <span className="text-xs text-muted-foreground">
          OCR locale nel browser · PNG, JPG · nessuna immagine viene caricata online
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            void onFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {busy && (
          <span className="mt-2 w-full max-w-sm">
            <span className="mb-1 block text-xs text-primary" role="status">
              {stage === "loading"
                ? "Preparo il motore OCR (solo al primo uso)…"
                : `Leggo la foto… ${progress}%`}
            </span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${stage === "loading" ? Math.max(8, progress * 0.3) : progress}%`,
                }}
              />
            </span>
          </span>
        )}
      </label>

      {status && (
        <p
          role="status"
          className={`mt-3 text-center text-sm ${status.kind === "ok" ? "text-primary" : "text-destructive"}`}
        >
          {status.text}
        </p>
      )}

      {imported.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label="Compiti creati dalla foto">
          {imported.map((item, index) => {
            const draft = asTodo(item, index);
            return (
              <li key={`${item.title}-${index}`} className="rounded-2xl bg-muted/60 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium">{item.title}</span>
                  <span className="shrink-0 rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">
                    Priorità {priorityScore(draft, reg, Date.now())}/100
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.subject || "Scuola"} · {blocksOf(draft)} pomodori ({blocksOf(draft) * 25}{" "}
                  min) ·{" "}
                  {item.dueAt === null ? "senza scadenza" : `consegna ${shortDue(item.dueAt)}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
