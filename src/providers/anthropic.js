// src/providers/anthropic.js
// Proveedor Anthropic (Claude), usando el conector MCP nativo de la Messages
// API (`mcp_servers` + `mcp_toolset`). Ejecuta las tools de Metabase del lado
// de Anthropic, sin que nuestro Worker tenga que orquestar el protocolo MCP.
//
// Interfaz comun a todos los proveedores (ver src/agent.js): recibe
// { question, clientConfig, metabaseOAuthToken, env, apiKey, model } y
// devuelve { answer, chart, usage, numModelCalls, numMcpToolCalls, stopReason }.

import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, extractChart, BLOCKED_MCP_TOOLS, MAX_MCP_TOOL_CALLS, EMPTY_ANSWER_PLACEHOLDER } from '../prompt.js';

export async function ask({ question, clientConfig, metabaseOAuthToken, env, apiKey, model }) {
  const METABASE_MCP_URL = env.METABASE_MCP_URL;

  if (!METABASE_MCP_URL) {
    throw new Error('METABASE_MCP_URL no esta configurado (ver wrangler.jsonc vars).');
  }
  if (!metabaseOAuthToken) {
    throw new Error(`No hay token OAuth de Metabase configurado para el cliente "${clientConfig.display_name}". Revisa los secrets de Wrangler.`);
  }
  if (!apiKey) {
    throw new Error('Falta la API key de Anthropic para esta conexion.');
  }

  const anthropic = new Anthropic({ apiKey });
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
      model: model || 'claude-sonnet-5',
      max_tokens: 4096,
      // system y el toolset de MCP son identicos entre preguntas de un mismo
      // cliente (no dependen de la pregunta del usuario) asi que se cachean:
      // la primera pregunta en la ventana de cache paga precio normal, las
      // siguientes (de cualquier usuario) pagan ~10x menos por ese bloque.
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
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
          cache_control: { type: 'ephemeral' },
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

    // Guardrail duro de costo: si ya se paso el presupuesto de llamadas MCP,
    // no se manda otro turno aunque Claude quiera seguir explorando. Se usa
    // la respuesta parcial que ya se tiene en vez de dejar que seguir
    // buscando dispare el costo (ver AGENT_CONTEXT.md).
    if (numMcpToolCalls >= MAX_MCP_TOOL_CALLS) {
      break;
    }

    // pause_turn: el turno quedo incompleto (p.ej. a media ejecucion de una
    // tool de MCP) y hay que reenviar la conversacion tal cual para que Claude
    // la retome. NO se debe insertar un mensaje de usuario nuevo aqui: podria
    // dejar un mcp_tool_use sin su mcp_tool_result correspondiente y la API
    // rechaza la siguiente request.
    messages.push({ role: 'assistant', content: response.content });
  }

  const rawText = (finalResponse?.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const { answer, chart } = extractChart(rawText);

  return {
    answer: answer || EMPTY_ANSWER_PLACEHOLDER,
    chart,
    usage: usageTotals,
    numModelCalls,
    numMcpToolCalls,
    stopReason: finalResponse?.stop_reason || 'unknown',
  };
}
