import {expect} from "@playwright/test"

import type {TradingApi} from "./api-client"
import {INITIAL_CASH} from "./config"
import type {Order, Portfolio} from "./schemas"

/**
 * MODELO DE REFERENCIA (oráculo) del portafolio.
 *
 * La documentación dice que el portafolio "se deriva de las órdenes FILLED" y
 * va "neto de lo reservado por las PENDING". Entonces, dado el historial de
 * órdenes, podemos calcular de forma independiente cuánto cash y cuántas
 * acciones debería mostrar /portfolio:
 *
 *   FILLED   → liquida:  BUY resta cash y suma acciones, SELL al revés
 *   PENDING  → reserva:  BUY aparta cash (cantidad × precio límite),
 *                        SELL aparta acciones
 *   REJECTED → no afecta nada (su reserva se liberó)
 *
 * Esto permite verificar las órdenes LIMIT sin adivinar cómo se resuelven:
 * sea cual sea el estado de cada orden, el portafolio tiene que cuadrar.
 */
export type ExpectedPosition = {quantity: number; avgCostPrice: number}

export type ExpectedPortfolio = {
  cash: number
  positions: Map<number, ExpectedPosition>
}

export const expectedPortfolioFrom = (
  orders: Order[],
  initialCash = INITIAL_CASH
): ExpectedPortfolio => {
  let cash = initialCash
  // Por instrumento: acciones disponibles y costo total de esas acciones.
  const book = new Map<number, {quantity: number; cost: number}>()

  const chronological = [...orders].sort((a, b) => a.created_at.localeCompare(b.created_at))

  for (const order of chronological) {
    if (order.status === "REJECTED") continue

    const amount = order.quantity * order.price
    const position = book.get(order.instrument_id) ?? {quantity: 0, cost: 0}

    if (order.side === "BUY") {
      // Tanto FILLED (liquidado) como PENDING (reservado) descuentan cash.
      cash -= amount
      if (order.status === "FILLED") {
        position.quantity += order.quantity
        position.cost += amount
      }
    } else {
      if (order.status === "FILLED") cash += amount
      // Vender (o reservar para vender) saca acciones al costo promedio:
      // el costo promedio de las que quedan NO cambia.
      const avg = position.quantity > 0 ? position.cost / position.quantity : 0
      position.quantity -= order.quantity
      position.cost -= avg * order.quantity
    }
    book.set(order.instrument_id, position)
  }

  const positions = new Map<number, ExpectedPosition>()
  for (const [instrumentId, {quantity, cost}] of book) {
    if (quantity > 0) positions.set(instrumentId, {quantity, avgCostPrice: cost / quantity})
  }
  return {cash, positions}
}

/**
 * Lee historial y portafolio de forma consistente.
 *
 * Una LIMIT puede cambiar de estado entre que leemos /orders y /portfolio. Si
 * pasa, no es un bug: volvemos a leer. Sólo comparamos cuando el historial es
 * el mismo antes y después de leer el portafolio.
 */
export const consistentSnapshot = async (
  api: TradingApi
): Promise<{orders: Order[]; portfolio: Portfolio}> => {
  const fingerprint = (orders: Order[]) =>
    orders.map(o => `${o.id}:${o.status}:${o.price}`).sort().join("|")

  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await api.getOrders()
    const portfolio = await api.getPortfolio()
    const after = await api.getOrders()
    if (fingerprint(before) === fingerprint(after)) return {orders: after, portfolio}
  }
  throw new Error("El historial de órdenes no se estabilizó tras 5 lecturas")
}

/** Verifica que /portfolio coincide con lo que se deriva del historial. */
export const expectPortfolioMatchesOrders = async (api: TradingApi) => {
  const {orders, portfolio} = await consistentSnapshot(api)
  const expected = expectedPortfolioFrom(orders)
  const context = `\nÓrdenes: ${JSON.stringify(orders)}\nPortafolio: ${JSON.stringify(portfolio)}`

  expect(portfolio.cash, `cash derivado del historial${context}`).toBeCloseTo(expected.cash, 2)

  const actualIds = portfolio.holdings.filter(h => h.quantity > 0).map(h => h.instrument_id)
  expect(new Set(actualIds), `instrumentos en cartera${context}`).toEqual(
    new Set(expected.positions.keys())
  )

  for (const [instrumentId, position] of expected.positions) {
    const holding = portfolio.holdings.find(h => h.instrument_id === instrumentId)
    expect(holding?.quantity, `cantidad del instrumento ${instrumentId}${context}`).toBe(
      position.quantity
    )
    expect(holding?.avg_cost_price, `costo promedio del instrumento ${instrumentId}${context}`).toBeCloseTo(
      position.avgCostPrice,
      2
    )
  }
  return {orders, portfolio}
}
