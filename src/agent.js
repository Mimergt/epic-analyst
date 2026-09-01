// src/agent.js
// Dispatcher: intenta la conexion LLM principal; si falla con un error que
// pinta como "la conexion en si esta mal" (cuenta bloqueada, sin credito,
// key invalida, error de red), reintenta automaticamente con la de backup.
// No le importa a este archivo si backup es el mismo proveedor u otro --
// solo sigue la config de src/connections.js.
//
// IMPORTANTE sobre alcance de datos (ver README):
// El control de "solo puedes ver la coleccion X" se hace por PROMPT (system
// prompt, en src/prompt.js), NO por permisos de Metabase. Es un guardrail de
// UX, no una barrera de seguridad dura.

import * as anthropicProvider from './providers/anthropic.js';
import * as openaiProvider from './providers/openai.js';
import { getConnections } from './connections.js';

const PROVIDERS = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
};

// Nota: cualquier error de la conexion principal dispara el intento con la
// de backup (no se intenta distinguir "la conexion esta mal" de "esta
// pregunta en particular causo un error") -- mejor una respuesta tardia que
// ninguna.

export async function askEpicAnalyst({ question, clientConfig, metabaseOAuthToken, env }) {
  const connections = await getConnections(env);
  const attempts = [
    { role: 'primary', config: connections.primary },
    { role: 'backup', config: connections.backup },
  ].filter((a) => a.config);

  let lastError;

  for (const attempt of attempts) {
    const { provider: providerName, model, api_key_secret } = attempt.config;
    const provider = PROVIDERS[providerName];

    if (!provider) {
      lastError = new Error(`Proveedor desconocido: "${providerName}"`);
      continue;
    }

    const apiKey = env[api_key_secret];
    if (!apiKey) {
      lastError = new Error(`Falta el secret "${api_key_secret}" para la conexion ${attempt.role} (${providerName}).`);
      continue;
    }

    try {
      const result = await provider.ask({ question, clientConfig, metabaseOAuthToken, env, apiKey, model });
      return { ...result, connectionUsed: `${attempt.role}:${providerName}:${model}` };
    } catch (err) {
      console.error(`Conexion ${attempt.role} (${providerName}) fallo:`, err.message);
      lastError = err;
      // sigue al siguiente intento (backup), si hay uno
    }
  }

  throw lastError || new Error('No hay conexiones LLM configuradas.');
}
