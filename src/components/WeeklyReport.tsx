import { useState } from "react";
import { Download } from "lucide-react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { useStore, useNow } from "@/lib/store";
import { useRegistro } from "@/lib/grades";
import { useNotebook } from "@/lib/study-notebook";
import { weeklyReport } from "@/lib/study-engine";

export function WeeklyReport() {
  const { state } = useStore(); const { reg } = useRegistro(); const { data } = useNotebook(); const [exporting, setExporting] = useState(false); const [error, setError] = useState(""); useNow(true);
  const now = Date.now(); const report = weeklyReport(state, reg, data.habits, now);
  const date = new Date(now); const highlight = date.getDay() === 0 && date.getHours() >= 18;
  const points = report.roi.filter(r => r.grade !== null && r.hours > 0);
  const advice = report.roi.filter(r => r.hours >= 4 && r.grade !== null && r.grade < 6);
  const label = `${new Date(report.start).toLocaleDateString("it-IT")} – ${new Date(report.end - 1).toLocaleDateString("it-IT")}`;
  async function download() {
    setExporting(true); setError("");
    try {
      const { jsPDF } = await import("jspdf"); const pdf = new jsPDF();
      pdf.setFontSize(24); pdf.text("Tide | Report settimanale", 18, 24);
      pdf.setFontSize(12); pdf.text(`Martino | ${label}`, 18, 35);
      let y = 50;
      const write = (text: string) => { const lines = pdf.splitTextToSize(text, 172) as string[]; if (y + lines.length * 6 > 278) { pdf.addPage(); y = 22; } pdf.text(lines, 18, y); y += lines.length * 6 + 5; };
      write(`Focus: ${(report.seconds / 3600).toFixed(2)} ore | Pomodori: ${report.blocks} | Abitudini: ${report.habitCount}`);
      write(`Materie trascurate: ${report.neglected.join(", ") || "Nessuna"}`);
      write("ROI dello studio | Ore registrate e voti della settimana");
      report.roi.forEach(r => write(`${r.name}: ${r.hours} ore | voto medio settimanale: ${r.grade === null ? "non disponibile" : r.grade.toFixed(2)}`));
      advice.forEach(r => write(`${r.name}: prova piu esercizi e meno rilettura della teoria.`));
      write("Confronto descrittivo: le ore e i voti non dimostrano un rapporto di causa-effetto. Il focus precedente all'attivazione dello storico non e attribuibile a questa settimana.");
      pdf.save(`Tide-report-${new Date(report.start).toISOString().slice(0, 10)}.pdf`);
    } catch { setError("Esportazione non riuscita. Riprova."); } finally { setExporting(false); }
  }
  return <section className={`space-y-5 border-t border-input pt-6 ${highlight ? "border-primary" : ""}`}>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-display text-xl font-semibold">Performance, Sforzo & ROI</h2><p className="text-sm text-muted-foreground">{label}{highlight ? " · Riepilogo della domenica" : ""}</p></div><Button onClick={download} disabled={exporting}><Download className="h-4 w-4" />{exporting ? "Esportazione…" : "Esporta PDF"}</Button></header>
    <div className="grid grid-cols-3 gap-3">{[{ label: "Ore di Focus", value: (report.seconds / 3600).toLocaleString("it-IT", { maximumFractionDigits: 2 }), cls: "text-primary" }, { label: "Pomodori", value: report.blocks, cls: "text-ring-2" }, { label: "Abitudini fatte", value: report.habitCount, cls: "text-low" }].map(m => <div key={m.label} className="border-l-2 border-input pl-3"><div className={`font-display text-2xl font-semibold ${m.cls}`}>{m.value}</div><div className="text-xs text-muted-foreground">{m.label}</div></div>)}</div>
    <p className="text-sm"><span className="text-muted-foreground">Materie trascurate: </span>{report.neglected.join(", ") || "Nessuna"}</p>
    <div className="h-64 w-full min-w-0">{points.length === 0 ? <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">Nessuna materia con ore di studio e voti registrati questa settimana.</div> : <ResponsiveContainer><ScatterChart margin={{ bottom: 25, left: 0, right: 15 }}><CartesianGrid stroke="var(--glass-border)" /><XAxis type="number" dataKey="hours" name="Ore di studio" stroke="var(--muted-foreground)" label={{ value: "Ore di studio", position: "insideBottom", offset: -15, fill: "var(--muted-foreground)" }} /><YAxis type="number" dataKey="grade" domain={[1, 10]} name="Voto medio" stroke="var(--muted-foreground)" /><ZAxis dataKey="name" name="Materia" /><Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "var(--popover)", borderColor: "var(--glass-border)", color: "var(--foreground)" }} /><Scatter data={points} fill="var(--ring-2)" /></ScatterChart></ResponsiveContainer>}</div>
    {advice.map(r => <p key={r.name} className="text-sm border-l-2 border-medium pl-3">{r.name}: {r.hours} ore di studio, voto medio {r.grade}. Prova più esercizi anziché rileggere la teoria.</p>)}
    <p className="text-xs text-muted-foreground">Confronto descrittivo, non causale · storico dal primo utilizzo del time boxing · focus precedente non attribuito alla settimana</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}