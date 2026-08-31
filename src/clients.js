// src/clients.js
// Config de clientes/agentes EPIC Analyst. Cada entrada representa un agente
// independiente: Cliente -> Model de Metabase -> token OAuth propio.
//
// Los tokens NO viven aqui. Cada "metabase_oauth_token_secret" es el NOMBRE
// del secret de Wrangler que contiene el token real, definido con:
//   wrangler secret put METABASE_OAUTH_TOKEN_DEFAULT
//
// Para agregar un cliente nuevo: agrega una entrada aqui + su secret
// correspondiente. No hace falta tocar ningun otro archivo.

export const CLIENTS = {
  default: {
    display_name: 'Cliente Demo',
    metabase_oauth_token_secret: 'METABASE_OAUTH_TOKEN_DEFAULT',
    allowed_model_name: 'Ventas Gimnasios',
    allowed_model_description:
      'Modelo de Metabase con las ventas diarias por gimnasio, incluye fecha, monto, gimnasio y producto.',
    extra_instructions: '',
  },

  // cliente_b: {
  //   display_name: 'Cliente B',
  //   metabase_oauth_token_secret: 'METABASE_OAUTH_TOKEN_CLIENTE_B',
  //   allowed_model_name: 'Ventas Retail Cliente B',
  //   allowed_model_description: 'Descripcion del Model correspondiente.',
  //   extra_instructions: '',
  // },
};

export function getClient(clientId) {
  return CLIENTS[clientId] || null;
}

export function listClientsSafe() {
  return Object.entries(CLIENTS).map(([client_id, cfg]) => ({
    client_id,
    display_name: cfg.display_name,
    allowed_model_name: cfg.allowed_model_name,
  }));
}
