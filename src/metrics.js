// src/metrics.js
// Registro de uso/costo con Workers Analytics Engine. Sin base de datos que
// administrar: Cloudflare guarda los eventos y expone una SQL API para leerlos.
//
// Escritura: env.METRICS.writeDataPoint() -- sincrono/fire-and-forget, disponible
// directo desde el binding declarado en wrangler.jsonc.
//
// Lectura/agregados: Analytics Engine NO se puede consultar desde dentro del
// propio Worker via el binding (el binding es solo de escritura). Hay que
// llamar a la SQL HTTP API de Cloudflare con tu Account ID + un API Token con
// permiso "Account Analytics Read". Ver README para como generarlo.
//
// Layout del data point (recordar el ORDEN, es posicional):
//   indexes: [client_id]                          <- 1 sola string, usada para sampling/agrupacion
//   blobs:   [question_preview, stop_reason, error_or_empty]
//   doubles: [input_tokens, output_tokens, cache_creation_input_tokens,
//             cache_read_input_tokens, num_model_calls, num_mcp_tool_calls,
//             latency_ms, estimated_cost_usd, is_error (0|1)]

export function logUsageEvent(env, event) {
  if (!env.METRICS) {
    console.warn('METRICS binding no disponible; evento no registrado.', event);
    return;
  }

  env.METRICS.writeDataPoint({
    indexes: [event.client_id || 'unknown'],
    blobs: [
      (event.question || '').slice(0, 200),
      event.stop_reason || '',
      event.error || '',
    ],
    doubles: [
      event.input_tokens || 0,
      event.output_tokens || 0,
      event.cache_creation_input_tokens || 0,
      event.cache_read_input_tokens || 0,
      event.num_model_calls || 0,
      event.num_mcp_tool_calls || 0,
      event.latency_ms || 0,
      event.estimated_cost_usd || 0,
      event.error ? 1 : 0,
    ],
  });
}

/**
 * Lee agregados desde la SQL API de Analytics Engine (HTTP, requiere
 * CF_ACCOUNT_ID + CF_ANALYTICS_API_TOKEN como secrets).
 */
export async function querySummary(env, { clientId } = {}) {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_API_TOKEN) {
    return {
      error:
        'Falta configurar CF_ACCOUNT_ID y/o CF_ANALYTICS_API_TOKEN como secrets para poder leer metricas. Ver README.',
    };
  }

  const where = clientId ? `WHERE index1 = '${clientId.replace(/'/g, "''")}'` : '';

  // Se usa SUM(_sample_interval) en vez de COUNT(*) porque Analytics Engine
  // puede aplicar sampling en volumenes altos; _sample_interval compensa eso
  // para que los agregados sigan siendo estadisticamente correctos. En
  // volumenes bajos (como este MVP) _sample_interval es normalmente 1, asi
  // que el numero coincide con un conteo exacto.
  const sql = `
    SELECT
      SUM(_sample_interval) AS total_questions,
      SUM(double1) AS total_input_tokens,
      SUM(double2) AS total_output_tokens,
      SUM(double3) AS total_cache_write_tokens,
      SUM(double4) AS total_cache_read_tokens,
      SUM(double5) AS total_model_calls,
      SUM(double6) AS total_mcp_calls,
      AVG(double7) AS avg_latency_ms,
      SUM(double8) AS total_estimated_cost_usd,
      SUM(double9) AS total_errors
    FROM epic_analyst_usage
    ${where}
  `.trim();

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_ANALYTICS_API_TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body: sql,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    return { error: `Error consultando Analytics Engine: ${res.status} ${text}` };
  }

  const data = await res.json();
  return { totals: data?.data?.[0] || null, raw: data };
}
