// Registro Voti: logica pura + persistenza locale (chiave separata, non tocca i dati esistenti di Tide).
import { useCallback, useEffect, useRef, useState } from "react";

export type Tipo = "Scritto" | "Orale" | "Pratico";
export const TIPI: Tipo[] = ["Scritto", "Orale", "Pratico"];
export type Voto = { id: string; materia: string; valore: number; data: string; tipo: Tipo; peso?: number; nota?: string };
export type Registro = { materie: string[]; voti: Voto[]; obiettivo: number };

export const GRADES_KEY = "tide-voti-v1";
const EMPTY: Registro = { materie: [], voti: [], obiettivo: 6 };
const uid = () => Math.random().toString(36).slice(2, 10);

export const media = (voti: Voto[]) => (voti.length ? voti.reduce((s, v) => s + v.valore, 0) / voti.length : null);

/** Voto minimo alla prossima verifica per avere media >= obiettivo: x = obiettivo·(n+1) − somma. */
export function votoSalvezza(voti: Voto[], obiettivo: number) {
  const somma = voti.reduce((s, v) => s + v.valore, 0);
  const x = Math.round((obiettivo * (voti.length + 1) - somma) * 100) / 100;
  return { voto: Math.max(1, x), raggiungibile: x <= 10 };
}

/** "6+"→6.25, "6-"→5.75, "6½"/"6,5"→6.5, "7/10"→7, "6/7"→6.5. Restituisce null se non è un voto 1–10. */
export function parseVoto(raw: unknown): number | null {
  if (typeof raw === "number") return raw >= 1 && raw <= 10 ? raw : null;
  let s = String(raw ?? "").trim().replace(",", ".").replace("½", ".5");
  // Su Nuvola "7/10" è il voto, non una media: si tiene il numeratore.
  const outOfTen = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*10$/);
  if (outOfTen) s = outOfTen[1]!;
  let n: number;
  const range = s.match(/^(\d+(?:\.\d+)?)\s*[/-]\s*(\d+(?:\.\d+)?)$/);
  if (range) n = (Number(range[1]) + Number(range[2])) / 2;
  else if (/^\d+(\.\d+)?\+$/.test(s)) n = Math.min(10, Number(s.slice(0, -1)) + 0.25);
  else if (/^\d+(\.\d+)?-$/.test(s)) n = Math.max(1, Number(s.slice(0, -1)) - 0.25);
  else { s = s.replace(/[^\d.]/g, ""); n = s ? Number(s) : NaN; }
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

function parseData(raw: unknown): string {
  // read-excel-file restituisce le celle data come Date a mezzanotte UTC.
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  // Celle data formattate come numero: seriale Excel (1900) → giorno.
  if (typeof raw === "number" && raw >= 20000 && raw <= 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(raw ?? "").trim();
  const it = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (it) { const y = it[3]!.length === 2 ? `20${it[3]}` : it[3]; return `${y}-${it[2]!.padStart(2, "0")}-${it[1]!.padStart(2, "0")}`; }
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : new Date().toISOString().slice(0, 10);
}

export const tipoOf = (raw: unknown): Tipo => {
  const s = String(raw ?? "").toLowerCase();
  // Nuvola scrive anche "Interrogazione orale" o "Prova pratica": si cerca la parola chiave.
  if (/oral|interrog/.test(s)) return "Orale";
  if (/pratic|lab|graf/.test(s)) return "Pratico";
  return "Scritto";
};
export const cap = (s: string) => s.trim().toLowerCase().replace(/(^|[\s"'(])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());

/** Voti estratti dal file + se la colonna Data esisteva davvero. */
export type NuvolaImport = { voti: Voto[]; hasDate: boolean };

/** Converte righe (dal CSV o dall'Excel di Nuvola) in voti: cerca le colonne Materia, Voto, Data, Tipo. */
export function rowsToVotiDetailed(rows: unknown[][]): NuvolaImport {
  const hi = rows.findIndex((r) => r.some((c) => /materia/i.test(String(c))) && r.some((c) => /voto|valutaz/i.test(String(c))));
  if (hi < 0) return { voti: [], hasDate: false };
  const h = rows[hi]!.map((c) => String(c ?? "").toLowerCase());
  const col = (re: RegExp) => h.findIndex((c) => re.test(c));
  const [cm, cv, cd, ct] = [col(/materia/), col(/voto|valutaz/), col(/data/), col(/tipo/)];
  const voti = rows.slice(hi + 1).flatMap((r) => {
    const materia = cap(String(r[cm] ?? ""));
    const valore = parseVoto(r[cv]);
    if (!materia || valore === null) return [];
    return [{ id: uid(), materia, valore, data: parseData(cd >= 0 ? r[cd] : ""), tipo: tipoOf(ct >= 0 ? r[ct] : "") }];
  });
  return { voti, hasDate: cd >= 0 };
}

export const rowsToVoti = (rows: unknown[][]): Voto[] => rowsToVotiDetailed(rows).voti;

const SEPARATORS = [";", ",", "\t"] as const;

/** Sceglie il separatore contando le occorrenze fuori dalle virgolette nella prima riga. */
function detectSeparator(line: string): string {
  const counts = new Map<string, number>(SEPARATORS.map((s) => [s, 0]));
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return SEPARATORS.reduce((best, s) => ((counts.get(s) ?? 0) > (counts.get(best) ?? 0) ? s : best), SEPARATORS[0]);
}

/** Legge CSV/TSV robusto: virgolette, "virgolette doppie" e celle su più righe. */
export function parseCsv(text: string): unknown[][] {
  let source = text.replace(/^\uFEFF/, "");
  // Excel a volte premette "sep=;".
  const declared = source.match(/^sep=(.)\r?\n/i);
  if (declared) source = source.slice(declared[0].length);
  const sep = declared?.[1] ?? detectSeparator(source.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  const pushRow = () => {
    row.push(cur);
    if (row.some((c) => c.trim())) rows.push(row.map((c) => c.trim()));
    row = [];
    cur = "";
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (quoted) {
      if (ch !== '"') cur += ch;
      else if (source[i + 1] === '"') { cur += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      pushRow();
    } else cur += ch;
  }
  if (cur || row.length) pushRow();
  return rows;
}

export async function readNuvolaFileDetailed(file: File): Promise<NuvolaImport> {
  if (/\.(xlsx|xlsm)$/i.test(file.name)) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    // L'export di Nuvola a volte mette il registro in un foglio diverso dal primo.
    for (const sheet of await readXlsxFile(file)) {
      const result = rowsToVotiDetailed(sheet.data as unknown[][]);
      if (result.voti.length) return result;
    }
    return { voti: [], hasDate: false };
  }
  return rowsToVotiDetailed(parseCsv(await file.text()));
}

/** Unisce i voti importati evitando doppioni (stessa materia, voto, data, tipo). */
export function mergeVoti(reg: Registro, nuovi: Voto[]): Registro {
  const key = (v: Voto) => `${v.materia}|${v.valore}|${v.data}|${v.tipo}`;
  const seen = new Set(reg.voti.map(key));
  const add = nuovi.filter((v) => !seen.has(key(v)) && (seen.add(key(v)), true));
  const materie = [...new Set([...reg.materie, ...add.map((v) => v.materia)])];
  return { ...reg, materie, voti: [...reg.voti, ...add] };
}

export function useRegistro() {
  const [reg, setReg] = useState<Registro>(EMPTY);
  // Il valore corrente vive anche in un ref: gli aggiornamenti restano fuori dal
  // reducer di React (niente effetti collaterali doppi) e l'import sa quanti voti ha aggiunto.
  const current = useRef<Registro>(EMPTY);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(GRADES_KEY);
      if (raw) current.current = { ...EMPTY, ...JSON.parse(raw) };
      setReg(current.current);
    } catch { /* dati illeggibili: si parte vuoti */ }
  }, []);
  const update = useCallback((fn: (r: Registro) => Registro) => {
    const next = fn(current.current);
    current.current = next;
    setReg(next);
    try { localStorage.setItem(GRADES_KEY, JSON.stringify(next)); } catch { /* spazio pieno */ }
  }, []);
  // Le materie nuove lette dall'import vengono registrate accanto ai voti.
  const withSubjects = (r: Registro, voti: Voto[]): Registro => ({
    ...r,
    materie: [...new Set([...r.materie, ...voti.map((v) => cap(v.materia))])],
  });
  return {
    reg,
    addMateria: (m: string) => update((r) => (r.materie.includes(cap(m)) ? r : { ...r, materie: [...r.materie, cap(m)] })),
    removeMateria: (m: string) => update((r) => ({ ...r, materie: r.materie.filter((x) => x !== m), voti: r.voti.filter((v) => v.materia !== m) })),
    addVoto: (v: Omit<Voto, "id">) => {
      const voto = { ...v, id: uid() };
      update((r) => ({ ...withSubjects(r, [voto]), voti: [...r.voti, voto] }));
    },
    /** Aggiunge più voti in una sola scrittura e restituisce gli id creati (serve per l'undo). */
    addVoti: (voti: Omit<Voto, "id">[]) => {
      const added = voti.map((v) => ({ ...v, id: uid() }));
      if (added.length) update((r) => ({ ...withSubjects(r, added), voti: [...r.voti, ...added] }));
      return added.map((v) => v.id);
    },
    removeVoto: (id: string) => update((r) => ({ ...r, voti: r.voti.filter((v) => v.id !== id) })),
    removeVotiByIds: (ids: string[]) => {
      if (!ids.length) return;
      update((r) => ({ ...r, voti: r.voti.filter((v) => !ids.includes(v.id)) }));
    },
    setObiettivo: (o: number) => update((r) => ({ ...r, obiettivo: o })),
    importa: (nuovi: Voto[]) => {
      const before = current.current.voti.length;
      update((r) => mergeVoti(r, nuovi));
      return current.current.voti.length - before;
    },
  };
}
