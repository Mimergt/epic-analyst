# EPIC Analyst — MVP en Cloudflare Workers

Chat de BI conversacional que conecta una interfaz web propia con **Claude API**
y **Metabase self-hosted** vía el **MCP connector nativo de la Claude Messages
API**, desplegado en su totalidad sobre **Cloudflare Workers** (frontend +
backend + métricas, sin servidor propio ni base de datos administrada).

Repo: https://github.com/Mimergt/epic-analyst

## Por qué esta arquitectura

- **No existe hoy un "front" de Claude.ai reutilizable para exponer a
  terceros sin cuenta.** Por eso el flujo pasa por tu propio backend: tu web
  → tu Worker → Claude API → MCP de Metabase.
- **Cloudflare Workers**, no Node.js: por eso el backend usa `fetch` handler
  nativo (no Express) y `@anthropic-ai/sdk`, que Anthropic soporta
  oficialmente en el runtime de Workers.
- **Sin base de datos que administrar**: las métricas de uso/costo se
  registran con **Workers Analytics Engine**, incluido en el plan gratuito de
  Cloudflare, con cardinalidad ilimitada y sin esquema que migrar.
- **Frontend + backend en el mismo Worker**: el HTML del chat se sirve como
  Assets estáticos del propio Worker (binding `ASSETS`), así que todo vive en
  un solo despliegue, sin CORS entre dominios distintos.

## Arquitectura

```
Browser (frontend/index.html, servido por el mismo Worker)
      │  POST /api/chat { question, client_id }
      ▼
Cloudflare Worker (src/index.js)
      │  arma la llamada a Claude con mcp_servers=[Metabase MCP]
      ▼
Claude Messages API (Sonnet 5)
      │  MCP connector llama tools del MCP remoto (search, execute_query, ...)
      ▼
Metabase MCP (https://dlpdash.epic.gt/api/metabase-mcp)
      │
      ▼
Metabase → PostgreSQL

En paralelo, cada pregunta escribe un evento en:
Worker → Workers Analytics Engine (dataset epic_analyst_usage)
```

Metabase sigue siendo la única capa de acceso a datos: el Worker nunca toca
PostgreSQL directamente ni implementa su propio cliente MCP.

## Estructura del proyecto

```
epic-analyst/
├── wrangler.jsonc          Config de Cloudflare: binding de Analytics Engine,
│                            binding de Assets (frontend), vars no secretas
├── package.json
├── .dev.vars.example        Plantilla de secretos para desarrollo local
├── src/
│   ├── index.js              Worker principal: rutas /api/chat, /api/metrics, /api/clients
│   ├── agent.js               Llamada a Claude + MCP connector + system prompt
│   ├── clients.js             Config de clientes/agentes (Cliente → Model de Metabase)
│   ├── pricing.js             Cálculo de costo estimado por pregunta
│   └── metrics.js             Escritura/lectura de Workers Analytics Engine
└── frontend/
    └── index.html              Chat web simple (mismo dominio que la API)
```

## Puesta en marcha

### 0. Requisitos

- Cuenta de Cloudflare con la zona **epic.gt** ya agregada (confirmado: ya está).
- Node.js 18+ instalado localmente.
- Tu API key de Anthropic.
- Un access token OAuth vigente del MCP de tu Metabase (ver paso 5).

### 1. Clonar tu repo y copiar el proyecto adentro

```bash
git clone https://github.com/Mimergt/epic-analyst.git
cd epic-analyst
# copia aquí adentro el contenido de este proyecto (src/, frontend/,
# wrangler.jsonc, package.json, .gitignore, .dev.vars.example, README.md)
git add .
git commit -m "MVP EPIC Analyst en Cloudflare Workers"
git push
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Login a Cloudflare

```bash
npx wrangler login
```

Esto abre el navegador para autorizar Wrangler contra tu cuenta.

### 4. Configurar secretos

**Para desarrollo local** (`wrangler dev`), copia la plantilla:

```bash
cp .dev.vars.example .dev.vars
# edita .dev.vars con tu ANTHROPIC_API_KEY y tu METABASE_OAUTH_TOKEN_DEFAULT
```

`.dev.vars` nunca se commitea (está en `.gitignore`).

**Para producción**, los secretos se configuran directo en Cloudflare, no en
ningún archivo del repo:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put METABASE_OAUTH_TOKEN_DEFAULT
```

(Opcional, solo si quieres que `/api/metrics` funcione en producción — ver
sección de métricas más abajo):

```bash
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_ANALYTICS_API_TOKEN
```

### 5. Obtener el token OAuth de Metabase

El MCP de Metabase 0.63 se autentica con **OAuth 2.0**, no con una API key
simple en el header. Necesitas un `access_token` válido, obtenido con el
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) apuntando
a `https://dlpdash.epic.gt/api/metabase-mcp`, completando el flujo OAuth con
un usuario de Metabase.

⚠️ **Los tokens OAuth expiran.** Este MVP no los refresca automáticamente —
si el chat empieza a fallar con errores de autenticación, regenera el token y
actualiza el secret con `wrangler secret put METABASE_OAUTH_TOKEN_DEFAULT`.

### 6. Correr localmente

```bash
npm run dev
```

Abre `http://localhost:8787` — frontend y API quedan disponibles en el mismo
puerto.

### 7. Desplegar a producción en analyst-bi.epic.gt

`wrangler.jsonc` ya incluye la ruta del dominio:

```jsonc
"routes": [
  { "pattern": "analyst-bi.epic.gt", "custom_domain": true }
]
```

Como `epic.gt` ya es una zona en tu cuenta de Cloudflare, no hace falta tocar
DNS a mano — Wrangler crea el registro y el certificado TLS solos:

```bash
npm run deploy
```

Al terminar, Wrangler confirma la URL del despliegue. Verifica que quedó
enlazado al dominio yendo a **Workers & Pages → epic-analyst → Settings →
Domains & Routes** en el dashboard de Cloudflare: debe aparecer
`analyst-bi.epic.gt` como Custom Domain, con el candado de "Active".

Una vez activo, `https://analyst-bi.epic.gt` sirve el chat directamente — de
ahí puedes copiar la URL para tu embed (por ejemplo, un `<iframe
src="https://analyst-bi.epic.gt">` en tu sitio, o enlazar la URL donde la
necesites).

**Si vas a usarlo dentro de un `<iframe>`** en otro sitio, algunos
navegadores exigen la cabecera `Content-Security-Policy: frame-ancestors`
explícita para permitirlo (por defecto este Worker no envía ninguna cabecera
restrictiva, así que debería embeberse sin cambios, pero si tu navegador lo
bloquea, agrega esto en `src/index.js`, en la respuesta que sirve el HTML):

```js
// Permite el embed solo desde los dominios que tú controlas.
response.headers.set(
  'Content-Security-Policy',
  "frame-ancestors 'self' https://tu-sitio-que-embebe.com"
);
```

## Multi-cliente (Cliente A → colección A, Cliente B → colección B)

Edita `src/clients.js` y agrega una entrada:

```js
export const CLIENTS = {
  dlp: { ... },
  cliente_b: {
    display_name: 'Cliente B',
    metabase_oauth_token_secret: 'METABASE_OAUTH_TOKEN_CLIENTE_B',
    allowed_collection_name: 'Nombre de la coleccion en Metabase',
    allowed_collection_description: 'Descripción de que contiene esa colección.',
    extra_instructions: '',
  },
};
```

Y crea el secret correspondiente:

```bash
npx wrangler secret put METABASE_OAUTH_TOKEN_CLIENTE_B
```

El frontend detecta automáticamente los clientes disponibles vía
`GET /api/clients`. Cada cliente nuevo requiere un redeploy (`npm run
deploy`), ya que `src/clients.js` es código, no una config externa — para un
volumen alto de clientes, la siguiente iteración natural es mover esto a KV o
D1.

## ⚠️ Sobre el alcance de datos (léelo antes de dar acceso a clientes reales)

Por decisión explícita para este MVP, **el límite "solo puedes ver el Model
X" está implementado por prompt** (instrucciones de sistema en `agent.js`),
no por permisos de Metabase. Esto significa:

- Es un guardrail de comportamiento, razonablemente efectivo para uso normal,
  **pero no es una barrera de seguridad dura**. Un usuario que intente
  activamente hacer que el modelo se salga del alcance (prompt injection)
  podría lograr que el agente consulte datos fuera del Model previsto,
  siempre que el token OAuth usado tenga permisos sobre esos datos en
  Metabase.
- El aislamiento real ocurre a nivel del **token OAuth**: si ese token tiene
  acceso amplio en Metabase, el agente técnicamente puede alcanzar más de lo
  que el prompt le pide que muestre.

**Antes de dar acceso a clientes externos reales o datos sensibles**, crea un
usuario de Metabase de solo-lectura con permisos acotados al Model
correspondiente para cada cliente, y genera el token OAuth de ese cliente
contra ese usuario.

También se bloquean explícitamente (denylist en `agent.js`) los tools MCP de
escritura (`create_dashboard`, `update_question`, etc.) como defensa en
profundidad adicional.

## Métricas de uso y costo

Cada pregunta escribe un evento en el dataset `epic_analyst_usage` de Workers
Analytics Engine, con: tokens de entrada/salida/cache write/cache read,
número de llamadas al modelo y a Metabase (MCP), latencia, y costo estimado
en USD.

**Importante**: el binding de Analytics Engine solo permite *escribir* desde
dentro del Worker. Para *leer* agregados, `GET /api/metrics` usa la [SQL HTTP
API de Cloudflare](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/),
que requiere:

- `CF_ACCOUNT_ID`: tu Account ID (visible en el dashboard, barra lateral de
  Workers & Pages).
- `CF_ANALYTICS_API_TOKEN`: un API Token con permiso **Account Analytics >
  Read**, creado en
  [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

Sin esos dos secrets configurados, `/api/metrics` responde con un mensaje
indicándolo, pero el chat en sí funciona igual — las métricas se siguen
escribiendo, solo no se pueden consultar desde el endpoint hasta que
configures esos secrets.

```
GET /api/metrics
GET /api/metrics?client_id=default
```

Los precios en `wrangler.jsonc` (`vars.PRICE_*`) corresponden a **Claude
Sonnet 5** ($2 input / $10 output por millón de tokens, tarifa permanente
desde agosto 2026). Si cambias de modelo, actualiza esos valores (ver
[platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)).

Nota sobre retención: Analytics Engine guarda los datos por 3 meses. Para
análisis de costo histórico más largo, exporta periódicamente vía la SQL API
a otro almacenamiento.

## Fuera de alcance en este MVP (a propósito)

- Autenticación de usuarios finales
- Billing / multi-tenancy completo
- Refresh automático de tokens OAuth
- Aislamiento por permisos de Metabase (ver advertencia arriba)
- Streaming de respuesta token-a-token (hoy la respuesta llega completa)
- UI de administración para agregar clientes sin redeploy

## Próximos pasos sugeridos

1. Medir consumo real con preguntas variadas (revisa `num_mcp_tool_calls` en
   las métricas para detectar si el prompt genera demasiadas llamadas MCP por
   pregunta).
2. Mover el aislamiento de datos de "por prompt" a "por permisos de
   Metabase" antes de onboardear clientes reales.
3. Agregar autenticación básica al Worker (API key propia o Cloudflare
   Access) antes de dar la URL a clientes.
4. Automatizar refresh de tokens OAuth de Metabase.
5. Si el número de clientes crece, mover `src/clients.js` a Cloudflare KV
   para no requerir redeploy por cada alta.
