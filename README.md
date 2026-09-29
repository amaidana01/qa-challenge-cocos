# QA Challenge — app-qa (Cocos)

[![API tests](https://github.com/amaidana01/qa-challenge-cocos/actions/workflows/api-tests.yml/badge.svg)](https://github.com/amaidana01/qa-challenge-cocos/actions/workflows/api-tests.yml)

Estrategia de calidad y suite automatizada para `app-qa`, una app de inversiones en React Native que consume una API REST de trading.

El foco no fue maximizar la cantidad de tests, sino **cubrir lo que más riesgo tiene en un sistema financiero**: que se cree o se pierda valor, o que el usuario vea un valor distinto del real.

## Qué hay en este repositorio

| Documento | Contenido |
|---|---|
| [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) | Plan de pruebas: mapa de riesgos, alcance, **fuera de alcance**, supuestos, invariantes del modelo y estrategia sin reset |
| [`BUGS.md`](BUGS.md) | Reporte de bugs y hallazgos: pasos, esperado vs. obtenido, **impacto de negocio**, severidad y evidencia |
| [`tests/`](tests) | Suite automatizada de la API (Playwright + TypeScript) |
| [`docs/postman/`](docs/postman) | Colección de Postman usada en la exploración manual |
| [`.github/workflows/`](.github/workflows) | Integración continua en GitHub Actions |

## Cómo ejecutar

**Requisitos:** Node.js 20 o superior. No hace falta navegador, simulador ni la app: la suite habla directo con la API.

```sh
npm install
npm test                 # suite completa contra X-Enable-Bugs=off (el golden path)
```

| Comando | Qué hace |
|---|---|
| `npm test` | Corre la suite en `off`. **Tiene que pasar completa** |
| `npm run test:easy` / `test:medium` / `test:hard` | Corre la suite con defectos inyectados. **Tiene que fallar** |
| `npm run tiers` | Corre los 4 niveles y genera la matriz de detección en `reports/tiers/summary.md` |
| `npm run test:slow` | Tests lentos (unos 5 min): esperan la resolución real de órdenes LIMIT |
| `npm run report` | Abre el reporte HTML de la última corrida |
| `npx playwright test --grep @P0` | Solo los tests críticos |

**Variables de entorno (opcionales):**

| Variable | Default | Uso |
|---|---|---|
| `BUGS_TIER` | `off` | Nivel de `X-Enable-Bugs` |
| `API_URL` | `https://dummy-api-topaz.vercel.app` | URL de la API |
| `CANDIDATE_PREFIX` | `amaidana` | Prefijo de las cuentas de prueba |

**Reportes:** HTML en `reports/html`, JUnit en `reports/junit.xml` y JSON en `reports/results.json`. Cada test anota en el reporte la cuenta (`X-Candidate-Id`) que usó, para poder reproducirlo a mano.

**CI:** en cada push, GitHub Actions corre la suite en `off` (tiene que pasar) y publica los reportes. Todas las noches corre además los 4 niveles y los tests lentos.

## Decisiones principales

### 1. Automatizar la API, no la UI

La razón principal es **dónde está el riesgo**. Las reglas de negocio (validación, reservas, liquidación, saldos) viven en la API. Además, la app valida el formulario antes de enviar, así que **desde la UI no se pueden probar las reglas del servidor**: nunca llega un precio negativo o una cantidad decimal. Probar a nivel API da tests determinísticos, aislados y rápidos (la suite completa corre en unos 10 segundos).

Dos factores adicionales, documentados como hallazgos:
- **Testabilidad** ([APP-01](BUGS.md#app-01)): la app no tiene `testID`, sus etiquetas incluyen precios que cambian, y usa alertas nativas, toasts y gráficos en canvas.
- **Costo de infraestructura** ([APP-02](BUGS.md#app-02)): compilar la app requiere Xcode, simulador, CocoaPods y más de 25 GB, y con el Xcode actual no compila sin un ajuste.

La lógica de presentación de la app (valor de mercado, ganancia, rendimiento, formatos) ya tiene tests unitarios en su propio repo. En un equipo real, sumaría 2 o 3 flujos E2E críticos por UI, después de agregar `testID`.

### 2. Una cuenta por test, sin depender de `/reset`

La API aísla el estado por `X-Candidate-Id`. Cada test usa una cuenta propia (`amaidana-<corrida>-<hash del test>`), así que arranca con 1.000.000 y sin posiciones, no depende de otros tests ni del orden, y la suite corre en paralelo. `/reset` solo se usa para probar el propio reset.

**¿Y si no hubiera reset?** Esta misma estrategia ya funciona sin él. En un entorno real, las alternativas en orden de preferencia son: cuentas descartables aprovisionadas por test, tests que miden diferencias (antes → acción → después) en vez de valores absolutos, operaciones compensatorias, y un pool de cuentas con lock para correr en paralelo. Detalle en el [plan, sección 10](docs/TEST_PLAN.md#10-aislamiento-y-datos-de-prueba).

### 3. Las órdenes LIMIT se prueban con un modelo de referencia

Las LIMIT se resuelven de forma no determinística: en la exploración, entre segundos y más de 20 minutos, con resultado aleatorio. **Ningún test espera un estado ni un tiempo.** En su lugar, [`src/ledger.ts`](src/ledger.ts) reconstruye el portafolio esperado a partir del historial de órdenes (FILLED liquida, PENDING reserva, REJECTED no afecta) y lo compara con lo que devuelve `/portfolio`. Si una orden cambia de estado entre dos lecturas, se vuelve a leer. Así el test es estable en cualquier escenario y detecta cualquier descuadre de dinero. Las reglas están en el [plan, sección 8](docs/TEST_PLAN.md#8-invariantes-del-modelo).

### 4. Los bugs reales quedan visibles sin romper la suite

Los bugs encontrados en `off` tienen su test, que describe el comportamiento **correcto**, marcado como fallo conocido (`test.fail`) y vinculado a `BUGS.md`. La suite queda en verde sin esconderlos, y si alguien corrige el bug, el test "pasa inesperadamente" y avisa que hay que quitar la marca.

### 5. Aserciones sobre comportamiento, no sobre "respondió 200"

Cada test de órdenes verifica el efecto completo: la respuesta, el precio de ejecución, el cash al centavo, la cantidad, el costo promedio y el historial. En los rechazos verifica además que **la cuenta quedó intacta**. Todas las respuestas se validan contra su contrato ([`src/schemas.ts`](src/schemas.ts)), que replica lo que valida la propia app. Los tests están etiquetados por prioridad de riesgo (`@P0` a `@P2`).

## Resultados

### Bugs encontrados

Detalle completo en [`BUGS.md`](BUGS.md). Los más relevantes, porque existen **sin defectos inyectados** (`off`):

- 🔴 **BUG-01:** una LIMIT con precio negativo se acepta y **aumenta el cash disponible**. La app valida el precio, la API no.
- 🟠 **BUG-02:** se acepta una LIMIT con precio 0.
- 🟡 **BUG-03:** al ejecutarse una LIMIT, el historial pierde el precio límite pedido (trazabilidad).
- 🟡 **BUG-04:** la moneda de liquidación (ARS) se puede comprar como una acción.

### Sensibilidad de la suite ante defectos inyectados

La API permite inyectar defectos con `X-Enable-Bugs`. Se usaron para **validar que la suite detecta distintas categorías de regresión**, no como métrica de calidad en sí:

| Nivel | Tests OK | Tests fallidos | Defectos distintos detectados |
|---|---|---|---|
| off | 43 | 0 | — |
| easy | 38 | 5 | 3 |
| medium | 35 | 8 | 5 |
| hard | 29 | 14 | 8 |

Entre los detectados: ventas de acciones que no se tienen (creación de dinero), ejecución al precio de cierre en lugar del último, órdenes MARKET que quedan pendientes y respuestas que rompen el contrato de forma intermitente. `hard` no es "más ruidoso": sus defectos exclusivos solo se detectan verificando montos y contratos. Un mismo defecto puede romper varios tests, por eso se cuentan defectos y no tests. Los tests fallidos en `easy`, `medium` y `hard` pueden variar levemente entre corridas: algunos defectos inyectados son intermitentes (INJ-05, INJ-06) y las LIMIT se resuelven al azar. Lo estable, y lo que importa, es que `off` pasa siempre completa y que el conjunto de defectos detectados se mantiene.

## Decisiones de diseño y lecciones aprendidas

**Un error de aislamiento, detectado por la propia suite.** La primera versión generaba el identificador de corrida por worker, y los tests de un mismo archivo terminaban compartiendo cuenta. Los tests pasaban o fallaban según con quién coincidían en paralelo. Se detectó porque el mensaje de error listaba órdenes que el test nunca había creado. Se corrigió con un identificador único por corrida y un hash por test. Lección: **el aislamiento no se asume, se verifica**.

**Una aserción menor escondía bugs críticos.** En `medium` y `hard`, crear una orden responde 200 en lugar de 201. Como todos los tests de órdenes exigían 201 en el primer paso, ese desvío cortaba 14 tests antes de verificar precios y saldos, y escondía la ejecución al precio de cierre y las órdenes pendientes. Ahora el helper acepta cualquier 2xx (igual que la app) y el 201 se verifica en un test propio. Lección: **cada test verifica un riesgo; una aserción menor al principio puede reducir la capacidad de diagnóstico de toda la suite**.

**Verificar el impacto antes de asignar severidad.** En `easy`, MIRG aparece con precio 0 y la primera hipótesis fue "permite comprar gratis" (crítica). Al verificarlo, la orden se ejecutó al precio correcto: el defecto estaba en el dato mostrado, no en el cobrado. Se reclasificó como alta, con el impacto real.

**Un test de exploración que asumía tiempos.** En la exploración con Postman, un chequeo asumía que las LIMIT seguían pendientes segundos después de crearlas, y falló porque una se había ejecutado. De ahí salió el diseño basado en invariantes de la suite final.

## Estructura

```
src/
  config.ts        configuración de la corrida (nivel de bugs, URL, id de corrida)
  schemas.ts       contratos de respuesta (zod), alineados con los de la app
  api-client.ts    cliente de la API por cuenta: métodos crudos y tipados
  fixtures.ts      cuenta aislada por test, acción operable, fallos conocidos
  ledger.ts        modelo de referencia del portafolio a partir del historial
tests/
  01-headers-isolation     headers requeridos y aislamiento entre cuentas
  02-instruments-search    datos de mercado y búsqueda
  03-market-orders         órdenes MARKET y controles de saldo
  04-order-validation      validaciones y fallos conocidos
  05-limit-orders          órdenes LIMIT y reservas
  06-portfolio-reset       portafolio y reset
scripts/tier-matrix.mjs    matriz de detección por nivel de bugs
```

## Limitaciones y próximos pasos

- **La app no se pudo levantar** en el equipo del challenge: con el Xcode actual requirió un ajuste de compatibilidad y después la compilación no completó por falta de espacio en disco ([APP-02](BUGS.md#app-02)). Los hallazgos de la app provienen de la revisión de su código y están marcados como tales.
- **Costo promedio con precios distintos:** los precios de la API son estáticos, así que el promedio ponderado con precios diferentes solo se puede ejercitar con ejecuciones LIMIT, que son aleatorias. Cobertura parcial.
- **En un entorno productivo** sumaría:
  - `testID` en la app y 2 o 3 flujos E2E críticos (por ejemplo, con Maestro) en un pipeline separado.
  - Pruebas de contrato con el equipo de la API, para acordar el esquema de errores (hoy inconsistente, BUG-06).
  - Monitoreo de tests inestables en la corrida nocturna.
  - Pruebas de performance en un entorno dedicado (la API de este challenge es compartida).
  - Revisión de seguridad: hoy la identidad es un header sin autenticación.

## Uso de IA

Trabajé con un asistente de IA como par de programación. El asistente escribió la mayor parte del código y propuso enfoques técnicos. Yo dirigí el trabajo: ejecuté la exploración de la API, tomé las decisiones de alcance (API-first, UI fuera de la automatización), revisé cada resultado contra la API real, validé las severidades de los hallazgos (incluida la reclasificación de MIRG tras verificarla) y decidí qué entraba en la entrega. Lo considero la forma realista de trabajar hoy: el valor está en el criterio, la verificación y la responsabilidad sobre el resultado.

## Modificaciones a la app

Ninguna en la entrega. Para intentar compilar la app en iOS se aplicó un ajuste local al `Podfile`, documentado en [APP-02](BUGS.md#app-02) como workaround.
