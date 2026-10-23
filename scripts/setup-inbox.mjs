#!/usr/bin/env node
// Crea una volta sola le cartelle dell'Inbox AI su questo Mac.
// Uso: node scripts/setup-inbox.mjs [--root ~/Tide/Inbox]

import fs from "node:fs";
import path from "node:path";
import {
  INPUT_FOLDERS,
  SUPPORT_FOLDERS,
  defaultOutputPath,
  inboxRoot,
  loadAllowedHosts,
  parseArgs,
} from "./inbox/config.mjs";
import { createLogger } from "./inbox/log.mjs";
import { ensureLayout } from "./inbox/media.mjs";

const HELP = `Uso: node scripts/setup-inbox.mjs [opzioni]

  --root <cartella>   cartella Inbox (default: ~/Tide/Inbox)
  --verbose           stampa i dettagli
  -h, --help          questo messaggio

Crea: Compiti, Voti, Verifiche, Note, Link, Processati, Rifiutati, Log.
Non sovrascrive mai i file esistenti.`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  const root = inboxRoot(args.root);
  const logger = createLogger(path.join(root, "Log", "inbox.log"), { verbose: args.verbose });

  const { created } = await ensureLayout(root);
  for (const folder of [...INPUT_FOLDERS, ...SUPPORT_FOLDERS]) {
    const target = path.join(root, folder);
    console.log(`  ${created.includes(target) ? "creata " : "esiste "} ${folder}`);
  }

  // File di lavoro dell'OCR: nascosto, fuori dalle cartelle sorvegliate.
  await fs.promises.mkdir(path.join(root, ".cache", "work"), { recursive: true });

  // Domini dei link: file facoltativo, l'utente può aggiungerli senza toccare il codice.
  const allowFile = path.join(root, "allowed-hosts.json");
  if (!fs.existsSync(allowFile)) {
    const defaults = ["classroom.google.com", "elearning.*"];
    await fs.promises.writeFile(allowFile, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
    console.log("  creato  allowed-hosts.json (aggiungi qui i domini della tua scuola)");
  } else {
    console.log("  esiste  allowed-hosts.json");
  }

  const allowlist = loadAllowedHosts(root);
  await logger.info(`setup completato: ${created.length} cartelle create`);
  console.log(`\nInbox: ${root}`);
  console.log(`Proposte: ${defaultOutputPath()}`);
  console.log(`Link consentiti: ${[...allowlist.hosts, ...allowlist.patterns].join(", ")}`);
  console.log(
    "\nProssimo passo: node scripts/tide-inbox.mjs  (oppure imposta TIDE_INBOX_ROOT per usare un'altra cartella)",
  );
}

main().catch((error) => {
  console.error(`Setup Inbox non riuscito: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
