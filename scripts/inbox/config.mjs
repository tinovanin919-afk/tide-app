// Configurazione condivisa dell'Inbox AI (fondamenta locali, nessun servizio online).
//
// Tutto vive sul Mac: la cartella di lavoro predefinita è ~/Tide/Inbox e il file
// delle proposte viene scritto in public/ del progetto, così l'app lo può leggere
// con una semplice fetch("/inbox-candidates.json").
//
// Variabili d'ambiente (tutte opzionali):
//   TIDE_INBOX_ROOT       cartella dell'Inbox (default: ~/Tide/Inbox)
//   TIDE_INBOX_OUTPUT     percorso del JSON delle proposte
//   TIDE_ALLOWED_HOSTS    domini extra per i link, separati da virgola
//   TIDE_OCR_LANGS        lingue Tesseract (default: ita)
//   TIDE_OLLAMA_MODEL     modello Ollama da usare
//   TIDE_INBOX_VISION=0   disattiva Apple Vision (passa a Tesseract)
//   TIDE_INBOX_OLLAMA=0   disattiva Ollama (solo regole + OCR)
//   TIDE_INBOX_THUMBNAILS=0  non generare le miniature

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Cartelle di input: il nome forza il tipo della proposta. */
export const INPUT_FOLDERS = ["Compiti", "Voti", "Verifiche", "Note", "Link"];

/** Cartelle di servizio. */
export const SUPPORT_FOLDERS = ["Processati", "Rifiutati", "Log"];

/** La provenienza vince sempre sulle euristiche sul testo. */
export const FOLDER_TYPES = {
  Compiti: "task",
  Voti: "grade",
  Verifiche: "exam",
  Note: "note",
  Link: "link",
};

export const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".heic", ".pdf"];
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Allowlist dei link: solo Classroom e portali e-learning, più i domini dell'utente. */
export const DEFAULT_ALLOWED_HOSTS = ["classroom.google.com"];
export const DEFAULT_ALLOWED_PATTERNS = [
  "elearning.*",
  "*.elearning.*",
  "e-learning.*",
  "*.e-learning.*",
];

/** Radice del progetto (scripts/inbox/ → ../..). */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const expandHome = (value) => {
  if (!value) return value;
  if (value === "~") return os.homedir();
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
};

export const inboxRoot = (override) =>
  path.resolve(expandHome(override ?? process.env.TIDE_INBOX_ROOT ?? "~/Tide/Inbox"));

export const inboxCacheDir = (root) => path.join(root, ".cache");

export const defaultOutputPath = () =>
  path.resolve(
    expandHome(
      process.env.TIDE_INBOX_OUTPUT ?? path.join(PROJECT_ROOT, "public", "inbox-candidates.json"),
    ),
  );

export const logPath = (root) => path.join(root, "Log", "inbox.log");

export const inputDirs = (root) => INPUT_FOLDERS.map((folder) => path.join(root, folder));

export const folderOf = (root, filePath) => {
  const relative = path.relative(root, filePath);
  const [first] = relative.split(path.sep);
  return first && INPUT_FOLDERS.includes(first) ? first : "";
};

export const isSupportedName = (name) =>
  SUPPORTED_EXTENSIONS.includes(path.extname(name).toLocaleLowerCase("en-US"));

export function parseArgs(argv) {
  const result = { root: undefined, output: undefined, help: false, verbose: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--verbose" || arg === "-v") result.verbose = true;
    else if (arg.startsWith("--root=")) result.root = arg.slice("--root=".length);
    else if (arg === "--root") result.root = argv[++index];
    else if (arg.startsWith("--output=")) result.output = arg.slice("--output=".length);
    else if (arg === "--output") result.output = argv[++index];
    else throw new Error(`Opzione non riconosciuta: ${arg}`);
  }
  return result;
}

const hostsFrom = (raw) => {
  if (Array.isArray(raw)) return raw.filter((value) => typeof value === "string");
  if (raw && typeof raw === "object" && Array.isArray(raw.hosts)) {
    return raw.hosts.filter((value) => typeof value === "string");
  }
  return [];
};

/**
 * Allowlist dei domini: default + `allowed-hosts.json` nella cartella Inbox +
 * TIDE_ALLOWED_HOSTS. Il file locale si modifica a mano e non viene mai sovrascritto.
 */
export function loadAllowedHosts(root) {
  const hosts = [...DEFAULT_ALLOWED_HOSTS];
  const patterns = [...DEFAULT_ALLOWED_PATTERNS];
  const configFile = path.join(root, "allowed-hosts.json");
  try {
    if (fs.existsSync(configFile)) {
      const parsed = JSON.parse(fs.readFileSync(configFile, "utf8"));
      for (const host of hostsFrom(parsed)) {
        if (host.includes("*")) patterns.push(host);
        else hosts.push(host);
      }
    }
  } catch {
    // Un file di configurazione illeggibile non deve allargare l'allowlist.
  }
  for (const host of (process.env.TIDE_ALLOWED_HOSTS ?? "").split(",")) {
    const clean = host.trim();
    if (!clean) continue;
    if (clean.includes("*")) patterns.push(clean);
    else hosts.push(clean);
  }
  const normalize = (value) =>
    value
      .trim()
      .toLocaleLowerCase("en-US")
      .replace(/^\.+|\.+$/g, "");
  return {
    hosts: [...new Set(hosts.map(normalize).filter(Boolean))],
    patterns: [...new Set(patterns.map(normalize).filter(Boolean))],
  };
}

export const flags = {
  vision: process.env.TIDE_INBOX_VISION !== "0",
  ollama: process.env.TIDE_INBOX_OLLAMA !== "0",
  thumbnails: process.env.TIDE_INBOX_THUMBNAILS !== "0",
};

export const ocrLangs = process.env.TIDE_OCR_LANGS?.trim() || "ita";
