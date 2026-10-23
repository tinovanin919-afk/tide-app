import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  mergeVoti,
  parseCsv,
  parseVoto,
  rowsToVoti,
  useRegistro,
  votoSalvezza,
  type Voto,
} from "@/lib/grades";

const v = (valore: number): Voto => ({
  id: String(valore),
  materia: "Fisica",
  valore,
  data: "2026-10-01",
  tipo: "Scritto",
});

describe("Registro Voti", () => {
  it("calcola il voto salvezza per raggiungere l'obiettivo", () => {
    // media 5 su due voti → per il 6 serve 6·3 − 10 = 8
    expect(votoSalvezza([v(4), v(6)], 6)).toEqual({ voto: 8, raggiungibile: true });
  });
  it("segnala quando un solo voto non basta", () => {
    expect(votoSalvezza([v(2), v(3)], 8).raggiungibile).toBe(false);
  });
  it("legge i voti in stile Nuvola", () => {
    expect([parseVoto("6+"), parseVoto("6-"), parseVoto("6,5"), parseVoto("6/7")]).toEqual([
      6.25, 5.75, 6.5, 6.5,
    ]);
  });
  it('tratta "7/10" come voto e non come media', () => {
    expect([parseVoto("7/10"), parseVoto("9,5/10"), parseVoto("10/10")]).toEqual([7, 9.5, 10]);
  });
  it("non supera i 10 con la lode e scarta i valori fuori scala", () => {
    expect([parseVoto("10+"), parseVoto("0"), parseVoto("11"), parseVoto("")]).toEqual([
      10,
      null,
      null,
      null,
    ]);
  });
  it("importa un CSV con Materia, Voto e Data", () => {
    const out = rowsToVoti(parseCsv("Data;Materia;Tipo;Voto\n03/10/2026;MATEMATICA;Orale;7\n"));
    expect(out[0]).toMatchObject({
      materia: "Matematica",
      valore: 7,
      data: "2026-10-03",
      tipo: "Orale",
    });
  });
});

describe("Import CSV/Excel da Nuvola", () => {
  it("salta le righe di intestazione dell'export e accetta la colonna Valutazione", () => {
    const csv = [
      "Registro elettronico Nuvola",
      "Alunno;Martino Rossi",
      "Materia;Data;Valutazione;Tipologia",
      "Fisica;12/09/2026;7,5;Scritto",
      "Filosofia;20/09/2026;6+;Orale",
    ].join("\r\n");
    expect(rowsToVoti(parseCsv(csv))).toEqual([
      expect.objectContaining({
        materia: "Fisica",
        valore: 7.5,
        data: "2026-09-12",
        tipo: "Scritto",
      }),
      expect.objectContaining({
        materia: "Filosofia",
        valore: 6.25,
        data: "2026-09-20",
        tipo: "Orale",
      }),
    ]);
  });

  it("gestisce virgolette, virgole e a capo dentro le celle", () => {
    const csv =
      'Materia,Voto,Data\n"Scienze, Motorie",8,01/10/2026\n"Arte ""e Immagine""",9,02/10/2026\n';
    expect(rowsToVoti(parseCsv(csv))).toEqual([
      expect.objectContaining({ materia: "Scienze, Motorie", valore: 8 }),
      expect.objectContaining({ materia: 'Arte "E Immagine"', valore: 9 }),
    ]);
  });

  it("riconosce il separatore dichiarato da Excel (sep=;)", () => {
    expect(parseCsv("sep=;\nMateria;Voto\nFisica;6\n")).toEqual([
      ["Materia", "Voto"],
      ["Fisica", "6"],
    ]);
    expect(rowsToVoti(parseCsv("sep=;\nMateria;Voto\nFisica;6\n"))[0]).toMatchObject({
      materia: "Fisica",
      valore: 6,
    });
  });

  it("legge le date Excel sia come Date sia come seriale numerico", () => {
    const asDate = rowsToVoti([
      ["Materia", "Voto", "Data"],
      ["Storia", 8, new Date(Date.UTC(2026, 9, 5))],
    ]);
    const asSerial = rowsToVoti([
      ["Materia", "Voto", "Data"],
      ["Storia", 8, 46300],
    ]);
    expect(asDate[0]?.data).toBe("2026-10-05");
    expect(asSerial[0]?.data).toBe("2026-10-05");
  });

  it("riconosce la tipologia anche quando è scritta estesa", () => {
    const out = rowsToVoti([
      ["Materia", "Voto", "Tipo"],
      ["Storia", 7, "Interrogazione orale"],
      ["Arte", 8, "Prova pratica"],
      ["Italiano", 6, "Scritto"],
    ]);
    expect(out.map((v) => v.tipo)).toEqual(["Orale", "Pratico", "Scritto"]);
  });

  it("scarta le righe senza materia o con voti non validi", () => {
    expect(
      rowsToVoti([
        ["Materia", "Voto"],
        ["", 7],
        ["Chimica", "assente"],
        ["Chimica", 9],
      ]),
    ).toHaveLength(1);
  });

  it("unisce gli import evitando i doppioni", () => {
    const base = { materie: ["Fisica"], voti: [v(7)], obiettivo: 6 };
    const merged = mergeVoti(base, [v(7), v(8)]);
    expect(merged.voti.map((x) => x.valore)).toEqual([7, 8]);
  });
});

describe("Registro Voti locale", () => {
  beforeEach(() => localStorage.clear());

  it("conta solo i voti realmente aggiunti dall'import", () => {
    const { result } = renderHook(() => useRegistro());
    const voti = [v(7), v(8)];
    let added = 0;
    act(() => {
      added = result.current.importa(voti);
    });
    expect(added).toBe(2);
    expect(result.current.reg.materie).toEqual(["Fisica"]);
    act(() => {
      added = result.current.importa([v(8)]);
    });
    expect(added).toBe(0);
    expect(JSON.parse(localStorage.getItem("tide-voti-v1") ?? "{}").voti).toHaveLength(2);
  });

  it("ritrova voti e materie dopo un riavvio dell'app", () => {
    const first = renderHook(() => useRegistro());
    act(() => {
      first.result.current.addMateria("Fisica");
      first.result.current.addVoto({
        materia: "Fisica",
        valore: 7,
        data: "2026-10-01",
        tipo: "Scritto",
      });
    });
    first.unmount();

    const second = renderHook(() => useRegistro());
    expect(second.result.current.reg.materie).toEqual(["Fisica"]);
    expect(second.result.current.reg.voti).toHaveLength(1);
    expect(second.result.current.reg.voti[0]).toMatchObject({ materia: "Fisica", valore: 7 });
  });
});
