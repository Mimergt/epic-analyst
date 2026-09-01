// src/metabase-auth.js
// Renovacion automatica del access_token OAuth2 de Metabase usando su
// refresh_token, para no tener que regenerarlo a mano cada vez que expira.
//
// Bootstrap (una sola vez, manual, ver README): obtener con el MCP Inspector
// no solo el access_token sino tambien el refresh_token y el client_id
// (dynamic client registration), y guardarlos como secrets de Wrangler:
//   METABASE_OAUTH_REFRESH_TOKEN_DEFAULT
//   METABASE_OAUTH_CLIENT_ID_DEFAULT
//
// De ahi en adelante, el Worker se renueva solo: guarda el access_token vigente
// (y el refresh_token, por si Metabase lo rota en cada uso) en KV
// (METABASE_TOKEN_STORE), y solo vuelve a golpear el token endpoint cuando el
// access_token esta por expirar. Los secrets de Wrangler quedan solo como
// "semilla" de recuperacion si el KV se borra o nunca se ha inicializado.

const TOKEN_ENDPOINT = 'https://dlpdash.epic.gt/oauth/token';
const EXPIRY_BUFFER_MS = 60_000; // renovar 60s antes de que expire de verdad

function kvKey(clientId) {
  return `metabase_token:${clientId}`;
}

async function refreshWithToken(refreshToken, clientId2 /* client_id de Metabase, no confundir con el clientId de EPIC Analyst */, metabaseMcpUrl) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId2,
      // El spec de autorizacion de MCP (RFC 8707 Resource Indicators) exige
      // este parametro para vincular el token al recurso especifico; sin el,
      // Metabase responde 400 invalid_request.
      resource: metabaseMcpUrl,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`No se pudo renovar el token OAuth de Metabase (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    // Metabase puede o no rotar el refresh_token en cada uso; si no manda uno
    // nuevo, seguimos usando el mismo.
    refresh_token: data.refresh_token || refreshToken,
    expires_at: Date.now() + (data.expires_in ? data.expires_in * 1000 : 5 * 60 * 1000),
  };
}

/**
 * Devuelve un access_token vigente para el cliente dado, renovandolo via
 * refresh_token si hace falta. Lanza un error claro si no hay forma de
 * renovarlo (hay que rehacer el bootstrap manual).
 */
export async function getValidAccessToken(clientId, clientConfig, env) {
  if (!env.METABASE_TOKEN_STORE) {
    // Sin KV configurado, cae al access_token estatico del secret (comportamiento viejo).
    return env[clientConfig.metabase_oauth_token_secret];
  }

  const stored = await env.METABASE_TOKEN_STORE.get(kvKey(clientId), 'json');
  if (stored && stored.expires_at > Date.now() + EXPIRY_BUFFER_MS) {
    return stored.access_token;
  }

  return forceRefresh(clientId, clientConfig, env);
}

/**
 * Fuerza una renovacion (ignora lo que haya en KV) y guarda el resultado.
 * Se usa tanto para el refresh proactivo como para reintentar tras un error
 * de autenticacion inesperado del lado de Anthropic/Metabase.
 */
export async function forceRefresh(clientId, clientConfig, env) {
  const refreshToken =
    (await env.METABASE_TOKEN_STORE?.get(kvKey(clientId), 'json'))?.refresh_token ||
    env[clientConfig.metabase_oauth_refresh_token_secret];
  const oauthClientId = env[clientConfig.metabase_oauth_client_id_secret];

  if (!refreshToken || !oauthClientId) {
    // No hay forma de renovar automaticamente: usar el access_token estatico
    // como ultimo recurso (probablemente tambien expirado, pero es lo unico
    // que hay) y dejar que falle con un mensaje claro en vez de romper aqui.
    return env[clientConfig.metabase_oauth_token_secret];
  }

  const refreshed = await refreshWithToken(refreshToken, oauthClientId, env.METABASE_MCP_URL);

  if (env.METABASE_TOKEN_STORE) {
    await env.METABASE_TOKEN_STORE.put(kvKey(clientId), JSON.stringify(refreshed));
  }

  return refreshed.access_token;
}
