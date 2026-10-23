import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Zap } from "lucide-react";
import { useState } from "react";
import { type Flashcard, useReviewedCards } from "@/lib/flashcards";

/** Micro-icona a fulmine che apre e chiude il mazzo di flashcard della card. */
export function FlashcardToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? "Chiudi" : "Apri"} le flashcard di ${label}`}
      title="Flashcard"
      className={`grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        open
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-primary"
      }`}
    >
      <Zap className={`h-3.5 w-3.5 ${open ? "fill-current" : ""}`} />
    </button>
  );
}

function FlashcardCard({
  card,
  index,
  reduceMotion,
  reviewed,
  onFlip,
}: {
  card: Flashcard;
  index: number;
  reduceMotion: boolean | null;
  reviewed: boolean;
  onFlip: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const flip = () => {
    if (!flipped) onFlip();
    setFlipped(!flipped);
  };
  const face =
    "absolute inset-0 flex flex-col justify-between overflow-hidden rounded-2xl border p-3 @md:p-4";
  const corner =
    "text-[9px] font-medium uppercase tracking-[0.12em] @md:text-[10px] @md:tracking-[0.14em]";

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: reduceMotion ? 0 : 0.07 * index,
        duration: 0.35,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="[perspective:1000px]"
    >
      <motion.button
        type="button"
        onClick={flip}
        aria-pressed={flipped}
        aria-label={`Flashcard ${index + 1}: ${flipped ? "mostra la domanda" : "mostra la risposta"}`}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative block h-40 w-full cursor-pointer rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-primary [transform-style:preserve-3d]"
      >
        <span
          aria-hidden={flipped}
          className={`${face} border-glass-border bg-popover [backface-visibility:hidden]`}
        >
          <span className={`${corner} flex items-center gap-1.5 text-primary`}>
            <Zap className="h-3 w-3" /> Domanda {index + 1}
            {reviewed && (
              <span
                role="img"
                aria-label="Già ripassata"
                title="Già ripassata"
                className="ml-auto flex shrink-0 items-center"
              >
                <Check className="h-3 w-3 text-primary" />
              </span>
            )}
          </span>
          <span className="line-clamp-4 text-xs font-medium leading-snug @md:text-sm">
            {card.question}
          </span>
          <span className="text-[9px] text-muted-foreground @md:text-[10px]">Tocca per girare</span>
        </span>
        <span
          aria-hidden={!flipped}
          className={`${face} border-primary/40 bg-primary/10 [backface-visibility:hidden] [transform:rotateY(180deg)]`}
        >
          <span className={`${corner} flex items-center gap-1.5 text-primary`}>
            <Zap className="h-3 w-3" /> Risposta {index + 1}
          </span>
          <span className="line-clamp-4 text-xs leading-snug text-primary @md:text-sm">
            {card.answer}
          </span>
          <span className="text-[9px] text-muted-foreground @md:text-[10px]">
            Tocca per tornare
          </span>
        </span>
      </motion.button>
    </motion.div>
  );
}

/** Mazzo che si espande sotto la card del compito con 3 flashcard girevoli in 3D. */
export function Flashcards({
  open,
  cards,
  taskId,
}: {
  open: boolean;
  cards: Flashcard[];
  taskId: string;
}) {
  const reduceMotion = useReducedMotion();
  const { reviewed, markReviewed } = useReviewedCards(taskId);
  const done = cards.filter((card) => reviewed.includes(card.id)).length;
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="flashcards"
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="cursor-default pt-3 @container">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                <Zap className="h-3 w-3" /> Area Ripasso
              </span>
              <span className="text-[10px] text-muted-foreground">
                Ripassate {done}/{cards.length} · tocca una carta per girarla
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 @md:gap-3">
              {cards.map((card, i) => (
                <FlashcardCard
                  key={card.id}
                  card={card}
                  index={i}
                  reduceMotion={reduceMotion}
                  reviewed={reviewed.includes(card.id)}
                  onFlip={() => markReviewed(card.id)}
                />
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
