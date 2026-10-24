// Archiviazione delle proposte approvate (Modulo 2C).
//
// Questo modulo gira solo sul server locale (Vite dev): il browser non può
// scrivere in `public/` né spostare file. Le proposte vengono rimosse dal JSON
// con una scrittura atomica e il file sorgente, se non è già stato archiviato
// dall'helper, viene spostato in ~/Tide/Inbox/Processati.
//
// Sicurezza: si toccano solo file dentro ~/Tide/Inbox (o la radice configurata
// con TIDE_INBOX_ROOT). Qualunque percorso esterno viene rifiutato, non seguito.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isInboxCandidate, type InboxCandidate } from "@/lib/inbox";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const expandHome = (value: string) => {
  if (value === "~") return os.homedir();
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
};

const OUTPUT_PATH = path.resolve(
  expandHome(
    process.env["TIDE_INBOX_OUTPUT"] ?? path.join(PROJECT_ROOT, "public", "inbox-candidates.json"),
  ),
);
const INBOX_ROOT = path.resolve(expandHome(process.env["TIDE_INBOX_ROOT"] ?? "~/Tide/Inbox"));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type StoreFile = {
  version: number;
  updatedAt: string;
  candidates: unknown[];
};

const emptyStore = (): StoreFile => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  candidates: [],
});

async function readStore(): Promise<StoreFile> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(OUTPUT_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
  if (!raw.trim()) return emptyStore();
  const parsed: unknown = JSON.parse(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed["candidates"])
      ? parsed["candidates"]
      : null;
  if (!list) throw new Error("inbox-candidates.json non contiene una lista di proposte");
  return {
    version: 1,
    updatedAt:
      isRecord(parsed) && typeof parsed["updatedAt"] === "string"
        ? parsed["updatedAt"]
        : new Date().toISOString(),
    candidates: [...list],
  };
}

/** Scrittura atomica: il watcher o un'altra scheda non vedono mai un file a metà. */
async function writeStore(candidates: unknown[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    candidates,
  };
  const tmp = `${OUTPUT_PATH}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.rename(tmp, OUTPUT_PATH);
}

const isInside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
};

const exists = (file: string) =>
  fs.promises
    .access(file)
    .then(() => true)
    .catch(() => false);

/** Nome unico in Processati: non si sovrascrive mai un file già archiviato. */
async function targetPathFor(sourcePath: string): Promise<string> {
  const dir = path.join(INBOX_ROOT, "Processati");
  await fs.promises.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `${stamp}_${path.basename(sourcePath)}`;
  let target = path.join(dir, base);
  for (let counter = 2; await exists(target); counter += 1) {
    target = path.join(dir, `${counter}_${base}`);
  }
  return target;
}

type ArchiveFileResult = { archivedPath: string | null; warning: string | null };

/**
 * Porta il file in Processati se non è già lì. L'helper lo archivia prima di
 * creare la proposta, quindi nella maggior parte dei casi non c'è nulla da fare.
 */
async function archiveSourceFile(sourcePath: string): Promise<ArchiveFileResult> {
  const file = path.resolve(expandHome(sourcePath));
  if (!isInside(INBOX_ROOT, file)) {
    return {
      archivedPath: null,
      warning: `File lasciato dov'è: è fuori da ${INBOX_ROOT}.`,
    };
  }
  const [folder] = path.relative(INBOX_ROOT, file).split(path.sep);
  if (folder === "Processati" || folder === "Rifiutati") {
    return { archivedPath: file, warning: null };
  }
  if (!(await exists(file))) {
    return {
      archivedPath: null,
      warning: "File sorgente non trovato: proposta archiviata comunque.",
    };
  }
  try {
    const target = await targetPathFor(file);
    await fs.promises.rename(file, target);
    return { archivedPath: target, warning: null };
  } catch (error) {
    return {
      archivedPath: null,
      warning: `Proposta rimossa, ma il file non è stato spostato: ${String(
        (error as Error)?.message ?? error,
      ).slice(0, 160)}`,
    };
  }
}

export type ArchiveInboxResult = {
  /** true se dopo la chiamata la proposta non è più nel JSON. */
  removed: boolean;
  archivedPath: string | null;
  warning: string | null;
};

/**
 * Rimuove la proposta dal JSON e archivia il file. Idempotente: se il watcher
 * ha già riscritto il file senza quella proposta, l'approvazione resta valida.
 */
export async function archiveInboxCandidate(id: string): Promise<ArchiveInboxResult> {
  const store = await readStore();
  const index = store.candidates.findIndex((entry) => isRecord(entry) && entry["id"] === id);
  if (index < 0) {
    return {
      removed: true,
      archivedPath: null,
      warning: "La proposta era già stata archiviata.",
    };
  }

  const [removed] = store.candidates.splice(index, 1);
  await writeStore(store.candidates);

  if (!isInboxCandidate(removed)) {
    return {
      removed: true,
      archivedPath: null,
      warning: "Proposta rimossa, ma il file sorgente non era leggibile.",
    };
  }
  const archived = await archiveSourceFile(removed.sourcePath);
  return { removed: true, ...archived };
}

export type RestoreInboxResult = {
  restored: boolean;
  warning: string | null;
};

/** Undo: rimette la proposta nel JSON (il file resta in Processati). */
export async function restoreInboxCandidate(raw: unknown): Promise<RestoreInboxResult> {
  if (!isInboxCandidate(raw)) {
    return {
      restored: false,
      warning: "La proposta non è più valida e non può essere ripristinata.",
    };
  }
  const candidate: InboxCandidate = { ...raw, status: "pending" };
  const store = await readStore();
  if (store.candidates.some((entry) => isRecord(entry) && entry["id"] === candidate.id)) {
    return { restored: true, warning: null };
  }
  await writeStore([candidate, ...store.candidates]);
  return { restored: true, warning: null };
}
