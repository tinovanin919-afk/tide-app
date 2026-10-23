import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { QuickLinks, SubjectNotebook } from "@/components/SubjectNotebook";

beforeEach(() => localStorage.clear());

describe("Diario di Bordo e Caveau dei Link", () => {
  it("salva il diario della materia nel browser", () => {
    render(<SubjectNotebook subject="Fisica" />);
    fireEvent.click(screen.getByRole("button", { name: "Diario di Bordo delle Interrogazioni" }));
    fireEvent.change(screen.getByLabelText("Diario di Fisica"), { target: { value: "Ripassare le leve" } });

    const saved = JSON.parse(localStorage.getItem("tide-study-notebook-v1") ?? "{}") as {
      notes?: Record<string, string>;
    };
    expect(saved.notes?.["Fisica"]).toBe("Ripassare le leve");
  });

  it("rifiuta i link che non sono http o https", () => {
    render(<SubjectNotebook subject="Fisica" />);
    fireEvent.click(screen.getByRole("button", { name: "Caveau dei Link (Resource Hub)" }));
    fireEvent.change(screen.getByLabelText("URL Fisica"), { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(screen.getByLabelText("URL Fisica").closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("http");
  });

  it("mostra sempre il collegamento rapido a Classroom", () => {
    render(<QuickLinks />);
    expect(screen.getByRole("link", { name: /Google Classroom/ })).toHaveAttribute(
      "href",
      "https://classroom.google.com/",
    );
  });
});
