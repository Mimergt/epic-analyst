# Contexto del proyecto — para agentes de IA (Claude Code u otros)

Lee esto primero antes de tocar nada. Resume decisiones y estado que no son obvias
solo leyendo el código.

## Qué es esto

EPIC Analyst: chat de BI que conecta la Claude Messages API (con el MCP connector
nativo, `mcp_servers` + `mcp_toolset`) a un servidor MCP de Metabase self-hosted
(`https://dlpdash.epic.gt/api/metabase-mcp`). Todo corre en un solo Cloudflare
Worker: backend (`src/`) + frontend estático (`frontend/index.html`) + métricas
en Workers Analytics Engine. Sin base de datos propia, sin servidor Node.

Ver [README.md](README.md) para arquitectura completa, setup paso a paso y cómo
agregar clientes nuevos.

## Dónde vive el código y por qué hay dos carpetas

- **Copia de trabajo (local, fuera de iCloud)**: `~/dev/epic-analyst-cf`
  Aquí se corre `npm install`, `wrangler dev`, `wrangler deploy`, todo lo pesado.
  Es un `git clone` normal de https://github.com/Mimergt/epic-analyst.git

- **Copia espejo (iCloud)**: `.../CloudDocs/Dev/EPIC Analyst/epic-analyst-cf`
  Es solo para que el usuario la vea/edite en Finder. **No tiene `node_modules`,
  `.wrangler` ni `.git`** — nunca correr `npm install` ni `wrangler` ahí, porque
  iCloud entra en un ciclo de descarga/expulsión de archivos y todo se cuelga
  (pasó, costó tiempo resolverlo). El disco del usuario además tiene poco espacio
  libre, así que evitar duplicar `node_modules` en dos lugares.

**Rutina de sincronización** (repetir cuando haya cambios):
1. Editar y probar en `~/dev/epic-analyst-cf`.
2. `git add && git commit && git push` desde ahí (GitHub es la fuente de verdad
   real, no iCloud).
3. Sincronizar el código fuente de vuelta a iCloud con rsync, excluyendo
   `node_modules`, `.wrangler`, `.git`, `.dev.vars`, `.DS_Store`:
   ```bash
   rsync -av --delete \
     --exclude 'node_modules' --exclude '.wrangler' --exclude '.git' \
     --exclude '.dev.vars' --exclude '.DS_Store' \
     ~/dev/epic-analyst-cf/ "/Users/mimer/Library/Mobile Documents/com~apple~CloudDocs/Dev/EPIC Analyst/epic-analyst-cf/"
   ```
4. Si el disco se aprieta, es seguro borrar `node_modules`/`.wrangler` de la
   copia local — se regeneran con `npm install` en segundos porque están fuera
   de iCloud.

Si en algún momento no existe la copia local (`~/dev/epic-analyst-cf`), recrearla
con `git clone https://github.com/Mimergt/epic-analyst.git ~/dev/epic-analyst-cf`
y copiar `.dev.vars` desde la copia de iCloud (no está en git, tiene secretos).

## Estado de despliegue

- **Cuenta de Cloudflare**: "EPIC", account_id `db8d33d5dfbdf640b40aa3c13b2c2927`
  (fijado en `wrangler.jsonc` como `account_id` para que wrangler nunca pregunte
  cuál cuenta usar — el usuario tiene ~20 cuentas de Cloudflare distintas).
- **Dominio en producción**: https://analyst-bi.epic.gt (ya desplegado y activo,
  custom domain sobre la zona `epic.gt`).
- **Secrets ya configurados** en Cloudflare (no en ningún archivo del repo):
  - `ANTHROPIC_API_KEY`
  - `METABASE_OAUTH_TOKEN_DEFAULT`
- **Analytics Engine**: dataset `epic_analyst_usage` ya creado manualmente en el
  dashboard de Cloudflare (Workers & Pages → Analytics Engine → Create Dataset)
  porque la cuenta lo pedía como paso explícito antes de aceptar el binding.

## V2: optimizacion de costo (agosto 2026)

Al agregar mas tipos de grafica y la regla de "solo pedidos completados" se
detecto que el costo por pregunta se disparaba a $0.27-$1.39 (normal deberia
ser centavos). Causa raiz: 0 tokens de cache (`cache_creation_input_tokens` y
`cache_read_input_tokens` en 0 siempre) — cada pregunta reenviaba desde cero
el system prompt y las ~75 definiciones de tools del MCP de Metabase, y ademas
el modelo a veces exploraba de mas (10-20 llamadas MCP) o traia filas crudas
sin agregar en vez de usar preguntas ya guardadas.

Fix (en `src/agent.js` y `src/clients.js`):
1. `cache_control: {type:'ephemeral'}` en el bloque `system` y en el
   `mcp_toolset`. Redujo el costo tipico a **$0.03-0.05 por pregunta**.
   Hallazgo raro: el caché del `system` SI se reutiliza consistentemente entre
   requests, pero el bloque de definiciones de tools del MCP NUNCA cachea (se
   reescribe completo cada vez, mismo conteo de tokens en cada prueba). Se
   sospecha que el propio MCP de Metabase devuelve el listado de tools con
   algo ligeramente distinto cada vez (aunque se vea igual), invalidando ese
   cache especifico del lado de Anthropic. Es un limite fuera de nuestro
   control por ahora; no vale la pena perseguirlo mas ya que el resultado
   actual esta muy por debajo del objetivo de costo del usuario (<$0.10).
2. `known_questions` en `clients.js`: catalogo de ~26 preguntas guardadas de
   la coleccion DLP con su id, inyectado en el system prompt para que Claude
   use `execute_question` directo en vez de gastar llamadas de `search`
   explorando cada vez. Si se crean/renombran preguntas relevantes en
   Metabase, actualizar esta lista.
3. `MAX_MCP_TOOL_CALLS = 6` en `agent.js`: limite duro (ademas de la
   instruccion en el prompt) — si ya se alcanzo, no se manda otro turno de
   `pause_turn` aunque Claude quiera seguir explorando; se usa la respuesta
   parcial que ya se tiene.
4. Prompt: instruccion explicita de preferir preguntas guardadas/consultas
   agregadas sobre filas crudas sin agregar (evita que sume cientos de filas
   el mismo en vez de que Metabase agregue con GROUP BY).

Si el costo por pregunta vuelve a dispararse, revisar primero si estas
optimizaciones siguen en su lugar (sobre todo el `cache_control`) antes de
buscar otra causa.

## Graficas: se descarto el embedding de Metabase, son SVG propio

Se intento primero mostrar graficas via "static embedding" de Metabase (iframe
firmado con JWT, `Admin > Settings > Embedding`). Se abandono ese camino porque
Metabase exige activar el embedding **pregunta por pregunta** (no basta el
secret global), lo cual es inviable con ~75 preguntas en la coleccion DLP, y
ademas dio errores 403 incluso activandolo (posible bug/particularidad de la
version 0.63.10 del usuario). Existe un secret `METABASE_EMBEDDING_SECRET` en
Cloudflare que quedo huerfano de ese intento — es inofensivo dejarlo, no se usa
en ningun archivo del repo.

La solucion que SI quedo en produccion: el system prompt (`src/agent.js`)
instruye a Claude a que, cuando la respuesta se preste para una grafica,
agregue al final de su texto un bloque \`\`\`chart con JSON. El backend lo
extrae con una regex, lo saca del texto visible, y lo devuelve como `chart` en
la respuesta de `/api/chat`. El frontend (`frontend/index.html`) lo dibuja con
SVG hecho a mano, sin ninguna libreria de graficas ni dependencia de Metabase
para el render.

Tipos soportados (V2, agosto 2026): `bar`, `line`, `pie`, `stacked-bar`, `kpi`.
Cada uno tiene su propia funcion `render*` en `frontend/index.html` y su propio
formato de JSON documentado directamente en el system prompt de `agent.js`
(buscar "Sobre GRAFICAS"). Si se agrega un tipo nuevo, hay que agregarlo en
AMBOS lugares (el ejemplo de JSON en el prompt, y el render + dispatcher
`addChart` en el frontend).

## Frontend v2 (`/v2/`), embebible en Metabase

`frontend/index.html` (root, `/`) es la version original y se dejo intacta a
proposito — sigue siendo el chat "de referencia" con metricas visibles
(latencia, tokens, num de consultas MCP, costo).

`frontend/v2/index.html` (sirve en `/v2/` automaticamente, mismo binding de
Assets, sin tocar `wrangler.jsonc`) es la version pensada para embeber dentro
de Metabase (el usuario va a mostrar las metricas de uso ahi en vez de en el
chat). Diferencias clave respecto al root:
- Sin footer de metricas (nada de latencia/tokens/costo visible al usuario).
- La grafica es el elemento principal: ocupa el ancho completo de la tarjeta
  de respuesta (no una burbuja al 75% como el root), el SVG es mas grande
  (640x300 vs 480x220), y el texto es solo una linea/caption chica debajo de
  la grafica, no una burbuja de chat tradicional.
- Ambas versiones pegan al mismo backend (`/api/chat`, `/api/clients`) — no
  hay duplicacion de logica de negocio, solo de presentacion.

Si se agrega un tipo de grafica nuevo, hay que replicar el render en AMBOS
archivos (`frontend/index.html` y `frontend/v2/index.html`), ya que cada uno
tiene su propia copia de las funciones `render*` (se evito una dependencia
compartida a proposito para mantener cada HTML autocontenido y facil de leer
de un vistazo).

## Punto frágil a vigilar: el token OAuth de Metabase

`METABASE_OAUTH_TOKEN_DEFAULT` es un access token OAuth2 de vida corta, obtenido
manualmente con el MCP Inspector (`npx @modelcontextprotocol/inspector@latest`,
transport "Streamable HTTP", URL `https://dlpdash.epic.gt/api/metabase-mcp`,
login real contra Metabase, luego copiar el `access_token` de la pestaña
Auth/Network). **Este MVP no lo refresca automáticamente.**

Si el chat en producción empieza a fallar con errores de autenticación al
consultar Metabase, hay que repetir ese proceso y volver a correr:
```bash
npx wrangler secret put METABASE_OAUTH_TOKEN_DEFAULT
```
(desde `~/dev/epic-analyst-cf`, nunca desde la copia de iCloud).

## Cliente real en producción: DLP (Del Puente)

El único cliente configurado hoy en `src/clients.js` es `dlp` ("Del Puente"),
un ecommerce de hamburguesas. Ya no se usan nombres tipo "default"/"demo" para
clientes reales — el usuario pidió explícitamente evitar esa nomenclatura.

- El alcance del agente es la **colección de Metabase "DLP"** (id 5), no un
  solo Model — esa colección contiene todos los modelos, preguntas y
  dashboards del negocio: `dlp-Pedidos (Base) - V2.3`, `dlp-Items (Base)`,
  `dlp-Productos-Extras (Base)`, y ~75 preguntas/dashboards derivados (ventas
  por tienda, ticket promedio, top productos, métodos de pago, tipo de
  entrega, etc.).
- Por eso `clients.js` usa los campos `allowed_collection_name` /
  `allowed_collection_description` (no `allowed_model_name` — ese nombre de
  campo quedó obsoleto y ya no existe en el código).
- Dashboard de referencia del cliente:
  https://dlpdash.epic.gt/dashboard/6-del-puente-analisis-ecommerce
- Moneda del negocio: quetzales guatemaltecos (Q / GTQ).

## Bug ya resuelto: `pause_turn` rompía turnos largos de MCP

En `src/agent.js`, el loop de continuación insertaba un mensaje de usuario
`"Continua."` cada vez que `stop_reason` era `pause_turn`. Eso es incorrecto:
cuando la API pausa un turno largo (a media ejecución de una tool de MCP), hay
que reenviar la conversación **tal cual**, sin insertar un turno de usuario
nuevo — si no, se puede quedar un bloque `mcp_tool_use` sin su
`mcp_tool_result` correspondiente y la API siguiente rechaza la request con
`400 invalid_request_error`. Se quitó ese mensaje y se subió `max_tokens` de
1500 a 4096 para reducir la frecuencia de `pause_turn`. Si vuelve a aparecer
ese error 400 mencionando `mcp_tool_use ... without a corresponding
mcp_tool_result`, revisar primero que este fix siga en su lugar antes de
buscar otra causa.

Nota de costo/latencia observada: preguntas que requieren que el agente
*busque* qué pregunta de Metabase usar (en vez de una ya conocida) pueden
disparar 15-20 llamadas MCP y tardar 50s+ costando ~$0.50. No es un bug, pero
es una oportunidad de optimización futura (cachear qué IDs de pregunta
resuelven qué intenciones típicas) si el volumen de uso lo justifica.

## Otras notas de contexto

- El aislamiento de "solo puedes ver la colección X" es por **prompt**, no por
  permisos de Metabase (ver advertencia detallada en el README). No convertir
  esto en un control de seguridad real sin que el usuario lo pida explícitamente
  — es una decisión consciente para el MVP.
- El usuario prefiere procesos simples y directos; si algo se puede resolver en
  2 comandos, no lo conviertas en 10. Explicar el *porqué* de cada paso ayuda
  más que agregar pasos "por si acaso".
