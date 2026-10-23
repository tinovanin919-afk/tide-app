// Estrazione strutturata dalle proposte dell'Inbox.
//
// Due adapter, in ordine: OllamaAdapter (locale, opzionale) → RuleBasedAdapter
// (sempre disponibile). Le regole restano la base: se Ollama non c'è o sbaglia,
// il sistema funziona comunque. Date, voti, pesi e URL proposti dall'AI vengono
// accettati solo se compaiono davvero nel testo OCR: mai inventati.

import { flags } from "./config.mjs";

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

const fold = (value) =>
  String(value)
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const smartCase = (value) => {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return "";
  if (text === text.toLocaleUpperCase("it-IT") && text.length > 4) {
    return text.charAt(0) + text.slice(1).toLocaleLowerCase("it-IT");
  }
  return text.charAt(0).toLocaleUpperCase("it-IT") + text.slice(1);
};

export const combineConfidence = (ocr, certainty) => clamp(ocr * 0.45 + certainty * 0.55);

/* --------------------------------------------------------------- link --- */

const escapeRegExp = (value) => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

const hostMatches = (pattern, host) => {
  const source = `^${escapeRegExp(pattern).replace(/\*/g, ".*")}$`;
  return new RegExp(source).test(host);
};

/** Solo http/https, senza credenziali, e solo host in allowlist (anche wildcard). */
export function sanitizeUrl(raw, allowlist) {
  const value = String(raw ?? "")
    .trim()
    .replace(/[)\].,;:'"»]+$/g, "");
  if (!value || value.length > 2000) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLocaleLowerCase("en-US");
  if (!host) return null;
  const candidates = host.startsWith("www.") ? [host, host.slice(4)] : [host];
  const allowed =
    allowlist.hosts.some((entry) => candidates.includes(entry)) ||
    allowlist.patterns.some((pattern) => candidates.some((entry) => hostMatches(pattern, entry)));
  return allowed ? url.toString() : null;
}

/** Il testo può contenere "classroom. google. com": prova anche senza spazi. */
function urlCandidates(text) {
  const clean = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const spaced = text.match(/https?:\/\/[^\n]{3,240}/gi) ?? [];
  return [
    ...new Set([...clean, ...spaced.map((chunk) => chunk.replace(/\s+/g, "").slice(0, 240))]),
  ];
}

export function findUrl(text, allowlist) {
  // Si controllano tutti i candidati: anche gli URL scartati finiscono nel log.
  const rejected = new Set();
  let url = null;
  for (const candidate of urlCandidates(text)) {
    const safe = sanitizeUrl(candidate, allowlist);
    if (safe) {
      url ??= safe;
    } else {
      rejected.add(candidate.slice(0, 80));
    }
  }
  return { url, rejected: [...rejected] };
}

/* --------------------------------------------------------------- date --- */

const MONTH_ALIASES = {
  gen: 1,
  gennaio: 1,
  feb: 2,
  febbraio: 2,
  mar: 3,
  marzo: 3,
  apr: 4,
  aprile: 4,
  mag: 5,
  maggio: 5,
  giu: 6,
  giugno: 6,
  lug: 7,
  luglio: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  settembre: 9,
  ott: 10,
  ottobre: 10,
  nov: 11,
  novembre: 11,
  dic: 12,
  dicembre: 12,
};

const MONTH_SRC =
  "gen(?:naio)?|feb(?:braio)?|mar(?:zo)?|apr(?:ile)?|mag(?:gio)?|giu(?:gno)?|lug(?:lio)?|ago(?:sto)?|set(?:tembre)?|ott(?:obre)?|nov(?:embre)?|dic(?:embre)?";

const DEADLINE_CUE =
  /\b(scadenz\w*|consegn\w*|entro|da consegnare|per il|per la|in data|verifica|esame|interrogazione)\b/i;

const pad = (value) => String(value).padStart(2, "0");
const isoOfDate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function isValidParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * Tutte le date scritte nel testo (numeriche e a parole), con la loro posizione.
 * L'anno mancante viene assunto corrente: la data resta "lette", non inventata.
 */
export function datesInText(text, now = new Date()) {
  const hits = [];
  const numeric = /\b(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?\b/g;
  for (const match of text.matchAll(numeric)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const yearRaw = match[3];
    // "7/10" senza anno e con giorno ≤ 12 è più probabilmente un voto.
    if (yearRaw === undefined && day <= 12) continue;
    const year =
      yearRaw === undefined
        ? now.getFullYear()
        : Number(yearRaw) < 100
          ? 2000 + Number(yearRaw)
          : Number(yearRaw);
    if (!isValidParts(year, month, day)) continue;
    hits.push({
      iso: `${year}-${pad(month)}-${pad(day)}`,
      year,
      month,
      day,
      hasYear: yearRaw !== undefined,
      index: match.index ?? 0,
    });
  }
  const verbal = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_SRC})\\.?\\s*(\\d{4})?`, "gi");
  for (const match of text.matchAll(verbal)) {
    const day = Number(match[1]);
    const month = MONTH_ALIASES[fold(match[2] ?? "")];
    if (!month) continue;
    const year = match[3] ? Number(match[3]) : now.getFullYear();
    if (!isValidParts(year, month, day)) continue;
    hits.push({
      iso: `${year}-${pad(month)}-${pad(day)}`,
      year,
      month,
      day,
      hasYear: Boolean(match[3]),
      index: match.index ?? 0,
    });
  }
  return hits.sort((a, b) => a.index - b.index);
}

const todayStart = (now) => {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
};

/**
 * Scadenza/esame: preferisce la data vicina a "entro/consegna/verifica", poi la
 * prima data futura. Se il testo contiene solo date passate, restituisce null:
 * la data viene chiesta a mano, non inventata.
 */
export function findDateEvidence(text, now = new Date()) {
  const start = todayStart(now);
  const future = datesInText(text, now)
    .map((hit) => {
      const date = new Date(hit.year, hit.month - 1, hit.day);
      return { ...hit, date };
    })
    .filter((hit) => hit.date.getTime() >= start.getTime());
  if (future.length > 0) {
    const cued = future.find((hit) =>
      DEADLINE_CUE.test(fold(text.slice(Math.max(0, hit.index - 32), hit.index))),
    );
    const hit = cued ?? future[0];
    return { iso: hit.iso, certainty: hit.hasYear ? 96 : 82 };
  }

  const folded = fold(text);
  const day = new Date(now);
  day.setHours(12, 0, 0, 0);
  if (/\bdopodomani\b/.test(folded)) {
    day.setDate(day.getDate() + 2);
    return { iso: isoOfDate(day), certainty: 68 };
  }
  if (/\bdomani\b/.test(folded)) {
    day.setDate(day.getDate() + 1);
    return { iso: isoOfDate(day), certainty: 68 };
  }
  if (/\b(oggi|stasera)\b/.test(folded)) {
    return { iso: isoOfDate(day), certainty: 60 };
  }
  return null;
}

/* --------------------------------------------------------------- voto --- */

const normalizeNumber = (raw) => {
  const value = Number(String(raw).replace(",", "."));
  return Number.isFinite(value) ? value : null;
};

const stripGradeNoise = (text) =>
  text
    // Si tolgono solo le date vere: "8/10" è un voto, non il 8 ottobre.
    .replace(
      /\b(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?\b/g,
      (full, dayRaw, monthRaw, yearRaw) => {
        const day = Number(dayRaw);
        const month = Number(monthRaw);
        const isDate = yearRaw !== undefined || (month >= 1 && month <= 12 && day > 12);
        return isDate ? " " : full;
      },
    )
    .replace(
      /\b\d{1,2}\s+(?:gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\w*\.?\s*\d{0,4}/gi,
      " ",
    )
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, " ")
    .replace(/\bpeso\b\s*[:–-]?\s*\d+(?:[.,]\d+)?/gi, " ");

/** Voto letto dal testo: etichetta o "/10" sono forti, un numero isolato è debole. */
export function gradeEvidence(text) {
  const clean = stripGradeNoise(text);
  const labelled = clean.match(
    /\b(?:voto|voti|valutazione)\b\s*[:–-]?\s*(\d{1,2}(?:[.,]\d{1,2})?)(?:\s*\/\s*10)?/i,
  );
  if (labelled) {
    const value = normalizeNumber(labelled[1] ?? "");
    if (value !== null && value >= 1 && value <= 10) return { value, certainty: 97 };
  }
  const overTen = clean.match(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s*\/\s*10\b/);
  if (overTen) {
    const value = normalizeNumber(overTen[1] ?? "");
    if (value !== null && value >= 1 && value <= 10) return { value, certainty: 95 };
  }
  const isolated = clean.match(/(?:^|\n)\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:\n|$)/);
  if (isolated) {
    const value = normalizeNumber(isolated[1] ?? "");
    if (value !== null && value >= 1 && value <= 10) return { value, certainty: 58 };
  }
  // Riga di registro senza etichette: "ITALIANO 7 12/10/2026 Scritto".
  // Solo un numero 1–10 nella riga: con più numeri la lettura è ambigua e si omette.
  const tokens = clean.match(/(?<![\d/])\d{1,2}(?:[.,]\d{1,2})?(?![\d/])/g) ?? [];
  const values = [
    ...new Set(
      tokens.map(normalizeNumber).filter((value) => value !== null && value >= 1 && value <= 10),
    ),
  ];
  if (values.length === 1) return { value: values[0], certainty: 60 };
  return null;
}

export function weightEvidence(text) {
  const match = text.match(/\bpeso\b\s*[:–-]?\s*(\d{1,2}(?:[.,]\d{1,2})?)/i);
  if (!match) return null;
  const value = normalizeNumber(match[1] ?? "");
  if (value === null || value <= 0 || value > 10) return null;
  return { value, certainty: 95 };
}

export function gradeTypeEvidence(text) {
  const value = fold(text);
  if (/\borale\b|\borali\b|interrogazion|interrogazione/.test(value))
    return { value: "Orale", certainty: 94 };
  if (/\bpratico\b|\bpratica\b|laborator|grafic/.test(value))
    return { value: "Pratico", certainty: 90 };
  if (/\bscritto\b|verific|compito|tema\b|relazion|eserciz/.test(value))
    return { value: "Scritto", certainty: 92 };
  return null;
}

/* -------------------------------------------------------------- materia --- */

const COMMON_SUBJECTS = [
  "italiano",
  "matematica",
  "storia",
  "geografia",
  "geostoria",
  "scienze",
  "scienze naturali",
  "scienze umane",
  "scienze motorie",
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
  "arte",
  "arte e immagine",
  "musica",
  "educazione fisica",
  "informatica",
  "tecnologia",
  "religione",
  "diritto",
  "economia",
  "letteratura",
  "cittadinanza",
];

export function subjectEvidence(text) {
  const labelled = text.match(/\bmateria\s*[:–-]\s*([^\n|]{2,40})/i);
  if (labelled) {
    const value = smartCase((labelled[1] ?? "").replace(/\s+/g, " ").trim());
    if (value.length >= 3 && /^[\p{L}\s'’&.]+$/u.test(value)) return { value, certainty: 96 };
  }
  const possessive = text.match(
    /\b(?:compiti|compito|verifica|esame|interrogazione|nota|esercizi)\s+(?:di|d['’])\s+([\p{L}'’ ]{3,30})/iu,
  );
  if (possessive) {
    const value = smartCase((possessive[1] ?? "").trim());
    if (value.length >= 3) return { value, certainty: 88 };
  }
  const folded = fold(text);
  const match = [...COMMON_SUBJECTS]
    .sort((a, b) => b.length - a.length)
    .find((subject) =>
      new RegExp(`(^|[^\\p{L}])${escapeRegExp(fold(subject))}([^\\p{L}]|$)`, "u").test(folded),
    );
  return match ? { value: smartCase(match), certainty: 86 } : null;
}

/* --------------------------------------------------------------- titolo --- */

const UI_NOISE =
  /^(classroom|stream|compiti|compito|calendario|iscriviti|tutte le attività|tutte le attivita|scadenze|apri|altro|home|materie|voti|registro|notifiche|account|menu|profilo|impostazioni|indietro|avanti|carica|condividi|commenti|consegnato|in ritardo|assegnato|postato|lavagna|salva|cerca|documenti|file|immagine)$/i;

const CUE =
  /(esercizi|esercizio|pag\.|pagg?\.|pagina|pagine|tema|saggio|riassunto|schema|mappa|studiare|ripass|leggere|lettura|completare|rispondere|svolgere|relazione|ricerca|problemi|equazion|traduzione|analisi|commento|parafrasi|progetto|laboratorio|disegno|presentazione|verifica|interrogazione|test|domande|memorizzare|fotocopie|scheda|consegna|scadenza)/i;

// Si toglie l'etichetta solo quando è seguita da ":" o da un trattino:
// "Compiti di Matematica" resta un titolo, "Compito: esercizi" diventa "Esercizi".
const TITLE_LABEL =
  /^(?:titolo|compiti|compito|consegna|consegnare|scadenza|da consegnare|attività|attivita|materiali|istruzioni|dettagli|verifica|esame|interrogazione|nota|note|link)\s*[:–-]\s*/i;

const isOnlyDate = (value) =>
  value
    .replace(/\b\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?\b/g, " ")
    .replace(/\b(?:gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\w*\b/gi, " ")
    .replace(/\b(?:lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/gi, " ")
    .replace(/[^\p{L}]/gu, "")
    .trim().length === 0;

const isOnlyNumber = (value) => /^[\d.,/\s]+$/.test(value);

const meaningfulLines = (text) =>
  text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1 && !UI_NOISE.test(line));

function pickTitle(lines) {
  // Per i link la riga con l'URL non è un titolo: si usa il testo attorno.
  const candidates = lines
    .map((line, index) => ({
      index,
      text: smartCase(
        line
          .replace(TITLE_LABEL, "")
          .replace(/[;:,]\s*$/, "")
          .trim(),
      ),
      cue: CUE.test(line),
    }))
    .filter((candidate) => candidate.text.length >= 4 && candidate.text.length <= 140)
    .filter((candidate) => !/^https?:\/\//i.test(candidate.text))
    .filter((candidate) => !isOnlyDate(candidate.text) && !isOnlyNumber(candidate.text));
  if (candidates.length === 0) return null;
  const cued = candidates.filter((candidate) => candidate.cue);
  const pool = cued.length > 0 ? cued : candidates;
  const best = pool.sort(
    (a, b) => Number(b.text.length >= 8) - Number(a.text.length >= 8) || a.index - b.index,
  )[0];
  return best ? best.text.slice(0, 140) : null;
}

/* ------------------------------------------------------------ regole --- */

const FIELDS_BY_TYPE = {
  task: ["title", "subject", "description", "dueDate"],
  exam: ["title", "subject", "description", "examDate"],
  grade: ["subject", "grade", "gradeType", "weight"],
  note: ["title", "subject", "description"],
  link: ["title", "description", "url"],
  unknown: ["title", "subject", "description", "dueDate", "grade", "url"],
};

/** Euristica usata solo fuori dalle cinque cartelle (la cartella forza il tipo). */
export function guessType(text) {
  const folded = fold(text);
  if (/\bverifica\b|\besame\b|interrogazion/.test(folded)) return "exam";
  if (/\b\d{1,2}\s*\/\s*10\b|\bvoto\b/.test(folded)) return "grade";
  if (/https?:\/\//i.test(text)) return "link";
  if (/consegn|scadenz|esercizi|compiti|pagina|entro/.test(folded)) return "task";
  if (text.trim()) return "note";
  return "unknown";
}

/**
 * RuleBasedAdapter: estrae solo ciò che il testo contiene.
 * Restituisce valori + confidenza per campo (0 quando il campo manca).
 */
export function extractRules({ text, type, allowlist, now = new Date(), ocrConfidence = 92 }) {
  const values = {};
  const confidence = {};
  const notes = [];
  const lines = meaningfulLines(text);

  const title = pickTitle(lines);
  const subject = subjectEvidence(text);
  const grade = gradeEvidence(text);
  const weight = weightEvidence(text);
  const gradeType = gradeTypeEvidence(text);
  const date = findDateEvidence(text, now);
  const link = findUrl(text, allowlist);

  const set = (key, value, certainty) => {
    if (value === undefined || value === null || value === "") return;
    values[key] = value;
    confidence[key] = certainty;
  };

  set("title", title, title ? (CUE.test(title) ? 92 : 78) : null);
  set("subject", subject?.value, subject?.certainty);
  set("grade", grade?.value, grade?.certainty);
  set("weight", weight?.value, weight?.certainty);
  set("gradeType", gradeType?.value, gradeType?.certainty);
  set("url", link.url, link.url ? 97 : null);
  if (type === "task") set("dueDate", date?.iso, date?.certainty);
  if (type === "exam") set("examDate", date?.iso, date?.certainty);
  if (type === "unknown" && date) set("dueDate", date.iso, date.certainty);

  const titleLine = title ? fold(title) : "";
  const body = lines
    .filter((line) => fold(line) !== titleLine)
    .filter((line) => !/^https?:\/\//i.test(line))
    .join(" ")
    .trim();
  if (
    body &&
    (type === "note" || type === "task" || type === "exam" || type === "link" || type === "unknown")
  ) {
    set("description", body.slice(0, 280), 74);
  }

  if (link.rejected.length > 0)
    notes.push(`link fuori allowlist ignorati: ${link.rejected.join(", ")}`);

  const allowed = new Set(FIELDS_BY_TYPE[type] ?? FIELDS_BY_TYPE.unknown);
  const fields = {};
  const scores = {};
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) continue;
    fields[key] = values[key];
    scores[key] = combineConfidence(ocrConfidence, confidence[key] ?? 0);
  }
  return { values: fields, fieldConfidence: scores, notes };
}

/* ------------------------------------------------------------ Ollama --- */

const OLLAMA_URL = process.env.TIDE_OLLAMA_URL?.trim() || "http://localhost:11434";
const PREFERRED_MODELS = [
  process.env.TIDE_OLLAMA_MODEL?.trim(),
  "qwen2.5:3b",
  "llama3.2:3b",
].filter(Boolean);

/**
 * OllamaAdapter (opzionale): se il server locale non c'è, il chiamante resta
 * sulle regole. Nessuna richiesta esce da localhost.
 */
export async function probeOllama({ logger }) {
  if (!flags.ollama) return null;
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const installed = (Array.isArray(data?.models) ? data.models : [])
      .map((model) => String(model?.name ?? "").trim())
      .filter(Boolean);
    const model = PREFERRED_MODELS.find((name) =>
      installed.some(
        (candidate) =>
          candidate === name ||
          candidate.startsWith(`${name}:`) ||
          (!name.includes(":") && candidate.split(":")[0] === name),
      ),
    );
    if (!model) {
      logger.info(
        `Ollama è attivo ma nessuno dei modelli consigliati è installato (${PREFERRED_MODELS.join(", ")}): uso le regole`,
      );
      return null;
    }
    return { baseUrl: OLLAMA_URL, model };
  } catch {
    logger.info("Ollama non raggiungibile: estrazione con le regole locali");
    return null;
  }
}

const OLLAMA_PROMPT = (text, type) => `Sei un assistente locale per un'app di scuola italiana.
Estrai i dati dal testo OCR qui sotto. Tipo proposta: ${type} (deciso dalla cartella, non cambiarlo).

Rispondi SOLO con un oggetto JSON valido, senza spiegazioni. Chiavi ammesse:
title, subject, description, dueDate, examDate, grade, gradeType, weight, url.

Regole:
- dueDate e examDate: formato YYYY-MM-DD, solo se una data compare nel testo; se manca l'anno usa l'anno corrente.
- grade: numero 1-10 solo se il testo contiene un voto. weight: numero 1-10 solo se compare "peso".
- gradeType: "Scritto", "Orale" o "Pratico" solo se il testo lo indica.
- url: copia solo URL http/https presenti nel testo.
- Non inventare date, voti, pesi, materie o URL: se non li leggi, ometti la chiave.
- title e description: brevi e fedeli al testo.

TESTO OCR:
"""${text.slice(0, 6000)}"""`;

async function ollamaExtract(ollama, text, type, logger) {
  try {
    const response = await fetch(`${ollama.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: ollama.model,
        prompt: OLLAMA_PROMPT(text, type),
        stream: false,
        format: "json",
        options: { temperature: 0, num_predict: 400 },
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const raw = String(data?.response ?? "")
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    logger.warn(
      `Ollama: proposta non disponibile, uso le regole (${String(error?.message ?? error).slice(0, 120)})`,
    );
    return null;
  }
}

const sharesWord = (value, foldedText) => {
  const words = value.match(/[\p{L}\d]{4,}/gu) ?? [];
  return words.some((word) => foldedText.includes(fold(word)));
};

/** Accetta dall'AI solo campi verificabili nel testo OCR. */
function groundAiValues(raw, { text, type, allowlist, ocrConfidence }) {
  const allowed = new Set(FIELDS_BY_TYPE[type] ?? FIELDS_BY_TYPE.unknown);
  const folded = fold(text);
  const isoDates = new Set(datesInText(text).map((hit) => hit.iso));
  const deadline = findDateEvidence(text);
  if (deadline) isoDates.add(deadline.iso);
  const compactText = text.replace(/\s+/g, "");
  const values = {};
  const fieldConfidence = {};
  const accept = (key, value, certainty = 84) => {
    if (!allowed.has(key)) return;
    values[key] = value;
    fieldConfidence[key] = combineConfidence(ocrConfidence, certainty);
  };

  const stringValue = (value, max) =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

  const title = stringValue(raw.title, 140);
  if (title.length >= 4 && sharesWord(title, folded)) accept("title", title, 82);

  const subject = stringValue(raw.subject, 40);
  if (subject.length >= 3) {
    const known = COMMON_SUBJECTS.some((entry) => fold(entry) === fold(subject));
    if (known || sharesWord(subject, folded)) accept("subject", subject, 84);
  }

  const description = stringValue(raw.description, 400);
  if (description.length >= 4) accept("description", description, 72);

  const isoDate = (value) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
  const dueDate = isoDate(raw.dueDate);
  if (type === "task" && dueDate && isoDates.has(dueDate)) accept("dueDate", dueDate, 86);
  if (type === "unknown" && dueDate && isoDates.has(dueDate)) accept("dueDate", dueDate, 82);
  const examDate = isoDate(raw.examDate);
  if (type === "exam" && examDate && isoDates.has(examDate)) accept("examDate", examDate, 86);

  const numbers = new Set(
    (text.match(/\d{1,2}(?:[.,]\d{1,2})?/g) ?? [])
      .map((token) => normalizeNumber(token))
      .filter((value) => value !== null),
  );
  const grade =
    typeof raw.grade === "number" ? raw.grade : normalizeNumber(String(raw.grade ?? ""));
  if (type === "grade" && grade !== null && grade >= 1 && grade <= 10 && numbers.has(grade)) {
    accept("grade", grade, 84);
  }
  if (type === "unknown" && grade !== null && grade >= 1 && grade <= 10 && numbers.has(grade)) {
    accept("grade", grade, 80);
  }

  const weight =
    typeof raw.weight === "number" ? raw.weight : normalizeNumber(String(raw.weight ?? ""));
  if (
    type === "grade" &&
    weight !== null &&
    weight > 0 &&
    weight <= 10 &&
    /peso/.test(folded) &&
    numbers.has(weight)
  ) {
    accept("weight", weight, 82);
  }

  const gradeType = stringValue(raw.gradeType, 20);
  if (["Scritto", "Orale", "Pratico"].includes(gradeType)) {
    const evidence = gradeTypeEvidence(text);
    if (evidence && evidence.value === gradeType) accept("gradeType", gradeType, 82);
  }

  if (type === "link" && typeof raw.url === "string") {
    const safe = sanitizeUrl(raw.url, allowlist);
    if (safe && compactText.includes(safe.replace(/\s+/g, ""))) accept("url", safe, 88);
  }

  return { values, fieldConfidence };
}

/** Regole + AI: la regola esplicita vince sui campi delicati, l'AI sui testi. */
function mergeExtractions(rules, ai, context) {
  const values = { ...rules.values };
  const fieldConfidence = { ...rules.fieldConfidence };
  for (const [key, value] of Object.entries(ai.values)) {
    const delicate = ["dueDate", "examDate", "grade", "gradeType", "weight", "url"].includes(key);
    if (delicate && (fieldConfidence[key] ?? 0) >= 90) continue;
    values[key] = value;
    fieldConfidence[key] = ai.fieldConfidence[key] ?? combineConfidence(context.ocrConfidence, 80);
  }
  return { values, fieldConfidence, notes: rules.notes };
}

/**
 * Crea l'estrattore. L'unica differenza tra avere Ollama o no è la qualità:
 * senza Ollama il risultato è identico alle regole.
 */
export async function createExtractor({ logger, allowlist }) {
  const ollama = await probeOllama({ logger });
  if (ollama) logger.info(`Estrattore: Ollama ${ollama.model} (${ollama.baseUrl}) + regole locali`);

  return {
    ollama,
    async extract({ text, type, ocrConfidence, now = new Date() }) {
      const rules = extractRules({ text, type, allowlist, now });
      if (!ollama || text.trim().length < 20) return rules;
      const raw = await ollamaExtract(ollama, text, type, logger);
      if (!raw) return rules;
      const grounded = groundAiValues(raw, { text, type, allowlist, ocrConfidence });
      if (Object.keys(grounded.values).length === 0) return rules;
      return mergeExtractions(rules, grounded, { ocrConfidence });
    },
  };
}
