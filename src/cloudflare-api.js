// src/cloudflare-api.js
// Llamadas a la API de Cloudflare para gestionar secrets del propio Worker
// desde el panel de administracion (en vez de requerir `wrangler secret put`
// por consola). Requiere:
//   CF_API_TOKEN_WORKERS_EDIT -- token con permiso "Workers Scripts: Edit"
//   CF_ACCOUNT_ID             -- ya existe como var no secreta
//   WORKER_SCRIPT_NAME        -- nombre del Worker actual (var), para que el
//                                mismo codigo sirva tanto en beta como en
//                                produccion sin hardcodear el nombre.

export async function setWorkerSecret(env, secretName, secretValue) {
  if (!env.CF_API_TOKEN_WORKERS_EDIT) {
    throw new Error('Falta el secret CF_API_TOKEN_WORKERS_EDIT para poder editar secrets desde el panel.');
  }
  if (!env.WORKER_SCRIPT_NAME) {
    throw new Error('Falta la var WORKER_SCRIPT_NAME en wrangler.jsonc.');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${env.WORKER_SCRIPT_NAME}/secrets`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN_WORKERS_EDIT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: secretName,
      text: secretValue,
      type: 'secret_text',
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`Error de Cloudflare al guardar el secret: ${JSON.stringify(data.errors || data)}`);
  }

  return true;
}
