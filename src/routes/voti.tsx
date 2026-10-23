import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/AppShell";
import { GradeImportReview, ImportHistory } from "@/components/GradeImportReview";
import { Button } from "@/components/ui/button";
import { QuickLinks, SubjectNotebook } from "@/components/SubjectNotebook";
import {
  autoApprovable,
  lastUndoableImport,
  loadImportLog,
  markDuplicates,
  markImportUndone,
  newBatchId,
  proposalsFromVoti,
  toPendingGrades,
  toVoto,
  upsertImportLog,
  useImportSettings,
  type ImportLogEntry,
  type ImportSource,
  type ReviewBatch,
} from "@/lib/grade-import";
import {
  TIPI,
  media,
  parseVoto,
  readNuvolaFileDetailed,
  useRegistro,
  votoSalvezza,
  type Tipo,
} from "@/lib/grades";
import { imageToDocument, isImageFile, makeThumbnail, parseVotiGrades } from "@/lib/vision";

export const Route = createFileRoute("/voti")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Registro Voti — Tide" },
      {
        name: "description",
        content: "Voti per materia, media e voto salvezza per raggiungere il tuo obiettivo.",
      },
      { property: "og:title", content: "Registro Voti — Tide" },
      {
        property: "og:description",
        content: "Voti per materia, media e voto salvezza per raggiungere il tuo obiettivo.",
      },
    ],
  }),
  component: RegistroVoti,
});

const field =
  "rounded-xl border border-input bg-muted px-3 py-2 text-sm outline-none focus:border-primary";
const f1 = (n: number) => n.toLocaleString("it-IT", { maximumFractionDigits: 2 });
// Le date sono salvate come "AAAA-MM-GG": formattarle senza passare da UTC evita il giorno sbagliato.
const dataIt = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

function RegistroVoti() {
  const {
    reg,
    addMateria,
    removeMateria,
    addVoto,
    addVoti,
    removeVoto,
    removeVotiByIds,
    setObiettivo,
  } = useRegistro();
  const { settings } = useImportSettings();
  const [nuovaMateria, setNuovaMateria] = useState("");
  const [form, setForm] = useState({
    materia: "",
    valore: "",
    data: new Date().toISOString().slice(0, 10),
    tipo: "Scritto" as Tipo,
  });
  const [drag, setDrag] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"loading" | "recognizing">("loading");
  const [progress, setProgress] = useState(0);
  const [review, setReview] = useState<ReviewBatch | null>(null);
  const [log, setLog] = useState<ImportLogEntry[]>([]);
  const conPeso = reg.voti.some((v) => v.peso !== undefined);

  useEffect(() => setLog(loadImportLog()), []);

  const all = media(reg.voti);
  const r = 46,
    c = 2 * Math.PI * r;
  const p = all ? Math.min(1, all / 10) : 0;
  const ok = all !== null && all >= reg.obiettivo;
  const undoable = lastUndoableImport(log);

  /**
   * Apre la revisione. L'auto-approvazione scatta solo se l'utente ha attivato
   * entrambe le preferenze e solo per le righe sopra la soglia; tutto il resto
   * resta in attesa di conferma.
   */
  function openReview(batch: ReviewBatch) {
    const auto = autoApprovable(batch.proposals, settings);
    if (auto.length === 0) {
      setReview(batch);
      setMsg(
        batch.source === "csv"
          ? "File letto: controlla le proposte e approva solo i voti giusti."
          : "Screenshot letto: controlla le proposte e approva solo i voti giusti.",
      );
      return;
    }
    const autoIds = new Set(auto.map((proposal) => proposal.id));
    const voti = auto.map(toVoto).filter((voto): voto is NonNullable<typeof voto> => voto !== null);
    const voteIds = addVoti(voti);
    const approved: Record<string, string> = {};
    auto.forEach((proposal, index) => {
      const voteId = voteIds[index];
      if (voteId) approved[proposal.id] = voteId;
    });
    setReview({
      ...batch,
      proposals: batch.proposals.map((proposal) =>
        autoIds.has(proposal.id) ? { ...proposal, status: "approved" } : proposal,
      ),
      autoApproved: approved,
    });
    setLog(
      upsertImportLog({
        batchId: batch.batchId,
        at: batch.createdAt,
        source: batch.source,
        approved: voteIds.length,
        rejected: 0,
        voteIds,
      }),
    );
    setMsg(
      `Approvati automaticamente ${voteIds.length} ${voteIds.length === 1 ? "voto" : "voti"} sopra il ${settings.threshold}%: le altre proposte sono da rivedere.`,
    );
  }

  async function onFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || busy) return;
    setMsg("");
    if (isImageFile(file)) {
      setBusy(true);
      setStage("loading");
      setProgress(0);
      try {
        const document = await imageToDocument(file, (update) => {
          setStage(update.stage);
          setProgress(update.progress);
        });
        const grades = parseVotiGrades(document, { knownSubjects: reg.materie });
        if (!grades.length) {
          setMsg(
            "Nessun voto riconosciuto nello screenshot: inquadra la tabella con Materia, Voto e Data.",
          );
          return;
        }
        const batchId = newBatchId();
        const thumbnail = await makeThumbnail(file);
        const proposals = markDuplicates(toPendingGrades(grades, batchId, thumbnail), reg.voti);
        openReview({
          batchId,
          source: "screenshot",
          fileName: file.name,
          createdAt: Date.now(),
          proposals,
          ...(thumbnail ? { thumbnail } : {}),
        });
      } catch {
        setMsg(
          "OCR non riuscito: il motore locale si scarica al primo uso. Controlla la connessione e riprova.",
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const { voti, hasDate } = await readNuvolaFileDetailed(file);
      if (!voti.length)
        return setMsg(
          "Nessun voto valido trovato: servono le colonne Materia e Voto con valori da 1 a 10.",
        );
      const batchId = newBatchId();
      openReview({
        batchId,
        source: "csv",
        fileName: file.name,
        createdAt: Date.now(),
        proposals: markDuplicates(
          proposalsFromVoti(voti, batchId, undefined, { dateKnown: hasDate }),
          reg.voti,
        ),
      });
    } catch {
      setMsg("Impossibile leggere il file. Usa un CSV o un Excel .xlsx.");
    }
  }

  /** Lo storico si aggiorna a ogni decisione presa nella revisione. */
  const handleProgress = useCallback(
    (batchId: string, source: ImportSource, approvedIds: string[], rejected: number) => {
      const previous = loadImportLog().find((entry) => entry.batchId === batchId);
      // Un batch già annullato non torna in vita quando la revisione svuota le righe.
      if (previous?.undone && approvedIds.length === 0) return;
      if (!previous && approvedIds.length === 0 && rejected === 0) return;
      const entry: ImportLogEntry = {
        batchId,
        at: previous?.at ?? Date.now(),
        source,
        approved: approvedIds.length,
        rejected,
        voteIds: approvedIds,
      };
      setLog(upsertImportLog(entry));
    },
    [],
  );

  const undoBatch = useCallback(
    (batchId: string) => {
      const entry = loadImportLog().find((item) => item.batchId === batchId);
      if (!entry || entry.undone || entry.voteIds.length === 0) return null;
      removeVotiByIds(entry.voteIds);
      setLog(markImportUndone(batchId));
      setMsg(
        `Annullato l'import: rimossi ${entry.voteIds.length} ${entry.voteIds.length === 1 ? "voto" : "voti"}.`,
      );
      return entry;
    },
    [removeVotiByIds],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Registro Voti</h1>
        <p className="mt-1 text-muted-foreground">
          Le tue medie e il voto salvezza per ogni materia, Martino.
        </p>
      </header>
      <QuickLinks />

      <Card title="Voto salvezza">
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <div className="relative mx-auto h-36 w-36 shrink-0">
            <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90">
              <circle
                cx="55"
                cy="55"
                r={r}
                fill="none"
                strokeWidth="10"
                stroke="currentColor"
                className="text-muted"
              />
              <circle
                cx="55"
                cy="55"
                r={r}
                fill="none"
                strokeWidth="10"
                strokeLinecap="round"
                stroke="currentColor"
                className={ok ? "text-primary" : "text-ring-3"}
                strokeDasharray={c}
                strokeDashoffset={c * (1 - p)}
                style={{ transition: "stroke-dashoffset .7s ease" }}
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="font-display text-3xl font-semibold text-primary">
                  {all ? f1(all) : "—"}
                </div>
                <div className="text-xs text-muted-foreground">media generale</div>
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Obiettivo:</span>
              {[6, 7, 8].map((o) => (
                <Button
                  key={o}
                  size="sm"
                  variant={reg.obiettivo === o ? "default" : "secondary"}
                  className="rounded-full"
                  onClick={() => setObiettivo(o)}
                >
                  {o}
                </Button>
              ))}
            </div>
            {reg.materie.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Aggiungi una materia per vedere il tuo voto salvezza.
              </p>
            )}
            <ul className="grid gap-2 sm:grid-cols-2">
              {reg.materie.map((m) => {
                const vs = reg.voti.filter((v) => v.materia === m);
                const avg = media(vs);
                const s = votoSalvezza(vs, reg.obiettivo);
                return (
                  <li key={m} className="rounded-2xl bg-muted/60 p-3 text-sm">
                    <div className="flex justify-between font-medium">
                      <span>{m}</span>
                      <span className="text-primary">{avg ? f1(avg) : "—"}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${avg && avg >= reg.obiettivo ? "bg-primary" : "bg-ring-3"}`}
                        style={{ width: `${((avg ?? 0) / 10) * 100}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {!s.raggiungibile
                        ? `Per il ${reg.obiettivo} serve più di una verifica: anche un 10 non basta subito.`
                        : avg !== null && avg >= reg.obiettivo
                          ? `Per restare sopra il ${reg.obiettivo} ti basta almeno ${f1(s.voto)}.`
                          : `Per raggiungere il ${reg.obiettivo}, alla prossima verifica devi prendere almeno ${f1(s.voto)}.`}
                    </p>
                    <SubjectNotebook subject={m} />
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Card>

      <section aria-labelledby="import-voti" className="glass rounded-3xl p-5">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 id="import-voti" className="text-base font-semibold">
              Importa voti con revisione
            </h2>
            <p className="text-sm text-muted-foreground">
              Nessun voto viene salvato senza la tua conferma: prima vedi le proposte, poi approvi.
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <p className="rounded-2xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs">
            <span className="font-semibold text-primary">Consigliato:</span> esporta CSV/Excel da
            Nuvola
            <span className="mt-0.5 block text-muted-foreground">
              Colonne lette senza interpretazione visiva.
            </span>
          </p>
          <p className="rounded-2xl border border-glass-border bg-muted/40 px-3 py-2 text-xs">
            <span className="font-semibold">Alternativa:</span> screenshot del registro
            <span className="mt-0.5 block text-muted-foreground">
              OCR locale nel browser, poi revisione delle confidenze.
            </span>
          </p>
        </div>
        <label
          aria-busy={busy}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void onFiles(e.dataTransfer.files);
          }}
          className={`mt-3 flex cursor-pointer flex-col items-center gap-2 rounded-3xl border-2 border-dashed p-8 text-center transition ${drag ? "border-primary bg-accent" : "border-input"}`}
        >
          {busy ? (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          ) : (
            <Upload className="h-6 w-6 text-primary" />
          )}
          <span className="font-medium">
            Trascina il CSV/Excel di Nuvola o uno screenshot del registro
          </span>
          <span className="text-xs text-muted-foreground">
            CSV, Excel o immagine PNG/JPG · Materia, Voto, Data, Tipo, Peso · oppure clicca per
            scegliere il file
          </span>
          <span className="text-xs text-muted-foreground">
            L'OCR gira nel browser: nessuna immagine viene caricata online.
          </span>
          <input
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,.xlsm,image/png,image/jpeg,image/webp"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              void onFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {busy && (
            <span className="mt-2 w-full max-w-sm">
              <span className="mb-1 block text-xs text-primary" role="status">
                {stage === "loading"
                  ? "Preparo il motore OCR (solo al primo uso)…"
                  : `Leggo lo screenshot… ${progress}%`}
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
          {msg && (
            <span className="text-sm text-primary" role="status">
              {msg}
            </span>
          )}
        </label>
      </section>

      <ImportHistory
        entries={log}
        onUndo={(batchId) => {
          undoBatch(batchId);
        }}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Materie">
          <form
            className="mb-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (nuovaMateria.trim()) {
                addMateria(nuovaMateria);
                setNuovaMateria("");
              }
            }}
          >
            <input
              value={nuovaMateria}
              onChange={(e) => setNuovaMateria(e.target.value)}
              placeholder="Es. Matematica"
              aria-label="Nuova materia"
              className={`${field} min-w-0 flex-1`}
            />
            <Button aria-label="Aggiungi materia">
              <Plus className="h-4 w-4" />
            </Button>
          </form>
          <ul className="space-y-1">
            {reg.materie.map((m) => (
              <li
                key={m}
                className="group flex items-center justify-between rounded-xl px-2 py-1.5 text-sm hover:bg-accent"
              >
                {m}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Elimina ${m}`}
                  onClick={() => confirm(`Eliminare ${m} e i suoi voti?`) && removeMateria(m)}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Voti" className="lg:col-span-2">
          <form
            className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              const v = parseVoto(form.valore);
              if (!form.materia || v === null) return;
              addVoto({ materia: form.materia, valore: v, data: form.data, tipo: form.tipo });
              setForm({ ...form, valore: "" });
            }}
          >
            <select
              required
              aria-label="Materia"
              value={form.materia}
              onChange={(e) => setForm({ ...form, materia: e.target.value })}
              className={field}
            >
              <option value="">Materia…</option>
              {reg.materie.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              required
              inputMode="decimal"
              aria-label="Voto"
              placeholder="Voto (1–10)"
              value={form.valore}
              onChange={(e) => setForm({ ...form, valore: e.target.value })}
              className={field}
            />
            <input
              type="date"
              aria-label="Data"
              value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
              className={`${field} [color-scheme:dark]`}
            />
            <select
              aria-label="Tipologia"
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value as Tipo })}
              className={field}
            >
              {TIPI.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <Button type="submit" className="col-span-2 md:col-span-1">
              Aggiungi voto
            </Button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Data</th>
                  <th className="p-2">Materia</th>
                  <th className="p-2">Tipo</th>
                  {conPeso && <th className="p-2">Peso</th>}
                  <th className="p-2 text-right">Voto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reg.voti.length === 0 && (
                  <tr>
                    <td colSpan={conPeso ? 6 : 5} className="p-4 text-muted-foreground">
                      Nessun voto registrato.
                    </td>
                  </tr>
                )}
                {[...reg.voti]
                  .sort((a, b) => b.data.localeCompare(a.data))
                  .map((v) => (
                    <tr key={v.id} className="border-t border-input">
                      <td className="p-2">{dataIt(v.data)}</td>
                      <td className="p-2">
                        {v.materia}
                        {v.nota && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {v.nota}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-muted-foreground">{v.tipo}</td>
                      {conPeso && (
                        <td className="p-2 text-muted-foreground">
                          {v.peso === undefined ? "—" : f1(v.peso)}
                        </td>
                      )}
                      <td
                        className={`p-2 text-right font-semibold ${v.valore < 6 ? "text-destructive" : "text-primary"}`}
                      >
                        {f1(v.valore)}
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Elimina voto"
                          onClick={() => removeVoto(v.id)}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <GradeImportReview
        batch={review}
        subjects={reg.materie}
        onSave={addVoti}
        onRemove={removeVotiByIds}
        onProgress={handleProgress}
        onUndoLast={() => (undoable ? undoBatch(undoable.batchId) : null)}
        undoable={undoable}
        onClose={() => setReview(null)}
      />
    </div>
  );
}
