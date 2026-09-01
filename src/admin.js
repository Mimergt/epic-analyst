// src/admin.js
// Rutas /api/admin/* del panel de administracion. Todas requieren el header
// X-Admin-Password (ver admin-auth.js) -- index.js ya valida esto antes de
// llamar a estas funciones, asi que aqui se asume que la request esta
// autorizada.

import { CLIENTS } from './clients.js';
import { getClientOverride, setClientOverride } from './client-config.js';
import { getConnections, setConnections } from './connections.js';
import { setWorkerSecret } from './cloudflare-api.js';
import { queryLogs } from './metrics.js';

// Nombres de los secrets relevantes para el panel -- se reporta si CADA UNO
// esta configurado o no (nunca su valor, los secrets de Cloudflare son de
// solo escritura, ni nosotros mismos podemos leerlos de vuelta).
const RELEVANT_SECRETS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'METABASE_OAUTH_TOKEN_DEFAULT',
  'METABASE_OAUTH_REFRESH_TOKEN_DEFAULT',
  'METABASE_OAUTH_CLIENT_ID_DEFAULT',
  'CF_ANALYTICS_API_TOKEN',
  'CF_API_TOKEN_WORKERS_EDIT',
  'ADMIN_PASSWORD',
];

export async function getAdminConfig(env) {
  const connections = await getConnections(env);

  const clients = await Promise.all(
    Object.keys(CLIENTS).map(async (clientId) => {
      const base = CLIENTS[clientId];
      const override = await getClientOverride(clientId, env);
      return {
        client_id: clientId,
        display_name: base.display_name,
        allowed_collection_name: base.allowed_collection_name,
        extra_instructions: override?.extra_instructions ?? base.extra_instructions ?? '',
        known_questions: override?.known_questions ?? base.known_questions ?? [],
        has_override: !!override,
      };
    })
  );

  const secretsStatus = {};
  for (const name of RELEVANT_SECRETS) {
    secretsStatus[name] = !!env[name];
  }

  return { connections, clients, secrets_status: secretsStatus };
}

export async function updateConnections(env, body) {
  if (!body?.primary) {
    throw new Error('Falta "primary" en el body.');
  }
  await setConnections(env, { primary: body.primary, backup: body.backup || null });
  return getConnections(env);
}

export async function updateClientConfig(env, clientId, body) {
  const patch = {};
  if (typeof body.extra_instructions === 'string') patch.extra_instructions = body.extra_instructions;
  if (Array.isArray(body.known_questions)) patch.known_questions = body.known_questions;
  return setClientOverride(clientId, env, patch);
}

export async function updateSecret(env, name, value) {
  if (!RELEVANT_SECRETS.includes(name)) {
    throw new Error(`"${name}" no es un secret editable desde el panel.`);
  }
  if (!value || typeof value !== 'string') {
    throw new Error('Falta el valor del secret.');
  }
  await setWorkerSecret(env, name, value);
  return true;
}

export async function getLogs(env, { limit, clientId, onlyErrors }) {
  return queryLogs(env, { limit, clientId, onlyErrors });
}
