// Flashcard derivate dai compiti: logica pura, nessun dato da configurare.
import { useCallback, useEffect, useState } from "react";

export type Flashcard = { id: string; question: string; answer: string };

type Source = {
  /** Titolo del compito, es. "Fisica: formule leve". */
  title: string;
  /** Materia/progetto della card (Bacheca), se presente. */
  subject?: string | undefined;
  /** Scadenza in millisecondi, se il compito ne ha una. */
  dueAt?: number | undefined;
};

const quando = (ts: number) =>
  new Date(ts).toLocaleString("it-IT", { dateStyle: "long", timeStyle: "short" });

/** "Fisica: formule leve" → { materia: "Fisica", argomento: "formule leve" }. */
export function splitTitle(title: string): { subject?: string | undefined; topic: string } {
  const clean = title.trim();
  const match = clean.match(/^(.{2,40}?)\s*(?::|–|—|\s-\s)\s*(.+)$/);
  if (!match) return { topic: clean };
  const subject = match[1]!.trim();
  const topic = match[2]!.trim();
  return { subject: subject || undefined, topic: topic || clean };
}

/**
 * Tre domande chiave sul compito: titolo/materia per costruirle, scadenza per chiudere.
 * Funzionano subito anche sui compiti già esistenti.
 */
export const FLASHCARDS_KEY = "tide-flashcards-v1";
type Progress = Record<string, string[]>;

function readProgress(): Progress {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FLASHCARDS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Progress = {};
    for (const [taskId, cards] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(cards))
        out[taskId] = cards.filter((id): id is string => typeof id === "string");
    }
    return out;
  } catch {
    return {};
  }
}

/** Carte già girate almeno una volta, per compito: sopravvivono al riavvio dell'app. */
export function useReviewedCards(taskId: string) {
  const [reviewed, setReviewed] = useState<string[]>([]);
  useEffect(() => {
    setReviewed(readProgress()[taskId] ?? []);
  }, [taskId]);
  const markReviewed = useCallback(
    (cardId: string) => {
      const all = readProgress();
      const current = all[taskId] ?? [];
      if (current.includes(cardId)) return;
      const next = [...current, cardId];
      all[taskId] = next;
      try {
        localStorage.setItem(FLASHCARDS_KEY, JSON.stringify(all));
      } catch {
        /* spazio pieno: il ripasso resta valido per la sessione */
      }
      setReviewed(next);
    },
    [taskId],
  );
  return { reviewed, markReviewed };
}

export function buildFlashcards({ title, subject, dueAt }: Source): Flashcard[] {
  const parsed = splitTitle(title);
  const materia = subject?.trim() || parsed.subject;
  const argomento = parsed.subject ? parsed.topic : title.trim();

  return [
    {
      id: "argomento",
      question: materia ? `Qual è l'argomento chiave di ${materia}?` : "Qual è l'argomento chiave?",
      answer: argomento,
    },
    {
      id: "materia",
      question: "In quale materia lo stai preparando?",
      answer: materia ?? "Scuola",
    },
    {
      id: "scadenza",
      question: "Entro quando devi averlo pronto?",
      answer: dueAt ? quando(dueAt) : "Nessuna scadenza fissata.",
    },
  ];
}
