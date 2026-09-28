import {expect, type APIRequestContext} from "@playwright/test"
import type {z} from "zod"

import {
  errorSchema,
  instrumentListSchema,
  orderListSchema,
  orderSchema,
  portfolioSchema,
  type Instrument,
  type Order,
  type OrderSide,
  type OrderType,
  type Portfolio,
} from "./schemas"

export type ApiResponse = {status: number; body: unknown}

export type OrderRequest = {
  instrument_id: number
  side: OrderSide
  type: OrderType
  quantity: number
  price?: number
}

/** Valida una respuesta contra su contrato y devuelve el dato tipado. */
const parse = <T>(schema: z.ZodType<T>, body: unknown, what: string): T => {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new Error(
      `Contrato roto en ${what}: ${result.error.message}\nRespuesta: ${JSON.stringify(body)}`
    )
  }
  return result.data
}

/**
 * Cliente de la API para UNA cuenta (X-Candidate-Id) y un nivel de bugs.
 *
 * Hay dos tipos de métodos:
 * - "raw" (get/post, createOrder): devuelven status y body sin validar, para
 *   los tests que prueban rechazos.
 * - tipados (getPortfolio, placeOrder, ...): exigen éxito y validan el
 *   contrato, para que los tests del camino feliz sean cortos y legibles.
 */
export class TradingApi {
  constructor(
    private readonly request: APIRequestContext,
    readonly candidateId: string,
    readonly bugsTier: string
  ) {}

  private get headers() {
    return {
      "X-Enable-Bugs": this.bugsTier,
      "X-Candidate-Id": this.candidateId,
    }
  }

  async get(path: string, params?: Record<string, string>): Promise<ApiResponse> {
    const response = await this.request.get(path, {headers: this.headers, params})
    return {status: response.status(), body: await response.json().catch(() => null)}
  }

  async post(path: string, data?: unknown): Promise<ApiResponse> {
    const response = await this.request.post(path, {headers: this.headers, data})
    return {status: response.status(), body: await response.json().catch(() => null)}
  }

  // ---- Lectura ----

  async getInstruments(): Promise<Instrument[]> {
    const res = await this.get("/instruments")
    expect(res.status, "GET /instruments").toBe(200)
    return parse(instrumentListSchema, res.body, "GET /instruments")
  }

  async search(query: string): Promise<Instrument[]> {
    const res = await this.get("/search", {query})
    expect(res.status, `GET /search?query=${query}`).toBe(200)
    return parse(instrumentListSchema, res.body, "GET /search")
  }

  async getPortfolio(): Promise<Portfolio> {
    const res = await this.get("/portfolio")
    expect(res.status, "GET /portfolio").toBe(200)
    return parse(portfolioSchema, res.body, "GET /portfolio")
  }

  async getOrders(): Promise<Order[]> {
    const res = await this.get("/orders")
    expect(res.status, "GET /orders").toBe(200)
    return parse(orderListSchema, res.body, "GET /orders")
  }

  // ---- Escritura ----

  /** Envía cualquier body (válido o no) y devuelve la respuesta cruda. */
  createOrder(body: unknown): Promise<ApiResponse> {
    return this.post("/orders", body)
  }

  /**
   * Envía una orden que DEBE aceptarse y devuelve la orden creada.
   *
   * Acepta cualquier 2xx, igual que la app (axios). El código exacto (201) se
   * verifica en un test propio: si lo exigiéramos acá, un desvío menor en el
   * código de respuesta haría fallar todos los tests de órdenes en el primer
   * paso y ESCONDERÍA los bugs de negocio que vienen después.
   */
  async placeOrder(order: OrderRequest): Promise<Order> {
    const res = await this.createOrder(order)
    expect(res.status, `POST /orders ${JSON.stringify(order)} → ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(200)
    expect(res.status, `POST /orders ${JSON.stringify(order)} → ${JSON.stringify(res.body)}`).toBeLessThan(300)
    return parse(orderSchema, res.body, "POST /orders")
  }

  /** Envía una orden que DEBE rechazarse y devuelve el mensaje de error. */
  async rejectOrder(body: unknown): Promise<string> {
    const res = await this.createOrder(body)
    expect(res.status, `POST /orders ${JSON.stringify(body)} → ${JSON.stringify(res.body)}`).toBe(400)
    return parse(errorSchema, res.body, "POST /orders (error)").error
  }

  async reset(): Promise<void> {
    const res = await this.post("/reset")
    expect(res.status, "POST /reset").toBe(200)
    expect(res.body).toEqual({ok: true})
  }
}
