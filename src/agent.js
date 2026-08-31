// src/agent.js
// Nucleo del agente EPIC Analyst. Misma logica que en la version Node original,
// adaptada a Cloudflare Workers (sin process.env; todo llega via `env`).
//
// IMPORTANTE sobre alcance de datos (ver README):
// El control de "solo puedes ver el Model X" se hace por PROMPT (system prompt).
// Es un guardrail de UX, NO una barrera de seguridad dura: el token OAuth usado
// determina a que datos tiene acceso real el MCP. Antes de dar acceso a clientes
// reales, migrar el aislamiento a permisos de Metabase (usuario de solo-lectura
// por cliente, acotado al Model correspondiente).

import Anthropic from '@anthropic-ai/sdk';

// Tools de escritura/administracion del MCP de Metabase que NO se permiten en
// este MVP de solo lectura. Se bloquean por denylist ademas de los permisos
// del propio token OAuth (defensa en profundidad).
const BLOCKED_MCP_TOOLS = [
  'create_dashboard',
  'update_dashboard',
  'create_question',
  'update_question',
  'create_metric',
  'update_metric',
  'create_collection',
];

function buildSystemPrompt(clientConfig) {
  return `Eres EPIC Analyst, un asistente de Business Intelligence conversacional para el negocio del cliente "${clientConfig.display_name}".

Tu unica fuente de datos es Metabase, a traves de las herramientas MCP disponibles. Debes:
- Responder preguntas sobre ventas, gimnasios, productos y metricas de negocio usando EXCLUSIVAMENTE datos que obtengas consultando Metabase con las herramientas disponibles.
- Enfocarte en el siguiente Model/fuente de datos: "${clientConfig.allowed_model_name}". Descripcion: ${clientConfig.allowed_model_description}
- Si una pregunta claramente pide datos fuera de ese alcance (otro Model, otra base de datos, informacion administrativa de Metabase, usuarios, permisos, etc.), responde amablemente que no tienes acceso a esa informacion en este agente.
- NUNCA crees, modifiques ni borres dashboards, preguntas, colecciones o metricas. Solo consultas de lectura.
- Responde siempre en español, de forma clara, breve y en lenguaje natural (no muestres SQL ni JSON crudo salvo que el usuario lo pida explicitamente).
- Si necesitas un rango de fechas relativo ("ayer", "este mes", "los ultimos 30 dias"), calcula las fechas asumiendo que hoy es la fecha actual real.
- Si el dato no esta disponible o la consulta falla, dilo con honestidad en vez de inventar numeros.
${clientConfig.extra_instructions ? `\nInstrucciones adicionales para este cliente:\n${clientConfig.extra_instructions}` : ''}`;
}

/**
 * Ejecuta una pregunta de usuario contra Claude + Metabase MCP.
 * @param {Object} params
 * @param {string} params.question
 * @param {Object} params.clientConfig
 * @param {string} params.metabaseOAuthToken
 * @param {Object} params.env - Bindings/vars del Worker (ANTHROPIC_API_KEY, CLAUDE_MODEL, METABASE_MCP_URL)
 */
export async function askEpicAnalyst({ question, clientConfig, metabaseOAuthToken, env }) {
  const METABASE_MCP_URL = env.METABASE_MCP_URL;
  const CLAUDE_MODEL = env.CLAUDE_MODEL || 'claude-sonnet-5';

  if (!METABASE_MCP_URL) {
    throw new Error('METABASE_MCP_URL no esta configurado (ver wrangler.jsonc vars).');
  }
  if (!metabaseOAuthToken) {
    throw new Error(`No hay token OAuth de Metabase configurado para el cliente "${clientConfig.display_name}". Revisa los secrets de Wrangler.`);
  }

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const systemPrompt = buildSystemPrompt(clientConfig);

  const usageTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let numModelCalls = 0;
  let numMcpToolCalls = 0;

  const messages = [{ role: 'user', content: question }];

  let finalResponse = null;
  const MAX_TURNS = 4;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages,
      mcp_servers: [
        {
          type: 'url',
          url: METABASE_MCP_URL,
          name: 'metabase',
          authorization_token: metabaseOAuthToken,
        },
      ],
      tools: [
        {
          type: 'mcp_toolset',
          mcp_server_name: 'metabase',
          configs: BLOCKED_MCP_TOOLS.reduce((acc, toolName) => {
            acc[toolName] = { enabled: false };
            return acc;
          }, {}),
        },
      ],
      betas: ['mcp-client-2025-11-20'],
    });

    numModelCalls += 1;

    if (response.usage) {
      usageTotals.input_tokens += response.usage.input_tokens || 0;
      usageTotals.output_tokens += response.usage.output_tokens || 0;
      usageTotals.cache_creation_input_tokens += response.usage.cache_creation_input_tokens || 0;
      usageTotals.cache_read_input_tokens += response.usage.cache_read_input_tokens || 0;
    }

    const mcpCallsThisTurn = (response.content || []).filter(
      (block) => block.type === 'mcp_tool_use'
    ).length;
    numMcpToolCalls += mcpCallsThisTurn;

    finalResponse = response;

    if (response.stop_reason !== 'tool_use' && response.stop_reason !== 'pause_turn') {
      break;
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: 'Continua.' });
  }

  const answerText = (finalResponse?.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return {
    answer: answerText || '(El agente no genero una respuesta de texto. Revisa los logs.)',
    usage: usageTotals,
    numModelCalls,
    numMcpToolCalls,
    stopReason: finalResponse?.stop_reason || 'unknown',
  };
}

export { BLOCKED_MCP_TOOLS };
