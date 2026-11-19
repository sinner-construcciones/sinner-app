// Sinner Construcciones · Presupuesto dictado con IA (Claude)
// Se despliega en Supabase → Edge Functions → nombre: presupuesto-ia
// Necesita el secreto ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets). La clave NUNCA va en la app.
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGENES = ["https://sinnerconstrucciones.netlify.app"];
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

Deno.serve(async (req) => {
  const h = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405, h);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "Falta configurar la clave de la IA (ANTHROPIC_API_KEY) en Supabase." }, 500, h);

  // Solo administradores: se valida con la sesión del usuario.
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "Sesión vencida. Volvé a entrar." }, 401, h);
  const { data: perfil } = await sb.from("perfiles").select("rol").eq("id", u.user.id).maybeSingle();
  if (perfil?.rol !== "admin") return json({ error: "Solo administradores." }, 403, h);

  let texto = "";
  try { texto = String((await req.json()).texto || "").trim(); } catch { /* */ }
  if (texto.length < 5) return json({ error: "Contá qué hay que presupuestar." }, 400, h);
  if (texto.length > 6000) texto = texto.slice(0, 6000);

  const { data: cfgRow } = await sb.from("config").select("data").eq("id", "general").maybeSingle();
  const cfg = (cfgRow?.data ?? {}) as Record<string, any>;
  const precioJornal = Number(cfg.precioJornal) || Number(cfg.costoJornal) || 100000;
  const cot = Number(cfg.cotizacion) || 0;
  const rend = cfg.rend ?? { pared: 10, revoque: 12, platea: 16 };
  const precios = cfg.precios ?? {};
  const lista = String(cfg.listaPrecios ?? "").slice(0, 12000);

  const sistema = `Sos el presupuestista de Sinner Construcciones (Córdoba, Argentina). Construyen casas y ampliaciones con paneles de EPS (Concrehaus), revoque proyectado, plateas de hormigón, techos y terminaciones.
Armás presupuestos PARA EL CLIENTE en pesos argentinos a partir de lo que te dictan.
Reglas:
- La mano de obra se cobra por jornal a ${precioJornal} pesos cada jornal (precio al cliente). Calculá los jornales con estos rendimientos: pared de panel ${rend.pared} m² por jornal, revoque ${rend.revoque} m² por jornal, platea ${rend.platea} jornales por platea típica. Para otras tareas estimá jornales con criterio de obra.
- En los ítems de mano de obra poné el precio por unidad (por m² o global) ya calculado, y en "jor" la cantidad de jornales que lleva. Nunca menciones márgenes, costos internos ni ganancias.
- Materiales: usá la lista de precios si el material está. Si está en dólares, pasalo a pesos con la cotización ${cot || "del día (si no la tenés, dejá el precio en 0 y avisalo en preguntas)"}. Precios de hormigón y bomba de la empresa: ${JSON.stringify(precios)}.
- Si falta un precio, poné precio 0 y agregalo en "preguntas". No inventes precios que no sabés.
- Calculá cantidades reales (m², unidades, paneles de 1,20 m de ancho, mallas) a partir de las medidas dictadas. Si falta una medida, suponé lo razonable y anotalo en "supuestos".
- Ítems claros y cortos, como los lee un cliente.
Lista de precios disponible:
${lista || "(no hay lista cargada)"}
Respondé SOLO con JSON válido, sin texto antes ni después, con esta forma:
{"cliente":"","obra":"","titulo":"","items":[{"d":"descripción","cant":0,"unid":"m²|u|gl|m³|jornales","precio":0,"jor":0}],"supuestos":[""],"preguntas":[""],"nota":"texto breve para el cliente (validez, forma de pago si la dictaron)"}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      system: sistema,
      messages: [{ role: "user", content: texto }],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("anthropic", r.status, t.slice(0, 500));
    return json({ error: r.status === 401 ? "La clave de la IA no es válida." : r.status === 429 ? "La IA está ocupada, probá en un minuto." : "La IA no respondió. Probá de nuevo." }, 502, h);
  }
  const out = await r.json();
  const txt = (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return json({ error: "La IA no devolvió un presupuesto. Probá dictarlo de nuevo." }, 502, h);
  try {
    const p = JSON.parse(m[0]);
    p.items = (Array.isArray(p.items) ? p.items : []).slice(0, 80).map((i: any) => ({
      d: String(i.d ?? "").slice(0, 200), cant: Number(i.cant) || 0, unid: String(i.unid ?? "").slice(0, 20),
      precio: Math.round((Number(i.precio) || 0) * 100) / 100, ...(Number(i.jor) ? { jor: Number(i.jor) } : {}),
    }));
    return json(p, 200, h);
  } catch {
    return json({ error: "La IA devolvió algo que no se pudo leer. Probá de nuevo." }, 502, h);
  }
});
