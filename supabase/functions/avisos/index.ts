// Sinner Construcciones · Avisos de la Agenda (notificaciones al celular)
// Se despliega en Supabase → Edge Functions → nombre: avisos  (con "Verify JWT" DESACTIVADO).
// No necesita ninguna clave: las claves de notificación se generan solas la primera vez
// y quedan guardadas en una tabla privada de la base (nadie las ve desde la app).
// - accion "clave": devuelve la clave pública para que el celular se suscriba.
// - accion "enviar": la llama el reloj de la base (cada 5 minutos) y manda lo que corresponda:
//     · resumen del día a partir de las 8:00 (una vez por día y por persona)
//     · aviso 30 minutos antes de cada pendiente con hora
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const ORIGENES = ["https://sinner-construcciones.github.io"];
function cors(origin: string | null) {
  const ok = origin && (ORIGENES.includes(origin) || origin.startsWith("http://localhost"));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ORIGENES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (b: unknown, s: number, h: Record<string, string>) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...h, "Content-Type": "application/json" } });

const HORA_RESUMEN = 8;      // 8:00 de Córdoba
const MIN_ANTES = 30;        // aviso media hora antes
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function ahoraCba() { // Argentina: UTC-3 todo el año
  const d = new Date(Date.now() - 3 * 3600e3);
  const iso = d.toISOString();
  return { fecha: iso.slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const aMin = (h: string) => { const [a, b] = (h || "").split(":").map(Number); return isNaN(a) ? null : a * 60 + (b || 0); };
const fCorta = (f: string) => { const d = new Date(f + "T12:00:00Z"); return DIAS[d.getUTCDay()] + " " + f.slice(8) + "/" + f.slice(5, 7); };

Deno.serve(async (req) => {
  const h = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405, h);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let body: { accion?: string } = {};
  try { body = await req.json(); } catch (_) { /* vacío */ }

  // Claves de notificación (se crean solas una vez)
  let { data: cl } = await db.from("push_claves").select("publica,privada").eq("id", 1).maybeSingle();
  if (!cl) {
    const k = webpush.generateVAPIDKeys();
    await db.from("push_claves").insert({ id: 1, publica: k.publicKey, privada: k.privateKey });
    ({ data: cl } = await db.from("push_claves").select("publica,privada").eq("id", 1).maybeSingle());
  }
  if (!cl) return json({ error: "No se pudieron preparar las claves" }, 500, h);
  if (body.accion === "clave") return json({ publica: cl.publica }, 200, h);
  if (body.accion !== "enviar") return json({ error: "Acción desconocida" }, 400, h);

  webpush.setVapidDetails("mailto:info@sinnerconstrucciones.com", cl.publica, cl.privada);
  const { fecha: hoy, min: ahora } = ahoraCba();

  const [{ data: subs }, { data: perfiles }, { data: ag }] = await Promise.all([
    db.from("push_subs").select("id,user_id,sub"),
    db.from("perfiles").select("id,rol,nombre"),
    db.from("agenda").select("id,data,creado_por"),
  ]);
  if (!subs || !subs.length) return json({ ok: true, enviados: 0 }, 200, h);
  const admins = (perfiles || []).filter((p) => p.rol === "admin").map((p) => p.id);
  const items = (ag || []).map((r) => ({ id: r.id, ...(r.data as Record<string, any>) })).filter((a) => !a.hecho && a.fecha);
  const paraQuien = (a: any): string[] => a.asignado ? [a.asignado] : admins;

  const yaEnviado = async (clave: string) => {
    const { error } = await db.from("push_log").insert({ clave });
    return !!error; // si ya existía, la inserción falla → ya se mandó
  };
  let enviados = 0;
  const mandar = async (uid: string, msg: Record<string, string>) => {
    for (const s of subs.filter((x) => x.user_id === uid)) {
      try { await webpush.sendNotification(s.sub, JSON.stringify(msg)); enviados++; }
      catch (e: any) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await db.from("push_subs").delete().eq("id", s.id); }
    }
  };
  const usuarios = [...new Set(subs.map((s) => s.user_id))];

  // 1) Resumen del día (desde las 8:00 hasta el mediodía, una sola vez)
  if (ahora >= HORA_RESUMEN * 60 && ahora < 12 * 60) {
    for (const uid of usuarios) {
      const mios = items.filter((a) => paraQuien(a).includes(uid) && a.fecha <= hoy);
      if (!mios.length) continue;
      if (await yaEnviado("dia|" + uid + "|" + hoy)) continue;
      const deHoy = mios.filter((a) => a.fecha === hoy).sort((a, b) => (a.hora || "99").localeCompare(b.hora || "99"));
      const venc = mios.filter((a) => a.fecha < hoy);
      const lista = deHoy.slice(0, 4).map((a) => (a.hora ? a.hora + " " : "") + a.texto).join(" - ");
      await mandar(uid, {
        title: deHoy.length ? "Hoy tenés " + deHoy.length + " pendiente" + (deHoy.length === 1 ? "" : "s") : "Pendientes vencidos",
        body: (lista || "") + (deHoy.length > 4 ? " ..." : "") + (venc.length ? (lista ? " | " : "") + venc.length + " vencido" + (venc.length === 1 ? "" : "s") + " sin hacer" : ""),
        tag: "dia-" + hoy, url: "./#agenda",
      });
    }
  }
  // 2) Aviso media hora antes de cada pendiente con hora
  for (const a of items.filter((x) => x.fecha === hoy && x.hora)) {
    const m = aMin(a.hora);
    if (m === null || ahora < m - MIN_ANTES || ahora >= m) continue;
    if (await yaEnviado("hora|" + a.id + "|" + a.fecha + "|" + a.hora)) continue;
    for (const uid of paraQuien(a)) {
      if (!usuarios.includes(uid)) continue;
      await mandar(uid, { title: "A las " + a.hora + ": " + a.texto, body: "Hoy " + fCorta(a.fecha) + (a.detalle ? " - " + a.detalle : ""), tag: "hora-" + a.id, url: "./#agenda" });
    }
  }
  // limpieza del registro de envíos viejos
  await db.from("push_log").delete().lt("ts", new Date(Date.now() - 10 * 864e5).toISOString());
  return json({ ok: true, enviados }, 200, h);
});
