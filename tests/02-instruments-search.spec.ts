import {expect, test} from "../src/fixtures"

/**
 * Riesgo P1: datos de mercado incorrectos (precios en 0, negativos o
 * duplicados) se traducen en órdenes ejecutadas a precios absurdos y
 * retornos mal calculados en la app.
 * Riesgo P2: que el usuario no encuentre un instrumento que existe.
 */
test.describe("Instrumentos", () => {
  test("todos los precios son positivos", {tag: "@P1"}, async ({api}) => {
    const instruments = await api.getInstruments()
    expect(instruments.length).toBeGreaterThan(0)

    const invalid = instruments.filter(i => !(i.last_price > 0) || !(i.close_price > 0))
    expect(invalid, "instrumentos con last_price o close_price <= 0").toEqual([])
  })

  test("ids y tickers son únicos", {tag: "@P1"}, async ({api}) => {
    const instruments = await api.getInstruments()
    const ids = instruments.map(i => i.id)
    const tickers = instruments.map(i => i.ticker)
    expect(new Set(ids).size, "ids duplicados").toBe(ids.length)
    expect(new Set(tickers).size, "tickers duplicados").toBe(tickers.length)
  })
})

test.describe("Búsqueda por ticker", () => {
  test("encuentra por coincidencia parcial del ticker", {tag: "@P2"}, async ({api, stock}) => {
    const query = stock.ticker.slice(0, 3)
    const results = await api.search(query)

    expect(results.map(r => r.ticker)).toContain(stock.ticker)
    for (const result of results) {
      expect(result.ticker.toUpperCase(), "todo resultado debe contener el texto buscado").toContain(
        query.toUpperCase()
      )
    }
  })

  test("no distingue mayúsculas de minúsculas", {tag: "@P2"}, async ({api, stock}) => {
    const query = stock.ticker.slice(0, 3)
    const upper = await api.search(query.toUpperCase())
    const lower = await api.search(query.toLowerCase())

    expect(lower.map(r => r.ticker)).toContain(stock.ticker)
    expect(lower).toEqual(upper)
  })

  test("los resultados coinciden con el listado de instrumentos", {tag: "@P2"}, async ({api, stock}) => {
    const instruments = await api.getInstruments()
    const results = await api.search(stock.ticker)

    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(instruments, `datos de ${result.ticker} en /search vs /instruments`).toContainEqual(result)
    }
  })

  test("un texto que no coincide con ningún ticker no devuelve resultados", {tag: "@P2"}, async ({api}) => {
    const instruments = await api.getInstruments()
    const query = "QQXZ"
    expect(instruments.some(i => i.ticker.includes(query))).toBe(false)

    expect(await api.search(query)).toEqual([])
  })
})
