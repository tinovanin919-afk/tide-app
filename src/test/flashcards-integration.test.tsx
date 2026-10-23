import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { Route as BachecaRoute } from "@/routes/bacheca";
import { Route as DashboardRoute } from "@/routes/index";
import { KEY, makeInitial, StoreProvider } from "@/lib/store";

const Dashboard = DashboardRoute.options.component as ComponentType;
const Bacheca = BachecaRoute.options.component as ComponentType;

// Gli ambiti e il filtro della Dashboard/Bacheca usano il contesto dello store reale.
const renderInStore = (Component: ComponentType) =>
  render(
    <StoreProvider>
      <Component />
    </StoreProvider>,
  );

describe("Flashcard nei compiti", () => {
  beforeEach(() => localStorage.clear());

  it("la Dashboard espande il compito e mostra tre carte girevoli", () => {
    renderInStore(Dashboard);

    fireEvent.click(
      screen.getByRole("button", { name: /Apri le flashcard di Aggiorna la roadmap Q4/ }),
    );

    expect(screen.getByText("Area Ripasso")).toBeInTheDocument();
    const cards = screen.getAllByRole("button", { name: /^Flashcard \d: mostra la risposta$/ });
    expect(cards).toHaveLength(3);
    expect(screen.getByText("Entro quando devi averlo pronto?")).toBeInTheDocument();

    fireEvent.click(cards[1]!);
    expect(
      screen.getByRole("button", { name: /^Flashcard 2: mostra la domanda$/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("la Bacheca mostra le flashcard con la materia del task", () => {
    renderInStore(Bacheca);

    fireEvent.click(
      screen.getByRole("button", { name: /Apri le flashcard di Pianifica prossimi obiettivi/ }),
    );

    expect(screen.getAllByRole("button", { name: /mostra la risposta/ })).toHaveLength(3);
    const materia = screen.getByRole("button", { name: /^Flashcard 2: mostra la risposta$/ });
    expect(within(materia).getByText("In quale materia lo stai preparando?")).toBeInTheDocument();
    expect(within(materia).getByText("Strategia")).toBeInTheDocument();
  });

  it("non mostra flashcard fuori dall'ambito scolastico", async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...makeInitial(), category: "vita" }));
    renderInStore(Dashboard);

    expect(await screen.findByText("Nessun compito in questo ambito.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /flashcard/i })).toBeNull();
  });
});
