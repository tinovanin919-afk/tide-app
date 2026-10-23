import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { safeUrl, useNotebook } from "@/lib/study-notebook";

function Expand({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false); const reduced = useReducedMotion();
  return <div className="border-t border-input pt-2"><Button variant="ghost" className="h-auto w-full justify-between whitespace-normal text-left" aria-expanded={open} onClick={() => setOpen(!open)}>{title}<ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`} /></Button><AnimatePresence initial={false}>{open && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : 0.18 }} className="overflow-hidden"><div className="py-3">{children}</div></motion.div>}</AnimatePresence></div>;
}
export function QuickLinks() {
  const { data, setSchoolUrl } = useNotebook(); const [value, setValue] = useState(""); const [error, setError] = useState("");
  return <section className="space-y-3"><h2 className="font-display font-semibold">Collegamenti Rapidi</h2><div className="flex flex-wrap gap-2">
    <Button variant="secondary" asChild><a href="https://classroom.google.com/" target="_blank" rel="noopener noreferrer"><ExternalLink />Google Classroom</a></Button>
    {safeUrl(data.schoolUrl) && <Button variant="secondary" asChild><a href={safeUrl(data.schoolUrl) ?? ""} target="_blank" rel="noopener noreferrer"><ExternalLink />E-Learning del liceo</a></Button>}
  </div><form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); const url = safeUrl(value); if (!url) { setError("Inserisci un indirizzo http o https valido."); return; } setSchoolUrl(url); setValue(""); setError(""); }}><input type="url" required aria-label="Indirizzo E-Learning del liceo" placeholder={data.schoolUrl || "Indirizzo E-Learning del liceo"} value={value} onChange={e => setValue(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-input bg-muted px-3 py-2 text-sm" /><Button type="submit" variant="secondary">Salva collegamento</Button></form>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</section>;
}
export function SubjectNotebook({ subject }: { subject: string }) {
  const { data, setNote, addLink, removeLink } = useNotebook(); const [title, setTitle] = useState(""); const [url, setUrl] = useState(""); const [error, setError] = useState("");
  return <div className="mt-3 space-y-2">
    <Expand title="Diario di Bordo delle Interrogazioni"><textarea aria-label={`Diario di ${subject}`} value={data.notes[subject] ?? ""} onChange={e => setNote(subject, e.target.value)} rows={4} placeholder="Domande, osservazioni, prossimi passi…" className="w-full rounded-lg border border-input bg-muted p-3 text-sm" /></Expand>
    <Expand title="Caveau dei Link (Resource Hub)"><ul className="space-y-2">{(data.links[subject] ?? []).map(link => <li className="flex min-w-0 items-center gap-2" key={link.id}>{safeUrl(link.url) && <a className="min-w-0 flex-1 break-all text-sm text-primary underline" href={link.url} target="_blank" rel="noopener noreferrer">{link.title}</a>}<Button size="icon" variant="ghost" aria-label={`Elimina link ${link.title}`} onClick={() => removeLink(subject, link.id)}><Trash2 className="h-4 w-4" /></Button></li>)}</ul>
      <form className="mt-3 space-y-2" onSubmit={e => { e.preventDefault(); if (!addLink(subject, title, url)) { setError("Inserisci un indirizzo http o https valido."); return; } setTitle(""); setUrl(""); setError(""); }}><input aria-label={`Titolo link ${subject}`} value={title} onChange={e => setTitle(e.target.value)} placeholder="Titolo risorsa" className="w-full rounded-lg border border-input bg-muted px-3 py-2 text-sm" /><div className="flex gap-2"><input aria-label={`URL ${subject}`} type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" className="min-w-0 flex-1 rounded-lg border border-input bg-muted px-3 py-2 text-sm" /><Button aria-label={`Salva link ${subject}`}><Plus className="h-4 w-4" /></Button></div>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</form>
    </Expand>
  </div>;
}