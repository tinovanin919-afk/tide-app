import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  BarChart3,
  GraduationCap,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Settings,
  Timer,
  Waves,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { LocalReminders } from "@/components/LocalReminders";
import { fmt, remainingOf, useNow, useStore } from "@/lib/store";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/bacheca", label: "Bacheca", icon: KanbanSquare },
  { to: "/analisi", label: "Analisi", icon: BarChart3 },
  { to: "/inbox-ai", label: "Inbox AI", icon: Inbox },
  { to: "/voti", label: "Registro Voti", icon: GraduationCap },
  { to: "/impostazioni", label: "Impostazioni", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { state, dispatch } = useStore();
  const running = !!state.timer.endsAt;
  useNow(running);
  const rem = remainingOf(state.timer);
  useEffect(() => {
    if (running && rem === 0) dispatch({ type: "timerTick" });
  }, [running, rem, dispatch]);

  return (
    <div className="flex min-h-screen">
      <LocalReminders />
      <aside className="sticky top-0 m-3 flex h-[calc(100vh-1.5rem)] w-16 shrink-0 flex-col items-center gap-1 rounded-2xl border border-glass-border bg-glass py-5 shadow-[var(--shadow-accent)] backdrop-blur-md md:w-56 md:items-stretch md:px-3">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Waves className="h-5 w-5" />
          </div>
          <span className="hidden font-display text-lg font-semibold md:inline">Tide</span>
        </div>
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: true }}
            className="group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors duration-200 hover:bg-accent/60 hover:text-foreground"
            activeProps={{ className: "bg-accent/80 !text-foreground" }}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="sidebar-indicator"
                    className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-primary shadow-[0_0_12px_var(--primary)]"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <Icon
                  strokeWidth={1.5}
                  className="h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110"
                />
                <span className="hidden font-medium tracking-tight md:inline">{label}</span>
              </>
            )}
          </Link>
        ))}
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      {running && (
        <div className="glass fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full px-4 py-2 shadow-2xl md:bottom-auto md:right-6 md:top-6 animate-in fade-in motion-reduce:animate-none">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          <Timer className="h-4 w-4 text-primary" />
          <span className="font-display font-semibold tabular-nums">{fmt(rem)}</span>
        </div>
      )}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass rounded-3xl p-5 ${className}`}>
      {title && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
