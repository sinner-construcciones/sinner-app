/* Configuración pública de la app (Supabase → Project Settings → API Keys → Publishable key).
   Esta clave está pensada para ir en el navegador: lo que protege los datos son los permisos (RLS) de la base.
   NUNCA pongas acá la clave secreta (sb_secret_… / service_role) ni la contraseña de la base de datos. */
window.SINNER_CONFIG = {
  url: "https://xqwbltonjiotcgyzdbnz.supabase.co",
  publishableKey: "sb_publishable_OCJuriAfVvRrEvoKYI8ZxA_zGcD1GCr"
};
