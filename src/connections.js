// src/connections.js
// Configuracion de conexiones LLM (proveedor + modelo + secret de API key).
// Una conexion NO es lo mismo que un proveedor: la principal y la de backup
// pueden ser del mismo proveedor (ej. dos cuentas distintas de Anthropic) o
// de proveedores distintos. Esto es justo lo que hubiera evitado el bloqueo
// de cuenta de Anthropic de agosto/septiembre 2026 (ver AGENT_CONTEXT.md).
//
// La config vive en KV (CONNECTIONS_STORE) para que un futuro panel de
// administracion pueda leerla/escribirla sin necesitar un redeploy. Si el KV
// esta vacio (primera vez, o el binding no existe), se usa DEFAULT_CONNECTIONS
// como semilla.

const KV_KEY = 'llm_connections';

export const DEFAULT_CONNECTIONS = {
  primary: {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    api_key_secret: 'ANTHROPIC_API_KEY',
  },
  backup: {
    provider: 'openai',
    // "gpt-5-mini" fallo con "context_length_exceeded" en pruebas reales
    // (agosto/septiembre 2026) -- puede que el nombre exacto del modelo haya
    // cambiado o no exista tal cual. gpt-4o-mini esta confirmado funcionando
    // end-to-end (respuesta, grafica, y costo correctos). Si se quiere
    // probar gpt-5-mini de nuevo, hacerlo con una sola pregunta de prueba
    // primero, no asumir que el nombre es correcto.
    model: 'gpt-4o-mini',
    api_key_secret: 'OPENAI_API_KEY',
  },
};

/**
 * @returns {Promise<{primary: Object, backup: Object|null}>}
 */
export async function getConnections(env) {
  if (!env.CONNECTIONS_STORE) return DEFAULT_CONNECTIONS;

  const stored = await env.CONNECTIONS_STORE.get(KV_KEY, 'json');
  if (!stored || !stored.primary) return DEFAULT_CONNECTIONS;

  return stored;
}

/**
 * Guarda la config de conexiones en KV. Pensado para cuando exista el panel
 * de administracion; no se usa todavia en el flujo normal.
 */
export async function setConnections(env, connections) {
  if (!env.CONNECTIONS_STORE) {
    throw new Error('CONNECTIONS_STORE no esta configurado en este Worker.');
  }
  await env.CONNECTIONS_STORE.put(KV_KEY, JSON.stringify(connections));
}
