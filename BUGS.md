# Reporte de bugs y hallazgos

Comportamientos incorrectos, inconsistentes o inesperados respecto de lo documentado en la consigna, encontrados con exploración manual (curl y Postman), con la suite automatizada y con la revisión del código de la app.

## Cómo leer este reporte

**Severidad**, según el impacto para el usuario y el negocio:

| Severidad | Criterio |
|---|---|
| 🔴 Crítica | Crea o destruye valor: dinero o acciones que aparecen o desaparecen, u operaciones financieramente imposibles |
| 🟠 Alta | Viola una regla de negocio documentada o muestra información financiera incorrecta, sin pérdida directa |
| 🟡 Media | Comportamiento inconsistente que confunde al usuario o afecta la trazabilidad |
| 🟢 Baja | Desvío de contrato o de UX sin impacto funcional |

**Origen:**
- **API (`off`)**: bugs reales de la API en el modo "correcto". Son los más relevantes: existen sin defectos inyectados.
- **Inyectado (`easy`/`medium`/`hard`)**: defectos que la API introduce a propósito. Se listan para mostrar que la suite los detecta y cuál los detecta.
- **App**: hallazgos del código o del entorno de la app móvil.

**Reproducción.** Todos los ejemplos usan curl contra `https://dummy-api-topaz.vercel.app`, con una cuenta nueva por escenario para que el resultado no dependa de otras pruebas:

```sh
BASE=https://dummy-api-topaz.vercel.app
H=(-H "X-Enable-Bugs: off" -H "X-Candidate-Id: amaidana-repro-01" -H "Content-Type: application/json")
```

Las respuestas citadas como evidencia son las obtenidas el 27 y 28/09/2026. Los ids de orden son globales y aleatorios, así que cambian en cada reproducción.

## Resumen

| ID | Hallazgo | Origen | Severidad | Detectado por |
|---|---|---|---|---|
| [BUG-01](#bug-01) | Una LIMIT con precio negativo aumenta el cash disponible | API (`off`) | 🔴 Crítica | Test marcado como fallo conocido |
| [BUG-02](#bug-02) | Se acepta una LIMIT con precio 0 | API (`off`) | 🟠 Alta | Test marcado como fallo conocido |
| [BUG-03](#bug-03) | Al ejecutarse una LIMIT se pierde el precio límite pedido | API (`off`) | 🟡 Media | Exploración |
| [BUG-04](#bug-04) | La moneda de liquidación (ARS) se puede comprar como una acción | API (`off`) | 🟡 Media | Test marcado como fallo conocido |
| [BUG-05](#bug-05) | Se acepta `quantity` como texto | API (`off`) | 🟡 Media | Test marcado como fallo conocido |
| [BUG-06](#bug-06) | Mensajes de error inconsistentes, uno sin traducir en la app | API + App | 🟢 Baja | Exploración + código |
| [INJ-01](#inj-01) | Se pueden vender acciones que no se tienen, y se cobran | `easy`+ | 🔴 Crítica | Suite (3 tests) |
| [INJ-02](#inj-02) | Las órdenes MARKET se ejecutan al precio de cierre | `hard` | 🔴 Crítica | Suite |
| [INJ-03](#inj-03) | MIRG cotiza con `last_price` 0 | `easy`+ | 🔴 Crítica | Suite |
| [INJ-04](#inj-04) | Una cantidad decimal se acepta y se trunca | `medium`+ | 🟠 Alta | Suite |
| [INJ-05](#inj-05) | Algunas órdenes MARKET quedan PENDING | `hard` | 🟠 Alta | Suite |
| [INJ-06](#inj-06) | El portafolio omite a veces el campo `ticker` | `hard` | 🟠 Alta | Suite (contrato) |
| [INJ-07](#inj-07) | La búsqueda distingue mayúsculas | `easy`+ | 🟡 Media | Suite |
| [INJ-08](#inj-08) | Crear una orden responde 200 en lugar de 201 | `medium`+ | 🟢 Baja | Suite |
| [APP-01](#app-01) | La app no tiene identificadores estables para automatizar la UI | App | 🟠 Alta (testabilidad) | Revisión de código |
| [APP-02](#app-02) | La app no compila en iOS con la versión actual de Xcode | App | 🟡 Media (reproducibilidad) | Intento de build |
| [APP-03](#app-03) | La moneda ARS aparece en el listado de mercados como un instrumento más | App | 🟡 Media | Revisión de código |
| [APP-04](#app-04) | La app envía identificadores del dispositivo en cada request | App | 🟢 Observación | Revisión de código |

Al final: [observaciones](#observaciones-no-son-bugs) que no se clasifican como bugs y [riesgos potenciales](#riesgos-potenciales-no-reproducidos) detectados en el código que no se llegaron a reproducir.

---

## Bugs de la API en `off`

### BUG-01

**Una orden LIMIT con precio negativo se acepta y aumenta el cash disponible.** 🔴 Crítica

**Pasos**
1. Cuenta nueva: `GET /portfolio` → `cash: 1000000`.
2. Crear una compra LIMIT con precio negativo:
   ```sh
   curl -s -X POST $BASE/orders "${H[@]}" \
     -d '{"instrument_id":2,"side":"BUY","type":"LIMIT","quantity":1,"price":-5}'
   ```
3. `GET /portfolio`.

**Esperado:** `400`, con un error del tipo "price must be a positive number". El cash no cambia.

**Obtenido:** `201` y la orden queda `PENDING`:
```json
{"id":578766,"instrument_id":2,"side":"BUY","type":"LIMIT","quantity":1,"price":-5,"status":"PENDING"}
```
La "reserva" de la orden es `1 × (−5) = −5`, así que **el cash disponible sube $5**. En la exploración, la cuenta mostró `999.897,64` cuando debía mostrar `999.892,64`. Con `quantity: 100000, price: -1000`, el cash disponible sube $100.000.000.

**Impacto de negocio:** permite inflar artificialmente el saldo disponible y usarlo para comprar mientras la orden siga pendiente, que puede ser más de 20 minutos. Compromete la integridad financiera de la cuenta. La app valida `price > 0` en el formulario, pero la API no: cualquier cliente que llame directo a la API saltea el control.

**Notas:** la orden se resolvió como `REJECTED` entre 10 y 20 minutos después. El dinero "fabricado" estuvo disponible durante todo ese tiempo.

**Cobertura:** `tests/04-order-validation.spec.ts` › *rechaza: LIMIT con precio negativo (y no genera cash)*, marcado como fallo conocido.

### BUG-02

**Se acepta una orden LIMIT con precio 0.** 🟠 Alta

**Pasos**
```sh
curl -s -X POST $BASE/orders "${H[@]}" \
  -d '{"instrument_id":2,"side":"BUY","type":"LIMIT","quantity":1,"price":0}'
```

**Esperado:** `400`. Un precio límite de 0 no es una orden válida.

**Obtenido:** `201`, orden `PENDING` con `price: 0`, que después se resolvió como `REJECTED`.

**Impacto de negocio:** órdenes sin sentido económico entran al libro y quedan pendientes. Si alguna condición de ejecución las aceptara, significaría adquirir acciones gratis. Es el mismo hueco de validación que BUG-01.

**Cobertura:** `tests/04-order-validation.spec.ts` › *rechaza: LIMIT con precio 0*, marcado como fallo conocido.

### BUG-03

**Al ejecutarse una orden LIMIT, el historial pierde el precio límite que pidió el usuario.** 🟡 Media

**Pasos**
1. Comprar 20 DYCA a mercado (last_price 45,72).
2. Crear una venta LIMIT de 5 a $40: `{"instrument_id":1,"side":"SELL","type":"LIMIT","quantity":5,"price":40}`.
3. Cuando se resuelva, consultar `GET /orders`.

**Esperado:** el historial conserva el precio límite pedido (40) y, por separado, informa el precio de ejecución.

**Obtenido:** la orden figura como `FILLED` con `"price": 45.72`. El 40 original ya no aparece en ningún lado.
```json
{"id":372153,"side":"SELL","type":"LIMIT","quantity":5,"price":45.72,"status":"FILLED"}
```

**Impacto de negocio:** que se ejecute a un precio mejor que el límite es correcto y favorece al usuario. El problema es la **trazabilidad**: ni el usuario, ni soporte, ni auditoría pueden reconstruir qué se pidió. En una plataforma de inversión, eso dificulta resolver reclamos ("yo puse la orden a otro precio").

### BUG-04

**La moneda de liquidación (ARS) se puede comprar como una acción.** 🟡 Media

**Pasos**
```sh
curl -s -X POST $BASE/orders "${H[@]}" \
  -d '{"instrument_id":26,"side":"BUY","type":"MARKET","quantity":1000}'
curl -s $BASE/portfolio "${H[@]}"
```

**Esperado:** rechazo. ARS (`type: MONEDA`) es la moneda en la que se liquidan las órdenes, no un instrumento operable.

**Obtenido:** la orden se ejecuta (`FILLED` a $1). El cash baja a `999.000` y aparece una tenencia `ARS` de 1.000 unidades:
```json
{"cash":999000,"holdings":[{"instrument_id":26,"ticker":"ARS","quantity":1000,"last_price":1,"avg_cost_price":1}]}
```

**Impacto de negocio:** no se pierde valor, pero el efectivo disponible baja sin que haya inversión, y el portafolio muestra una posición que no es una inversión. Confunde al usuario ("¿por qué tengo menos efectivo?").

**Pregunta abierta:** si ARS existe a propósito para modelar movimientos de efectivo, debería excluirse del listado y de las órdenes. Si no, la API debería rechazar órdenes sobre instrumentos de tipo MONEDA. Se reporta con las dos alternativas porque la documentación no lo define.

**Cobertura:** `tests/04-order-validation.spec.ts` › *rechaza: operar la moneda de liquidación (ARS)*, marcado como fallo conocido.

### BUG-05

**Se acepta `quantity` enviada como texto.** 🟡 Media

**Pasos**
```sh
curl -s -X POST $BASE/orders "${H[@]}" \
  -d '{"instrument_id":2,"side":"BUY","type":"MARKET","quantity":"2"}'
```

**Esperado:** `400`. La consigna define `quantity` como entero positivo.

**Obtenido:** `201`. La orden se ejecuta con `quantity: 2`.

**Impacto de negocio:** la API convierte tipos en silencio. Hoy "2" se interpreta bien, pero un contrato laxo abre la puerta a interpretaciones inesperadas de valores como `"2e3"` o `"0x10"` en un endpoint que mueve dinero. Mismo patrón que BUG-01 y BUG-02: la API confía en la validación del cliente.

**Cobertura:** `tests/04-order-validation.spec.ts` › *rechaza: cantidad enviada como texto*, marcado como fallo conocido.

### BUG-06

**Mensajes de error inconsistentes, y uno no está traducido en la app.** 🟢 Baja

**Pasos:** enviar `quantity: 0` y después `quantity: 1.5`.

**Obtenido:**
- Con `0`: `"quantity must be a positive number"`.
- Con `1.5`: `"quantity must be a positive integer"`.

La app (`src/features/orders/orderErrorMessages.ts`) solo traduce el segundo. El primero se mostraría en inglés.

**Esperado:** un único mensaje consistente para la misma regla, traducido.

**Impacto:** bajo. Hoy la app bloquea la cantidad 0 en el formulario, así que el usuario no llega a ver ese mensaje, pero sí cualquier cambio futuro del cliente. Refleja que el contrato de errores entre API y app no está sincronizado.

---

## Defectos inyectados detectados por la suite

La API permite activar defectos con `X-Enable-Bugs`. Se usaron para **validar la sensibilidad de la suite**: comprobar que detecta distintas categorías de regresión. La suite pasa completa en `off` y falla en cada nivel por los defectos listados.

| Nivel | Tests OK | Tests fallidos | Defectos distintos detectados |
|---|---|---|---|
| off | 42 | 0 | — |
| easy | 37 | 5 | 3 |
| medium | 35 | 7 | 5 |
| hard | 30 | 12 | 8 |

Un mismo defecto puede hacer fallar varios tests (por ejemplo, INJ-01 rompe 3), por eso el reporte cuenta **defectos**, no tests fallidos. Para regenerar la matriz: `npm run tiers`.

### INJ-01

**Se pueden vender acciones que no se tienen, y se cobran.** 🔴 Crítica · `easy`, `medium`, `hard`

**Pasos:** con `X-Enable-Bugs: easy` y una cuenta nueva sin tenencias, `{"instrument_id":1,"side":"SELL","type":"MARKET","quantity":1}`.

**Esperado:** `400 Insufficient shares`.

**Obtenido:** `201 FILLED` a $45,72. El cash sube sin que la cuenta tuviera acciones. En un test con 7 acciones, una venta de 100 sumó $5.368 (100 × 53,68).

**Impacto de negocio:** creación de dinero de la nada. Es la falla más grave posible para una app de inversiones.

**Detectado por:** *vender más acciones de las que se tienen…*, *vender sin tener el instrumento…* y *una venta LIMIT pendiente reserva acciones…*

### INJ-02

**Las órdenes MARKET se ejecutan al precio de cierre en lugar del último precio.** 🔴 Crítica · `hard`

**Obtenido:** DYCA (last 45,72 / close 50,07) se ejecuta a **50,07**, y CAPX (last 53,68 / close 49,71) a **49,71**. El `avg_cost_price` del portafolio refleja el precio erróneo.

**Esperado:** ejecución al `last_price`, según la documentación.

**Impacto de negocio:** el usuario paga (o cobra) un precio distinto del que ve en pantalla. En DYCA paga un 9,5% de más.

**Detectado por:** *compra: se ejecuta al último precio…*, *venta parcial…* y *se puede usar el cash hasta el último peso…* (con el precio incorrecto, el cash ya no alcanza).

### INJ-03

**MIRG cotiza con `last_price` 0.** 🔴 Crítica · `easy`, `medium`, `hard`

**Obtenido:**
```json
{"id":5,"ticker":"MIRG","name":"Mirgor","type":"ACCIONES","last_price":0,"close_price":37.74}
```

**Esperado:** precio positivo (en `off`: 40,88).

**Impacto de negocio:** como las órdenes MARKET se ejecutan al `last_price`, habilita potencialmente **compras gratis**. En la app, el retorno diario de MIRG se vería como −100%, y el valor de mercado de quien lo tenga daría 0.

**Detectado por:** *todos los precios son positivos*.

### INJ-04

**Una cantidad decimal se acepta y se trunca.** 🟠 Alta · `medium`, `hard`

**Obtenido:** `{"quantity":1.5}` → orden `FILLED` con `quantity: 1`.

**Esperado:** `400 quantity must be a positive integer` (como en `off`).

**Impacto de negocio:** se ejecuta una operación distinta de la pedida sin avisar.

**Detectado por:** *rechaza: cantidad decimal*.

### INJ-05

**Algunas órdenes MARKET quedan PENDING.** 🟠 Alta · `hard`

**Obtenido:** `{"side":"BUY","type":"MARKET","quantity":10,…,"status":"PENDING"}`.

**Esperado:** toda MARKET se ejecuta de inmediato (`FILLED`).

**Impacto de negocio:** una orden a mercado que no se ejecuta deja al usuario expuesto a movimientos de precio que no eligió, y el portafolio no refleja la compra.

**Detectado por:** *compra: se ejecuta al último precio…* (verifica el estado) y *los precios de las tenencias coinciden con los del mercado* (falta una de las posiciones compradas).

### INJ-06

**El portafolio omite a veces el campo `ticker` de una tenencia.** 🟠 Alta · `hard`

**Obtenido:**
```json
{"cash":999499.3,"holdings":[{"instrument_id":1,"quantity":10,"last_price":45.72,"close_price":50.07,"avg_cost_price":50.07}]}
```

**Esperado:** cada tenencia incluye `ticker`, como indica la documentación.

**Impacto:** la app valida la respuesta con el mismo contrato (`portfolioSchema`) y, ante un campo faltante, **muestra la pantalla de error del portafolio**. El usuario no puede ver sus inversiones.

**Detectado por:** la validación de contrato que corre en cada request de la suite. Es intermitente: aparece en algunos requests y no en otros.

### INJ-07

**La búsqueda distingue mayúsculas.** 🟡 Media · `easy`, `medium`, `hard`

**Obtenido:** `GET /search?query=DYC` → `[DYCA]`; `GET /search?query=dyc` → `[]`.

**Esperado:** los mismos resultados (en `off` no distingue mayúsculas).

**Impacto:** el usuario que escribe en minúsculas no encuentra el instrumento. La app normaliza a mayúsculas en su buscador, lo que mitiga el caso en la UI, pero no para otros clientes.

**Detectado por:** *no distingue mayúsculas de minúsculas*.

### INJ-08

**Crear una orden responde `200` en lugar de `201`.** 🟢 Baja · `medium`, `hard`

**Impacto:** la app acepta cualquier 2xx, así que el usuario no lo nota. Rompe el contrato HTTP para otros clientes.

**Detectado por:** *crear una orden responde 201 Created*. Ver en el README cómo este defecto llevó a separar la verificación del código HTTP para que no enmascarara otros bugs.

---

## Hallazgos en la app

### APP-01

**La app no tiene identificadores estables para automatizar la UI.** 🟠 Alta (testabilidad)

**Evidencia:** no hay ningún `testID` en `src/`. Los elementos solo tienen `accessibilityLabel`, y los de las listas incluyen datos dinámicos. Por ejemplo, en `MarketsInstrumentRow.tsx`:
```
`${ticker}, ${name}, ultimo precio ${price}, retorno diario ${pct} por ciento`
```
Además:
- El reset usa `Alert.alert` nativo.
- Los resultados de las órdenes se muestran en toasts que duran 6 segundos.
- Los gráficos (Skia) se dibujan en un canvas sin elementos inspeccionables.

**Impacto:** cualquier automatización de UI dependería de textos que cambian con cada precio, y sería frágil. Obliga a modificar la app antes de automatizar.

**Recomendación:** agregar `testID` estables en los elementos interactivos y en los valores clave (lista de instrumentos, formulario de órdenes, estado de la orden, cash del portafolio) y exponer el resultado de la orden en un elemento persistente, además del toast.

### APP-02

**La app no compila en iOS con la versión actual de Xcode.** 🟡 Media (reproducibilidad)

**Pasos:** seguir el README de la app (`bun i`, `bun prebuild`, `bun run ios`) con Xcode actualizado.

**Obtenido:**
```
The iOS Simulator deployment target 'IPHONEOS_DEPLOYMENT_TARGET' is set to 12.4,
but the range of supported deployment target versions is 15.0 to 27.0.x.
(in target 'RNSVG-RNSVGFilters' from project 'Pods')
```

**Esperado:** que la app compile siguiendo el README.

**Workaround aplicado:** en `ios/Podfile`, forzar `IPHONEOS_DEPLOYMENT_TARGET` = 16.4 (el mínimo de la app) en el `post_install` de todos los pods.

**Impacto:** cualquier persona que se sume al equipo, o un pipeline de CI con Xcode actualizado, no puede compilar la app sin ese ajuste. Además, el entorno completo (Xcode, simulador, CocoaPods, Bun) requiere más de 25 GB: en el equipo usado para el challenge, la compilación no pudo completarse por falta de espacio. Se documenta como limitación del entorno.

### APP-03

**La moneda ARS aparece en el listado de mercados como un instrumento más.** 🟡 Media

**Evidencia:** la app no filtra por `type` en el listado (`features/markets`), y la API devuelve ARS (`type: MONEDA`) junto con las acciones. En consecuencia, también se puede abrir su ficha y enviar órdenes desde la app. Ver BUG-04.

### APP-04

**La app envía identificadores del dispositivo en cada request.** 🟢 Observación

**Evidencia:** `src/config/api.config.ts` agrega a cada request la IP del dispositivo, el device ID, el nombre del dispositivo (por ejemplo "iPhone de …"), el modelo, el fabricante y la versión de OS.

**Por qué se reporta:** ninguna funcionalidad de la API los requiere. En una app financiera conviene revisar si su envío está justificado y declarado (minimización de datos personales).

---

## Observaciones (no son bugs)

- **`side` y `type` en minúsculas se aceptan** y se normalizan (`"buy"` → `BUY`). La documentación no lo define. Se trata como tolerancia de la API, no como bug.
- **Una MARKET con `price`** ignora ese campo sin avisar y ejecuta al `last_price`. Es correcto funcionalmente. Un aviso o un rechazo harían el contrato más explícito.
- **La búsqueda vacía** (`/search?query=`) devuelve todos los instrumentos. La documentación no define ese caso.
- **Tenencias netas de reservas:** tal como documenta la consigna, una venta LIMIT pendiente descuenta las acciones reservadas de `/portfolio`. Con 10 acciones y una venta pendiente de 6, el portafolio muestra 4. Es correcto según la documentación, pero la API no expone el total, así que el usuario podría percibir que "le faltan" acciones. Riesgo de UX para evaluar con Producto.
- **Resolución de LIMIT:** entre segundos y más de 20 minutos, con resultado aleatorio, tal como anticipa la consigna. En la exploración, todas las compras LIMIT (incluso una por encima del mercado) terminaron `REJECTED`, y la única ejecutada fue una venta. Con tan pocas muestras no alcanza para concluir un patrón.

## Riesgos potenciales (no reproducidos)

Surgen de la revisión del código de la app. No se pudieron verificar en la UI porque la app no llegó a compilar (APP-02).

- **Identidad de posición por índice:** `positionId = "${instrument_id}-${index}"` (`portfolio.api.ts`). Si la API devolviera las tenencias en otro orden entre dos consultas, el detalle de una posición podría mostrar otra.
- **Precio desactualizado en el modo "monto en pesos":** la cantidad se calcula con el `lastPrice` en caché, y la MARKET se ejecuta al precio vigente en el servidor. Si el precio subió, el total puede superar el monto ingresado o la orden puede rechazarse por falta de cash. Hoy los precios de la API son estáticos, así que no se manifiesta.
