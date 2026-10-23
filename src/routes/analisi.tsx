import { createFileRoute } from "@tanstack/react-router";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/AppShell";
import { CategorySwitcher } from "@/components/CategorySwitcher";
import { WeeklyReport } from "@/components/WeeklyReport";
import { inCategory, useStore } from "@/lib/store";

export const Route = createFileRoute("/analisi")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Analisi — Tide" },
      { name: "description", content: "Throughput e avanzamento per progetto del tuo lavoro." },
      { property: "og:title", content: "Analisi — Tide" },
      { property: "og:description", content: "Throughput e avanzamento per progetto del tuo lavoro." },
    ],
  }),
  component: Analisi,
});

const COLORS = ["var(--primary)", "var(--ring-2)", "var(--ring-3)", "var(--low)", "var(--high)", "var(--urgent)"];
const tip = { background: "var(--popover)", border: "1px solid var(--glass-border)", borderRadius: 12, color: "var(--foreground)" };

function Analisi() {
  const { state } = useStore();
  const tasks = inCategory(state.tasks, state.category);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    const end = d.getTime() + 86400000;
    return {
      giorno: d.toLocaleDateString("it-IT", { weekday: "short" }),
      completati: tasks.filter((t) => t.completedAt && t.completedAt >= d.getTime() && t.completedAt < end).length,
    };
  });
  const projects = [...new Set(tasks.map((t) => t.project))].map((p) => {
    const all = tasks.filter((t) => t.project === p);
    const done = all.filter((t) => t.status === "completato").length;
    return { name: p, value: done, pct: Math.round((done / all.length) * 100) };
  });
  const totalDone = tasks.filter((t) => t.status === "completato").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-3xl font-semibold">Analisi</h1>
      <CategorySwitcher />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Throughput" className="lg:col-span-3">
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={days}>
                <CartesianGrid stroke="var(--glass-border)" vertical={false} />
                <XAxis dataKey="giorno" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={tip} />
                <Line type="monotone" dataKey="completati" stroke="var(--primary)" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Per Progetto" className="lg:col-span-2">
          <div className="h-52">
            {totalDone === 0 ? (
              <p className="grid h-full place-items-center text-sm text-muted-foreground">Nessun task completato.</p>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={projects.filter((p) => p.value)} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3} stroke="none">
                    {projects.filter((p) => p.value).map((p) => <Cell key={p.name} fill={COLORS[projects.indexOf(p) % COLORS.length] ?? "var(--primary)"} />)}
                  </Pie>
                  <Tooltip contentStyle={tip} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <ul className="mt-3 space-y-1.5">
            {projects.map((p, i) => (
              <li key={p.name} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="flex-1">{p.name}</span>
                <span className="text-muted-foreground">{p.pct}% finiti</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <WeeklyReport />
    </div>
  );
}
