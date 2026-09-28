import {z} from "zod"

/**
 * Contratos de respuesta de la API.
 *
 * Replican lo que valida la propia app (src/features/<feature>/api/*.api.ts):
 * si la API rompe alguno de estos contratos, la app muestra un error en
 * pantalla. Por eso todo request de la suite valida su respuesta contra ellos.
 */

export const orderSideSchema = z.enum(["BUY", "SELL"])
export const orderTypeSchema = z.enum(["MARKET", "LIMIT"])
export const orderStatusSchema = z.enum(["PENDING", "FILLED", "REJECTED"])

export const instrumentSchema = z.object({
  id: z.number().int(),
  ticker: z.string().min(1),
  name: z.string(),
  type: z.string(),
  last_price: z.number(),
  close_price: z.number(),
})

export const instrumentListSchema = z.array(instrumentSchema)

export const orderSchema = z.object({
  id: z.union([z.number(), z.string()]),
  instrument_id: z.number().int(),
  side: orderSideSchema,
  type: orderTypeSchema,
  quantity: z.number(),
  price: z.number(),
  status: orderStatusSchema,
  created_at: z.iso.datetime(),
})

export const orderListSchema = z.array(orderSchema)

export const holdingSchema = z.object({
  instrument_id: z.number().int(),
  ticker: z.string(),
  quantity: z.number(),
  last_price: z.number(),
  close_price: z.number(),
  avg_cost_price: z.number(),
})

export const portfolioSchema = z.object({
  cash: z.number(),
  holdings: z.array(holdingSchema),
})

export const errorSchema = z.object({
  error: z.string().min(1),
})

export type Instrument = z.infer<typeof instrumentSchema>
export type Order = z.infer<typeof orderSchema>
export type Holding = z.infer<typeof holdingSchema>
export type Portfolio = z.infer<typeof portfolioSchema>
export type OrderSide = z.infer<typeof orderSideSchema>
export type OrderType = z.infer<typeof orderTypeSchema>
export type OrderStatus = z.infer<typeof orderStatusSchema>
