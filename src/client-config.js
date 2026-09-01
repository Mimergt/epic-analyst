// src/client-config.js
// Overrides de configuracion por cliente (contexto de negocio, catalogo de
// preguntas conocidas) editables desde el panel de administracion, guardados
// en KV (reusa el binding CONNECTIONS_STORE) para no requerir redeploy.
// La base sigue viviendo en clients.js (codigo) -- el override en KV se
// mezcla encima cuando existe.

import { CLIENTS, getClient as getBaseClient } from './clients.js';

function kvKey(clientId) {
  return `client_config:${clientId}`;
}

/**
 * Config completa del cliente (base de clients.js + override de KV si existe).
 */
export async function getClientConfig(clientId, env) {
  const base = getBaseClient(clientId);
  if (!base) return null;
  if (!env?.CONNECTIONS_STORE) return base;

  const override = await env.CONNECTIONS_STORE.get(kvKey(clientId), 'json');
  if (!override) return base;

  return {
    ...base,
    extra_instructions: override.extra_instructions ?? base.extra_instructions,
    known_questions: override.known_questions ?? base.known_questions,
  };
}

/**
 * Solo el override guardado en KV (sin mezclar con la base), para mostrar en
 * el formulario de edicion del panel -- si no hay override, se le muestra al
 * usuario la base actual como punto de partida.
 */
export async function getClientOverride(clientId, env) {
  if (!env?.CONNECTIONS_STORE) return null;
  return env.CONNECTIONS_STORE.get(kvKey(clientId), 'json');
}

export async function setClientOverride(clientId, env, patch) {
  if (!env.CONNECTIONS_STORE) {
    throw new Error('CONNECTIONS_STORE no esta configurado en este Worker.');
  }
  if (!CLIENTS[clientId]) {
    throw new Error(`Cliente "${clientId}" no existe.`);
  }

  const current = (await env.CONNECTIONS_STORE.get(kvKey(clientId), 'json')) || {};
  const updated = { ...current, ...patch };
  await env.CONNECTIONS_STORE.put(kvKey(clientId), JSON.stringify(updated));
  return updated;
}
