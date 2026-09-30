import {INITIAL_CASH} from "../src/config"
import {expect, expectMoney, test} from "../src/fixtures"
import {consistentSnapshot, expectPortfolioMatchesOrders} from "../src/ledger"
import type {Order} from "../src/schemas"

/**
 * Riesgo P0: reservas de órdenes LIMIT. Una PENDING tiene que apartar cash o
 * acciones para que no se usen dos veces, y liberarlos si se rechaza.
 *
 * DESAFÍO: la resolución de las LIMIT es no determinística (observado: de
 * segundos a más de 20 minutos, con resultado aleatorio). Ningún test espera
 * un estado ni un tiempo concreto. En su lugar se verifican INVARIANTES que
 * valen siempre: el portafolio tiene que poder reconstruirse a partir del
 * historial de órdenes (ver src/ledger.ts), sea cual sea el estado de cada una.
 */
test.describe("Órdenes LIMIT y reservas", () => {
  test("una LIMIT se crea PENDING con el precio límite pedido", {tag: "@P0"}, async ({api, stock}) => {
    const limitPrice = Math.round(stock.last_price * 0.9 * 100) / 100

    const order = await api.placeOrder({
      instrument_id: stock.id,
      side: "BUY",
      type: "LIMIT",
      quantity: 5,
      price: limitPrice,
    })

    expect(order).toMatchObject({
      instrument_id: stock.id,
      side: "BUY",
      type: "LIMIT",
      quantity: 5,
      price: limitPrice,
      status: "PENDING",
    })
  })

  test("el portafolio cuadra con el historial en un escenario mixto de LIMIT", {tag: "@P0"}, async ({api, stock}) => {
    const above = Math.round(stock.last_price * 1.1 * 100) / 100
    const below = Math.round(stock.last_price * 0.9 * 100) / 100

    await test.step("comprar 20 a mercado y crear 4 LIMIT (compras y ventas, arriba y abajo del mercado)", async () => {
      await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 20})
      for (const [side, price] of [
        ["BUY", above],
        ["BUY", below],
        ["SELL", below],
        ["SELL", above],
      ] as const) {
        const order = await api.placeOrder({instrument_id: stock.id, side, type: "LIMIT", quantity: 5, price})
        expect(order.status, "toda LIMIT nace PENDING").toBe("PENDING")
      }
    })

    await test.step("cash y tenencias coinciden con lo que se deriva de las órdenes", async () => {
      const {orders} = await expectPortfolioMatchesOrders(api)
      expect(orders).toHaveLength(5)
    })
  })

  test("una compra LIMIT pendiente reserva cash: no se puede gastar dos veces", {tag: "@P0"}, async ({api, stock}) => {
    // Reservar casi todo el cash con una LIMIT por debajo del mercado.
    const limitPrice = Math.round(stock.last_price * 0.5 * 100) / 100
    const quantity = Math.floor((INITIAL_CASH * 0.9) / limitPrice)
    const limit = await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "LIMIT", quantity, price: limitPrice})

    const {portfolio} = await consistentSnapshot(api)
    const affordable = Math.floor(portfolio.cash / stock.last_price)

    // Intentar comprar a mercado más de lo que alcanza el cash DISPONIBLE.
    const res = await api.createOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: affordable + 1})
    const current = (await api.getOrders()).find(o => o.id === limit.id) as Order

    if (current.status === "REJECTED" && res.status === 201) {
      // La LIMIT se rechazó justo entre la lectura y la compra y liberó el
      // cash: la compra era válida. No es un bug, es la carrera esperada.
      test.info().annotations.push({type: "note", description: "la LIMIT se resolvió durante el test"})
    } else {
      expect(res.status, `comprar ${affordable + 1} con cash disponible ${portfolio.cash}`).toBe(400)
      expect(res.body).toEqual({error: "Insufficient cash"})
    }
    await expectPortfolioMatchesOrders(api)
  })

  test("una venta LIMIT pendiente reserva acciones: no se pueden vender dos veces", {tag: "@P0"}, async ({api, stock}) => {
    await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 10})
    const limit = await api.placeOrder({
      instrument_id: stock.id,
      side: "SELL",
      type: "LIMIT",
      quantity: 6,
      price: Math.round(stock.last_price * 1.5 * 100) / 100,
    })

    const {portfolio} = await consistentSnapshot(api)
    const available = portfolio.holdings.find(h => h.instrument_id === stock.id)?.quantity ?? 0

    const res = await api.createOrder({instrument_id: stock.id, side: "SELL", type: "MARKET", quantity: available + 1})
    const current = (await api.getOrders()).find(o => o.id === limit.id) as Order

    if (current.status === "REJECTED" && res.status === 201) {
      test.info().annotations.push({type: "note", description: "la LIMIT se resolvió durante el test"})
    } else {
      expect(res.status, `vender ${available + 1} con ${available} disponibles`).toBe(400)
      expect(res.body).toEqual({error: "Insufficient shares"})
    }
    await expectPortfolioMatchesOrders(api)
  })

  test("una LIMIT ejecutada respeta su precio límite", {tag: ["@P1", "@slow"]}, async ({api, stock}) => {
    // Lento y opcional (`npm run test:slow`): espera a que alguna LIMIT se
    // resuelva. Corre en la CI nocturna, no en cada cambio.
    test.setTimeout(5 * 60_000)

    await api.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 30})
    const limits: {id: Order["id"]; side: "BUY" | "SELL"; limit: number}[] = []
    for (const [side, factor] of [
      ["BUY", 1.05],
      ["BUY", 0.95],
      ["SELL", 0.95],
      ["SELL", 1.05],
    ] as const) {
      const limit = Math.round(stock.last_price * factor * 100) / 100
      const order = await api.placeOrder({instrument_id: stock.id, side, type: "LIMIT", quantity: 5, price: limit})
      limits.push({id: order.id, side, limit})
    }

    // Esperamos hasta que AL MENOS UNA LIMIT se resuelva (no todas): en la
    // exploración, la resolución tardó entre segundos y más de 20 minutos.
    // Exigir que se resuelvan todas en un plazo fijo haría el test inestable.
    const deadline = Date.now() + 4 * 60_000
    let resolved: Order[] = []
    while (Date.now() < deadline) {
      resolved = (await api.getOrders()).filter(o => o.type === "LIMIT" && o.status !== "PENDING")
      if (resolved.length > 0) break
      await new Promise(resolve => setTimeout(resolve, 5_000))
    }
    test.skip(
      resolved.length === 0,
      "Ninguna LIMIT se resolvió en 4 minutos (la resolución es aleatoria y puede tardar más de 20): no hay ejecución para verificar"
    )

    for (const order of resolved.filter(o => o.status === "FILLED")) {
      const {side, limit} = limits.find(l => l.id === order.id)!
      if (side === "BUY") expect(order.price, "una compra no puede pagar más que el límite").toBeLessThanOrEqual(limit)
      else expect(order.price, "una venta no puede cobrar menos que el límite").toBeGreaterThanOrEqual(limit)
    }
    await expectPortfolioMatchesOrders(api)
  })
})
