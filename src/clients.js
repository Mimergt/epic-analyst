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
    // access_token estatico, usado solo como fallback si nunca se hizo el
    // bootstrap de refresh automatico (ver src/metabase-auth.js) o si el KV
    // esta vacio.
    metabase_oauth_token_secret: 'METABASE_OAUTH_TOKEN_DEFAULT',
    // refresh_token + client_id obtenidos una sola vez con el MCP Inspector
    // (ver README), habilitan la renovacion automatica sin intervencion manual.
    metabase_oauth_refresh_token_secret: 'METABASE_OAUTH_REFRESH_TOKEN_DEFAULT',
    metabase_oauth_client_id_secret: 'METABASE_OAUTH_CLIENT_ID_DEFAULT',
    allowed_collection_name: 'DLP',
    allowed_collection_description:
      'Coleccion de Metabase con todos los modelos, bases y dashboards del ecommerce de Del Puente (venta de hamburguesas): pedidos, items/productos, tiendas, metodos de pago, tipo de entrega, tickets promedio y analisis de ventas por periodo.',
    extra_instructions:
      'Cuando se pregunte por ventas, ingresos, ganancias o cualquier metrica de dinero relacionada a pedidos, usa UNICAMENTE pedidos con estado "Completada". Solo usa otro estado (pendiente, cancelado, todos, etc.) si el usuario lo pide explicitamente. No es necesario aclarar ni mencionar este filtro en tu respuesta a menos que el usuario pregunte explicitamente por el criterio o estado usado.',
    // Catalogo de preguntas guardadas ya conocidas en la coleccion DLP. Se
    // inyecta en el system prompt para que el modelo use execute_question
    // directo en vez de gastar llamadas de "search" explorando cada vez.
    // Actualizar esta lista si se crean/renombran preguntas relevantes en
    // Metabase. IDs obtenidos explorando la coleccion DLP (id 5) en agosto 2026.
    known_questions: [
      { id: 204, desc: 'Ganancia por tienda - mes actual' },
      { id: 203, desc: 'Ganancia por tienda - trimestral' },
      { id: 138, desc: 'Ganancia por tienda - trimestre actual' },
      { id: 139, desc: 'Objetivo de ventas del trimestre' },
      { id: 205, desc: 'Pedidos por metodo de pago + tipo de entrega del mes' },
      { id: 130, desc: 'Analisis de pedidos por dia de la semana' },
      { id: 132, desc: 'Top tiendas por pedidos' },
      { id: 158, desc: 'Pedidos del trimestre' },
      { id: 206, desc: 'Pedidos y ventas por tienda al mes' },
      { id: 131, desc: 'Top productos mas vendidos' },
      { id: 201, desc: 'Tabla de tiendas' },
      { id: 90, desc: 'Distribucion delivery vs pickup' },
      { id: 89, desc: 'Distribucion de metodos de pago' },
      { id: 202, desc: 'Heatmap de pedidos' },
      { id: 114, desc: 'Pedidos por dispositivo a lo largo del tiempo' },
      { id: 102, desc: 'Pedidos efectivo/tarjeta a lo largo del tiempo' },
      { id: 105, desc: 'Pedidos por tipo de entrega a lo largo del tiempo' },
      { id: 101, desc: 'Pedidos a lo largo del tiempo' },
      { id: 107, desc: 'Ticket promedio a lo largo del tiempo' },
      { id: 106, desc: 'Tiempo promedio de entrega a lo largo del tiempo' },
      { id: 88, desc: 'Pedidos por periodo' },
      { id: 86, desc: 'Ticket promedio' },
      { id: 93, desc: 'Ticket promedio del mes' },
      { id: 91, desc: 'Top 5 productos del mes' },
      { id: 83, desc: 'Top 5 productos del trimestre' },
      { id: 78, desc: 'Total de pedidos' },
    ],
    // Modelo pre-agregado (creado 2026-09-01, id 207 en Metabase) para
    // preguntas que cruzan varias dimensiones y no calzan con ninguna
    // pregunta guardada de arriba. Ya viene sumado por dia/tienda/metodo de
    // pago/tipo de entrega/estado, asi que filtrar y re-agrupar sobre el es
    // mucho mas rapido que agregar desde pedidos crudos (la tabla es miles
    // de filas en vez de decenas de miles). NO usar con execute_question (no
    // soporta filtros); usar con construct_query + execute_query.
    cross_dimension_model: {
      entity_id: 'VY-ISZotPw8FnyoPD1kD1',
      question_id: 207,
      description:
        'Modelo "Analyst_agent - Resumen diario por tienda/pago/entrega": una fila por combinacion de dia + tienda + metodo_pago_grupo (Efectivo/Tarjeta) + tipo_entrega (delivery/pickup) + status_label (Completada/Cancelada/Fallida), con columnas ya agregadas count, sum, avg (del monto total). Para responder cruces (ej. ventas por tienda Y metodo de pago este mes), usa construct_query con este modelo como source-card, filtra por fecha/status_label segun se necesite, y vuelve a agrupar/sumar sobre estas filas ya agregadas (no hace falta bajar a pedidos individuales).',
    },
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
