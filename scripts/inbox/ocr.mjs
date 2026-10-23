// OCR locale con adapter: Apple Vision (macOS, se compilabile) → Tesseract (già
// nel progetto, WebAssembly in Node) → inserimento manuale. Nessuna immagine
// viene caricata online; Tesseract scarica solo il modello linguistico la prima volta.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const VISION_SOURCE = path.join(here, "native", "vision-ocr.swift");

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

/** Adapter Apple Vision: compila l'helper Swift una volta e lo riusa. */
function createAppleVisionAdapter(cacheDir, logger) {
  const binary = path.join(cacheDir, "vision-ocr");
  let available = false;
  let disabled = false;

  const compile = async () => {
    if (process.platform !== "darwin") {
      disabled = true;
      return false;
    }
    if (!fs.existsSync(VISION_SOURCE)) {
      logger.warn("OCR Apple Vision: helper Swift mancante");
      disabled = true;
      return false;
    }
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const sourceTime = (await fs.promises.stat(VISION_SOURCE)).mtimeMs;
    const binaryTime = await fs.promises
      .stat(binary)
      .then((stats) => stats.mtimeMs)
      .catch(() => 0);
    if (binaryTime >= sourceTime) return true;
    try {
      await execFileAsync("swiftc", ["-O", "-o", binary, VISION_SOURCE], {
        timeout: 180000,
        maxBuffer: 8 * 1024 * 1024,
      });
      await fs.promises.chmod(binary, 0o755);
      logger.info("OCR Apple Vision: helper compilato");
      return true;
    } catch (error) {
      logger.warn(
        `OCR Apple Vision non disponibile (${String(error?.message ?? error).slice(0, 160)})`,
      );
      disabled = true;
      return false;
    }
  };

  return {
    name: "apple-vision",
    get available() {
      return available;
    },
    async prepare() {
      if (disabled) return false;
      available = await compile();
      return available;
    },
    async recognize(jpegPath) {
      const { stdout } = await execFileAsync(binary, [jpegPath], {
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const payload = JSON.parse(stdout);
      const lines = (Array.isArray(payload.lines) ? payload.lines : [])
        .map((line) => ({
          text: String(line?.text ?? "").trim(),
          confidence: clamp(Number(line?.confidence ?? 0) * 100),
        }))
        .filter((line) => line.text.length > 0);
      const text = lines.map((line) => line.text).join("\n");
      const confidence = lines.length
        ? clamp(lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length)
        : 0;
      return { engine: "apple-vision", text, lines, confidence };
    },
  };
}

/** Adapter Tesseract: riusa il motore del progetto (un solo worker, in serie). */
function createTesseractAdapter(cacheDir, langs, logger) {
  let available = false;
  let workerPromise = null;
  let failed = false;

  const getWorker = async () => {
    workerPromise ??= (async () => {
      const { createWorker } = await import("tesseract.js");
      const cachePath = path.join(cacheDir, "tesseract");
      await fs.promises.mkdir(cachePath, { recursive: true });
      logger.info(
        `OCR Tesseract: preparo il modello "${langs}" (primo avvio: download locale del modello)`,
      );
      const worker = await createWorker(langs, 1, { cachePath });
      await worker.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1" });
      return worker;
    })();
    try {
      return await workerPromise;
    } catch (error) {
      workerPromise = null;
      failed = true;
      throw error;
    }
  };

  return {
    name: "tesseract",
    get available() {
      return available;
    },
    async prepare() {
      if (failed) return false;
      try {
        await import("tesseract.js");
        available = true;
      } catch (error) {
        logger.warn(
          `OCR Tesseract non disponibile: ${String(error?.message ?? error).slice(0, 160)}`,
        );
        available = false;
      }
      return available;
    },
    async recognize(jpegPath) {
      const worker = await getWorker();
      const { data } = await worker.recognize(jpegPath);
      return {
        engine: "tesseract",
        text: String(data.text ?? "").trim(),
        lines: [],
        confidence: clamp(Number(data.confidence ?? 0)),
      };
    },
    async dispose() {
      const pending = workerPromise;
      workerPromise = null;
      if (!pending) return;
      const worker = await pending.catch(() => null);
      await worker?.terminate().catch(() => {});
    },
  };
}

/** Ultimo livello: nessun OCR, la proposta resta da completare a mano. */
function createManualAdapter() {
  return {
    name: "manual",
    available: true,
    async prepare() {
      return true;
    },
    async recognize() {
      return { engine: "manual", text: "", lines: [], confidence: 0 };
    },
  };
}

/**
 * Crea la catena OCR e prepara gli adapter in ordine di preferenza.
 * Se il primo non è disponibile, il file viene letto dal successivo.
 */
export async function createOcrChain({ cacheDir, langs = "ita", logger, useVision = true }) {
  const adapters = [];
  if (useVision) adapters.push(createAppleVisionAdapter(cacheDir, logger));
  adapters.push(createTesseractAdapter(cacheDir, langs, logger));
  adapters.push(createManualAdapter());

  for (const adapter of adapters) {
    const ready = await adapter.prepare();
    logger.info(`OCR ${adapter.name}: ${ready ? "pronto" : "non disponibile"}`);
  }

  return {
    describe: () =>
      adapters
        .filter((adapter) => adapter.available)
        .map((adapter) => adapter.name)
        .join(" → "),
    async recognize(jpegPath) {
      for (const adapter of adapters) {
        if (!adapter.available) continue;
        try {
          const result = await adapter.recognize(jpegPath);
          if (result.text.trim()) return { ...result, adapter: adapter.name };
          if (adapter.name === "manual") return { ...result, adapter: adapter.name };
          logger.warn(`OCR ${adapter.name}: nessun testo riconosciuto, provo il successivo`);
        } catch (error) {
          logger.warn(
            `OCR ${adapter.name} fallito: ${String(error?.message ?? error).slice(0, 200)}`,
          );
        }
      }
      return { engine: "manual", text: "", lines: [], confidence: 0, adapter: "manual" };
    },
    async dispose() {
      for (const adapter of adapters) await adapter.dispose?.();
    },
  };
}
