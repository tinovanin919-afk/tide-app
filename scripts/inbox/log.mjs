// Log locale dell'Inbox: una riga per evento in ~/Tide/Inbox/Log/inbox.log.
// Le scritture sono in coda, così i file elaborati uno alla volta non si accavallano.

import fs from "node:fs";
import path from "node:path";

const LEVELS = new Set(["DEBUG", "INFO", "WARN", "ERROR"]);

const clean = (message) => String(message).replace(/\s+/g, " ").trim();

export function createLogger(logFile, options = {}) {
  const verbose = options.verbose === true;
  const stream = options.stream ?? process.stdout;
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  let queue = Promise.resolve();

  const emit = (level, message) => {
    const line = `[${new Date().toISOString()}] ${level.padEnd(5)} ${clean(message)}`;
    if (verbose || level !== "DEBUG") {
      try {
        stream.write(`${line}\n`);
      } catch {
        // stdout chiuso (es. piped): il file di log resta la fonte di verità.
      }
    }
    queue = queue
      .then(() => fs.promises.appendFile(logFile, `${line}\n`))
      .catch(() => {
        // Un log non scrivibile non deve fermare l'elaborazione.
      });
    return queue;
  };

  return {
    line: "—".repeat(60),
    debug: (message) => emit("DEBUG", message),
    info: (message) => emit("INFO", message),
    warn: (message) => emit("WARN", message),
    error: (message) => emit("ERROR", message),
    flush: () => queue,
  };
}

export const isValidLevel = (level) => LEVELS.has(level);
