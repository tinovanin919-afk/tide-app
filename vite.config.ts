// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    optimizeDeps: {
      // Discover shared React consumers together, before route navigation or HMR.
      // Late dependency optimization can otherwise leave an open preview using
      // a React dispatcher from an older dependency graph.
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@radix-ui/react-tabs",
        "@radix-ui/react-switch",
        "@radix-ui/react-slot",
        "framer-motion",
        "recharts",
        "lucide-react",
        "read-excel-file/browser",
        // OCR locale: pre-bundlato con React, così l'import dinamico dello screenshot
        // non avvia una seconda ottimizzazione a preview già aperta.
        "tesseract.js",
      ],
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
