# QA Challenge — app-qa (Cocos)

> README en construcción. Ver el plan de pruebas en [docs/TEST_PLAN.md](docs/TEST_PLAN.md).

## Cómo ejecutar

Requisitos: Node.js 20 o superior.

```sh
npm install
npm test                 # suite contra X-Enable-Bugs=off (golden path)
npm run test:easy        # misma suite con defectos inyectados (también: test:medium, test:hard)
npm run tiers            # corre los 4 niveles y resume qué detecta cada uno
npm run test:slow        # tests lentos: esperan la resolución de órdenes LIMIT (~5 min)
npm run report           # abre el reporte HTML de la última corrida
```
