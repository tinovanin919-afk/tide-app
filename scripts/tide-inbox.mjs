#!/usr/bin/env node
// Tide · Inbox AI — fondamenta locali.
//
// Guarda Compiti, Voti, Verifiche, Note e Link; elabora un file alla volta
// (8 GB di RAM bastano), crea una proposta in public/inbox-candidates.json e
// archivia l'originale in Processati. I file illeggibili finiscono in Rifiutati.
//
// Uso: node scripts/tide-inbox.mjs [--root ~/Tide/Inbox] [--output <json>] [--verbose]

import fs from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import {
  FOLDER_TYPES,
  INPUT_FOLDERS,
  defaultOutputPath,
  expandHome,
  flags,
  folderOf,
  inboxCacheDir,
  inboxRoot,
  inputDirs,
  loadAllowedHosts,
  logPath,
  ocrLangs,
  parseArgs,
} from "./inbox/config.mjs";
import { createLogger } from "./inbox/log.mjs";
import {
  archiveFile,
  ensureLayout,
  isHiddenOrTemp,
  makeThumbnail,
  prepareOcrImage,
} from "./inbox/media.mjs";
import { createOcrChain } from "./inbox/ocr.mjs";
import { createExtractor, guessType } from "./inbox/extract.mjs";
import { buildCandidate, newCandidateId, saveCandidate } from "./inbox/candidates.mjs";

const HELP = `Uso: node scripts/tide-inbox.mjs [opzioni]

  --root <cartella>   cartella Inbox (default: ~/Tide/Inbox)
  --output <file>     JSON delle proposte (default: public/inbox-candidates.json)
  --verbose           log completo (include i DEBUG)
  -h, --help          questo messaggio

Ambiente: TIDE_INBOX_ROOT, TIDE_INBOX_OUTPUT, TIDE_ALLOWED_HOSTS,
          TIDE_OCR_LANGS, TIDE_OLLAMA_MODEL, TIDE_INBOX_VISION=0,
          TIDE_INBOX_OLLAMA=0, TIDE_INBOX_THUMBNAILS=0`;

const errorText = (error) =>
  String(error?.message ?? error)
    .replace(/\s+/g, " ")
    .slice(0, 200);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const root = inboxRoot(args.root);
  const outputPath = path.resolve(expandHome(args.output ?? defaultOutputPath()));
  const cacheDir = inboxCacheDir(root);
  const workDir = path.join(cacheDir, "work");
  const logger = createLogger(logPath(root), { verbose: args.verbose });

  await ensureLayout(root);
  await fs.promises.mkdir(workDir, { recursive: true });
  const allowlist = loadAllowedHosts(root);

  // Un solo watcher per Inbox: due istanze scriverebbero lo stesso JSON in parallelo.
  const lockPath = path.join(cacheDir, "watcher.lock");
  const releaseLock = () => {
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (Number(current?.pid) === process.pid) fs.unlinkSync(lockPath);
    } catch {
      // Lock già rimosso o illeggibile: niente da fare.
    }
  };
  const acquireLock = () => {
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      const pid = Number(current?.pid);
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
        try {
          process.kill(pid, 0);
          logger.error(`un altro watcher è già attivo su questa Inbox (PID ${pid}): esco`);
          return false;
        } catch {
          logger.warn(`lock di un watcher non più attivo (PID ${pid}): lo riprendo`);
        }
      }
    } catch {
      // Nessun lock precedente.
    }
    try {
      fs.writeFileSync(
        lockPath,
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      );
      return true;
    } catch (error) {
      logger.warn(`lock non creato (${errorText(error)}): continuo senza protezione`);
      return true;
    }
  };
  if (!acquireLock()) {
    await logger.flush();
    process.exitCode = 1;
    return;
  }
  process.on("exit", releaseLock);

  // Stato leggibile dalla dashboard (`public/inbox-status.json`): è solo informativo,
  // quindi un errore di scrittura non deve mai fermare il watcher.
  const statusPath = path.join(path.dirname(outputPath), "inbox-status.json");
  const writeStatus = (helperActive, note) => {
    try {
      fs.mkdirSync(path.dirname(statusPath), { recursive: true });
      const tmp = `${statusPath}.${process.pid}.tmp`;
      fs.writeFileSync(
        tmp,
        `${JSON.stringify({
          helperActive,
          updatedAt: new Date().toISOString(),
          pid: helperActive ? process.pid : null,
          note,
        })}\n`,
      );
      fs.renameSync(tmp, statusPath);
    } catch {
      // Stato puramente informativo: si ignora.
    }
  };
  writeStatus(true, "watcher attivo");
  const heartbeat = setInterval(() => writeStatus(true, "watcher attivo"), 60_000);
  heartbeat.unref?.();
  process.on("exit", () => {
    clearInterval(heartbeat);
    writeStatus(false, "watcher non attivo");
  });

  logger.info("─".repeat(60));
  logger.info(`Tide Inbox: ${root}`);
  logger.info(`Proposte: ${outputPath}`);
  logger.info(
    `Link consentiti: ${[...allowlist.hosts, ...allowlist.patterns].join(", ") || "(nessuno)"}`,
  );

  const ocr = await createOcrChain({ cacheDir, langs: ocrLangs, logger, useVision: flags.vision });
  const extractor = await createExtractor({ logger, allowlist });
  logger.info(`OCR attivo: ${ocr.describe()}`);
  logger.info(`Miniature: ${flags.thumbnails ? "sì" : "no"}`);

  const handled = new Map();

  const reject = async (filePath, reason) => {
    logger.error(`rifiutato ${path.relative(root, filePath)}: ${reason}`);
    try {
      const archived = await archiveFile(root, "Rifiutati", filePath);
      logger.info(`spostato in Rifiutati: ${path.relative(root, archived)}`);
    } catch (error) {
      logger.warn(`impossibile spostare in Rifiutati: ${errorText(error)}`);
    }
  };

  async function processFile(filePath) {
    const name = path.basename(filePath);
    const folder = folderOf(root, filePath);
    logger.info(`elaboro ${folder ? `${folder}/` : ""}${name}`);
    let prepared = null;

    try {
      let ocrResult;
      try {
        prepared = await prepareOcrImage(filePath, workDir);
        ocrResult = await ocr.recognize(prepared.jpegPath);
      } catch (error) {
        await reject(filePath, errorText(error));
        return;
      }

      const text = ocrResult.text.replace(/\r\n?/g, "\n").trim();
      const type = FOLDER_TYPES[folder] ?? guessType(text);
      if (!ocrResult.text.trim()) {
        logger.warn(`OCR senza testo (${ocrResult.adapter}): proposta da completare a mano`);
      }

      const extracted = await extractor.extract({
        text,
        type,
        ocrConfidence: ocrResult.confidence,
      });
      const thumbnail =
        flags.thumbnails && prepared
          ? await makeThumbnail(prepared.jpegPath, workDir).catch(() => undefined)
          : undefined;

      let sourcePath = filePath;
      try {
        sourcePath = await archiveFile(root, "Processati", filePath);
      } catch (error) {
        // La proposta resta valida anche se il file non si sposta.
        logger.warn(`file lasciato in ${folder}: ${errorText(error)}`);
      }

      const candidate = buildCandidate({
        id: newCandidateId(),
        createdAt: new Date().toISOString(),
        type,
        folder: folder || "Unknown",
        sourcePath,
        ocrText: text,
        values: extracted.values,
        fieldConfidence: extracted.fieldConfidence,
        thumbnail,
      });
      const result = await saveCandidate(outputPath, candidate, logger);
      logger.info(
        `${result.saved ? "proposta" : "proposta invariata"} ${type} · confidenza ${candidate.confidence} · ` +
          `${candidate.ocrText.length} caratteri · OCR ${ocrResult.adapter} · ${path.basename(sourcePath)}`,
      );
      for (const note of extracted.notes) logger.warn(note);
    } catch (error) {
      logger.error(`errore su ${name}: ${errorText(error)}`);
      // Se il file è già stato archiviato, non lo si sposta due volte.
      const stillThere = await fs.promises
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      if (stillThere) await reject(filePath, "errore durante l'elaborazione");
    } finally {
      await prepared?.cleanup().catch(() => {});
    }
  }

  let tail = Promise.resolve();
  const enqueue = (filePath) => {
    if (!folderOf(root, filePath)) return;
    if (isHiddenOrTemp(path.basename(filePath))) return;
    const now = Date.now();
    for (const [key, expiry] of handled) if (expiry <= now) handled.delete(key);
    if (handled.has(filePath)) return;
    handled.set(filePath, now + 10000);
    // Serial queue: un file alla volta, la RAM resta bassa.
    tail = tail
      .then(() => processFile(filePath))
      .catch((error) => logger.error(`coda: ${errorText(error)}`));
    return tail;
  };

  const watcher = chokidar.watch(inputDirs(root), {
    ignoreInitial: false,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 900, pollInterval: 120 },
    ignored: (candidate) => {
      const base = path.basename(candidate);
      return base ? isHiddenOrTemp(base) : false;
    },
  });

  watcher.on("add", enqueue);
  watcher.on("change", enqueue);
  watcher.on("error", (error) => logger.error(`watcher: ${errorText(error)}`));
  watcher.on("ready", () => {
    logger.info(`watcher pronto su ${INPUT_FOLDERS.join(", ")} — in attesa di file`);
  });

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info(`ricevuto ${signal}: ultimo file in corso, poi esco`);
    await watcher.close().catch(() => {});
    await tail.catch(() => {});
    await ocr.dispose().catch(() => {});
    releaseLock();
    await logger.flush();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) =>
    logger.error(`unhandledRejection: ${errorText(reason)}`),
  );

  // Il processo resta vivo finché il watcher è aperto.
  await new Promise(() => {});
}

main().catch(async (error) => {
  console.error(`Tide Inbox non avviato: ${error?.stack ?? error}`);
  process.exit(1);
});
