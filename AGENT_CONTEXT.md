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

## Otras notas de contexto

- El aislamiento de "solo puedes ver el Model X" es por **prompt**, no por
  permisos de Metabase (ver advertencia detallada en el README). No convertir
  esto en un control de seguridad real sin que el usuario lo pida explícitamente
  — es una decisión consciente para el MVP.
- El usuario prefiere procesos simples y directos; si algo se puede resolver en
  2 comandos, no lo conviertas en 10. Explicar el *porqué* de cada paso ayuda
  más que agregar pasos "por si acaso".
