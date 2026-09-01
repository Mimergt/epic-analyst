// src/providers/openai.js
// Proveedor OpenAI, usando el tool "mcp" nativo de la Responses API
// (https://api.openai.com/v1/responses). Al igual que el conector de
// Anthropic, OpenAI ejecuta las tools de Metabase del lado de su propia
// infraestructura -- nuestro Worker no orquesta el protocolo MCP el mismo.
//
// Diferencia clave con Anthropic: su MCP usa una LISTA BLANCA (`allowed_tools`)
// en vez de una lista negra, asi que aqui invertimos BLOCKED_MCP_TOOLS.
//
// NOTA: el shape exacto de "output" (que item trae el texto final) y de
// "usage" se verifico contra la doc oficial de OpenAI, pero conviene
// reconfirmar con una llamada real la primera vez que se use (ver
// AGENT_CONTEXT.md) -- por eso el parseo es defensivo (busca por tipo en vez
// de asumir una posicion fija).

import { buildSystemPrompt, extractChart, BLOCKED_MCP_TOOLS } from '../prompt.js';

const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';

// Todas las tools que expone el MCP de Metabase (ver AGENT_CONTEXT.md). Se
// filtra contra BLOCKED_MCP_TOOLS para armar la lista blanca que OpenAI
// requiere (a diferencia de Anthropic, que usa lista negra).
const ALL_METABASE_TOOLS = [
  'construct_native_query',
  'construct_query',
  'create_collection',
  'create_dashboard',
  'create_metric',
  'create_question',
  'execute_query',
  'execute_question',
  'execute_sql',
  'query',
  'read_resource',
  'render_drill_through',
  'search',
  'update_dashboard',
  'update_metric',
  'update_question',
  'visualize_query',
];

const ALLOWED_METABASE_TOOLS = ALL_METABASE_TOOLS.filter((t) => !BLOCKED_MCP_TOOLS.includes(t));

export async function ask({ question, clientConfig, metabaseOAuthToken, env, apiKey, model }) {
  const METABASE_MCP_URL = env.METABASE_MCP_URL;

  if (!METABASE_MCP_URL) {
    throw new Error('METABASE_MCP_URL no esta configurado (ver wrangler.jsonc vars).');
  }
  if (!metabaseOAuthToken) {
    throw new Error(`No hay token OAuth de Metabase configurado para el cliente "${clientConfig.display_name}". Revisa los secrets de Wrangler.`);
  }
  if (!apiKey) {
    throw new Error('Falta la API key de OpenAI para esta conexion.');
  }

  const systemPrompt = buildSystemPrompt(clientConfig);

  const res = await fetch(RESPONSES_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      instructions: systemPrompt,
      input: question,
      tools: [
        {
          type: 'mcp',
          server_label: 'metabase',
          server_url: METABASE_MCP_URL,
          authorization: metabaseOAuthToken,
          require_approval: 'never',
          allowed_tools: ALLOWED_METABASE_TOOLS,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }

  const data = await res.json();
  const output = data.output || [];

  const mcpCalls = output.filter((item) => item.type === 'mcp_call');
  const messageItem = output.find((item) => item.type === 'message');
  const rawText = (messageItem?.content || [])
    .filter((c) => c.type === 'output_text' || c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();

  const { answer, chart } = extractChart(rawText);

  const usage = data.usage || {};

  return {
    answer: answer || '(El agente no genero una respuesta de texto. Revisa los logs.)',
    chart,
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: usage.input_tokens_details?.cached_tokens || 0,
    },
    numModelCalls: 1,
    numMcpToolCalls: mcpCalls.length,
    stopReason: data.status || 'unknown',
  };
}
