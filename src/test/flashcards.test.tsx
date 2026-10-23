import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { Flashcards, FlashcardToggle } from "@/components/Flashcards";
import { buildFlashcards, splitTitle } from "@/lib/flashcards";

describe("Flashcard", () => {
  beforeEach(() => localStorage.clear());

  it("ricava materia e argomento dal titolo del compito", () => {
    expect(splitTitle("Fisica: formule leve")).toEqual({
      subject: "Fisica",
      topic: "formule leve",
    });
    expect(splitTitle("Leggi il capitolo 4")).toEqual({ topic: "Leggi il capitolo 4" });
    expect(splitTitle("Analisi 1-2")).toEqual({ topic: "Analisi 1-2" });
  });

  it("costruisce tre domande chiave a partire dal titolo", () => {
    const study = buildFlashcards({ title: "Fisica: formule leve" });
    expect(study).toHaveLength(3);
    expect(study.map((c) => c.question)).toEqual([
      "Qual è l'argomento chiave di Fisica?",
      "In quale materia lo stai preparando?",
      "Entro quando devi averlo pronto?",
    ]);
    expect(study.map((c) => c.answer)).toEqual([
      "formule leve",
      "Fisica",
      "Nessuna scadenza fissata.",
    ]);

    const task = buildFlashcards({
      title: "Leggi il capitolo 4",
      subject: "Filosofia",
      dueAt: Date.UTC(2026, 9, 25, 8),
    });
    expect(task[1]?.answer).toBe("Filosofia");
    expect(task[2]?.answer).toContain("2026");
  });

  it("resta chiuso finché non si clicca il fulmine", () => {
    render(
      <Flashcards open={false} taskId="t1" cards={buildFlashcards({ title: "Fisica: leve" })} />,
    );
    expect(screen.queryByText(/Domanda 1/)).toBeNull();
  });

  it("apre l'Area Ripasso e gira ogni carta mostrando la risposta", async () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <FlashcardToggle open={open} label="Fisica" onToggle={() => setOpen((o) => !o)} />
          <Flashcards
            open={open}
            taskId="fisica-1"
            cards={buildFlashcards({ title: "Fisica: leve" })}
          />
        </>
      );
    }
    render(<Demo />);

    const toggle = screen.getByRole("button", { name: /Apri le flashcard di Fisica/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Area Ripasso")).toBeInTheDocument();

    const cards = screen.getAllByRole("button", { name: /^Flashcard \d: mostra la risposta$/ });
    expect(cards).toHaveLength(3);
    expect(within(cards[0]!).getByText("Domanda 1")).toBeInTheDocument();

    fireEvent.click(cards[0]!);
    const flipped = screen.getAllByRole("button", { name: /^Flashcard 1: mostra la domanda$/ });
    expect(flipped[0]).toHaveAttribute("aria-pressed", "true");
    expect(within(flipped[0]!).getByText("Risposta 1")).toBeInTheDocument();

    fireEvent.click(flipped[0]!);
    expect(
      screen.getByRole("button", { name: /^Flashcard 1: mostra la risposta$/ }),
    ).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByText(/Domanda 1/)).toBeNull(), { timeout: 2000 });
  });

  it("ricorda le carte ripassate anche dopo il riavvio", async () => {
    const cards = buildFlashcards({ title: "Fisica: leve" });
    const first = render(<Flashcards open taskId="fisica-1" cards={cards} />);
    fireEvent.click(screen.getAllByRole("button", { name: /mostra la risposta/ })[0]!);
    expect(screen.getByText(/Ripassate 1\/3/)).toBeInTheDocument();

    first.unmount();
    render(<Flashcards open taskId="fisica-1" cards={cards} />);
    expect(await screen.findByText(/Ripassate 1\/3/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Già ripassata" })).toBeInTheDocument();
  });
});
