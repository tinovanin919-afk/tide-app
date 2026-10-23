// OCR locale nel browser (Tesseract in WebAssembly): nessuna immagine lascia il Mac.
// Prima di leggere, l'immagine viene preparata con operazioni leggere su canvas:
// ridimensionamento, scala di grigi, contrasto, inversione per le UI scure e, solo
// come secondo tentativo, binarizzazione di Otsu. Il motore resta uno solo e viene
// riusato, così la memoria non cresce a ogni screenshot.

export type OcrUpdate = { stage: "loading" | "recognizing"; progress: number };

/** Riga riconosciuta con la confidenza che Tesseract le assegna (0–100). */
export type OcrLine = { text: string; confidence: number };

/** Testo completo + righe con confidenza: serve a stimare quanto fidarsi di ogni campo. */
export type OcrDocument = {
  text: string;
  confidence: number;
  lines: OcrLine[];
  /**
   * Righe ricostruite dalle coordinate delle parole. Tesseract a volte legge una
   * tabella per colonne (tutte le materie, poi tutte le date): qui le parole con
   * la stessa altezza tornano sulla stessa riga visiva.
   */
  rows?: OcrLine[];
  preprocess: "soft" | "binary";
};

type OcrWorker = {
  recognize(
    image: Blob | HTMLCanvasElement,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ): Promise<{ data: OcrPage }>;
  setParameters(params: Record<string, string>): Promise<unknown>;
};

type Bbox = { x0?: number; y0?: number; x1?: number; y1?: number };
type OcrWord = { text?: string; confidence?: number; bbox?: Bbox };
type OcrLineData = { text?: string; confidence?: number; words?: OcrWord[] };

type OcrPage = {
  text?: string;
  confidence?: number;
  blocks?:
    | {
        confidence?: number;
        paragraphs?: { lines?: OcrLineData[] }[];
      }[]
    | null;
};

const MAX_SIDE = 2000;

let workerPromise: Promise<OcrWorker> | null = null;
let reporter: ((update: OcrUpdate) => void) | null = null;

/** Accetta solo i formati che i browser sanno decodificare senza plugin. */
export const isImageFile = (file: File) =>
  /^image\/(png|jpe?g|webp)$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);

async function getWorker(): Promise<OcrWorker> {
  workerPromise ??= (async () => {
    const { createWorker } = (await import("tesseract.js")) as unknown as {
      createWorker: (
        langs: string,
        oem: number,
        options: Record<string, unknown>,
      ) => Promise<OcrWorker>;
    };
    const worker = await createWorker("ita", 1, {
      logger: (message: { status: string; progress?: number }) => {
        if (!reporter) return;
        const progress = Math.round(Math.min(1, Math.max(0, message.progress ?? 0)) * 100);
        reporter({
          stage: message.status === "recognizing text" ? "recognizing" : "loading",
          progress,
        });
      },
    });
    // PSM 3 (analisi automatica) legge tabelle e schede meglio del blocco unico,
    // mentre preserve_interword_spaces conserva la distanza tra le colonne del registro.
    await worker.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1" });
    return worker;
  })();
  try {
    return await workerPromise;
  } catch (error) {
    workerPromise = null;
    throw error;
  }
}

/** Luminanza media: sotto questa soglia lo screenshot è scuro e va invertito. */
function isDark(data: Uint8ClampedArray): boolean {
  let sum = 0;
  // Un pixel ogni 16 basta per la media e tiene il giro leggero anche a 2000px.
  for (let i = 0; i < data.length; i += 64) sum += data[i] ?? 0;
  const samples = Math.max(1, Math.floor(data.length / 64));
  return sum / samples < 118;
}

/** Soglia di Otsu: separa testo e sfondo senza valori fissi che dipendono dal tema. */
function otsu(histogram: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * (histogram[i] ?? 0);
  let sumB = 0;
  let weightB = 0;
  let best = 128;
  let bestVariance = -1;
  for (let t = 0; t < 256; t++) {
    weightB += histogram[t] ?? 0;
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * (histogram[t] ?? 0);
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

/**
 * Ridimensiona (max 2000px), converte in grigi e aumenta il contrasto.
 * In `soft` conserva le sfumature, in `binary` binarizza con Otsu: il secondo
 * passaggio si usa solo quando il primo non trova abbastanza testo.
 */
async function preprocess(
  file: File | Blob,
  mode: "soft" | "binary",
): Promise<Blob | HTMLCanvasElement> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_SIDE ? MAX_SIDE / longest : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return file;
    // Gli screenshot con trasparenza vanno appoggiati su bianco, non su nero.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    const gray = new Uint8ClampedArray(pixels.length / 4);
    for (let p = 0, g = 0; p < pixels.length; p += 4, g++) {
      gray[g] = Math.round(
        0.299 * (pixels[p] ?? 0) + 0.587 * (pixels[p + 1] ?? 0) + 0.114 * (pixels[p + 2] ?? 0),
      );
    }

    // Le UI scure hanno testo chiaro: Tesseract preferisce il contrario.
    const invert = isDark(gray);
    const histogram = new Array<number>(256).fill(0);
    for (let g = 0; g < gray.length; g++) {
      const value = gray[g] ?? 0;
      histogram[value] = (histogram[value] ?? 0) + 1;
    }
    const threshold = otsu(histogram, gray.length);

    for (let g = 0, p = 0; g < gray.length; g++, p += 4) {
      let value = gray[g] ?? 0;
      if (invert) value = 255 - value;
      if (mode === "binary") {
        value = value > threshold ? 255 : 0;
      } else {
        // Contrasto dolce intorno al grigio medio: non brucia i tratti sottili.
        value = (value - 128) * 1.28 + 128;
      }
      value = Math.max(0, Math.min(255, Math.round(value)));
      pixels[p] = value;
      pixels[p + 1] = value;
      pixels[p + 2] = value;
      pixels[p + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}

type PositionedWord = {
  text: string;
  confidence: number;
  x0: number;
  x1: number;
  cy: number;
  height: number;
};

/**
 * Ricompone le righe visive dalle coordinate delle parole. Tesseract può leggere
 * una tabella per colonne: così "ITALIANO 7" e la sua data tornano insieme.
 * Il distacco tra colonne diventa tre spazi, quello tra parole uno.
 */
function visualRows(blocks: NonNullable<OcrPage["blocks"]>): OcrLine[] {
  const words: PositionedWord[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const bbox = word.bbox;
          const text = (word.text ?? "").trim();
          if (!text || !bbox) continue;
          const x0 = Number(bbox.x0);
          const x1 = Number(bbox.x1);
          const y0 = Number(bbox.y0);
          const y1 = Number(bbox.y1);
          if (![x0, x1, y0, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) continue;
          words.push({
            text,
            confidence: Math.round(word.confidence ?? line.confidence ?? 0),
            x0,
            x1,
            cy: (y0 + y1) / 2,
            height: y1 - y0,
          });
        }
      }
    }
  }
  if (words.length < 6) return [];

  const heights = words.map((word) => word.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 12;
  const tolerance = Math.max(7, medianHeight * 0.55);
  const groups: { words: PositionedWord[]; center: number }[] = [];

  for (const word of [...words].sort((a, b) => a.cy - b.cy)) {
    let closest: (typeof groups)[number] | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const group of groups) {
      const delta = Math.abs(group.center - word.cy);
      if (delta <= tolerance && delta < distance) {
        closest = group;
        distance = delta;
      }
    }
    if (closest) {
      closest.words.push(word);
      closest.center = closest.words.reduce((sum, item) => sum + item.cy, 0) / closest.words.length;
    } else {
      groups.push({ words: [word], center: word.cy });
    }
  }

  const columnGap = Math.max(14, medianHeight * 0.6);
  return groups
    .sort((a, b) => a.center - b.center)
    .map((group) => {
      const sorted = [...group.words].sort((a, b) => a.x0 - b.x0);
      let text = "";
      let previous: PositionedWord | undefined;
      for (const word of sorted) {
        if (previous) text += word.x0 - previous.x1 > columnGap ? "   " : " ";
        text += word.text;
        previous = word;
      }
      return {
        text,
        confidence: Math.round(
          sorted.reduce((sum, word) => sum + word.confidence, 0) / sorted.length,
        ),
      };
    })
    .filter((row) => row.text.trim().length > 0);
}

/** Riconosce una pagina e restituisce testo, confidenza globale e righe. */
async function recognizePage(
  worker: OcrWorker,
  image: Blob | HTMLCanvasElement,
): Promise<OcrDocument> {
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
  const text = data.text ?? "";
  const blocks = data.blocks ?? [];
  const lines: OcrLine[] = blocks
    .flatMap((block) =>
      (block.paragraphs ?? []).flatMap((paragraph) =>
        (paragraph.lines ?? []).map((line) => ({
          text: (line.text ?? "").replace(/\s+/g, " ").trim(),
          confidence: Math.round(line.confidence ?? block.confidence ?? data.confidence ?? 0),
        })),
      ),
    )
    .filter((line) => line.text.length > 0);
  const rows = visualRows(blocks);
  return {
    text,
    confidence: Math.round(data.confidence ?? 0),
    lines,
    ...(rows.length > 1 ? { rows } : {}),
    preprocess: "soft",
  };
}

/**
 * Prepara lo screenshot e lo legge. Se il primo passaggio trova pochissimo testo
 * (foto sgranate, tabelle a basso contrasto) riprova in bianco e nero.
 */
export async function imageToDocument(
  file: File | Blob,
  onUpdate?: (update: OcrUpdate) => void,
): Promise<OcrDocument> {
  if (typeof window === "undefined") throw new Error("L'OCR è disponibile solo nel browser.");
  reporter = onUpdate ?? null;
  try {
    const worker = await getWorker();
    const soft = await recognizePage(worker, await preprocess(file, "soft"));
    if (soft.text.replace(/\s/g, "").length >= 40 || soft.lines.length > 3) return soft;
    const binary = await recognizePage(worker, await preprocess(file, "binary"));
    // Si tiene il tentativo che ha letto più testo.
    return binary.text.length > soft.text.length ? { ...binary, preprocess: "binary" } : soft;
  } finally {
    reporter = null;
  }
}

/** Riconosce il testo di uno screenshot. Il motore scarica una volta il modello italiano e poi lo riusa. */
export async function imageToText(
  file: File | Blob,
  onUpdate?: (update: OcrUpdate) => void,
): Promise<string> {
  const document = await imageToDocument(file, onUpdate);
  return document.text;
}

/**
 * Miniatura leggera (max 320px, JPEG) da mostrare accanto alle proposte.
 * Vive solo in memoria: non finisce nel localStorage e non viene caricata online.
 */
export async function makeThumbnail(file: File | Blob): Promise<string | undefined> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return undefined;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return undefined;
  }
}
