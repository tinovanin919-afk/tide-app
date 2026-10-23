import { useEffect, useRef } from "react";
import { dueReminders } from "@/lib/reminders";
import { useStore } from "@/lib/store";

export function LocalReminders() {
  const { state, ready } = useStore();
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!ready || !state.notificationsEnabled || !("Notification" in window)) return;
    let disposed = false;
    const check = () => {
      if (disposed || Notification.permission !== "granted" || !latest.current.notificationsEnabled) return;
      const send = () => {
        if (disposed) return;
        let sent = 0;
        for (const reminder of dueReminders(latest.current, Date.now())) {
          if (sent >= 3) break;
          const key = `tide-reminder-v1:${reminder.key}`;
          try {
            if (localStorage.getItem(key)) continue;
            // Shared storage and a browser lock prevent duplicates across tabs.
            localStorage.setItem(key, "sent");
            try {
              const notification = new Notification(`Tide · ${reminder.category === "vita" ? "Vita Quotidiana" : "Scuola"}`, {
                body: reminder.title, tag: reminder.key,
              });
              sent += 1;
              notification.onclick = () => { window.focus(); notification.close(); };
            } catch { localStorage.removeItem(key); }
          } catch { return; }
        }
      };
      if (navigator.locks) void navigator.locks.request("tide-local-reminders", send).catch(() => {});
      else send();
    };
    check();
    const interval = window.setInterval(check, 30000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [ready, state.notificationsEnabled]);
  return null;
}