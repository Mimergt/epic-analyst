// src/index.js
// Worker principal de EPIC Analyst.
// Rutas:
//   POST /api/chat      -> pregunta -> Claude + Metabase MCP -> respuesta
//   GET  /api/metrics   -> agregados de uso/costo (opcional ?client_id=)
//   GET  /api/clients   -> lista de clientes/agentes configurados
//   GET  /health        -> healthcheck
// Cualquier otra ruta cae en los assets estaticos (frontend/), servidos
// automaticamente por el binding ASSETS configurado en wrangler.jsonc.

import { askEpicAnalyst } from './agent.js';
import { getClient, listClientsSafe } from './clients.js';
import { estimateCostUsd } from './pricing.js';
import { logUsageEvent, querySummary } from './metrics.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...(init.headers || {}),
    },
  });
}

async function handleChat(request, env) {
  const startedAt = Date.now();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body invalido, se esperaba JSON.' }, { status: 400 });
  }

  const { question, client_id } = body || {};
  if (!question || typeof question !== 'string' || !question.trim()) {
    return json({ error: 'El campo "question" es requerido.' }, { status: 400 });
  }

  const effectiveClientId = client_id || 'default';
  const clientConfig = getClient(effectiveClientId);

  if (!clientConfig) {
    return json({ error: `Cliente "${effectiveClientId}" no configurado.` }, { status: 404 });
  }

  const metabaseOAuthToken = env[clientConfig.metabase_oauth_token_secret];

  try {
    const result = await askEpicAnalyst({
      question: question.trim(),
      clientConfig,
      metabaseOAuthToken,
      env,
    });

    const latencyMs = Date.now() - startedAt;
    const estimatedCost = estimateCostUsd(result.usage, env);

    logUsageEvent(env, {
      client_id: effectiveClientId,
      question: question.trim(),
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      cache_creation_input_tokens: result.usage.cache_creation_input_tokens,
      cache_read_input_tokens: result.usage.cache_read_input_tokens,
      num_model_calls: result.numModelCalls,
      num_mcp_tool_calls: result.numMcpToolCalls,
      latency_ms: latencyMs,
      estimated_cost_usd: estimatedCost,
      stop_reason: result.stopReason,
    });

    return json({
      answer: result.answer,
      metrics: {
        latency_ms: latencyMs,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cache_creation_input_tokens: result.usage.cache_creation_input_tokens,
        cache_read_input_tokens: result.usage.cache_read_input_tokens,
        num_model_calls: result.numModelCalls,
        num_mcp_tool_calls: result.numMcpToolCalls,
        estimated_cost_usd: estimatedCost,
      },
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    console.error('Error en /api/chat:', err);

    logUsageEvent(env, {
      client_id: effectiveClientId,
      question: question.trim(),
      latency_ms: latencyMs,
      error: err.message || String(err),
    });

    return json(
      {
        error: 'Hubo un error consultando a EPIC Analyst. Intenta de nuevo en un momento.',
        detail: err.message || String(err),
      },
      { status: 500 }
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', time: new Date().toISOString() });
    }

    if (url.pathname === '/api/clients' && request.method === 'GET') {
      return json(listClientsSafe());
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      return handleChat(request, env);
    }

    if (url.pathname === '/api/metrics' && request.method === 'GET') {
      const clientId = url.searchParams.get('client_id') || undefined;
      const summary = await querySummary(env, { clientId });
      return json(summary);
    }

    // Cualquier otra ruta: sirve el frontend estatico (SPA fallback a index.html).
    return env.ASSETS.fetch(request);
  },
};
