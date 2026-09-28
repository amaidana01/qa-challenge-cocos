import {INITIAL_CASH} from "../src/config"
import {expect, expectMoney, knownIssue, test} from "../src/fixtures"

/**
 * Riesgo P1: órdenes con datos inválidos. La app valida el formulario antes
 * de enviar, así que estas reglas del servidor SÓLO se pueden probar contra
 * la API: cualquier cliente que la llame directo saltea la validación de la
 * app.
 *
 * Cada caso verifica el rechazo (400 + mensaje) y que la cuenta quedó igual.
 */
const INSTRUMENT = 2 // cualquier instrumento válido; el precio no importa acá

const invalidOrders: {name: string; body: Record<string, unknown>; error?: string}[] = [
  {
    name: "cantidad 0",
    body: {instrument_id: INSTRUMENT, side: "BUY", type: "MARKET", quantity: 0},
  },
  {
    name: "cantidad negativa",
    body: {instrument_id: INSTRUMENT, side: "BUY", type: "MARKET", quantity: -1},
  },
  {
    name: "cantidad decimal",
    body: {instrument_id: INSTRUMENT, side: "BUY", type: "MARKET", quantity: 1.5},
    error: "quantity must be a positive integer",
  },
  {
    name: "sin cantidad",
    body: {instrument_id: INSTRUMENT, side: "BUY", type: "MARKET"},
  },
  {
    name: "instrumento inexistente",
    body: {instrument_id: 999_999, side: "BUY", type: "MARKET", quantity: 1},
    error: "Instrument not found",
  },
  {
    name: "side inválido",
    body: {instrument_id: INSTRUMENT, side: "HOLD", type: "MARKET", quantity: 1},
  },
  {
    name: "type inválido",
    body: {instrument_id: INSTRUMENT, side: "BUY", type: "STOP", quantity: 1},
  },
  {
    name: "LIMIT sin precio",
    body: {instrument_id: INSTRUMENT, side: "BUY", type: "LIMIT", quantity: 1},
    error: "LIMIT orders require a numeric price",
  },
]

const expectAccountUntouched = async (api: import("../src/api-client").TradingApi) => {
  const portfolio = await api.getPortfolio()
  expectMoney(portfolio.cash, INITIAL_CASH, "el cash no debe cambiar")
  expect(portfolio.holdings, "no debe haber tenencias").toEqual([])
  expect(await api.getOrders(), "no debe crearse ninguna orden").toEqual([])
}

test.describe("Validación de órdenes", () => {
  for (const {name, body, error} of invalidOrders) {
    test(`rechaza: ${name}`, {tag: "@P1"}, async ({api}) => {
      const message = await api.rejectOrder(body)
      // Los mensajes que la app traduce al español son parte del contrato:
      // si cambian, el usuario ve el texto en inglés.
      if (error) expect(message).toBe(error)
      await expectAccountUntouched(api)
    })
  }
})

/**
 * Bugs encontrados en la exploración con X-Enable-Bugs=off. Los tests
 * describen el comportamiento correcto y quedan marcados como fallos
 * conocidos (ver BUGS.md).
 */
test.describe("Validación de órdenes — fallos conocidos", () => {
  test("rechaza: LIMIT con precio negativo (y no genera cash)", {tag: "@P0"}, async ({api}) => {
    knownIssue("BUG-01", "una LIMIT con precio negativo se acepta y aumenta el cash disponible")

    const res = await api.createOrder({instrument_id: INSTRUMENT, side: "BUY", type: "LIMIT", quantity: 1, price: -5})
    const portfolio = await api.getPortfolio()
    expect(portfolio.cash, "el cash nunca puede superar el inicial sin ventas").toBeLessThanOrEqual(INITIAL_CASH)
    expect(res.status).toBe(400)
  })

  test("rechaza: LIMIT con precio 0", {tag: "@P1"}, async ({api}) => {
    knownIssue("BUG-02", "una LIMIT con precio 0 se acepta")

    await api.rejectOrder({instrument_id: INSTRUMENT, side: "BUY", type: "LIMIT", quantity: 1, price: 0})
    await expectAccountUntouched(api)
  })

  test("rechaza: cantidad enviada como texto", {tag: "@P2"}, async ({api}) => {
    knownIssue("BUG-05", "quantity como texto (\"2\") se acepta y se ejecuta")

    await api.rejectOrder({instrument_id: INSTRUMENT, side: "BUY", type: "MARKET", quantity: "2"})
    await expectAccountUntouched(api)
  })

  test("rechaza: operar la moneda de liquidación (ARS)", {tag: "@P2"}, async ({api}) => {
    knownIssue("BUG-04", "el instrumento ARS (tipo MONEDA) se puede comprar como una acción")

    const ars = (await api.getInstruments()).find(i => i.type === "MONEDA")
    test.skip(!ars, "no hay instrumento de tipo MONEDA")

    await api.rejectOrder({instrument_id: ars!.id, side: "BUY", type: "MARKET", quantity: 100})
    await expectAccountUntouched(api)
  })
})
