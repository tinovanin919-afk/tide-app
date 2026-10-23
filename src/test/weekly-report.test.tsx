import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyReport } from "@/components/WeeklyReport";
import { localDay } from "@/lib/study-engine";
import { makeInitial, StoreProvider } from "@/lib/store";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("jspdf", () => ({
  jsPDF: class {
    setFontSize() {}
    text() {}
    splitTextToSize(value: string) {
      return [value];
    }
    addPage() {}
    save(name: string) {
      save(name);
    }
  },
}));

beforeEach(() => {
  localStorage.clear();
  save.mockClear();
});

describe("Report Performance, Sforzo & ROI", () => {
  it("riepiloga solo la settimana corrente ed esporta il PDF su richiesta", async () => {
    const now = Date.now();
    localStorage.setItem(
      "tide-cruscotto-v1",
      JSON.stringify({
        ...makeInitial(),
        focusLog: [
          { at: now, seconds: 7200, blocks: 3, subject: "Matematica" },
          { at: now - 8 * 86400000, seconds: 600, blocks: 1, subject: "Fisica" },
        ],
      }),
    );
    localStorage.setItem(
      "tide-voti-v1",
      JSON.stringify({
        materie: ["Matematica", "Fisica"],
        obiettivo: 6,
        voti: [{ id: "v1", materia: "Matematica", valore: 6.5, data: localDay(now), tipo: "Scritto" }],
      }),
    );

    render(
      <StoreProvider>
        <WeeklyReport />
      </StoreProvider>,
    );

    expect(screen.getByText("Performance, Sforzo & ROI")).toBeInTheDocument();
    expect(await screen.findByText("2", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Materie trascurate:/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Esporta PDF/ }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toMatch(/^Tide-report-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
