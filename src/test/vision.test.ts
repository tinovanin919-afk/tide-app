import { describe, expect, it } from "vitest";
import { makeInitial, reducer, restoreState } from "@/lib/store";
import {
  findDeadline,
  findGrade,
  parseHomeworkScreenshot,
  parseVotiScreenshot,
  subjectFrom,
} from "@/lib/vision";

const at = (y: number, m: number, d: number, h = 18, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime();

describe("Screenshot del Registro Voti", () => {
  it("legge una tabella con Materia, Voto, Data, Tipo e Peso", () => {
    const screenshot = [
      "Registro elettronico · Voti",
      "Materia      Voto   Data        Tipo      Peso",
      "ITALIANO     7      12/10/2026  Scritto   1",
      "STORIA       8+     09/10/2026  Orale     2",
    ].join("\n");
    const voti = parseVotiScreenshot(screenshot, "2026-10-23");
    expect(voti).toHaveLength(2);
    expect(voti[0]).toMatchObject({
      materia: "Italiano",
      valore: 7,
      data: "2026-10-12",
      tipo: "Scritto",
      peso: 1,
    });
    expect(voti[1]).toMatchObject({
      materia: "Storia",
      valore: 8.25,
      data: "2026-10-09",
      tipo: "Orale",
      peso: 2,
    });
  });

  it("legge la scheda a più righe con etichette Voto, Data, Tipo e Peso", () => {
    const screenshot = [
      "Matematica",
      "Voto: 7,5",
      "Data: 18/10/2026",
      "Tipo: Scritto",
      "Peso: 2",
      "Fisica",
      "Voto: 6+",
      "Data: 20/09/2026",
      "Tipo: Orale",
    ].join("\n");
    const voti = parseVotiScreenshot(screenshot, "2026-10-23");
    expect(voti).toHaveLength(2);
    expect(voti[0]).toMatchObject({
      materia: "Matematica",
      valore: 7.5,
      data: "2026-10-18",
      peso: 2,
    });
    expect(voti[1]).toMatchObject({
      materia: "Fisica",
      valore: 6.25,
      data: "2026-09-20",
      tipo: "Orale",
    });
  });

  it("non scambia un voto tipo 7/10 per una data", () => {
    expect(findGrade("Voto: 7/10")).toBe(7);
    expect(findGrade("Data: 18/10/2026")).toBeNull();
    const voti = parseVotiScreenshot("Italiano\nVoto: 7/10\nData: 12/10/2026", "2026-10-23");
    expect(voti[0]).toMatchObject({ materia: "Italiano", valore: 7, data: "2026-10-12" });
  });

  it("scarta il rumore dell'interfaccia senza inventare materie", () => {
    expect(subjectFrom("Registro elettronico")).toBeNull();
    expect(subjectFrom("Voto 7")).toBeNull();
    expect(subjectFrom("ITALIANO 7 12/10/2026 Scritto")).toBe("Italiano");
    expect(parseVotiScreenshot("Segui\nNotifiche\nImpostazioni", "2026-10-23")).toEqual([]);
  });

  it("accetta una data senza anno e la mantiene nella forma ISO", () => {
    const voti = parseVotiScreenshot("Scienze Motorie\nVoto: 9\nData: 25/09", "2026-10-23");
    expect(voti[0]).toMatchObject({ materia: "Scienze Motorie", valore: 9, data: "2026-09-25" });
  });
});

describe("Screenshot dei compiti (Classroom e lavagna)", () => {
  it("crea la task con materia, scadenza e pomodori stimati", () => {
    const screenshot = [
      "Classroom",
      "Matematica",
      "Esercizi pag. 45 n. 1-5",
      "Scadenza: 25/10/2026",
    ].join("\n");
    const [task] = parseHomeworkScreenshot(screenshot, at(2026, 10, 23, 9));
    expect(task).toMatchObject({
      subject: "Matematica",
      title: "Esercizi pag. 45 n. 1-5",
      dueAt: at(2026, 10, 25),
      estimatedBlocks: 2,
    });
  });

  it("riconosce la scadenza scritta a parole e la materia della lavagna", () => {
    const screenshot = ["COMPITI DI STORIA", "Riassunto capitolo 3", "Per lunedì 26 ottobre"].join(
      "\n",
    );
    const [task] = parseHomeworkScreenshot(screenshot, at(2026, 10, 23, 9));
    expect(task).toMatchObject({
      subject: "Storia",
      title: "Riassunto capitolo 3",
      dueAt: at(2026, 10, 26),
      estimatedBlocks: 4,
    });
  });

  it("usa il giorno della settimana quando la data non c'è", () => {
    const screenshot = ["Italiano", "Ripassare i verbi", "Consegna venerdì"].join("\n");
    const [task] = parseHomeworkScreenshot(screenshot, at(2026, 10, 23, 9));
    expect(task).toMatchObject({
      subject: "Italiano",
      dueAt: at(2026, 10, 23),
      estimatedBlocks: 1,
    });
  });

  it("separa più materie nello stesso screenshot", () => {
    const screenshot = [
      "Italiano",
      "Tema: Il viaggio",
      "Consegna: 27/10/2026",
      "Storia",
      "Riassunto capitolo 3",
      "Consegna: 28/10/2026",
    ].join("\n");
    const tasks = parseHomeworkScreenshot(screenshot, at(2026, 10, 23, 9));
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ subject: "Italiano", dueAt: at(2026, 10, 27) });
    expect(tasks[1]).toMatchObject({ subject: "Storia", dueAt: at(2026, 10, 28) });
  });

  it("non inventa una scadenza quando nella foto non c'è", () => {
    const [task] = parseHomeworkScreenshot("Fisica\nLeggere capitolo 4", at(2026, 10, 23, 9));
    expect(task).toMatchObject({ subject: "Fisica", title: "Leggere capitolo 4", dueAt: null });
  });

  it("riconosce una verifica come lavoro più lungo di una lettura", () => {
    const [task] = parseHomeworkScreenshot(
      "Matematica\nVerifica sulle equazioni\nConsegna: 30/10",
      at(2026, 10, 23, 9),
    );
    expect(task?.estimatedBlocks).toBe(3);
  });

  it("preferisce la data vicina a 'consegna' a quella del giorno nella pagina", () => {
    const text = "23/10/2026\nMatematica\nEsercizi\nConsegna: 30/10/2026";
    expect(findDeadline(text, at(2026, 10, 23, 9))).toEqual({
      at: at(2026, 10, 30),
      iso: "2026-10-30",
    });
  });
});

describe("Task create dalla foto", () => {
  it("aggiunge i compiti importati in Scuola con materia e blocchi", () => {
    const next = reducer(makeInitial(), {
      type: "addTodos",
      items: [
        { title: "Tema", subject: "Italiano", dueAt: 123, estimatedBlocks: 3, category: "scuola" },
        { title: "Esercizi", subject: "Matematica", estimatedBlocks: 2, category: "scuola" },
      ],
    });
    expect(next.todos.slice(-2)).toEqual([
      expect.objectContaining({
        title: "Tema",
        subject: "Italiano",
        dueAt: 123,
        estimatedBlocks: 3,
        category: "scuola",
        done: false,
      }),
      expect.objectContaining({
        title: "Esercizi",
        subject: "Matematica",
        estimatedBlocks: 2,
        category: "scuola",
      }),
    ]);
    expect(restoreState(JSON.stringify(next)).todos.slice(-2)[0]).toMatchObject({
      title: "Tema",
      estimatedBlocks: 3,
    });
  });
});
