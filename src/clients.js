// src/clients.js
// Config de clientes/agentes EPIC Analyst. Cada entrada representa un agente
// independiente: Cliente -> Coleccion de Metabase -> token OAuth propio.
//
// Los tokens NO viven aqui. Cada "metabase_oauth_token_secret" es el NOMBRE
// del secret de Wrangler que contiene el token real, definido con:
//   wrangler secret put METABASE_OAUTH_TOKEN_DEFAULT
//
// Para agregar un cliente nuevo: agrega una entrada aqui + su secret
// correspondiente. No hace falta tocar ningun otro archivo.

export const CLIENTS = {
  dlp: {
    display_name: 'Del Puente',
    metabase_oauth_token_secret: 'METABASE_OAUTH_TOKEN_DEFAULT',
    allowed_collection_name: 'DLP',
    allowed_collection_description:
      'Coleccion de Metabase con todos los modelos, bases y dashboards del ecommerce de Del Puente (venta de hamburguesas): pedidos, items/productos, tiendas, metodos de pago, tipo de entrega, tickets promedio y analisis de ventas por periodo.',
    extra_instructions: '',
  },

  // cliente_b: {
  //   display_name: 'Cliente B',
  //   metabase_oauth_token_secret: 'METABASE_OAUTH_TOKEN_CLIENTE_B',
  //   allowed_collection_name: 'Nombre de la coleccion en Metabase',
  //   allowed_collection_description: 'Descripcion de que contiene esa coleccion.',
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
    allowed_collection_name: cfg.allowed_collection_name,
  }));
}
