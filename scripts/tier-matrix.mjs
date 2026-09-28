// Corre la suite contra los 4 niveles de X-Enable-Bugs y muestra qué tests
// fallan en cada uno: es la medida de la capacidad de detección de la suite.
import {spawnSync} from "node:child_process"
import {readFileSync, mkdirSync, writeFileSync} from "node:fs"

const tiers = ["off", "easy", "medium", "hard"]
const runId = Date.now().toString(36)
const results = {}
mkdirSync("reports/tiers", {recursive: true})

for (const tier of tiers) {
  console.log(`\n▶ Corriendo la suite con X-Enable-Bugs=${tier} ...`)
  const outputFile = `reports/tiers/${tier}.json`
  spawnSync("npx", ["playwright", "test", "--reporter=json"], {
    env: {...process.env, BUGS_TIER: tier, RUN_ID: `${runId}${tier[0]}`, PLAYWRIGHT_JSON_OUTPUT_NAME: outputFile},
    stdio: "ignore",
  })
  const report = JSON.parse(readFileSync(outputFile, "utf8"))
  const failed = []
  const walk = suite => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests)
        if (t.status === "unexpected") failed.push(`${suite.title} › ${spec.title}`)
    for (const child of suite.suites ?? []) walk(child)
  }
  report.suites.forEach(walk)
  results[tier] = {stats: report.stats, failed}
  console.log(`  ${report.stats.expected} ok · ${report.stats.unexpected} fallidos · ${report.stats.skipped} omitidos`)
}

let md = "# Detección por nivel de X-Enable-Bugs\n\n| Nivel | OK | Fallidos |\n|---|---|---|\n"
for (const tier of tiers) md += `| ${tier} | ${results[tier].stats.expected} | ${results[tier].stats.unexpected} |\n`
for (const tier of tiers.slice(1)) {
  md += `\n## ${tier}\n\n` + (results[tier].failed.map(f => `- ${f}`).join("\n") || "_Ningún fallo_") + "\n"
}
mkdirSync("reports/tiers", {recursive: true})
writeFileSync("reports/tiers/summary.md", md)
console.log("\n" + md + "\nResumen guardado en reports/tiers/summary.md")
