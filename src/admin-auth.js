// src/admin-auth.js
// Proteccion simple para las rutas /api/admin/*. Una sola contraseña
// compartida (secret ADMIN_PASSWORD), enviada en el header X-Admin-Password
// en cada request. No hay sesiones/cookies -- el frontend la guarda en
// sessionStorage (se borra al cerrar la pestaña) y la reenvia en cada
// llamada. Suficiente para uso interno de un equipo chico; si esto se
// comparte mas ampliamente, migrar a Cloudflare Access.

export function isAdminAuthorized(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const provided = request.headers.get('X-Admin-Password') || '';
  return provided === env.ADMIN_PASSWORD;
}
