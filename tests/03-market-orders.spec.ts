import {INITIAL_CASH} from "../src/config"
import {expect, expectMoney, test} from "../src/fixtures"

/**
 * Riesgo P0: liquidación incorrecta de órdenes a mercado. Un error acá
 * significa dinero o acciones que aparecen o desaparecen de la cuenta.
 *
 * Cada test verifica el efecto COMPLETO de la operación: la respuesta de la
 * orden, el cash, la tenencia (cantidad y costo promedio) y el historial.
 */
test.describe("Órdenes MARKET", () => {
  test("compra: se ejecuta al último precio y descuenta el cash exacto", {tag: "@P0"}, async ({api, stock}) => {
    const quantity = 10

    const order = await test.step("comprar", () =>
      api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity})
    )

    await test.step("la orden se ejecuta de inmediato al last_price", async () => {
      expect(order).toMatchObject({
        instrument_id: stock.id,
        side: "BUY",
        type: "MARKET",
        quantity,
        status: "FILLED",
      })
      expect(order.price).toBe(stock.last_price)
    })

    await test.step("el portafolio refleja la compra", async () => {
      const portfolio = await api.getPortfolio()
      expectMoney(portfolio.cash, INITIAL_CASH - quantity * stock.last_price, "cash")
      expect(portfolio.holdings).toHaveLength(1)
      expect(portfolio.holdings[0]).toMatchObject({
        instrument_id: stock.id,
        ticker: stock.ticker,
        quantity,
        last_price: stock.last_price,
        close_price: stock.close_price,
      })
      expectMoney(portfolio.holdings[0].avg_cost_price, stock.last_price, "costo promedio")
    })

    await test.step("la orden aparece en el historial", async () => {
      const orders = await api.getOrders()
      expect(orders).toHaveLength(1)
      expect(orders[0]).toMatchObject({id: order.id, status: "FILLED", quantity})
    })
  })

  test("venta parcial: suma el cash y NO cambia el costo promedio", {tag: "@P0"}, async ({api, stock}) => {
    await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 10})

    const sale = await api.placeOrder({instrument_id: stock.id, side: "SELL", type: "MARKET", quantity: 4})
    expect(sale).toMatchObject({status: "FILLED", price: stock.last_price})

    const portfolio = await api.getPortfolio()
    expectMoney(portfolio.cash, INITIAL_CASH - 10 * stock.last_price + 4 * stock.last_price, "cash")
    expect(portfolio.holdings).toHaveLength(1)
    expect(portfolio.holdings[0].quantity).toBe(6)
    expectMoney(portfolio.holdings[0].avg_cost_price, stock.last_price, "costo promedio")
  })

  test("venta total: la posición desaparece y el cash vuelve al inicial", {tag: "@P0"}, async ({api, stock}) => {
    await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 5})
    await api.placeOrder({instrument_id: stock.id, side: "SELL", type: "MARKET", quantity: 5})

    const portfolio = await api.getPortfolio()
    expectMoney(portfolio.cash, INITIAL_CASH, "cash")
    expect(portfolio.holdings.filter(h => h.quantity > 0)).toEqual([])
  })

  test("compras sucesivas acumulan cantidad y costo promedio ponderado", {tag: "@P1"}, async ({api, stock}) => {
    await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 3})
    await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 7})

    const orders = await api.getOrders()
    const totalCost = orders.reduce((sum, o) => sum + o.quantity * o.price, 0)

    const portfolio = await api.getPortfolio()
    expect(portfolio.holdings).toHaveLength(1)
    expect(portfolio.holdings[0].quantity).toBe(10)
    expectMoney(portfolio.holdings[0].avg_cost_price, totalCost / 10, "costo promedio ponderado")
    expectMoney(portfolio.cash, INITIAL_CASH - totalCost, "cash")
  })

  test("se puede usar el cash hasta el último peso, pero no más", {tag: "@P0"}, async ({api, stock}) => {
    const maxQuantity = Math.floor(INITIAL_CASH / stock.last_price)

    await test.step(`comprar el máximo posible (${maxQuantity} acciones)`, async () => {
      await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: maxQuantity})
    })

    await test.step("una acción más se rechaza por falta de cash", async () => {
      const error = await api.rejectOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 1})
      expect(error).toBe("Insufficient cash")
    })

    await test.step("el cash restante es menor que el precio de una acción", async () => {
      const portfolio = await api.getPortfolio()
      expectMoney(portfolio.cash, INITIAL_CASH - maxQuantity * stock.last_price, "cash")
      expect(portfolio.cash).toBeLessThan(stock.last_price)
      expect(await api.getOrders()).toHaveLength(1)
    })
  })
})

/**
 * Riesgo P0: los controles de saldo. Si fallan, se crea dinero o acciones de
 * la nada. Además del rechazo, se verifica que el estado NO cambió.
 */
test.describe("Controles de saldo", () => {
  test("comprar sin cash suficiente se rechaza sin tocar la cuenta", {tag: "@P0"}, async ({api, stock}) => {
    const tooMany = Math.floor(INITIAL_CASH / stock.last_price) + 1

    const error = await api.rejectOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: tooMany})
    expect(error).toBe("Insufficient cash")

    const portfolio = await api.getPortfolio()
    expectMoney(portfolio.cash, INITIAL_CASH, "cash")
    expect(portfolio.holdings).toEqual([])
    expect(await api.getOrders()).toEqual([])
  })

  test("vender más acciones de las que se tienen se rechaza sin tocar la cuenta", {tag: "@P0"}, async ({api, stock}) => {
    await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 7})

    const error = await api.rejectOrder({instrument_id: stock.id, side: "SELL", type: "MARKET", quantity: 8})
    expect(error).toBe("Insufficient shares")

    const portfolio = await api.getPortfolio()
    expectMoney(portfolio.cash, INITIAL_CASH - 7 * stock.last_price, "cash")
    expect(portfolio.holdings[0].quantity).toBe(7)
    expect(await api.getOrders()).toHaveLength(1)
  })

  test("vender sin tener el instrumento se rechaza", {tag: "@P0"}, async ({api, stock}) => {
    const error = await api.rejectOrder({instrument_id: stock.id, side: "SELL", type: "MARKET", quantity: 1})
    expect(error).toBe("Insufficient shares")

    const portfolio = await api.getPortfolio()
    expectMoney(portfolio.cash, INITIAL_CASH, "cash")
    expect(await api.getOrders()).toEqual([])
  })
})
