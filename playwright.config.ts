import {defineConfig} from "@playwright/test"

import {env} from "./src/config"

/**
 * Suite de API: no usa navegador. Playwright aporta el cliente HTTP, el
 * paralelismo, los reportes y el manejo de fallos conocidos (test.fail).
 */
export default defineConfig({
  testDir: "./tests",
  // Cada test usa su propia cuenta (X-Candidate-Id único), así que pueden
  // correr en paralelo sin interferir. Limitamos los workers porque la API
  // es compartida con otros candidatos.
  fullyParallel: true,
  workers: 4,
  // Sin reintentos: un reintento escondería un test inestable (flaky).
  retries: 0,
  timeout: 30_000,
  // Los tests lentos (esperan la resolución de órdenes LIMIT) sólo corren
  // cuando se piden explícitamente con `npm run test:slow`.
  grepInvert: process.env.RUN_SLOW ? undefined : /@slow/,
  reporter: [
    ["list"],
    ["html", {outputFolder: "reports/html", open: "never"}],
    ["junit", {outputFile: "reports/junit.xml"}],
    ["json", {outputFile: "reports/results.json"}],
  ],
  use: {
    baseURL: env.apiUrl,
  },
  metadata: {
    bugsTier: env.bugsTier,
    runId: env.runId,
  },
})
