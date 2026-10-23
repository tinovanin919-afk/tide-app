import { createFileRoute } from "@tanstack/react-router";
import { Bell, Check, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "@/components/AppShell";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useImportSettings } from "@/lib/grade-import";
import { ACCENTS, WALLPAPERS, useStore } from "@/lib/store";

export const Route = createFileRoute("/impostazioni")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Impostazioni — Tide" },
      { name: "description", content: "Personalizza sfondo e colore di accento del tuo cruscotto." },
      { property: "og:title", content: "Impostazioni — Tide" },
      { property: "og:description", content: "Personalizza sfondo e colore di accento del tuo cruscotto." },
    ],
  }),
  component: Impostazioni,
});

function Impostazioni() {
  const { state, dispatch } = useStore();
  const { settings, update } = useImportSettings();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const sync = () => setPermission("Notification" in window ? Notification.permission : "unsupported");
    sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);

  const toggleNotifications = async (enabled: boolean) => {
    setNotice("");
    if (!enabled) { dispatch({ type: "setNotifications", value: false }); return; }
    if (!("Notification" in window) || !window.isSecureContext) {
      setNotice("Le notifiche non sono disponibili in questo browser."); return;
    }
    if (window.self !== window.top) {
      setNotice("Apri Tide in una scheda separata per autorizzare le notifiche."); return;
    }
    if (Notification.permission === "denied") {
      setNotice("Notifiche bloccate: consenti le notifiche per Tide nelle impostazioni del browser."); return;
    }
    setPending(true);
    try {
      const result = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      setPermission(result);
      dispatch({ type: "setNotifications", value: result === "granted" });
      if (result !== "granted") setNotice(result === "denied" ? "Permesso negato. Puoi cambiarlo nelle impostazioni del browser." : "Permesso non concesso: le notifiche restano disattivate.");
    } catch { setNotice("Il browser non ha consentito la richiesta. Apri Tide in una scheda separata e riprova."); }
    finally { setPending(false); }
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-3xl font-semibold">Impostazioni</h1>
      <Card title="Notifiche">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="system-notifications" className="flex items-center gap-3 text-sm font-medium"><Bell className="h-5 w-5 shrink-0 text-primary" />Attiva Notifiche di Sistema</label>
          <Switch id="system-notifications" checked={state.notificationsEnabled && permission === "granted"} disabled={pending || permission === "unsupported"} onCheckedChange={toggleNotifications} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{permission === "unsupported" ? "Questo browser non supporta le notifiche di sistema." : state.notificationsEnabled && permission === "granted" ? "Notifiche attive per gli impegni e i compiti con scadenza." : "Notifiche disattivate."}</p>
        <p className="mt-2 text-xs text-muted-foreground">Tide deve restare aperto, anche ridotto a icona. A Mac in stop o app chiusa, i promemoria non sono garantiti; il browser può ritardarli. I banner dipendono anche dalle impostazioni macOS e da Non disturbare.</p>
        {notice && <p role="status" className="mt-3 text-sm text-medium">{notice}</p>}
      </Card>
      <Card title="Sfondo">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {WALLPAPERS.map((w) => (
            <button key={w} onClick={() => dispatch({ type: "setWallpaper", value: w })} className="group text-left">
              <div data-wallpaper={w} style={{ background: "var(--wallpaper)" }}
                className={`relative aspect-square rounded-2xl border-2 transition group-hover:scale-105 ${state.wallpaper === w ? "border-primary" : "border-glass-border"}`}>
                {state.wallpaper === w && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />}
              </div>
              <div className="mt-1.5 text-sm capitalize">{w}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Registro Voti · Import">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted-foreground">
            Gli screenshot vengono proposti, mai salvati da soli. L'OCR resta locale nel browser.
          </p>
        </div>
        <div className="mt-4 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <label htmlFor="always-review" className="space-y-1 text-sm font-medium">
              Mostra sempre la revisione prima di salvare voti
              <span className="block text-xs font-normal text-muted-foreground">
                Consigliato: ogni proposta aspetta la tua approvazione.
              </span>
            </label>
            <Switch
              id="always-review"
              checked={settings.alwaysReview}
              onCheckedChange={(value) => update({ alwaysReview: value })}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <label htmlFor="auto-approve" className="space-y-1 text-sm font-medium">
              Auto-approva i voti sopra la soglia
              <span className="block text-xs font-normal text-muted-foreground">
                {settings.alwaysReview
                  ? "Disattiva la revisione obbligatoria per usare l'auto-approvazione."
                  : "Solo righe senza doppioni e con tutti i campi validi."}
              </span>
            </label>
            <Switch
              id="auto-approve"
              checked={settings.autoApprove}
              disabled={settings.alwaysReview}
              onCheckedChange={(value) => update({ autoApprove: value })}
            />
          </div>
          <div className={settings.alwaysReview || !settings.autoApprove ? "opacity-60" : ""}>
            <div className="flex items-center justify-between text-sm">
              <span id="soglia-import" className="font-medium">
                Soglia di confidenza
              </span>
              <span className="font-display font-semibold text-primary">{settings.threshold}%</span>
            </div>
            <Slider
              aria-labelledby="soglia-import"
              className="mt-3"
              min={70}
              max={99}
              step={1}
              value={[settings.threshold]}
              disabled={settings.alwaysReview || !settings.autoApprove}
              onValueChange={(values) => {
                const value = values[0];
                if (value !== undefined) update({ threshold: value });
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Default 90%. Le proposte con confidenza inferiore restano in revisione.
            </p>
          </div>
        </div>
      </Card>
      <Card title="Accento">
        <div className="flex flex-wrap gap-4">
          {ACCENTS.map((a) => (
            <button key={a} onClick={() => dispatch({ type: "setAccent", value: a })} className="flex flex-col items-center gap-1.5">
              <span data-accent={a} style={{ background: "var(--primary)" }}
                className={`grid h-11 w-11 place-items-center rounded-full ring-offset-2 ring-offset-background transition hover:scale-110 ${state.accent === a ? "ring-2 ring-foreground" : ""}`}>
                {state.accent === a && <Check className="h-5 w-5 text-primary-foreground" />}
              </span>
              <span className="text-xs capitalize text-muted-foreground">{a}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
