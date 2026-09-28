import {createHash} from "node:crypto"

import {test as base, expect} from "@playwright/test"

import {TradingApi} from "./api-client"
import {env} from "./config"
import type {Instrument} from "./schemas"

type Fixtures = {
  /** Cliente sobre una cuenta NUEVA y exclusiva de este test. */
  api: TradingApi
  /** Crea cuentas adicionales (por ejemplo, para probar aislamiento). */
  newAccount: (label: string) => TradingApi
  /** Una acción operable, elegida en tiempo de ejecución (no hardcodeada). */
  stock: Instrument
}

/**
 * AISLAMIENTO: cada test recibe su propio X-Candidate-Id, por ejemplo
 * "amaidana-mg7k2x-3f9a1c2b0d-a-r0". La API aísla el estado por ese id, así que cada
 * test arranca con 1.000.000 de cash y sin posiciones, sin depender de
 * /reset ni del orden de ejecución, y los tests pueden correr en paralelo.
 */
export const test = base.extend<Fixtures>({
  newAccount: async ({request}, use, testInfo) => {
    // testId identifica al test (archivo + título). Lo resumimos en un hash
    // corto para que el id de la cuenta sea único por test y legible.
    const testHash = createHash("sha1").update(testInfo.testId).digest("hex").slice(0, 10)
    const accountFor = (label: string) =>
      new TradingApi(
        request,
        `${env.candidatePrefix}-${env.runId}-${testHash}-${label}-r${testInfo.retry}`,
        env.bugsTier
      )
    await use(accountFor)
  },

  api: async ({newAccount}, use, testInfo) => {
    const api = newAccount("a")
    // Queda registrado en el reporte: permite reproducir el test a mano.
    testInfo.annotations.push({type: "cuenta", description: api.candidateId})
    await use(api)
  },

  stock: async ({api}, use) => {
    const instruments = await api.getInstruments()
    const stock = instruments
      .filter(i => i.type === "ACCIONES" && i.last_price > 0)
      .sort((a, b) => a.id - b.id)[0]
    expect(stock, "debe existir al menos una acción operable").toBeDefined()
    await use(stock)
  },
})

export {expect}

/** Compara montos en pesos al centavo (evita falsos fallos por decimales). */
export const expectMoney = (actual: number | undefined, expected: number, what: string) =>
  expect(actual, what).toBeCloseTo(expected, 2)

/**
 * Marca un test como FALLO CONOCIDO: describe el comportamiento correcto y
 * hoy falla por un bug reportado. La suite queda en verde, el bug queda
 * visible en el reporte, y si alguien lo corrige el test "pasa
 * inesperadamente" y avisa que hay que quitar la marca.
 */
export const knownIssue = (id: string, summary: string) => {
  test.info().annotations.push({type: "known-issue", description: `${id}: ${summary} (ver BUGS.md)`})
  test.fail(true, `${id}: ${summary}`)
}
