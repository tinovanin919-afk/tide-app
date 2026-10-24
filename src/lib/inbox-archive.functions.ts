// Server functions del Modulo 2C: approvazione e undo delle proposte Inbox.
//
// Il client non importa mai `node:fs`: il modulo server viene caricato solo
// dentro l'handler, così build e bundle del browser restano puliti.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const archiveInput = z.object({
  id: z.string().min(1).max(160),
});

const restoreInput = z.object({
  candidate: z.unknown(),
});

export const archiveInboxCandidateFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => archiveInput.parse(data))
  .handler(async ({ data }) => {
    const { archiveInboxCandidate } = await import("./inbox-archive.server");
    return archiveInboxCandidate(data.id);
  });

export const restoreInboxCandidateFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => restoreInput.parse(data))
  .handler(async ({ data }) => {
    const { restoreInboxCandidate } = await import("./inbox-archive.server");
    return restoreInboxCandidate(data.candidate);
  });
