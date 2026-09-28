import {INITIAL_CASH} from "../src/config"
import {expect, expectMoney, test} from "../src/fixtures"

/**
 * Riesgo P1: información del portafolio incoherente con el mercado (la app
 * calcula valor de mercado, ganancia y rendimiento a partir de estos datos).
 * Riesgo P2: que el reset deje estado residual.
 */
test.describe("Portafolio", () => {
  test("una cuenta nueva arranca con 1.000.000 de cash y sin posiciones", {tag: "@P1"}, async ({api}) => {
    const portfolio = await api.getPortfolio()
    expectMoney(portfolio.cash, INITIAL_CASH, "cash inicial")
    expect(portfolio.holdings).toEqual([])
    expect(await api.getOrders()).toEqual([])
  })

  test("los precios de las tenencias coinciden con los del mercado", {tag: "@P1"}, async ({api}) => {
    const instruments = await api.getInstruments()
    const stocks = instruments.filter(i => i.type === "ACCIONES" && i.last_price > 0).slice(0, 3)
    for (const stock of stocks) {
      await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 2})
    }

    const portfolio = await api.getPortfolio()
    expect(portfolio.holdings).toHaveLength(stocks.length)
    for (const holding of portfolio.holdings) {
      const market = instruments.find(i => i.id === holding.instrument_id)
      expect(holding, `tenencia ${holding.ticker}`).toMatchObject({
        ticker: market?.ticker,
        last_price: market?.last_price,
        close_price: market?.close_price,
      })
    }
  })
})

test.describe("Reset de cuenta", () => {
  test("borra órdenes, tenencias y reservas, y vuelve al cash inicial", {tag: "@P2"}, async ({api, stock}) => {
    await test.step("generar estado: compra y LIMIT pendiente", async () => {
      await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 5})
      await api.placeOrder({
        instrument_id: stock.id,
        side: "BUY",
        type: "LIMIT",
        quantity: 5,
        price: Math.round(stock.last_price * 0.5 * 100) / 100,
      })
    })

    await api.reset()

    const portfolio = await api.getPortfolio()
    expectMoney(portfolio.cash, INITIAL_CASH, "cash tras reset")
    expect(portfolio.holdings).toEqual([])
    expect(await api.getOrders()).toEqual([])
  })

  test("sólo afecta a la cuenta que lo pide", {tag: "@P0"}, async ({newAccount, stock}) => {
    const alice = newAccount("alice")
    const bob = newAccount("bob")
    await alice.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 4})
    await bob.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 4})

    await bob.reset()

    expect(await alice.getOrders()).toHaveLength(1)
    expect((await alice.getPortfolio()).holdings[0]?.quantity).toBe(4)
  })
})
