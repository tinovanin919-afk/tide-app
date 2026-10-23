import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PriorityCenter, RecoveryBox, WorkloadBanner } from "@/components/StudyDashboard";
import { makeInitial, StoreProvider, type Task } from "@/lib/store";

const now = Date.now();
const DAY = 86400000;

const task = (over: Partial<Task> & Pick<Task, "id" | "title">): Task => ({
  project: "Matematica",
  status: "in-corso",
  priority: "media",
  category: "scuola",
  estimatedBlocks: 4,
  ...over,
});

function seed(tasks: Task[]) {
  localStorage.setItem("tide-cruscotto-v1", JSON.stringify({ ...makeInitial(), tasks, category: "scuola" }));
}

function seedGrades() {
  localStorage.setItem(
    "tide-voti-v1",
    JSON.stringify({
      materie: ["Matematica", "Fisica"],
      obiettivo: 6,
      voti: [
        { id: "v1", materia: "Matematica", valore: 5.8, data: "2026-10-19", tipo: "Scritto" },
        { id: "v2", materia: "Fisica", valore: 7.5, data: "2026-10-19", tipo: "Orale" },
      ],
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("Predittore di sovraccarico", () => {
  it("mostra rischio, stima delle ore e materie fragili con i voti reali", async () => {
    seed([
      task({ id: "a", title: "Verifica di matematica", dueAt: now + DAY }),
      task({ id: "b", title: "Relazione di fisica", dueAt: now + 1.5 * DAY }),
      task({ id: "c", title: "Esercizi di latino", dueAt: now + 2 * DAY, project: "Latino" }),
    ]);
    seedGrades();
    render(
      <StoreProvider>
        <WorkloadBanner />
      </StoreProvider>,
    );

    expect(screen.getByLabelText("Predittore di sovraccarico")).toBeInTheDocument();
    expect(screen.getByText(/Rischio ritardi:/)).toBeInTheDocument();
    expect((await screen.findAllByText(/Matematica/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/sotto l'obiettivo 6/)).toBeInTheDocument();
    expect(screen.getByText(/Suggerimento: inizia il ripasso di Matematica/)).toBeInTheDocument();
  });

  it("non inventa materie fragili quando il registro è vuoto", async () => {
    seed([task({ id: "a", title: "Verifica", dueAt: now + DAY })]);
    render(
      <StoreProvider>
        <WorkloadBanner />
      </StoreProvider>,
    );
    expect(await screen.findByText(/Registra i voti nel Registro Voti/)).toBeInTheDocument();
  });
});

describe("Centro Priorità", () => {
  it("ordina i compiti aperti e mostra punteggio e barra anti-ansia", async () => {
    seed([
      task({ id: "urgent", title: "Verifica di matematica", dueAt: now + DAY }),
      task({ id: "later", title: "Lettura di filosofia", dueAt: now + 20 * DAY, project: "Filosofia" }),
    ]);
    seedGrades();
    render(
      <StoreProvider>
        <PriorityCenter />
      </StoreProvider>,
    );

    expect(screen.getByText("Centro Priorità")).toBeInTheDocument();
    const badges = await screen.findAllByText(/\d+\/100$/);
    expect(badges.length).toBeGreaterThan(0);
    const first = screen.getAllByRole("meter")[0];
    expect(Number(first?.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  });
});

describe("Recupero Automatico", () => {
  it("rischedula un compito saltato salvando la nuova data nel browser", async () => {
    seed([task({ id: "late", title: "Verifica di fisica", dueAt: now - DAY, skipped: true })]);
    render(
      <StoreProvider>
        <RecoveryBox />
      </StoreProvider>,
    );

    expect(await screen.findByText("Verifica di fisica")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recupera domani alle 17:00" }));

    expect(await screen.findByText("Pianificati")).toBeInTheDocument();
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("tide-cruscotto-v1") ?? "{}") as { tasks?: Task[] };
      const moved = saved.tasks?.find((t) => t.id === "late");
      expect(moved?.skipped).toBe(false);
      expect(moved?.dueAt).toBeGreaterThan(now);
      const due = new Date(moved?.dueAt ?? 0);
      expect(due.getHours()).toBe(17);
      expect(due.getMinutes()).toBe(0);
    });
  });

  it("segnala quando non c'è nulla da recuperare", async () => {
    seed([task({ id: "ok", title: "Compito in regola", dueAt: now + DAY })]);
    render(
      <StoreProvider>
        <RecoveryBox />
      </StoreProvider>,
    );
    expect(await screen.findByText(/non c'è nulla da recuperare/)).toBeInTheDocument();
  });
});
