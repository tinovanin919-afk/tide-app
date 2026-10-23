// Gestione locale dei file dell'Inbox: validazione, conversione per l'OCR e archiviazione.
//
// Sicurezza: i comandi esterni (sips) ricevono solo percorsi come argomenti di un
// array. Nessun testo letto dall'OCR viene mai interpolato in una shell.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { INPUT_FOLDERS, MAX_FILE_BYTES, SUPPORT_FOLDERS, isSupportedName } from "./config.mjs";

const execFileAsync = promisify(execFile);

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

export const isHiddenOrTemp = (name) =>
  name.startsWith(".") ||
  name.startsWith("~$") ||
  /\.(tmp|part|partial|crdownload|download)$/i.test(name) ||
  name === "Thumbs.db" ||
  name === "desktop.ini";

/** Crea (se mancano) le cartelle dell'Inbox e restituisce quelle create adesso. */
export async function ensureLayout(root) {
  const created = [];
  for (const folder of [...INPUT_FOLDERS, ...SUPPORT_FOLDERS]) {
    const target = path.join(root, folder);
    if (!fs.existsSync(target)) {
      await fs.promises.mkdir(target, { recursive: true });
      created.push(target);
    }
  }
  return { root, created };
}

async function readMagic(filePath) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(4100);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Tipo reale del file dai magic bytes, non dall'estensione. */
function kindOfMagic(bytes) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("latin1");
    if (HEIC_BRANDS.has(brand)) return "image";
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  return null;
}

/** Il file è supportato e leggibile? Lancia un errore esplicito se corrotto. */
export async function validateFile(filePath) {
  const name = path.basename(filePath);
  if (!isSupportedName(name))
    throw new Error(`formato non supportato (${path.extname(name) || "?"})`);
  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile()) throw new Error("non è un file");
  if (stats.size === 0) throw new Error("file vuoto");
  if (stats.size > MAX_FILE_BYTES)
    throw new Error(`oltre 20 MB (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
  const kind = kindOfMagic(await readMagic(filePath));
  if (!kind) throw new Error("file corrotto o non riconosciuto");
  return { kind, size: stats.size, name };
}

const run = async (command, args, timeout = 60000) => {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout, stderr };
};

/**
 * Normalizza il file in un JPEG leggibile dall'OCR: sips gestisce HEIC, la prima
 * pagina dei PDF, l'orientamento e — utile — il PNG con trasparenza che Apple
 * Vision fatica a leggere. Restituisce anche il percorso da cancellare alla fine.
 */
export async function prepareOcrImage(filePath, workDir) {
  const { kind } = await validateFile(filePath);
  await fs.promises.mkdir(workDir, { recursive: true });
  const target = path.join(
    workDir,
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`,
  );
  // Un PDF viene reso solo nella prima pagina: è una base, non un OCR multipagina.
  await run("sips", [
    "-s",
    "format",
    "jpeg",
    "-s",
    "formatOptions",
    "90",
    "-Z",
    "2600",
    filePath,
    "--out",
    target,
  ]);
  const stats = await fs.promises.stat(target).catch(() => null);
  if (!stats || stats.size === 0)
    throw new Error("conversione immagine non riuscita (file corrotto?)");
  return { jpegPath: target, kind, cleanup: () => fs.promises.rm(target, { force: true }) };
}

/** Miniatura JPEG leggera come data URL, solo se resta piccola. */
export async function makeThumbnail(jpegPath, workDir) {
  const target = path.join(
    workDir,
    `thumb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`,
  );
  try {
    await run("sips", [
      "-Z",
      "360",
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      "60",
      jpegPath,
      "--out",
      target,
    ]);
    const buffer = await fs.promises.readFile(target);
    if (buffer.length === 0 || buffer.length > 120 * 1024) return undefined;
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  } catch {
    return undefined;
  } finally {
    await fs.promises.rm(target, { force: true });
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** Sposta il file in Processati/Rifiutati mantenendo un nome unico. */
export async function archiveFile(root, targetFolder, filePath) {
  const destination = path.join(root, targetFolder);
  await fs.promises.mkdir(destination, { recursive: true });
  const base = `${stamp()}_${path.basename(filePath)}`;
  const extension = path.extname(base);
  const stem = base.slice(0, base.length - extension.length);
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = attempt === 0 ? base : `${stem}-${attempt}${extension}`;
    const target = path.join(destination, name);
    if (fs.existsSync(target)) continue;
    try {
      await fs.promises.rename(filePath, target);
      return target;
    } catch (error) {
      // Volumi diversi: copia e rimuovi solo dopo una copia riuscita.
      if (error?.code === "EXDEV") {
        await fs.promises.copyFile(filePath, target);
        await fs.promises.unlink(filePath);
        return target;
      }
      throw error;
    }
  }
  throw new Error("impossibile trovare un nome libero nell'archivio");
}
