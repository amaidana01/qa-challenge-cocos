# Plan de pruebas — app-qa (Cocos)

> **Borrador para revisar.** Las marcas 🟡 señalan decisiones de criterio para confirmar o ajustar.

## 1. Contexto y objetivo

`app-qa` es una app de inversiones (React Native / Expo) que consume una API REST con instrumentos, búsqueda, portafolio y órdenes. El objetivo es **evaluar la calidad del sistema y automatizar la validación de lo que más riesgo tiene**, no cubrir todo.

La pregunta que guía el plan: **¿qué fallas le harían perder dinero al usuario o a la empresa, o le mostrarían información financiera incorrecta?**

## 2. Cómo funciona el sistema (mapa funcional)

```
App (React Native)                          API REST
─────────────────                           ────────
Mercados  ───────────── GET /instruments ──► precios compartidos (sólo lectura)
Búsqueda  ───────────── GET /search      ──►
Portafolio ──────────── GET /portfolio   ──► derivado de las órdenes del candidato
Órdenes   ── envío ──── POST /orders     ──► valida, reserva y ejecuta
          ── historial  GET /orders      ──►
          ── reiniciar  POST /reset      ──►
```

Tres características del diseño definen la estrategia:

1. **La API es la fuente de verdad del dinero.** Valida las órdenes, reserva saldo y liquida. La app solo muestra.
2. **La app hace cálculos de presentación** (valor de mercado, ganancia, rendimiento, retorno diario) a partir de datos crudos de la API. Esa lógica ya tiene tests unitarios en el repo (`bun test`, 11 archivos).
3. **La app valida el formulario antes de enviar.** Desde la UI no se puede mandar una cantidad 0 o un precio negativo, así que **las reglas del servidor solo se pueden probar de verdad contra la API**.

## 3. Mapa de riesgos

Prioridad = impacto × probabilidad. P0 es lo que no puede fallar nunca.

| Prio | Área | Qué puede salir mal | Impacto | Cobertura |
|---|---|---|---|---|
| **P0** | Liquidación de órdenes MARKET | Se ejecuta a un precio distinto de `last_price`, o el cash/las tenencias no se actualizan exactamente | Pérdida de dinero, saldo incorrecto | API automatizada |
| **P0** | Controles de saldo | Comprar sin cash suficiente o **vender acciones que no se tienen** | Dinero o acciones creados de la nada | API automatizada |
| **P0** | Reservas de órdenes LIMIT | Una PENDING no reserva, una REJECTED no libera, o una reserva negativa suma saldo | Doble gasto, saldo inflado | API automatizada (invariantes) |
| **P0** | Aislamiento entre cuentas | Un candidato ve u opera el estado de otro | Fuga de datos, operaciones ajenas | API automatizada |
| **P1** | Validación de entrada | Se aceptan cantidades no enteras, precios ≤ 0, tipos inválidos | Órdenes absurdas, efectos colaterales en el saldo | API automatizada |
| **P1** | Integridad del portafolio | `avg_cost_price`, cantidades o precios incoherentes con las órdenes | Ganancia y rendimiento mal mostrados | API automatizada |
| **P1** | Datos de mercado | Precios en 0, negativos, faltantes o duplicados | Compras gratis, retornos mal calculados | API automatizada |
| **P1** | Trazabilidad del historial | Las órdenes no reflejan lo pedido y lo ejecutado | Imposible auditar o dar soporte | API automatizada + reporte |
| **P2** | Búsqueda | No encuentra por minúsculas o por coincidencia parcial | El usuario no encuentra el instrumento | API automatizada |
| **P2** | Contrato de respuestas | Cambian campos o tipos y la app deja de mostrar datos | Pantallas con error | Validación de esquema |
| **P2** | Reset de cuenta | No limpia todo el estado | Datos residuales | API automatizada |
| **P3** | Presentación en la app | Formatos, textos, accesibilidad | Confusión del usuario | Exploración manual, fuera de la automatización |

## 4. Estrategia: a qué nivel probar y por qué

| Nivel | Decisión | Justificación |
|---|---|---|
| **API** | ✅ **Automatizado, foco principal** | Es donde viven las reglas de negocio y el riesgo financiero. Tests rápidos (segundos), estables, sin dependencias de dispositivo, y permiten probar casos que la UI bloquea |
| **Lógica del cliente** | ✅ Ya cubierta | El repo trae tests unitarios de cálculos, validación y formato. No se duplican |
| **UI (simulador)** | ❌ **Fuera de la automatización** 🟡 | Ver sección 6. Se explora manualmente y se documentan los problemas de testabilidad |

**Herramienta: Playwright Test (TypeScript).** Trae cliente HTTP, paralelismo, reintentos, reportes HTML/JUnit y marcado de fallos conocidos, sin librerías extra. Usa el mismo lenguaje que el repo de la app.

## 5. Alcance: qué se automatiza

### Instrumentos y búsqueda (P1–P2)
- Campos presentes, tipos correctos, precios mayores a 0, ids y tickers únicos.
- Búsqueda parcial, sin distinguir mayúsculas, solo por ticker, y sin resultados cuando corresponde.

### Órdenes MARKET (P0)
- Compra: `FILLED` al `last_price` vigente, el cash baja `cantidad × precio`, se crea la tenencia con costo promedio = precio.
- Venta parcial: el cash sube, la cantidad baja, **el costo promedio no cambia**.
- Venta total: la posición desaparece.
- Límite exacto de saldo: se puede comprar la cantidad máxima que alcanza el cash, y una más se rechaza.
- Rechazos por cash o acciones insuficientes, **verificando que el estado no cambió**.

### Validaciones (P1)
- Cantidad 0, negativa, decimal, texto o ausente; `side`/`type` inválidos; instrumento inexistente; LIMIT sin precio o con precio ≤ 0.
- Cada rechazo verifica también que **no se creó ninguna orden y el saldo quedó igual**.

### Órdenes LIMIT y reservas (P0)
- Toda LIMIT se crea `PENDING`.
- **Invariante principal:** el portafolio debe poder reconstruirse a partir del historial de órdenes (FILLED liquida, PENDING reserva, REJECTED no afecta). Se verifica sea cual sea el estado en que quedó cada orden. Ver sección 8.
- Una venta LIMIT pendiente reserva acciones, y una venta MARKET por encima de lo disponible se rechaza.
- Si una LIMIT se ejecuta, el precio respeta el límite (compra ≤ límite, venta ≥ límite).

### Aislamiento y reset (P0 / P2)
- Las órdenes de una cuenta no aparecen en otra.
- Faltan los headers requeridos → 400.
- `POST /reset` deja cash 1.000.000, sin tenencias y sin historial.

### Contrato (P2)
- Esquema de cada respuesta validado contra lo que espera la app (los mismos campos que valida su código).

## 6. Fuera de alcance

| Qué | Por qué |
|---|---|
| **Automatización de UI** 🟡 | La app no tiene `testID` (solo etiquetas de accesibilidad que incluyen precios, por lo que cambian), usa alertas nativas y toasts temporales, y los gráficos no son inspeccionables. Automatizarla exigiría modificar la app y sería costosa y frágil, mientras el riesgo principal está en la API. Se documenta como hallazgo de testabilidad, con el cambio propuesto |
| Pruebas de carga y performance | El entorno es compartido entre candidatos: cargarlo afectaría a otros. No es un objetivo del challenge |
| Seguridad más allá del aislamiento | No hay autenticación real: la identidad es un header. Se reporta como observación, sin intentar acceder a cuentas ajenas |
| Estadística del tiempo de resolución de LIMIT | Es aleatorio por diseño. Se prueban invariantes, no tiempos |
| Costo promedio ponderado con precios distintos | Los precios son estáticos, así que solo se puede ejercitar con ejecuciones LIMIT, que son aleatorias. Cobertura parcial, documentada como riesgo residual |
| Android / múltiples dispositivos | Fuera del foco de la API |
| Lógica de presentación de la app | Ya tiene tests unitarios en el repo |

## 7. Supuestos

1. `X-Enable-Bugs: off` es la referencia de comportamiento correcto, **salvo donde contradice la documentación o la lógica de negocio** (por ejemplo, precios negativos): ahí manda la documentación y se reporta el bug.
2. Los montos se comparan redondeados a centavos, para evitar falsos fallos de aritmética decimal.
3. Los precios fueron estáticos durante la exploración, pero **los tests no lo asumen**: leen el precio vigente antes de operar.
4. Que una LIMIT se ejecute a un precio mejor que el límite (price improvement) es válido.
5. `side`/`type` en minúsculas y la búsqueda vacía devolviendo todo se tratan como observaciones, no bugs, porque la documentación no las define. 🟡
6. El instrumento `ARS` (tipo MONEDA) no debería ser operable. Se reporta como observación con dos alternativas. 🟡

## 8. Cómo se manejan las LIMIT no determinísticas

Una LIMIT puede resolverse en segundos o en más de 20 minutos, con resultado aleatorio. Por eso **ningún test espera un estado concreto ni un tiempo**. En cambio:

1. Se lee el historial de órdenes y el portafolio.
2. Se calcula el portafolio esperado a partir de las órdenes: FILLED suma o resta, PENDING reserva, REJECTED no cuenta.
3. Se compara con lo que devuelve `/portfolio`.
4. Si una orden cambia de estado entre las dos lecturas, se vuelve a leer (una condición de carrera conocida, no un error).

Así el test es estable en cualquier escenario y detecta cualquier descuadre de dinero.

## 9. Aislamiento y datos de prueba

- **Cada test usa su propio `X-Candidate-Id`** (`amaidana-<corrida>-<test>`): arranca con una cuenta nueva de 1.000.000, sin depender de otros tests ni del orden de ejecución. Permite correr en paralelo.
- No se depende de `/reset` para aislar. Se usa solo para probar el propio reset.

### ¿Y si no existiera el reset?

La consigna pide explicarlo. La estrategia, en orden de preferencia:

1. **Cuentas descartables por test**, como hace esta suite: en un entorno real, un servicio o fixture que cree cuentas de prueba aprovisionadas con saldo conocido.
2. Si las cuentas son limitadas, **tests que miden diferencias** (estado antes → acción → estado después) en lugar de valores absolutos. No importa con cuánto saldo arranque la cuenta.
3. **Operaciones compensatorias** al final del test (vender lo comprado) para devolver la cuenta a un estado estable, sabiendo que no siempre es posible (una LIMIT pendiente no se puede cancelar en esta API).
4. **Pool de cuentas con lock**, para que dos corridas paralelas no usen la misma cuenta.
5. **Datos de solo lectura** (instrumentos) sin restricciones: no mutan.

## 10. Criterios de éxito de la suite

- Con `off`, **pasa completa**. Los bugs reales encontrados en `off` quedan marcados como **fallos conocidos** vinculados al reporte: la suite queda en verde, y si alguien corrige el bug, el test avisa.
- Con `easy`, `medium` y `hard`, **empieza a fallar**, y cada fallo apunta a un riesgo del mapa.
- Una sola forma de ejecutarla, reporte HTML y JUnit, y ejecución automática en GitHub Actions.
