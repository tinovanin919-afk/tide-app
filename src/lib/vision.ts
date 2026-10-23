// Lettura locale di screenshot: l'OCR gira in WebAssembly nel browser (Tesseract, gratuito)
// e nessuna immagine viene inviata a un servizio esterno. Qui vivono i parser puri
// del testo riconosciuto, così restano testabili senza fotocamera.
import { cap, parseVoto, tipoOf, type Tipo, type Voto } from "@/lib/grades";
import { imageToDocument, imageToText, isImageFile, makeThumbnail } from "@/lib/ocr";
import type { OcrDocument, OcrLine, OcrUpdate } from "@/lib/ocr";

export { imageToDocument, imageToText, isImageFile, makeThumbnail };
export type { OcrDocument, OcrLine, OcrUpdate };

const uid = () => Math.random().toString(36).slice(2, 10);
const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fold = (s: string) =>
  s
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/* ----------------------------------------------------------- date comuni --- */

const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MONTH_RE =
  "(gen(?:naio)?|feb(?:braio)?|mar(?:zo)?|apr(?:ile)?|mag(?:gio)?|giu(?:gno)?|lug(?:lio)?|ago(?:sto)?|set(?:tembre)?|ott(?:obre)?|nov(?:embre)?|dic(?:embre)?)";
const MONTHS_RE = new RegExp(`\\b\\d{1,2}\\s+${MONTH_RE}\\.?\\s*\\d{0,4}`, "gi");
const WEEKDAYS_FOLD = [
  "domenica",
  "lunedi",
  "martedi",
  "mercoledi",
  "giovedi",
  "venerdi",
  "sabato",
];
const WEEKDAYS_RE = /\b(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/i;

const monthOf = (word: string) =>
  MONTHS.indexOf(fold(word).slice(0, 3) as (typeof MONTHS)[number]) + 1;
const normalizeYear = (year: number) => (year < 100 ? 2000 + year : year);

type DateHit = { y: number; m: number; d: number; hasYear: boolean; index: number };

/** Date numeriche: "12/10/2026", "12-10", "3.11.26". Un "7/10" senza anno è un voto, non una data. */
function numericDates(text: string): DateHit[] {
  const hits: DateHit[] = [];
  const re = /\b(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?\b/g;
  for (const match of text.matchAll(re)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const yearRaw = match[3];
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    if (yearRaw === undefined && day <= 12) continue;
    hits.push({
      y: yearRaw === undefined ? new Date().getFullYear() : normalizeYear(Number(yearRaw)),
      m: month,
      d: day,
      hasYear: yearRaw !== undefined,
      index: match.index ?? 0,
    });
  }
  return hits;
}

/** Date scritte a parole: "25 ottobre 2026", "3 nov". */
function monthDates(text: string): DateHit[] {
  const hits: DateHit[] = [];
  const re = new RegExp(`\\b(\\d{1,2})\\s+${MONTH_RE}\\.?\\s*(\\d{4})?`, "gi");
  for (const match of text.matchAll(re)) {
    const day = Number(match[1]);
    const month = monthOf(match[2] ?? "");
    if (!month || day < 1 || day > 31) continue;
    hits.push({
      y: match[3] ? Number(match[3]) : new Date().getFullYear(),
      m: month,
      d: day,
      hasYear: Boolean(match[3]),
      index: match.index ?? 0,
    });
  }
  return hits;
}

/** Toglie dal testo le date non ambigue (quelle con l'anno o con giorno > 12). */
function stripDates(text: string): string {
  const withoutNumeric = text.replace(
    /\b(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?\b/g,
    (full: string, dayRaw: string, monthRaw: string, year: string | undefined) => {
      const day = Number(dayRaw);
      const month = Number(monthRaw);
      const isDate = year !== undefined || (month >= 1 && month <= 12 && day > 12 && day <= 31);
      return isDate ? " " : full;
    },
  );
  return withoutNumeric.replace(MONTHS_RE, " ");
}

function clockIn(text: string): number | null {
  const labelled = text.match(/\b(?:ore|h)\s*([01]?\d|2[0-3])(?:[:.](\d{2}))?\b/i);
  const plain = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const match = labelled ?? plain;
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2] ?? 0);
}

const DEADLINE_CUE = /\b(scadenz\w*|consegn\w*|entro|da consegnare|per il|per la)\b/i;

/** Data del registro: anche vecchia, senza la regola "scadenza passata" dei compiti. */
function findIsoDate(text: string): string | null {
  const hit = [...numericDates(text), ...monthDates(text)].sort((a, b) => a.index - b.index)[0];
  return hit ? isoOf(new Date(hit.y, hit.m - 1, hit.d)) : null;
}

export type Deadline = { at: number; iso: string };

/**
 * Cerca la scadenza in un testo libero (Classroom, lavagna, registro).
 * Preferisce le date vicine a "consegna/scadenza/entro", poi lunedì/domani.
 */
export function findDeadline(text: string, now = Date.now()): Deadline | null {
  const hits = [...numericDates(text), ...monthDates(text)].sort((a, b) => a.index - b.index);
  const cued = hits.find((hit) =>
    DEADLINE_CUE.test(text.slice(Math.max(0, hit.index - 24), hit.index)),
  );
  const hit = cued ?? hits[0];
  if (hit) {
    const date = new Date(hit.y, hit.m - 1, hit.d, 18, 0, 0, 0);
    if (!hit.hasYear && date.getTime() < now - 60 * DAY) date.setFullYear(date.getFullYear() + 1);
    const clock = clockIn(text);
    if (clock !== null) date.setHours(Math.floor(clock / 60), clock % 60, 0, 0);
    if (date.getTime() < now - 7 * DAY) return null;
    return { at: date.getTime(), iso: isoOf(date) };
  }

  const folded = fold(text);
  const clock = clockIn(text);
  const relative = folded.match(/\b(dopodomani|domani|oggi|stasera)\b/);
  const weekday = folded.match(WEEKDAYS_RE);
  const picks: { index: number; at: number }[] = [];

  if (weekday) {
    const target = WEEKDAYS_FOLD.indexOf(weekday[1] ?? "");
    const date = new Date(now);
    date.setHours(
      clock === null ? 18 : Math.floor(clock / 60),
      clock === null ? 0 : clock % 60,
      0,
      0,
    );
    if (target >= 0) {
      const ahead = (target - date.getDay() + 7) % 7;
      date.setDate(date.getDate() + ahead);
    }
    if (date.getTime() < now) date.setDate(date.getDate() + 7);
    picks.push({ index: weekday.index ?? 0, at: date.getTime() });
  }
  if (relative) {
    const date = new Date(now);
    date.setHours(
      clock === null ? 18 : Math.floor(clock / 60),
      clock === null ? 0 : clock % 60,
      0,
      0,
    );
    const word = relative[1];
    if (word === "domani") date.setDate(date.getDate() + 1);
    if (word === "dopodomani") date.setDate(date.getDate() + 2);
    if (date.getTime() < now) date.setDate(date.getDate() + 1);
    picks.push({ index: relative.index ?? 0, at: date.getTime() });
  }
  const first = picks.sort((a, b) => a.index - b.index)[0];
  return first ? { at: first.at, iso: isoOf(new Date(first.at)) } : null;
}

/* ----------------------------------------------------------- voti: testo --- */

const VOTI_HEADER = /\bmateria\b/i;
const VOTI_VALUE = /\b(voto|voti|valutazion[ei])\b/i;
const NOISE = new RegExp(
  [
    "voti?",
    "valutazion[ei]",
    "media",
    "registro",
    "elettronico",
    "classe",
    "alunn[oa]",
    "student[es]",
    "periodo",
    "scrutinio",
    "pagella",
    "document[oi]",
    "data",
    "tipo",
    "tipologia",
    "peso",
    "prova",
    "verific[ah]",
    "interrogazion[ei]",
    "scritt[oi]",
    "oral[ei]",
    "pratic[oi]",
    "esito",
    "giudizio",
    "materia",
    "materie",
    "anno",
    "scolastico",
    "quadrimestre",
    "pentamestre",
    "trimestre",
    "recupero",
    "simulazione",
    "test",
    "esame",
    "compito",
    "compiti",
  ].join("|"),
  "gi",
);

function splitLines(raw: string): string[] {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/[“”«»]/g, '"')
    .replace(/[’‘]/g, "'")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** "Materia   Voto   Data   Tipo   Peso" → indici delle colonne (separatori: 2+ spazi, tab, |). */
function columnsOf(line: string): string[] {
  return line
    .split(/\s{2,}|\t|\|/)
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function isVotiHeader(line: string): boolean {
  return VOTI_HEADER.test(line) && VOTI_VALUE.test(line);
}

/**
 * Voto + quanto è solida la lettura. Etichetta "Voto:" o formato "/10" sono forti;
 * un numero isolato è plausibile ma non certo; più numeri nella riga sono ambigui.
 */
export function gradeEvidence(text: string): { valore: number; certainty: number } | null {
  const clean = stripDates(text)
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, " ")
    .replace(/\bpeso\b\s*[:–-]?\s*\d+(?:[.,]\d+)?/gi, " ");

  const labelled = clean.match(
    /\b(?:voto|voti|valutazione)\b\s*[:–-]?\s*(\d{1,2}(?:[.,]\d{1,2})?(?:\s*(?:\/\s*10|[+-]))?)/i,
  );
  if (labelled) {
    const value = parseVoto(labelled[1] ?? "");
    if (value !== null) return { valore: value, certainty: 97 };
  }

  const tokens =
    clean.match(/(?<![\d/])\d{1,2}(?:[.,]\d{1,2})?(?:\s*(?:\/\s*10|[+-]))?(?![\d/])/g) ?? [];
  const values: number[] = [];
  for (const token of tokens) {
    const value = parseVoto(token);
    if (value !== null) values.push(value);
  }
  const first = values[0];
  if (first === undefined) return null;
  const unique = [...new Set(values)];
  return { valore: first, certainty: unique.length > 1 ? 52 : 78 };
}

/** Estrae il voto dalla riga: prima il numero dopo "Voto:", poi il primo 1–10 credibile. */
export function findGrade(text: string): number | null {
  return gradeEvidence(text)?.valore ?? null;
}

function parsePeso(raw: string): number | undefined {
  const match = raw.match(/(\d{1,2}(?:[.,]\d{1,2})?)/);
  if (!match) return undefined;
  const value = Number((match[1] ?? "").replace(",", "."));
  return Number.isFinite(value) && value > 0 && value <= 10 ? value : undefined;
}

export function findPeso(text: string): number | undefined {
  const labelled = text.match(/\bpeso\b\s*[:–-]?\s*(\d{1,2}(?:[.,]\d{1,2})?)/i);
  return labelled ? parsePeso(labelled[1] ?? "") : undefined;
}

/** Ricava "Italiano" da "ITALIANO 7 12/10/2026 Scritto" senza inventare parole. */
export function subjectFrom(text: string): string | null {
  const cleaned = stripDates(text)
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, " ")
    .replace(/\bpeso\b\s*[:–-]?\s*\d+(?:[.,]\d+)?/gi, " ")
    .replace(NOISE, " ")
    .replace(/[^\p{L}\s'’&.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.'’&-]+|[\s.'’&-]+$/g, "");
  if (!cleaned) return null;
  const words = cleaned.split(" ").filter((word) => word.length > 1);
  if (words.length === 0) return null;
  const subject = words.join(" ");
  const letters = subject.replace(/[^\p{L}]/gu, "");
  if (letters.length < 3 || subject.length > 45) return null;
  return cap(subject);
}

/** Ogni voto diventa un blocco: una riga di tabella o la scheda "Materia / Voto / Data". */
function groupVotiBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let block: string[] = [];
  const flush = () => {
    if (block.length) blocks.push(block);
    block = [];
  };
  for (const line of lines) {
    if (isVotiHeader(line)) {
      flush();
      continue;
    }
    const subject = subjectFrom(line);
    const grade = findGrade(line);
    if (subject && (grade !== null || block.some((row) => findGrade(row) !== null))) flush();
    block.push(line);
  }
  flush();
  return blocks;
}

function parseVotiBlocks(lines: string[], today: string): Voto[] {
  const voti: Voto[] = [];
  for (const block of groupVotiBlocks(lines)) {
    const text = block.join(" ");
    const valore = findGrade(text);
    if (valore === null) continue;
    const materia = subjectFrom(text);
    if (!materia) continue;
    const data = findIsoDate(text) ?? today;
    const peso = findPeso(text);
    const tipo: Tipo = tipoOf(text);
    voti.push({ id: uid(), materia, valore, data, tipo, ...(peso === undefined ? {} : { peso }) });
  }
  return voti;
}

/** Usa l'intestazione "Materia | Voto | Peso" quando l'OCR conserva le colonne. */
function parseVotiTable(lines: string[], today: string): Voto[] {
  for (let index = 0; index < lines.length; index++) {
    const header = columnsOf(lines[index] ?? "");
    const find = (re: RegExp) => header.findIndex((cell) => re.test(cell));
    const colMateria = find(/materia/i);
    const colVoto = find(/voto|valutaz/i);
    if (header.length < 2 || colMateria < 0 || colVoto < 0) continue;
    const colData = find(/data/i);
    const colTipo = find(/tipo|tipolog/i);
    const colPeso = find(/peso/i);
    const voti: Voto[] = [];
    for (let row = index + 1; row < lines.length; row++) {
      const cells = columnsOf(lines[row] ?? "");
      if (cells.length < header.length) break;
      const materia = subjectFrom(cells[colMateria] ?? "");
      const valore = findGrade(cells[colVoto] ?? "");
      if (!materia || valore === null) continue;
      const data = colData >= 0 ? (findIsoDate(cells[colData] ?? "") ?? today) : today;
      const peso = colPeso >= 0 ? parsePeso(cells[colPeso] ?? "") : undefined;
      voti.push({
        id: uid(),
        materia,
        valore,
        data,
        tipo: tipoOf(colTipo >= 0 ? cells[colTipo] : ""),
        ...(peso === undefined ? {} : { peso }),
      });
    }
    return voti;
  }
  return [];
}

/**
 * Converte lo screenshot del registro in voti pronti per l'import.
 * Materia, Voto, Data, Tipo e Peso vengono letti quando presenti.
 * La data mancante viene sostituita con oggi: è il comportamento storico, usato
 * solo dai test e non dal flusso sicuro, che passa da parseVotiGrades.
 */
export function parseVotiScreenshot(raw: string, today = isoOf(new Date())): Voto[] {
  const lines = splitLines(raw);
  if (lines.length === 0) return [];
  const table = parseVotiTable(lines, today);
  const blocks = parseVotiBlocks(lines, today);
  return table.length >= blocks.length && table.length > 0 ? table : blocks;
}

/* --------------------------------------------------- voti: proposte OCR --- */

/** Confidenza 0–100 per singolo campo e per l'intera riga. */
export type GradeFieldConfidence = {
  subject: number;
  grade: number;
  date: number;
  type: number;
  weight: number;
};

/** Una riga letta dallo screenshot, prima della revisione umana. */
export type ParsedGrade = {
  materia: string;
  valore: number;
  /** null quando la data non è stata letta: non viene mai inventata. */
  data: string | null;
  tipo: Tipo;
  peso?: number;
  nota?: string;
  confidence: number;
  fieldConfidence: GradeFieldConfidence;
};

export type GradeParserOptions = {
  /** Materie già presenti nel registro: se la lettura combacia, la confidenza sale. */
  knownSubjects?: string[];
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Media pesata delle confidenze: il voto conta più della tipologia. */
export function rowConfidence(field: GradeFieldConfidence): number {
  return clamp(field.grade * 0.45 + field.subject * 0.3 + field.date * 0.15 + field.type * 0.1);
}

/** Unisce la confidenza OCR della riga con la solidità del parser. */
const combine = (ocr: number, certainty: number) => clamp(ocr * 0.45 + certainty * 0.55);

const normalizeText = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLocaleLowerCase("it-IT");

function textConfidence(text: string, document: OcrDocument): number {
  const target = normalizeText(text);
  const pool = document.rows && document.rows.length > 0 ? document.rows : document.lines;
  const hits = pool.filter((line) => {
    const candidate = normalizeText(line.text);
    return candidate.length > 2 && target.includes(candidate);
  });
  if (hits.length === 0) return document.confidence;
  return Math.round(hits.reduce((sum, line) => sum + line.confidence, 0) / hits.length);
}

type DateEvidence = { iso: string; certainty: number };

/** Data + affidabilità: con l'anno è più sicura, senza anno può essere dell'anno scorso. */
export function findDateEvidence(text: string): DateEvidence | null {
  const hits = [
    ...numericDates(text).map((hit) => ({ ...hit, verbal: false })),
    ...monthDates(text).map((hit) => ({ ...hit, verbal: true })),
  ].sort((a, b) => a.index - b.index);
  for (const hit of hits) {
    const date = new Date(hit.y, hit.m - 1, hit.d);
    // 31/02 non deve diventare 3 marzo: se il calendario corregge, la lettura è sbagliata.
    if (date.getMonth() !== hit.m - 1 || date.getDate() !== hit.d) continue;
    const certainty = hit.verbal ? (hit.hasYear ? 93 : 84) : hit.hasYear ? 96 : 82;
    return { iso: isoOf(date), certainty };
  }
  return null;
}

/** Tipologia + affidabilità: senza parole chiave resta "Scritto", ma con poca fiducia. */
export function typeEvidence(text: string): { tipo: Tipo; certainty: number } {
  const value = fold(text);
  if (/\boral|interrog/.test(value)) return { tipo: "Orale", certainty: 95 };
  if (/\bpratic|\blaborator|\bgrafic/.test(value)) return { tipo: "Pratico", certainty: 90 };
  if (/\bscritt|\bverific|\bcompito|\btema\b|\brelazion|\beserciz/.test(value))
    return { tipo: "Scritto", certainty: 92 };
  return { tipo: "Scritto", certainty: 32 };
}

function noteOf(text: string): string | undefined {
  const match = text.match(/\b(?:nota|note|giudizio|commento)\b\s*[:–-]\s*([^|]{3,140})/i);
  const note = match?.[1]?.replace(/\s+/g, " ").trim();
  return note ? note.slice(0, 120) : undefined;
}

function isKnownSubject(subject: string, known: string[]): boolean {
  const target = fold(subject).replace(/\s+/g, " ").trim();
  return [...known, ...COMMON_SUBJECTS].some((name) => {
    const candidate = fold(name).replace(/\s+/g, " ").trim();
    return candidate.length > 2 && (target === candidate || target.includes(candidate));
  });
}

function buildGrade(
  parts: {
    materia: string;
    grade: { valore: number; certainty: number };
    date: DateEvidence | null;
    type: { tipo: Tipo; certainty: number };
    peso?: number;
    pesoCertainty?: number;
    nota?: string;
  },
  ocr: number,
  known: string[],
): ParsedGrade {
  const subjectCertainty = isKnownSubject(parts.materia, known) ? 100 : 58;
  const fieldConfidence: GradeFieldConfidence = {
    subject: combine(ocr, subjectCertainty),
    grade: combine(ocr, parts.grade.certainty),
    date: parts.date ? combine(ocr, parts.date.certainty) : 0,
    type: combine(ocr, parts.type.certainty),
    weight: parts.peso === undefined ? 0 : combine(ocr, parts.pesoCertainty ?? 92),
  };
  return {
    materia: parts.materia,
    valore: parts.grade.valore,
    data: parts.date?.iso ?? null,
    tipo: parts.type.tipo,
    ...(parts.peso === undefined ? {} : { peso: parts.peso }),
    ...(parts.nota ? { nota: parts.nota } : {}),
    confidence: rowConfidence(fieldConfidence),
    fieldConfidence,
  };
}

/** Formato "Materia | Voto | Data | Tipo | Peso" con le colonne conservate. */
function parseGradeTable(lines: string[], document: OcrDocument, known: string[]): ParsedGrade[] {
  for (let index = 0; index < lines.length; index++) {
    const header = columnsOf(lines[index] ?? "");
    const find = (re: RegExp) => header.findIndex((cell) => re.test(cell));
    const colMateria = find(/materia/i);
    const colVoto = find(/voto|valutaz/i);
    if (header.length < 2 || colMateria < 0 || colVoto < 0) continue;
    const colData = find(/data/i);
    const colTipo = find(/tipo|tipolog/i);
    const colPeso = find(/peso/i);
    const colNota = find(/nota|giudizio|commento/i);
    const grades: ParsedGrade[] = [];
    for (let row = index + 1; row < lines.length; row++) {
      const line = lines[row] ?? "";
      const cells = columnsOf(line);
      // Una colonna finale vuota (spesso il Peso) non deve far perdere la riga.
      if (cells.length < 2) break;
      const materia = subjectFrom(cells[colMateria] ?? "");
      const evidence = gradeEvidence(cells[colVoto] ?? "");
      if (!materia || !evidence) continue;
      // Nella colonna "Voto" il numero è il voto per costruzione, non un numero qualsiasi.
      const grade = { ...evidence, certainty: Math.max(evidence.certainty, 96) };
      const date = colData >= 0 ? findDateEvidence(cells[colData] ?? "") : null;
      // Se c'è la colonna Data ma la cella non ne contiene una, siamo fuori tabella.
      if (colData >= 0 && !date) continue;
      const peso = colPeso >= 0 ? parsePeso(cells[colPeso] ?? "") : undefined;
      grades.push(
        buildGrade(
          {
            materia,
            grade,
            date,
            type: typeEvidence(colTipo >= 0 ? (cells[colTipo] ?? "") : ""),
            ...(peso === undefined ? {} : { peso, pesoCertainty: 95 }),
            ...(colNota >= 0 && cells[colNota] ? { nota: cells[colNota]!.slice(0, 120) } : {}),
          },
          textConfidence(line, document),
          known,
        ),
      );
    }
    return grades;
  }
  return [];
}

/** Schede "Materia / Voto / Data / Tipo" una sotto l'altra. */
function parseGradeBlocks(lines: string[], document: OcrDocument, known: string[]): ParsedGrade[] {
  const grades: ParsedGrade[] = [];
  for (const block of groupVotiBlocks(lines)) {
    const text = block.join(" ");
    const grade = gradeEvidence(text);
    if (!grade) continue;
    const materia = subjectFrom(text);
    if (!materia) continue;
    const peso = findPeso(text);
    const nota = noteOf(text);
    grades.push(
      buildGrade(
        {
          materia,
          grade,
          date: findDateEvidence(text),
          type: typeEvidence(text),
          ...(peso === undefined ? {} : { peso }),
          ...(nota ? { nota } : {}),
        },
        textConfidence(text, document),
        known,
      ),
    );
  }
  return grades;
}

/**
 * Legge i voti da un documento OCR conservando la confidenza di ogni campo.
 * Le date mancanti restano null: la revisione chiede di completarle.
 */
export function parseVotiGrades(
  input: string | OcrDocument,
  options: GradeParserOptions = {},
): ParsedGrade[] {
  const document: OcrDocument =
    typeof input === "string"
      ? {
          text: input,
          confidence: 82,
          lines: splitLines(input).map((text) => ({ text, confidence: 82 })),
          preprocess: "soft",
        }
      : input;
  // Le righe visive ricostruite dalle coordinate valgono più dell'ordine di lettura
  // di Tesseract, che a volte elenca prima tutte le materie e poi tutte le date.
  const source =
    document.rows && document.rows.length > 1
      ? document.rows.map((row) => row.text).join("\n")
      : document.text;
  const lines = splitLines(source);
  if (lines.length === 0) return [];
  const known = options.knownSubjects ?? [];
  const table = parseGradeTable(lines, document, known);
  const blocks = parseGradeBlocks(lines, document, known);
  return table.length >= blocks.length && table.length > 0 ? table : blocks;
}

/* --------------------------------------------------------- compiti: testo --- */

export type HomeworkItem = {
  title: string;
  subject: string;
  dueAt: number | null;
  /** Pomodori stimati (25 min) per il Time Boxing. */
  estimatedBlocks: number;
};

const COMMON_SUBJECTS = [
  "italiano",
  "matematica",
  "storia",
  "geografia",
  "geostoria",
  "scienze",
  "scienze naturali",
  "scienze umane",
  "fisica",
  "chimica",
  "biologia",
  "inglese",
  "francese",
  "spagnolo",
  "tedesco",
  "latino",
  "greco",
  "filosofia",
  "arte e immagine",
  "arte",
  "musica",
  "educazione fisica",
  "scienze motorie",
  "informatica",
  "tecnologia",
  "religione",
  "diritto",
  "economia",
  "letteratura",
  "cittadinanza",
];

const NOISE_LINE =
  /^(classroom|stream|attività|attivita|compiti|compito|calendario|iscriviti|tutte le attività|tutte le attivita|scadenze|apri|altro|home|materie|voti|registro|notifiche|account|menu|profilo|impostazioni|indietro|avanti|carica|condividi|commenti|consegnato|in ritardo|assegnato|postato)$/i;

const CUE =
  /(esercizi|esercizio|pag\.|pagg?\.|pagina|pagine|tema|saggio|riassunto|riassumere|schema|mappa|studiare|ripass|leggere|lettura|completare|rispondere|svolgere|relazione|ricerca|problemi|equazion|traduzione|verbi|analisi|commento|parafrasi|progetto|laboratorio|disegno|presentazione|verifica|interrogazione|test|domande|memorizzare|fotocopie|scheda|note|es\.)/i;

const TITLE_LABEL =
  /^(?:compiti?(?:\s+di|\s+per)?|compito|consegna|consegnare|scadenza|da consegnare|attività|attivita|materiali|istruzioni|dettagli)\s*[:–-]?\s*/i;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matchSubject(text: string, known: string[]): string | null {
  const haystack = fold(text);
  const pool = [...new Set([...known, ...COMMON_SUBJECTS])]
    .map((name) => name.trim())
    .filter((name) => name.length > 2)
    .sort((a, b) => b.length - a.length);
  for (const candidate of pool) {
    const needle = fold(candidate);
    if (!needle) continue;
    const re = new RegExp(`(^|[^\\p{L}])${escapeRegExp(needle)}([^\\p{L}]|$)`, "u");
    if (re.test(haystack)) return cap(candidate);
  }
  return null;
}

function subjectHeading(line: string, known: string[]): string | null {
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;
  const trimmed = line
    .replace(
      /^(compiti?(?:\s+di|\s+per)?|compito|verifica|esercizi|esercizio|attività|attivita|materiali|consegna|scadenza|lavoro)\s*(?:di|per|:|-|–)?\s*/i,
      "",
    )
    .trim();
  return matchSubject(trimmed, known);
}

function guessSubject(lines: string[], known: string[]): string {
  for (const line of lines.slice(0, 4)) {
    const trimmed = line
      .replace(
        /^(compiti?(?:\s+di)?|compito|verifica|esercizi(?:\s+di)?|lavoro(?:\s+di)?)\s*[:–-]?\s*/i,
        "",
      )
      .replace(/\.$/, "")
      .trim();
    const match = matchSubject(trimmed, known);
    if (match) return match;
    const words = trimmed.split(/\s+/).filter(Boolean);
    const lettersOnly = /^\p{L}[\p{L}\s'’&.]*$/u.test(trimmed);
    if (words.length > 0 && words.length <= 2 && lettersOnly && trimmed.length >= 4)
      return cap(trimmed);
  }
  return "";
}

function isSubjectLine(line: string, known: string[]): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  return (
    words.length > 0 && words.length <= 3 && matchSubject(line, known) !== null && !CUE.test(line)
  );
}

function isDateOnly(line: string): boolean {
  const rest = stripDates(line)
    .replace(/\b(?:lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/gi, " ")
    .replace(
      /\b(?:scadenza|consegna|consegnare|entro|il|la|per|ore|h|domani|oggi|dopodomani)\b/gi,
      " ",
    )
    .replace(/[^\p{L}]/gu, "")
    .trim();
  return rest.length === 0;
}

function smartCase(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (trimmed === trimmed.toUpperCase() && trimmed.length > 4) return cap(trimmed);
  return trimmed.charAt(0).toLocaleUpperCase("it-IT") + trimmed.slice(1);
}

function pickTitle(lines: string[], known: string[]): string | null {
  const candidates = lines
    .map((line) => ({
      text: smartCase(line.replace(TITLE_LABEL, "").replace(/[;:,]\s*$/, "")),
      cue: CUE.test(line),
    }))
    .filter((candidate) => candidate.text.length >= 4)
    .filter((candidate) => !isSubjectLine(candidate.text, known))
    .filter((candidate) => !isDateOnly(candidate.text))
    .sort((a, b) => Number(b.cue) - Number(a.cue) || b.text.length - a.text.length);
  const best = candidates[0];
  return best ? best.text.slice(0, 120) : null;
}

function estimateBlocks(text: string): number {
  const value = text.toLocaleLowerCase("it-IT");
  if (/\b(verifica|interrogazione|esame|prova)\b/.test(value)) return 3;
  if (/\b(tema|saggio|relazione|ricerca|progetto|presentazione|riassunto)\b/.test(value)) return 4;
  if (/(pagg\.|pagine)/.test(value) && /(pagg\.|pagine)[^\d]{0,6}\d+\s*[-–]\s*\d+/.test(value))
    return 3;
  if (/(esercizi|esercizio|pagg?\.|pagine|problemi|equazioni|es\.)/.test(value)) return 2;
  if (/(leggere|lettura|ripass|studiare|memorizz|tradurre|traduzione)/.test(value)) return 1;
  return 2;
}

/** Divide lo screenshot in sezioni intestate da una materia (le liste di Classroom ne hanno una per riga). */
function splitSections(lines: string[], known: string[]): string[][] {
  const sections: string[][] = [];
  let section: string[] = [];
  let hasHeading = false;
  for (const line of lines) {
    if (NOISE_LINE.test(line.replace(/\s+/g, " "))) continue;
    const heading = subjectHeading(line, known);
    if (heading && hasHeading) {
      sections.push(section);
      section = [];
      hasHeading = false;
    }
    if (heading) hasHeading = true;
    section.push(line);
  }
  if (section.length) sections.push(section);
  return sections;
}

/**
 * Converte lo screenshot di Classroom (o la foto della lavagna) in compiti.
 * Materia e data di consegna vengono dedotte dal testo; i pomodori sono una stima
 * locale basata sulle parole chiave dell'assegnazione.
 */
export function parseHomeworkScreenshot(
  raw: string,
  now = Date.now(),
  known: string[] = [],
): HomeworkItem[] {
  const lines = splitLines(raw)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1 && !NOISE_LINE.test(line));
  if (lines.length === 0) return [];

  const seen = new Set<string>();
  const items: HomeworkItem[] = [];
  for (const section of splitSections(lines, known)) {
    const text = section.join("\n");
    const subject = guessSubject(section, known) || matchSubject(text, known) || "";
    const deadline = findDeadline(text, now);
    const title = pickTitle(section, known);
    const hasCue = CUE.test(text) || DEADLINE_CUE.test(text);
    if (!title && !hasCue) continue;
    const finalTitle = title ?? (subject ? `Compiti di ${subject}` : "Compiti da consegnare");
    const key = `${subject}|${finalTitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      title: finalTitle,
      subject,
      dueAt: deadline?.at ?? null,
      estimatedBlocks: estimateBlocks(`${finalTitle} ${text}`),
    });
  }
  return items.slice(0, 12);
}
