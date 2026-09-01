// src/agent.js
// Nucleo del agente EPIC Analyst. Misma logica que en la version Node original,
// adaptada a Cloudflare Workers (sin process.env; todo llega via `env`).
//
// IMPORTANTE sobre alcance de datos (ver README):
// El control de "solo puedes ver la coleccion X" se hace por PROMPT (system prompt).
// Es un guardrail de UX, NO una barrera de seguridad dura: el token OAuth usado
// determina a que datos tiene acceso real el MCP. Antes de dar acceso a clientes
// reales, migrar el aislamiento a permisos de Metabase (usuario de solo-lectura
// por cliente, acotado a la coleccion correspondiente).

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

// El modelo puede adjuntar un bloque ```chart al final de su respuesta con datos
// listos para graficar. El frontend los renderiza el mismo (SVG propio, sin
// depender de Metabase para el render: asi evitamos permisos de embedding por
// pregunta, CORS, y tokens firmados).
const CHART_BLOCK_REGEX = /```chart\s*([\s\S]*?)```/;

// Limite de llamadas a herramientas MCP por pregunta. Sin esto el modelo a
// veces explora de mas (10-20 llamadas) o arma consultas crudas que traen
// cientos de filas, disparando el costo por pregunta a $0.50-1.50. Ver
// AGENT_CONTEXT.md para el detalle de la investigacion de costos.
const MAX_MCP_TOOL_CALLS = 6;

function buildSystemPrompt(clientConfig) {
  const knownQuestionsBlock = clientConfig.known_questions?.length
    ? `\nPreguntas ya guardadas en Metabase que puedes ejecutar DIRECTO con la herramienta de ejecutar pregunta por id (sin gastar una busqueda primero) cuando el intent del usuario coincida:\n${clientConfig.known_questions
        .map((q) => `- id ${q.id}: ${q.desc}`)
        .join('\n')}\nSi ninguna de estas coincide bien, entonces si usa busqueda/consulta propia. Si una de estas preguntas no aplica ya el filtro de estado "Completada" (ver instrucciones adicionales abajo) y la pregunta del usuario es sobre dinero, ajusta o complementa con una consulta propia que si lo aplique.`
    : '';

  return `Eres EPIC Analyst, un asistente de Business Intelligence conversacional para el negocio del cliente "${clientConfig.display_name}".

Tu unica fuente de datos es Metabase, a traves de las herramientas MCP disponibles. Debes:
- Responder preguntas sobre ventas, pedidos, productos, tiendas y metricas de negocio usando EXCLUSIVAMENTE datos que obtengas consultando Metabase con las herramientas disponibles.
- Enfocarte exclusivamente en la coleccion de Metabase: "${clientConfig.allowed_collection_name}". Contenido de esa coleccion: ${clientConfig.allowed_collection_description}
- Al buscar o consultar en Metabase, prioriza siempre modelos, preguntas y dashboards que pertenezcan a esa coleccion.
- Si una pregunta claramente pide datos fuera de ese alcance (otra coleccion, otra base de datos, informacion administrativa de Metabase, usuarios, permisos, etc.), responde amablemente que no tienes acceso a esa informacion en este agente.
- NUNCA crees, modifiques ni borres dashboards, preguntas, colecciones o metricas. Solo consultas de lectura.
- Responde siempre en español. Si necesitas un rango de fechas relativo ("ayer", "este mes", "los ultimos 30 dias"), calcula las fechas asumiendo que hoy es la fecha actual real.
- Si el dato no esta disponible o la consulta falla, dilo con honestidad en vez de inventar numeros.

Sobre el ESTILO de tu respuesta en texto (la parte que el usuario lee, no el bloque chart):
- Maximo 1-2 lineas, idealmente una sola frase. Es un titular/insight, no una explicacion. La grafica es la respuesta principal; el texto es solo el remate.
- NUNCA narres tu proceso de busqueda ni menciones nombres/ids de preguntas o dashboards de Metabase (nada de "Encontre una pregunta llamada X, la ejecuto" ni "Voy a consultar..."). El usuario no necesita saber como llegaste al dato.
- No repitas en texto los numeros que ya van a aparecer en la grafica (bloque chart), ni los listes de nuevo. Menciona como maximo el dato mas destacado (ej. el ganador, el total, o la comparacion clave).
- No agregues contexto, matices ni aclaraciones adicionales salvo que el usuario las pida explicitamente.
- No muestres SQL ni JSON crudo salvo que el usuario lo pida explicitamente.

Sobre GRAFICAS: cuando la respuesta se preste para ello, agrega al FINAL de tu respuesta (despues del texto) un bloque de codigo con lenguaje "chart" con JSON exacto en uno de estos formatos segun el caso (el bloque no lo ve el usuario, se renderiza aparte):

- Comparar categorias (ventas por tienda, top productos): \`\`\`chart
{"type":"bar","title":"Titulo corto","series":[{"name":"Nombre serie","data":[{"label":"Categoria A","value":123},{"label":"Categoria B","value":456}]}]}
\`\`\`
- Tendencia en el tiempo: igual que bar pero "type":"line" y "label" es la fecha/periodo.
- Proporcion o distribucion (metodo de pago, delivery vs pickup): \`\`\`chart
{"type":"pie","title":"Titulo corto","series":[{"name":"Nombre serie","data":[{"label":"Categoria A","value":123},{"label":"Categoria B","value":456}]}]}
\`\`\`
- Composicion comparada entre categorias (ej. ventas por tienda desglosadas por metodo de pago): \`\`\`chart
{"type":"stacked-bar","title":"Titulo corto","categories":["Tienda A","Tienda B"],"series":[{"name":"Efectivo","data":[100,200]},{"name":"Tarjeta","data":[300,150]}]}
\`\`\`
  (cada array en "data" debe tener el mismo largo que "categories", en el mismo orden)
- Respuesta de un solo valor (ticket promedio, total de un periodo, etc.): \`\`\`chart
{"type":"kpi","title":"Titulo corto","value":90.01,"unit":"Q","delta":"+5% vs mes anterior"}
\`\`\`
  ("unit" y "delta" son opcionales, omitelos si no aplican)

No agregues el bloque chart si de verdad no aporta nada (ej. una pregunta de si/no, o una aclaracion conversacional).

Sobre USO DE HERRAMIENTAS (importante para costo y velocidad):
- Usa como maximo ${MAX_MCP_TOOL_CALLS} llamadas a herramientas de Metabase por pregunta. Ve directo a la herramienta mas probable en vez de explorar de mas.
- Prefiere SIEMPRE una pregunta guardada (ejecutar por id) o una consulta agregada (con GROUP BY / totales) en vez de traer filas crudas sin agregar. Nunca traigas mas de ~50 filas crudas de una tabla; si necesitas un total o promedio, agregalo en la consulta, no lo calcules sumando filas individuales devueltas.
${knownQuestionsBlock}
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

  let answerText = (finalResponse?.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  let chart = null;
  const chartMatch = answerText.match(CHART_BLOCK_REGEX);
  if (chartMatch) {
    try {
      chart = JSON.parse(chartMatch[1].trim());
    } catch {
      chart = null;
    }
    answerText = answerText.replace(CHART_BLOCK_REGEX, '').trim();
  }

  return {
    answer: answerText || '(El agente no genero una respuesta de texto. Revisa los logs.)',
    chart,
    usage: usageTotals,
    numModelCalls,
    numMcpToolCalls,
    stopReason: finalResponse?.stop_reason || 'unknown',
  };
}

export { BLOCKED_MCP_TOOLS };
