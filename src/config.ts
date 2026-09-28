const BUGS_TIERS = ["off", "easy", "medium", "hard"] as const

export type BugsTier = (typeof BUGS_TIERS)[number]

const parseTier = (value: string | undefined): BugsTier => {
  const tier = (value ?? "off").trim().toLowerCase()
  if (!BUGS_TIERS.includes(tier as BugsTier)) {
    throw new Error(
      `BUGS_TIER inválido: "${value}". Valores posibles: ${BUGS_TIERS.join(", ")}`
    )
  }
  return tier as BugsTier
}

// Playwright carga la configuración en el proceso principal y en cada worker.
// Fijamos RUN_ID en el proceso principal: los workers lo heredan, y así toda
// la corrida usa el mismo identificador.
process.env.RUN_ID ??= Date.now().toString(36)

/** Configuración de la corrida, tomada de variables de entorno. */
export const env = {
  apiUrl: process.env.API_URL ?? "https://dummy-api-topaz.vercel.app",
  bugsTier: parseTier(process.env.BUGS_TIER),
  // Prefijo de las cuentas de prueba: identifica quién generó los datos.
  candidatePrefix: process.env.CANDIDATE_PREFIX ?? "amaidana",
  // Identificador de la corrida: separa los datos de corridas distintas.
  // Se fija una sola vez (ver arriba) para que todos los workers lo compartan.
  runId: process.env.RUN_ID as string,
}

/** Saldo inicial documentado de toda cuenta nueva. */
export const INITIAL_CASH = 1_000_000
