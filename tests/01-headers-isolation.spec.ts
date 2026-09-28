import {env} from "../src/config"
import {expect, expectMoney, test} from "../src/fixtures"

/**
 * Riesgo P0: que un candidato vea u opere el estado de otro, o que la API
 * procese requests sin la identificación y el nivel de defectos requeridos.
 */
test.describe("Headers requeridos y aislamiento entre cuentas", () => {
  test("sin X-Enable-Bugs la API responde 400", {tag: "@P1"}, async ({request}) => {
    const res = await request.get("/instruments")
    expect(res.status()).toBe(400)
  })

  test("X-Enable-Bugs con un valor inválido responde 400", {tag: "@P1"}, async ({request}) => {
    const res = await request.get("/instruments", {headers: {"X-Enable-Bugs": "on"}})
    expect(res.status()).toBe(400)
  })

  test("X-Enable-Bugs no distingue mayúsculas (documentado)", {tag: "@P2"}, async ({request}) => {
    const res = await request.get("/instruments", {
      headers: {"X-Enable-Bugs": env.bugsTier.toUpperCase()},
    })
    expect(res.status()).toBe(200)
  })

  for (const [method, path] of [
    ["GET", "/portfolio"],
    ["GET", "/orders"],
    ["POST", "/reset"],
  ] as const) {
    test(`${method} ${path} sin X-Candidate-Id responde 400`, {tag: "@P0"}, async ({request}) => {
      const options = {headers: {"X-Enable-Bugs": env.bugsTier}}
      const res =
        method === "GET" ? await request.get(path, options) : await request.post(path, options)
      expect(res.status()).toBe(400)
    })
  }

  test("las órdenes de una cuenta no afectan a otra", {tag: "@P0"}, async ({newAccount, stock}) => {
    const alice = newAccount("alice")
    const bob = newAccount("bob")

    await test.step("Alice compra", async () => {
      await alice.placeOrder({instrument_id: stock.id, side: "BUY", type: "MARKET", quantity: 3})
    })

    await test.step("Bob sigue con la cuenta intacta", async () => {
      expect(await bob.getOrders()).toEqual([])
      const portfolio = await bob.getPortfolio()
      expectMoney(portfolio.cash, 1_000_000, "cash de Bob")
      expect(portfolio.holdings).toEqual([])
    })

    await test.step("Alice ve sólo su propia orden", async () => {
      const orders = await alice.getOrders()
      expect(orders).toHaveLength(1)
      expect(orders[0]).toMatchObject({instrument_id: stock.id, quantity: 3})
    })
  })
})
