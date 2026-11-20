
/* La conexión se lee de config.js (window.SINNER_CONFIG). Ahí va SOLO la clave publicable;
   la clave secreta (service_role / sb_secret) nunca va en la app. */
const SUPABASE_URL = (window.SINNER_CONFIG&&window.SINNER_CONFIG.url)||"PEGAR";
const SUPABASE_KEY = (window.SINNER_CONFIG&&window.SINNER_CONFIG.publishableKey)||"PEGAR";
if(/sb_secret_|service_role/.test(SUPABASE_KEY))throw new Error("Clave secreta detectada en config.js: no se usa en la app.");

/* ---------- estado ---------- */
const CAJAS = ["General","Federico","Numa","Lucas","Nico","Tamara"];
const SIN_OBRA = [
  {id:"_empresa", nombre:"Empresa / Galpón"},
  {id:"_oficina", nombre:"Gastos de oficina"},
  {id:"_sueldos", nombre:"Sueldos fijos"},
  {id:"_jornales", nombre:"Sueldos de obra (jornaleros)"},
  {id:"_federico", nombre:"Personal Federico"},
  {id:"_numa", nombre:"Retiros Numa"}
];
const CATEGORIAS = ["Pago recibido","Materiales","Pagos","Herramientas y equipos","Combustible","Gastos de empresa","Gastos de empleados","Adelantos de empleados","Sueldos","Sueldos fijos","Gastos de oficina","Alquiler oficina","Tarjeta de crédito","A cobrar","Comida empleados","Vivienda empleados","Viáticos","Mantenimiento vehículos","Personal Federico","Retiros Numa","Varios"];
const MOTIVOS = ["Lluvia / clima","Demora del hierro","Falta de material","Falta de personal","Espera de definiciones del cliente","Feriado","Problema de equipo","Otro"];
const DEF_CFG = {tarjetas:["Bancor Federico"],cotizacion:0, costoJornal:100000, precioJornal:0, listaPrecios:`Concrehaus Nro. 40 (sep 2026) – precios NETOS en U$S sin IVA, camión completo puesto en Córdoba. Ancho útil del panel 1,20 m.
Paneles EPS (U$S/m²): PCE 04 9,07 · PCE 06 10,53 · PCE 08 11,84 · PCE 10 13,17 · PCE 12 14,80 · PCE 14 16,28 · PCE 16 17,90 · PCE 18 19,97
Mallas (U$S/unidad): MPC 15 plana 22,5x123 1,18 · MPC 30 plana 30x123 1,69 · MAC 15 angular 18,5x18,5x123 2,11 · MAC 30 angular 30x30x123 3,06 · MUC 08/12 "U" 2,36 · MUC 14/18 "U" 2,64 · MEC 2401 entera 124x240 9,86`, precios:{hormigon:180000, bombaFija:780000, bombaM3:21000, macrofibra:63000}, rend:{pared:10, revoque:12, platea:16}, cajasDesde:"2026-11-01", saldosIniciales:{Lucas:97469.07}, ultimoRecibo:2};
const S = {movs:[], cierres:[], obras:[], jorn:[], bit:[], pres:[], inv:[], emp:[], liqs:[], cli:[], prov:[], imp:undefined, owner:false, importing:null, auth:"loading", rol:null, perfil:null, authMsg:"", cfg:structuredClone(DEF_CFG), cfgVer:false, loaded:{m:0,o:0,j:0,b:0}, uid:null, filt:{caja:"Todas", mes:hoy().slice(0,7)}, err:null, stale:false};
let db=null, dict=null, dl=true, sb=null;

/* ---------- utilidades ---------- */
function hoy(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
const $ = s=>document.querySelector(s);
const esc = s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n=>"$ "+Math.round(+n||0).toLocaleString("es-AR");
const fmtU = n=>"US$ "+(Math.round((+n||0)*100)/100).toLocaleString("es-AR");
const fdate = s=>{if(!s)return"";const[y,m,d]=s.split("-");return d+"/"+m+"/"+y.slice(2)};
const DIAS=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MESES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const dlabel = s=>{const d=new Date(s+"T12:00");return DIAS[d.getDay()]+" "+d.getDate()+" de "+MESES[d.getMonth()]};
const mlabel = s=>{const[y,m]=s.split("-");return MESES[+m-1]+" "+y};
const num = v=>{if(typeof v==="number")return v;const t=String(v||"").trim().replace(/\$/g,"").replace(/\s/g,"");if(!t)return 0;
  const c=t.includes(",")?t.replace(/\./g,"").replace(",","."):(/^\d{1,3}(\.\d{3})+$/.test(t)?t.replace(/\./g,""):t);return parseFloat(c)||0};
const obraNombre = id=>(S.obras.find(o=>o.id===id)||SIN_OBRA.find(o=>o.id===id)||{nombre:id?"(obra borrada)":"Sin obra"}).nombre;
const obrasActivas = ()=>S.obras.filter(o=>o.estado!=="Terminada");
const sortObras = arr=>[...arr].sort((a,b)=>(a.estado==="Terminada")-(b.estado==="Terminada")||a.nombre.localeCompare(b.nombre));
function toast(t){const e=$("#toast");e.textContent=t;e.style.display="block";clearTimeout(toast.t);toast.t=setTimeout(()=>e.style.display="none",2200)}

/* ---------- cálculos ---------- */
/* pesos y dólares: movimientos con moneda "USD" mueven dólares; "cambio" saca dólares y mete pesos */
const esUsd=m=>m.moneda==="USD";
function efecto(m,c){const v=+m.monto||0,u=+m.usd||0;
  if(m.pago==="tarjeta")return [0,0];
  if(m.tipo==="pagoTarjeta")return m.caja===c?[-v,0]:[0,0];
  if(m.tipo==="pase"){const sg=(m.cajaDestino===c?1:0)-(m.caja===c?1:0);return esUsd(m)?[0,sg*u]:[sg*v,0]}
  if(m.caja!==c)return [0,0];
  if(m.tipo==="cambio")return [v,-u];
  const sg=m.tipo==="ingreso"?1:-1;return esUsd(m)?[0,sg*u]:[sg*v,0]}
function inicioCaja(c){const I=(S.cfg.inicioCajas||{})[c];if(I&&I.fecha)return {desde:I.fecha,ars:+I.ars||0,usd:+I.usd||0};
  return {desde:S.cfg.cajasDesde||"",ars:+((S.cfg.saldosIniciales||{})[c])||0,usd:0}}
function saldos(c,hasta){const I=inicioCaja(c);let a=I.ars,u=I.usd;
  for(const m of S.movs){const f=m.fecha||"";if(I.desde&&f<I.desde)continue;if(hasta&&f>hasta)continue;const [x,y]=efecto(m,c);a+=x;u+=y}
  return {ars:a,usd:Math.round(u*100)/100}}
function saldoCaja(c){return saldos(c).ars}
function saldoUsd(c){return saldos(c).usd}
/* valor en pesos de un dólar para los números de obra: el último cambio real (cueva) de esa caja, si no de cualquiera */
function ultimoCambio(caja,fecha){const L=S.movs.filter(m=>m.tipo==="cambio"&&+m.usd&&(!fecha||(m.fecha||"")<=fecha)).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")||(b.creado||0)-(a.creado||0));
  const x=L.find(m=>m.caja===caja)||L[0];return x?{cot:+m2(x.monto/x.usd),fecha:x.fecha,caja:x.caja}:null}
const m2=n=>Math.round(n*100)/100;
/* un gasto en dólares vale, para la obra, lo que dio el último cambio real anterior (si no hay, lo que se guardó al cargarlo) */
function valorPesos(m){if(!esUsd(m))return +m.monto||0;const r=ultimoCambio(m.caja,m.fecha)||ultimoCambio(m.caja);return r?m2((+m.usd||0)*r.cot):(+m.monto||0)}
/* mano de obra por obra: semanas con planilla asignada por obra usan lo pagado de verdad;
   el resto usa jornales × costo del jornal */
function costoManoObra(id){
  let c=0;const sem=S.liqs.filter(l=>(l.filas||[]).some(f=>f.obra));
  const enSem=f=>sem.some(l=>f>=l.desde&&f<=l.hasta);
  for(const x of S.jorn)if(x.obra===id&&!enSem(x.fecha||""))c+=(+x.cantidad||0)*(+x.costoUnit||S.cfg.costoJornal);
  for(const l of sem){let sin=0;for(const f of l.filas||[]){if(f.tipo==="fijo")continue;if(f.obra===id)c+=+f.total||0;else if(!f.obra)sin+=+f.total||0}
    if(sin){const jw=S.jorn.filter(x=>x.fecha>=l.desde&&x.fecha<=l.hasta),tot=jw.reduce((a,x)=>a+(+x.cantidad||0),0),mio=jw.filter(x=>x.obra===id).reduce((a,x)=>a+(+x.cantidad||0),0);if(tot)c+=sin*mio/tot}}
  return c}
function resObra(id){
  const m=S.movs.filter(x=>x.obra===id&&x.tipo!=="pase");
  const cobros=m.filter(x=>x.tipo==="ingreso").reduce((a,x)=>a+valorPesos(x),0);
  const cobrosU=m.filter(x=>x.tipo==="ingreso").reduce((a,x)=>a+(+x.usd||+x.usdRef||0),0);
  const gastos=m.filter(x=>x.tipo==="egreso").reduce((a,x)=>a+valorPesos(x),0);
  const j=S.jorn.filter(x=>x.obra===id);
  const cantJ=j.reduce((a,x)=>a+(+x.cantidad||0),0);
  const costoJ=costoManoObra(id);
  const b=S.bit.filter(x=>x.obra===id);
  return {cobros,cobrosU,gastos,cantJ,costoJ,res:cobros-gastos-costoJ,
    trab:b.filter(x=>x.trabajo==="si").length,parc:b.filter(x=>x.trabajo==="parcial").length,perd:b.filter(x=>x.trabajo==="no").length}
}

/* ---------- navegación ---------- */
const VERSION="20/11 11:30";
const VIEWS=["tarjetas","usd","fede","portada","inicio","cierre","empresa","sueldos","legajo","clientes","cliente","proveedores","proveedor","caja","jornales","bitacora","obras","presupuestos","buscar"];
const VIEWS_ENC=["portada","inicio","caja","cierre","jornales","bitacora"];
const isEnc=()=>S.rol==="encargado";
function cur(){const h=location.hash.slice(1);const ok=isEnc()?VIEWS_ENC:VIEWS;return ok.includes(h)?h:"portada"}
document.querySelectorAll("#tabs button").forEach(b=>b.addEventListener("click",()=>{location.hash=b.dataset.v}));
addEventListener("hashchange",render);
$("#blueBtn").addEventListener("click",()=>openCfg());
$("#srchBtn").addEventListener("click",()=>{location.hash="buscar"});

function render(){
  if(S.auth!=="in"){
    document.body.classList.remove("conMenu");    $("#tabs").style.display="none";$("#menuBtn").style.display="none";cerrarMenu();$("#blueBtn").style.display="none";$("#srchBtn").style.display="none";$("#outBtn").style.display=S.auth==="pending"?"":"none";
    $("#view").innerHTML=vLogin();bindLogin();return}
  const enc=isEnc();
  document.body.classList.add("conMenu");pintarMenu();
  $("#tabs").style.display="";$("#menuBtn").style.display="";$("#outBtn").style.display="";$("#srchBtn").style.display=enc?"none":"";$("#blueBtn").style.display=enc?"none":"";
  document.querySelectorAll("#tabs button").forEach(b=>{b.style.display=enc&&!VIEWS_ENC.includes(b.dataset.v)?"none":"";if(b.dataset.v==="caja")b.textContent=enc?"Gastos":"Caja"});
  $("#tabs").style.gridTemplateColumns=`repeat(${enc?4:7},1fr)`;
  const v=cur();
  document.querySelectorAll("#tabs button").forEach(b=>{if(b.dataset.v===v)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  $("#blueBtn").textContent = "Ajustes";
  pintarHoy();
  $("#blueBtn").title = S.blue? `Dólar blue automático · compra ${fmt(S.blue.compra)} · venta ${fmt(S.blue.venta)} · actualizado ${S.blue.hora}` : "";
  const el=$("#view");
  let top="";
  if(!db||S.err) top=`<div class="banner">${esc(S.err||"Conectando con la base de datos…")}</div>`;
  else if(S.stale) top=`<div class="banner">Todavía no se pudo traer la información. Revisá la conexión; lo que ves puede estar desactualizado.</div>`;
  el.innerHTML = top + ({tarjetas:vTarjetas,usd:vUsd,fede:vFede,cierre:vCierre,portada:vPortada,inicio:enc?vInicioEnc:vInicio,caja:vCaja,jornales:vJornales,bitacora:vBitacora,obras:vObras,presupuestos:vPresupuestos,buscar:vBuscar,empresa:vEmpresa,sueldos:vSueldos,legajo:vLegajo,clientes:vClientes,cliente:vCliente,proveedores:vProveedores,proveedor:vProveedor}[v])();
  bindView(v);
  $("main").scrollTop = render.lastV===v? $("main").scrollTop : 0; render.lastV=v;
}

/* ---------- vistas ---------- */
function vInicio(){
  const mes=hoy().slice(0,7), hoyS=hoy();
  const mm=S.movs.filter(m=>(m.fecha||"").startsWith(mes)&&m.tipo!=="pase");
  const ing=mm.filter(m=>m.tipo==="ingreso").reduce((a,m)=>a+(+m.monto||0),0);
  const egr=mm.filter(m=>m.tipo==="egreso").reduce((a,m)=>a+(+m.monto||0),0);
  const jm=S.jorn.filter(j=>(j.fecha||"").startsWith(mes));
  const jc=jm.reduce((a,j)=>a+(+j.cantidad||0),0);
  const act=sortObras(obrasActivas()).filter(o=>o.estado==="En curso");
  const falt=act.filter(o=>!S.bit.some(b=>b.obra===o.id&&b.fecha===hoyS));
  return importBanner()+`
  <div class="row between"><h2>Hola, ${esc(S.perfil?.nombre||"")}</h2><span class="note">${esc(dlabel(hoyS))}</span></div>
  <section class="card"><div class="row between" style="margin-bottom:10px"><h3>Saldo de cajas</h3><button class="btn sm" data-go="caja">Ver caja</button></div>
    <div class="grid">${CAJAS.map(c=>{const s=saldoCaja(c),su=saldoUsd(c);return `<div class="stat"><div class="lbl">${c}</div>${su?`<div class="num" style="font-size:16px">${fmtU(su)}</div>`:""}<div class="num ${s<0?"neg":""}">${fmt(s)}</div></div>`}).join("")}</div>
    <p class="note" style="margin:10px 0 0">Saldos según lo cargado en la app. ${S.cfg.cajasDesde?"Desde el "+esc(fdate(S.cfg.cajasDesde))+", con su saldo inicial.":""}</p>
  </section>
  <section class="card"><h3 style="margin-bottom:10px">Este mes · ${esc(mlabel(mes))}</h3>
    <div class="grid">
      <div class="stat"><div class="lbl">Entró</div><div class="num pos">${fmt(ing)}</div></div>
      <div class="stat"><div class="lbl">Salió</div><div class="num neg">${fmt(egr)}</div></div>
      <div class="stat"><div class="lbl">Jornales cargados</div><div class="num">${jc}</div></div>
      <div class="stat"><div class="lbl">Costo jornales</div><div class="num">${fmt(jm.reduce((a,j)=>a+(+j.cantidad||0)*(+j.costoUnit||S.cfg.costoJornal),0))}</div></div>
    </div></section>
  <section class="card"><div class="row between" style="margin-bottom:10px"><h3>Bitácora de hoy</h3>${falt.length?`<span class="pill p-warn">Faltan ${falt.length}</span>`:act.length?`<span class="pill p-good">Al día</span>`:""}</div>
    ${act.length?`<div class="list">${act.map(o=>{const b=S.bit.find(x=>x.obra===o.id&&x.fecha===hoyS);
      return `<button class="item" data-bit-new="${esc(o.id)}"><span class="t">${esc(o.nombre)}</span><span class="s">${esc(o.encargado||"Sin encargado")}</span>
      <span class="m">${b?pillTrab(b.trabajo):`<span class="pill p-warn">Falta cargar</span>`}</span></button>`}).join("")}</div>`
      :`<div class="empty">No hay obras en curso. Cargalas en Obras.</div>`}
  </section>
  <section class="card"><div class="row between" style="margin-bottom:10px"><h3>Resultado por obra</h3><button class="btn sm" data-go="obras">Ver obras</button></div>
    ${obrasActivas().length?`<div class="tbl"><table><thead><tr><th>Obra</th><th>Cobrado</th><th>Costos</th><th>Resultado</th></tr></thead><tbody>
    ${sortObras(obrasActivas()).map(o=>{const r=resObra(o.id);return `<tr><td>${esc(o.nombre)}</td><td>${fmt(r.cobros)}</td><td>${fmt(r.gastos+r.costoJ)}</td><td class="${r.res<0?"num neg":"num pos"}" style="font-size:14px">${fmt(r.res)}</td></tr>`}).join("")}
    </tbody></table></div>`:`<div class="empty">Sin obras activas.</div>`}
  </section>
  <div class="fab"><button class="btn pri" data-new="mov">+ Movimiento</button></div>`;
}
function pillTrab(t){return t==="si"?`<span class="pill p-good">Se trabajó</span>`:t==="parcial"?`<span class="pill p-warn">Parcial</span>`:`<span class="pill p-bad">No se trabajó</span>`}

function vCaja(){
  const f=S.filt;
  const meses=[...new Set(S.movs.map(m=>(m.fecha||"").slice(0,7)).filter(Boolean).concat(hoy().slice(0,7)))].sort().reverse();
  let L=S.movs.filter(m=>f.mes==="todo"||(m.fecha||"").startsWith(f.mes));
  const encM=isEnc()?(f.encv||"caja"):null,miC=S.perfil?.caja||"";
  if(encM==="caja")L=L.filter(m=>m.caja===miC||m.cajaDestino===miC);
  else if(encM==="obras"){const ids=new Set(S.obras.map(o=>o.id));L=L.filter(m=>m.tipo==="egreso"&&ids.has(m.obra))}
  else if(f.caja!=="Todas")L=L.filter(m=>m.caja===f.caja||m.cajaDestino===f.caja);
  const nrm=x=>String(x||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const qw=nrm(f.cq).split(/\s+/).filter(Boolean);
  if(qw.length)L=L.filter(m=>{const txt=nrm([m.detalle,m.categoria,obraNombre(m.obra),m.caja,m.cajaDestino,m.rubroPersonal,m.proveedor,fdate(m.fecha),m.monto,fmt(m.monto),m.usd?"usd "+m.usd:""].join(" "));
    return qw.every(w=>txt.includes(w)||txt.replace(/\./g,"").includes(w.replace(/[.$]/g,"")))});
  L=[...L].sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")||(b.creado||0)-(a.creado||0));
  const sel=f.caja!=="Todas"?saldoCaja(f.caja):CAJAS.reduce((a,c)=>a+saldoCaja(c),0);
  const selU=f.caja!=="Todas"?saldoUsd(f.caja):CAJAS.reduce((a,c)=>a+saldoUsd(c),0);
  let html="",last="";
  for(const m of L){
    if(m.fecha!==last){html+=`<div class="day">${esc(dlabel(m.fecha))}</div>`;last=m.fecha}
    const pase=m.tipo==="pase";
    const cRef=encM?miC:f.caja;
    let sign=m.tipo==="ingreso"?1:-1; if(pase&&cRef!=="Todas")sign=m.cajaDestino===cRef?1:-1;
    const cb=m.tipo==="cambio";
    const t=cb?`Cambio US$ ${fmtN(m.usd)} → pesos`:pase?`Pase ${esc(m.caja)} → ${esc(m.cajaDestino)}`:esc(m.detalle||m.categoria||"Movimiento");
    const s=cb?`${esc(m.caja)} · a ${fmt(m.cotizacion||m.monto/m.usd)} por dólar${m.cotizacionBlue?` (blue ${fmt(m.cotizacionBlue)})`:""}${m.detalle?" · "+esc(m.detalle):""}`:pase?esc(m.detalle||""):`${esc(m.caja)} · ${esc(obraNombre(m.obra))}${m.categoria?" · "+esc(m.categoria):""}${m.usd&&!esUsd(m)?" · "+fmtU(m.usd)+(m.cotizacion?" a "+fmt(m.cotizacion):"")+(m.lugarCambio?" ("+esc(m.lugarCambio)+")":""):""}`;
    const tcTxt=m.pago==="tarjeta"?` · 💳 ${esc(m.tarjeta||"Tarjeta")}${+m.cuotas>1?" en "+m.cuotas+" cuotas":""} (no sale de la caja)`:"";
    const montoTxt=m.pago==="tarjeta"?`<span class="note">💳 ${fmt(m.monto)}</span>`:cb?`+ ${fmt(m.monto)}<br><span class="note">− ${fmtU(m.usd)}</span>`:esUsd(m)?`${pase&&cRef==="Todas"?"":sign>0?"+ ":"− "}${fmtU(m.usd)}`:`${pase&&cRef==="Todas"?"":sign>0?"+ ":"− "}${fmt(m.monto)}`;
    html+=`<button class="item" data-edit-mov="${esc(m.id)}"><span class="t">${t}</span><span class="s">${s}${tcTxt}</span>
      <span class="m" style="color:${cb||pase&&cRef==="Todas"?"var(--muted)":sign>0?"var(--good)":"var(--ink)"}">${montoTxt}</span></button>`;
  }
  const enc=isEnc();
  return `<div class="row between"><h2>${enc?"Mis gastos":"Caja"}</h2>${dl&&!enc?`<button class="btn sm" id="expMov">Descargar CSV</button>`:""}</div>
  ${enc?`<div class="seg" style="max-width:420px"><button type="button" data-encv="caja" aria-pressed="${encM==="caja"}">Mi caja (${esc(miC||"sin asignar")})</button><button type="button" data-encv="obras" aria-pressed="${encM==="obras"}">Gastos de mis obras</button></div>
  <p class="note" style="margin:0">${encM==="caja"?`Saldo de tu caja: <b>${fmt(saldoCaja(miC))}</b>. Ves todo lo que entra y sale de tu caja.`:"Todos los gastos de tus obras, de cualquier caja. Solo podés corregir lo que cargaste vos."}</p>`:""}
  <label class="f">Buscar<input id="cajaQ" type="search" value="${esc(f.cq||"")}" placeholder="Ej: contenedor, Dick Haus, adelanto Yoni, 85000, Santa Rosa"></label>
  ${qw.length?`<p class="note" style="margin:0">${L.length} resultado${L.length===1?"":"s"}${L.length?` · salidas ${fmt(L.filter(m=>m.tipo==="egreso").reduce((a,m)=>a+(+m.monto||0),0))} · entradas ${fmt(L.filter(m=>m.tipo==="ingreso").reduce((a,m)=>a+(+m.monto||0),0))}`:""}. Mirando ${f.mes==="todo"?"todos los meses":esc(mlabel(f.mes))}${f.caja!=="Todas"&&!enc?" de la caja "+esc(f.caja):""}.</p>`:""}
  <div class="chips" ${enc?'style="display:none"':""}>${["Todas",...CAJAS].map(c=>`<button class="chip" aria-pressed="${f.caja===c}" data-caja="${c}">${c}</button>`).join("")}</div>
  <div class="row between">
    <label class="f" style="flex:1;min-width:160px">Mes<select id="mesSel"><option value="todo" ${f.mes==="todo"?"selected":""}>Todos</option>${meses.map(m=>`<option value="${m}" ${f.mes===m?"selected":""}>${esc(mlabel(m))}</option>`).join("")}</select></label>
    <div class="stat card" style="padding:8px 12px;${enc?"display:none":""}"><div class="lbl">Saldo ${f.caja==="Todas"?"total":esc(f.caja)}</div><div class="num ${sel<0?"neg":""}">${fmt(sel)}</div>${selU?`<div class="num ${selU<0?"neg":""}" style="font-size:18px">${fmtU(selU)}</div>`:""}</div>
  </div>
  <div class="list">${html||`<div class="empty">${qw.length?"Nada coincide con la búsqueda. Probá con otra palabra o elegí “Todos” en Mes.":`No hay movimientos ${f.mes==="todo"?"":"en "+esc(mlabel(f.mes))}.`} ${qw.length?"":"Tocá “+ Movimiento” para cargar el primero."}</div>`}</div>
  <div class="fab"><button class="btn pri" data-new="mov">${enc?"+ Gasto":"+ Movimiento"}</button></div>`;
}

function vJornales(){
  const mes=S.filt.mes==="todo"?hoy().slice(0,7):S.filt.mes;
  const L=S.jorn.filter(j=>(j.fecha||"").startsWith(mes)).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const por={};for(const j of L){por[j.obra]=(por[j.obra]||0)+(+j.cantidad||0)}
  let html="",last="";
  for(const j of L){if(j.fecha!==last){html+=`<div class="day">${esc(dlabel(j.fecha))}</div>`;last=j.fecha}
    html+=`<button class="item" data-edit-jor="${esc(j.id)}"><span class="t">${esc(obraNombre(j.obra))}</span><span class="s">${esc(j.nota||"")}</span><span class="m">${+j.cantidad} jornal${+j.cantidad===1?"":"es"}</span></button>`}
  const tot=L.reduce((a,j)=>a+(+j.cantidad||0),0);
  return `<h2>Jornales · ${esc(mlabel(mes))}</h2>
  <p class="note" style="margin:0">Se carga cantidad de jornales por obra y por día.${isEnc()?"":` Costo por jornal: ${fmt(S.cfg.costoJornal)}. Los sueldos fijos van aparte, como movimiento de caja.`}</p>
  <section class="card"><h3 style="margin-bottom:8px">Total del mes por obra</h3>
  ${Object.keys(por).length?`<table><tbody>${Object.entries(por).map(([o,c])=>`<tr><td>${esc(obraNombre(o))}</td><td>${c}</td>${isEnc()?"":`<td>${fmt(c*S.cfg.costoJornal)}</td>`}</tr>`).join("")}</tbody>
  <tfoot><tr><td>Total</td><td>${tot}</td>${isEnc()?"":`<td>${fmt(L.reduce((a,j)=>a+(+j.cantidad||0)*(+j.costoUnit||S.cfg.costoJornal),0))}</td>`}</tr></tfoot></table>`:`<div class="empty">Sin jornales cargados este mes.</div>`}</section>
  <div class="list">${html}</div>
  <div class="fab"><button class="btn pri" data-new="jor">+ Jornales</button></div>`;
}

function vBitacora(){
  const ob=S.filt.bobra||"todas";
  let L=[...S.bit].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  if(ob!=="todas")L=L.filter(b=>b.obra===ob);
  L=L.slice(0,200);
  return `<h2>Bitácora de obra</h2>
  <p class="note" style="margin:0">Un registro por obra y por día: si se trabajó y, si no, por qué. Sirve para justificar atrasos.</p>
  <div class="chips"><button class="chip" aria-pressed="${ob==="todas"}" data-bobra="todas">Todas</button>${sortObras(S.obras).map(o=>`<button class="chip" aria-pressed="${ob===o.id}" data-bobra="${esc(o.id)}">${esc(o.nombre)}</button>`).join("")}</div>
  ${ob!=="todas"?(()=>{const r=resObra(ob);return `<div class="grid"><div class="card stat"><div class="lbl">Días trabajados</div><div class="num pos">${r.trab}</div></div><div class="card stat"><div class="lbl">Parciales</div><div class="num">${r.parc}</div></div><div class="card stat"><div class="lbl">Días perdidos</div><div class="num neg">${r.perd}</div></div></div>`})():""}
  <div class="list">${L.map(b=>`<button class="item" data-edit-bit="${esc(b.id)}"><span class="t">${esc(fdate(b.fecha))} · ${esc(obraNombre(b.obra))}</span>
    <span class="s">${b.trabajo!=="si"&&b.motivo?esc(b.motivo)+(b.detalle?" — ":""):""}${esc(b.detalle||"")}${b.jornales?` · ${esc(b.jornales)} en obra`:""}</span><span class="m">${pillTrab(b.trabajo)}</span></button>`).join("")||`<div class="empty">Todavía no hay registros.</div>`}</div>
  <div class="fab"><button class="btn pri" data-new="bit">+ Registro del día</button></div>`;
}

function fechasObra(o){const fs=[...S.movs.filter(m=>m.obra===o.id),...S.jorn.filter(j=>j.obra===o.id),...S.bit.filter(b=>b.obra===o.id)].map(x=>x.fecha).filter(Boolean).sort();
  return {ini:o.fechaInicio||fs[0]||"",fin:o.fechaFin||(o.estado==="Terminada"?fs[fs.length-1]||"":"")}}
function vHistorico(){
  const L=S.obras.filter(o=>o.estado==="Terminada").map(o=>({o,r:resObra(o.id),f:fechasObra(o)})).sort((a,b)=>(b.f.fin||"").localeCompare(a.f.fin||""));
  const T=L.reduce((a,x)=>({c:a.c+x.r.cobros,k:a.k+x.r.gastos+x.r.costoJ,res:a.res+x.r.res}),{c:0,k:0,res:0});
  return `${L.length?`<section class="card"><h3 style="margin-bottom:10px">Total obras terminadas (${L.length})</h3><div class="grid">
    <div class="stat"><div class="lbl">Cobrado</div><div class="num">${fmt(T.c)}</div></div><div class="stat"><div class="lbl">Costos</div><div class="num">${fmt(T.k)}</div></div>
    <div class="stat"><div class="lbl">Resultado</div><div class="num ${T.res<0?"neg":"pos"}">${fmt(T.res)}</div></div><div class="stat"><div class="lbl">Margen</div><div class="num">${T.c?Math.round(T.res/T.c*100)+"%":"—"}</div></div></div></section>`:""}
  ${L.map(({o,r,f})=>{const dias=f.ini&&f.fin?Math.round((new Date(f.fin)-new Date(f.ini))/864e5)+1:null;
    return `<button class="card obra-card" data-edit-obra="${esc(o.id)}">
    <div class="row between" style="width:100%"><div><div style="font-family:var(--display);font-weight:700;font-size:17px">${esc(o.nombre)}</div>
    <div class="note">${o.cliente?esc(o.cliente)+" · ":""}${f.ini?esc(fdate(f.ini)):"?"} al ${f.fin?esc(fdate(f.fin)):"?"}${dias?` · ${dias} días`:""}</div></div><span class="pill p-mut">Terminada</span></div>
    <div class="mini" style="width:100%"><div>Cobrado<b>${fmt(r.cobros)}</b></div><div>Costos<b>${fmt(r.gastos+r.costoJ)}</b></div><div>Resultado<b style="color:${r.res<0?"var(--bad)":"var(--good)"}">${fmt(r.res)}</b></div><div>Margen<b>${r.cobros?Math.round(r.res/r.cobros*100)+"%":"—"}</b></div></div>
    <div class="note">${r.cantJ} jornales · ${r.trab} días trabajados · ${r.perd} perdidos${o.contratoUsd?" · Contrato "+fmtU(o.contratoUsd):""}</div></button>`}).join("")||`<div class="card empty">Todavía no hay obras terminadas. Cuando termines una, entrá a la obra y cambiá el estado a “Terminada”: queda guardada acá con su resultado final.</div>`}`;
}
function vObras(){
  const hist=S.filt.oh==="hist";
  const L=sortObras(S.obras.filter(o=>o.estado!=="Terminada"));
  const nH=S.obras.filter(o=>o.estado==="Terminada").length;
  return `<div class="row between"><h2>Obras</h2>${dl?`<button class="btn sm" id="expRes">Descargar resultados</button>`:""}</div>
  <div class="seg" style="max-width:420px"><button type="button" data-oh="act" aria-pressed="${!hist}">En curso (${L.length})</button><button type="button" data-oh="hist" aria-pressed="${hist}">Histórico (${nH})</button></div>
  ${hist?vHistorico():`<p class="note" style="margin:0">Tocá una obra para abrir su legajo: números, archivos (presupuestos, planos, contrato, fotos) y bitácora. Resultado = cobrado − gastos de la obra − jornales × costo. Las obras se cotizan en dólar blue y cada cobro se pasa a pesos con la cotización del día.</p>
  ${L.map(o=>{const r=resObra(o.id);const pct=o.contratoUsd&&r.cobrosU?Math.min(100,Math.round(r.cobrosU/o.contratoUsd*100)):null;
   return `<button class="card obra-card" data-edit-obra="${esc(o.id)}">
    <div class="row between" style="width:100%"><div><div style="font-family:var(--display);font-weight:700;font-size:17px">${esc(o.nombre)}</div><div class="note">${esc(o.encargado||"Sin encargado")}${o.contratoUsd?" · Contrato "+fmtU(o.contratoUsd):""}</div></div>
    <span class="pill ${o.estado==="En curso"?"p-acc":o.estado==="Terminada"?"p-mut":"p-warn"}">${esc(o.estado||"En curso")}</span></div>
    <div class="mini" style="width:100%"><div>Cobrado<b>${fmt(r.cobros)}</b></div><div>Gastos<b>${fmt(r.gastos)}</b></div><div>Jornales<b>${r.cantJ} · ${fmt(r.costoJ)}</b></div><div>Resultado<b style="color:${r.res<0?"var(--bad)":"var(--good)"}">${fmt(r.res)}</b></div></div>
    <div class="note">Bitácora: ${r.trab} días trabajados · ${r.parc} parciales · ${r.perd} perdidos${pct!==null?` · Cobrado ${pct}% del contrato`:""}</div>
   </button>`}).join("")||`<div class="card empty">No hay obras en curso.</div>`}`}
  <div class="fab"><button class="btn pri" data-new="obra">+ Obra</button></div>`;
}

function vPresupuestosLista(){
  const c=S.cot||(S.cot={pared:"",revoque:"",platea:"",bomba:true,fibra:"",extra:[]});
  const L=[...S.pres].sort((a,b)=>(b.numero||0)-(a.numero||0));
  return `<div class="row between"><h3>Presupuestos guardados</h3><button class="btn sm" data-new="pres">+ Nuevo a mano</button></div>
  ${isAdmin()?`<section class="card" style="border-color:var(--gold)"><div class="row between" style="gap:12px"><div><h3>🎤 Dictar presupuesto</h3><p class="note" style="margin:4px 0 0">Contale qué hay que presupuestar (medidas, materiales, trabajos, cliente) y la IA lo arma con tus precios. Después lo revisás y lo mandás.</p></div>
    <button class="btn pri" id="dictarBtn">Dictar</button></div></section>`:""}
  <div class="list">${L.map(p=>{const t=presTot(p);return `<button class="item" data-edit-pres="${esc(p.id)}"><span class="t">N° ${esc(p.numero)} · ${esc(p.cliente||"Sin cliente")}</span>
    <span class="s">${esc(fdate(p.fecha))}${p.obra?" · "+esc(p.obra):""} · ${presPill(p.estado)}</span><span class="m">${fmt(t.total)}${t.usd?`<br><span class="note">${fmtU(t.usd)}</span>`:""}</span></button>`}).join("")||`<div class="empty">Todavía no hay presupuestos. Tocá “+ Nuevo presupuesto”.</div>`}</div>
  <h3 style="margin-top:8px">Cálculo rápido de mano de obra y hormigón</h3>
  <p class="note" style="margin:0">Cargá los metros y calcula jornales y hormigón con los rendimientos de la empresa. Con “Pasar a un presupuesto” se agregan como ítems.</p>
  <section class="card" style="display:flex;flex-direction:column;gap:10px">
    <div class="two">
      <label class="f">Pared de placa (m²)<input id="c_pared" inputmode="decimal" value="${esc(c.pared)}" placeholder="0"></label>
      <label class="f">Revoque (m²)<input id="c_revoque" inputmode="decimal" value="${esc(c.revoque)}" placeholder="0"></label>
      <label class="f">Hormigón H21 (m³)<input id="c_platea" inputmode="decimal" value="${esc(c.platea)}" placeholder="0"></label>
      <label class="f">Macrofibra (bolsas 4 kg)<input id="c_fibra" inputmode="decimal" value="${esc(c.fibra)}" placeholder="0"></label>
    </div>
    <label class="row" style="font-size:14px;font-weight:600"><input type="checkbox" id="c_bomba" ${c.bomba?"checked":""}> Con bomba para el hormigón</label>
  </section>
  <section class="card" id="cotRes">${cotTabla()}</section>
  <div class="row"><button class="btn" id="toPres">Pasar a un presupuesto</button><button class="btn" id="openCfg2">Precios y rendimientos</button><button class="btn" id="copyCot">Copiar cálculo</button></div>`;
}
function cotCalc(){
  const c=S.cot,p=S.cfg.precios,r=S.cfg.rend,cj=precioJ();
  const pared=num(c.pared),rev=num(c.revoque),m3=num(c.platea),fib=num(c.fibra);
  const rows=[];
  if(pared){const j=Math.ceil(pared/r.pared);rows.push(["Levantar pared de placa",`${pared} m² ÷ ${r.pared} m²/jornal = ${j} jornales`,j*cj,j,pared,"m²"])}
  if(rev){const j=Math.ceil(rev/r.revoque);rows.push(["Revoque",`${rev} m² ÷ ${r.revoque} m²/jornal = ${j} jornales`,j*cj,j,rev,"m²"])}
  if(m3){rows.push(["Hormigón H21",`${m3} m³ × ${fmt(p.hormigon)}`,m3*p.hormigon]);
    if(c.bomba)rows.push(["Bomba",`${fmt(p.bombaFija)} + ${m3} m³ × ${fmt(p.bombaM3)}`,p.bombaFija+m3*p.bombaM3]);
    rows.push(["Llenado de platea",`${r.platea} jornales`,r.platea*cj,r.platea,1,"gl"])}
  if(fib)rows.push(["Macrofibra",`${fib} bolsas × ${fmt(p.macrofibra)}`,fib*p.macrofibra]);
  return rows;
}
const precioJ=()=>num(S.cfg.precioJornal)||num(S.cfg.costoJornal);
function ganInterna(jornales,cobrado){const pj=precioJ(),cj=num(S.cfg.costoJornal);
  if(!jornales)return "";if(cobrado==null)cobrado=jornales*pj;
  return `<div class="card" style="background:var(--soft);margin-top:8px"><b>Solo para la empresa</b> <span class="note">(no sale en lo que se manda al cliente)</span>
    <table><tbody><tr><td>${jornales} jornales × lo que nos cuesta ${fmt(cj)}</td><td>${fmt(jornales*cj)}</td></tr><tr><td>Mano de obra cobrada al cliente</td><td>${fmt(cobrado)}</td></tr></tbody>
    <tfoot><tr><td>Ganancia en jornales</td><td>${fmt(cobrado-jornales*cj)}</td></tr></tfoot></table>
    ${num(S.cfg.precioJornal)?"":`<p class="note" style="margin:6px 0 0;color:var(--warn)">Falta cargar el precio del jornal al cliente en “Precios y rendimientos”.</p>`}</div>`}
function cotTabla(){
  const rows=cotCalc(),tot=rows.reduce((a,r)=>a+r[2],0),cot=S.cfg.cotizacion,jt=rows.reduce((a,r)=>a+(r[3]||0),0);
  if(!rows.length)return `<div class="empty">Cargá algún metro arriba para ver el cálculo.</div>`;
  return `<div class="tbl"><table><thead><tr><th>Ítem</th><th>Cálculo</th><th>Subtotal</th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td>${esc(r[0])}</td><td class="note" style="text-align:right">${esc(r[1])}</td><td>${fmt(r[2])}</td></tr>`).join("")}</tbody>
  <tfoot><tr><td>Total al cliente</td><td></td><td>${fmt(tot)}</td></tr>${cot?`<tr><td>En dólar blue</td><td class="note" style="text-align:right">a ${fmt(cot)}</td><td>${fmtU(tot/cot)}</td></tr>`:""}</tfoot></table></div>
  <p class="note" style="margin:8px 0 0">Mano de obra al precio del jornal al cliente; hormigón, bomba y fibra al costo. No incluye materiales de panel.</p>${ganInterna(jt)}`;
}

/* ---------- empresa: gastos e inventario ---------- */
const EMP_IDS=["_empresa","_oficina","_sueldos","_federico","_numa"];
const EST_INV=["Bueno","Regular","Para reparar","Roto","Perdido"];
const ubicNombre=u=>!u||u==="galpon"?"Depósito / Galpón":u==="persona"?"Prestada":obraNombre(u);
const esVeh=i=>i&&i.clase==="vehiculo";
const herrs=()=>S.inv.filter(i=>!esVeh(i));
const vehs=()=>S.inv.filter(esVeh).sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||""));
const RUBROS=[["Materiales",/^materiales$/i],["Combustible",/combustible|gasoil|nafta/i],["Viáticos y peajes",/vi[aá]tic|peaje/i],["Mantenimiento de vehículos",/mantenimiento veh/i],
  ["Herramientas y equipos",/herramient/i],["Sueldos y jornales",/^sueldos|adelanto/i],["Comida de empleados",/comida empleados/i],["Vivienda de empleados",/vivienda empleados/i],["Gastos de empleados",/gastos de empleados/i],["Oficina y empresa",/oficina|alquiler|gastos de empresa/i],["Retiros",/retiros|personal federico/i]];
function rubroDe(m){const c=m.categoria||"";
  if(/gastos de empleados/i.test(c)){const t=typeof tipoGastoEmp==="function"?tipoGastoEmp(m):null;return t==="vivienda"?"Vivienda de empleados":t==="otros"?"Gastos de empleados (otros)":"Comida de empleados"}
  for(const [n,re] of RUBROS)if(re.test(c))return n;if(/vi[aá]tic|peaje/i.test(m.detalle||""))return "Viáticos y peajes";
  if(/^pagos$/i.test(c))return "Pagos a terceros (máquinas, subcontratos)";if(/tarjeta/i.test(c))return "Tarjeta de crédito";if(/a cobrar/i.test(c))return "A cobrar";return "Varios"}
function movsDeVeh(v){const n=(v.nombre||"").toLowerCase().split(/\s+/)[0];
  return S.movs.filter(m=>m.tipo==="egreso"&&(m.vehiculo===v.id||(!m.vehiculo&&n.length>2&&(m.detalle||"").toLowerCase().includes(n))))}
function vEmpresa(){
  const tab=S.filt.emp||"resumen";
  const tabs=[["resumen","Resumen"],["jornal","Costo del jornal"],["gastos","Gastos de empresa"],["inv",`Herramientas (${herrs().length})`],["veh",`Vehículos (${vehs().length})`]];
  return `<h2>Empresa</h2>
  <div class="seg" style="max-width:640px">${tabs.map(([k,l])=>`<button type="button" data-emp="${k}" aria-pressed="${tab===k}">${l}</button>`).join("")}</div>
  ${tab==="jornal"?vCostoJornal():tab==="gastos"?vEmpGastos():tab==="inv"?vInventario():tab==="veh"?vVehiculos():vEmpResumen()}`;
}
function selMes(){const f=S.filt;const meses=[...new Set(S.movs.map(m=>(m.fecha||"").slice(0,7)).filter(Boolean).concat(hoy().slice(0,7)))].sort().reverse();
  return `<label class="f" style="flex:1;min-width:160px">Mes<select id="mesSel"><option value="todo" ${f.mes==="todo"?"selected":""}>Todos</option>${meses.map(m=>`<option value="${m}" ${f.mes===m?"selected":""}>${esc(mlabel(m))}</option>`).join("")}</select></label>`}
function vEmpResumen(){
  const mes=S.filt.mes,enMes=m=>mes==="todo"||(m.fecha||"").startsWith(mes);
  const eg=S.movs.filter(m=>m.tipo==="egreso"&&enMes(m)),ing=S.movs.filter(m=>m.tipo==="ingreso"&&enMes(m)&&!/cambio/i.test(m.categoria||""));
  const totE=eg.reduce((a,m)=>a+(+m.monto||0),0),totI=ing.reduce((a,m)=>a+(+m.monto||0),0);
  const jm=S.jorn.filter(j=>mes==="todo"||(j.fecha||"").startsWith(mes)),jc=jm.reduce((a,j)=>a+(+j.cantidad||0),0);
  const porR={};for(const m of eg){const r=rubroDe(m);porR[r]=(porR[r]||0)+(+m.monto||0)}
  const vH=herrs().reduce((a,i)=>a+(+i.valor||0)*(+i.cantidad||1),0),vV=vehs().reduce((a,i)=>a+(+i.valor||0),0);
  const ubic={};for(const i of herrs()){const u=i.ubic||"galpon";ubic[u]=(ubic[u]||0)+(+i.cantidad||1)}
  const veh=vehs().map(v=>({v,t:movsDeVeh(v).filter(enMes).reduce((a,m)=>a+(+m.monto||0),0)}));
  const act=sortObras(obrasActivas()).filter(o=>o.estado==="En curso");
  return `<div class="row between">${selMes()}</div>
  <div class="grid"><div class="card stat"><div class="lbl">Entró</div><div class="num" style="color:var(--good)">${fmt(totI)}</div></div>
    <div class="card stat"><div class="lbl">Salió</div><div class="num neg">${fmt(totE)}</div></div>
    <div class="card stat"><div class="lbl">Jornales</div><div class="num">${jc}</div></div>
    <div class="card stat"><div class="lbl">Capital (herramientas + vehículos)</div><div class="num">${fmt(vH+vV)}</div></div></div>
  <section class="card"><h3 style="margin-bottom:4px">¿En qué se fue la plata?</h3><p class="note" style="margin:0 0 8px">Tocá un rubro para ver cada carga.</p>${Object.keys(porR).length?`<div class="list">${Object.entries(porR).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{const ab=S.filt.rubro===k;const L=ab?eg.filter(m=>rubroDe(m)===k).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")||(+b.monto)-(+a.monto)):[];
    return `<button class="item" data-rubro="${esc(k)}" aria-expanded="${ab}"><span class="t">${ab?"▾":"▸"} ${esc(k)}</span><span class="s">${totE?Math.round(v/totE*100):0}% de lo que salió${ab?` · ${L.length} cargas`:""}</span><span class="m">${fmt(v)}</span></button>
    ${ab?`<div style="margin:0 0 8px 14px;border-left:3px solid var(--gold);padding-left:8px" class="list">${L.map(m=>`<button class="item" data-edit-mov="${esc(m.id)}"><span class="t">${esc(m.detalle||m.categoria)}</span><span class="s">${esc(fdate(m.fecha))} · ${esc(obraNombre(m.obra))} · Caja ${esc(m.caja)}</span><span class="m">${fmt(m.monto)}</span></button>`).join("")}</div>`:""}`}).join("")}</div>`:`<div class="empty">Sin gastos en este período.</div>`}</section>
  <section class="card"><div class="row between" style="margin-bottom:8px"><h3>Vehículos</h3><button class="btn sm" data-emp="veh">Ver</button></div>
    ${veh.length?`<table><tbody>${veh.map(x=>`<tr><td>${esc(x.v.nombre)}${x.v.patente?` <span class="note">${esc(x.v.patente)}</span>`:""}</td><td>${fmt(x.t)}</td></tr>`).join("")}</tbody></table>`:`<div class="empty">Cargá los vehículos en la pestaña Vehículos.</div>`}</section>
  <section class="card"><div class="row between" style="margin-bottom:8px"><h3>Herramientas: dónde están</h3><button class="btn sm" data-emp="inv">Ver</button></div>
    ${Object.keys(ubic).length?`<table><tbody>${Object.entries(ubic).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(ubicNombre(k))}</td><td>${v} herramientas</td></tr>`).join("")}</tbody></table>`:`<div class="empty">Todavía no hay herramientas cargadas.</div>`}</section>
  <section class="card"><div class="row between" style="margin-bottom:8px"><h3>Obras en curso</h3><button class="btn sm" data-go="obras">Ver</button></div>
    <table><tbody>${act.map(o=>{const r=resObra(o.id);return `<tr><td>${esc(o.nombre)}</td><td>${fmt(r.res)}</td></tr>`}).join("")}</tbody></table>
    <p class="note" style="margin:6px 0 0">Resultado = cobrado − gastos − jornales, desde el inicio de cada obra.</p></section>`;
}
/* costo real del jornal: lo que se paga + lo que cuesta mantener a la gente */
function tipoGastoEmp(m){const c=m.categoria||"",d=(m.detalle||"").toLowerCase();
  if(/comida empleados/i.test(c))return "comida";if(/vivienda empleados/i.test(c))return "vivienda";
  if(/vi[aá]tic/i.test(c))return /comida|almuerzo|cena|bebida/.test(d)?"comida":"viaticos";
  if(/gastos de empleados/i.test(c)){if(/aloj|alquiler|vivienda|casa|luz|gas |garrafa|agua|epec|cooperativa/.test(d))return "vivienda";
    if(/farmacia|medic/.test(d))return "otros";return "comida"}
  return null}
function vCostoJornal(){
  const mes=S.filt.mes==="todo"?"todo":S.filt.mes,enMes=x=>mes==="todo"||(x.fecha||"").startsWith(mes);
  const eg=S.movs.filter(m=>m.tipo==="egreso"&&enMes(m));
  const sueldos=eg.filter(m=>m.obra==="_jornales"||/^sueldos$|adelanto/i.test(m.categoria||"")&&m.obra!=="_sueldos").reduce((a,m)=>a+(+m.monto||0),0);
  const g={comida:0,vivienda:0,viaticos:0,otros:0},det={comida:[],vivienda:[],viaticos:[],otros:[]};
  for(const m of eg){const t=tipoGastoEmp(m);if(t){g[t]+=+m.monto||0;det[t].push(m)}}
  const jor=S.jorn.filter(enMes).reduce((a,j)=>a+(+j.cantidad||0),0);
  const extra=g.comida+g.vivienda+g.viaticos+g.otros,total=sueldos+extra;
  const pj=jor?total/jor:0,cfg=num(S.cfg.costoJornal),pc=num(S.cfg.precioJornal);
  const fijos=eg.filter(m=>m.obra==="_sueldos").reduce((a,m)=>a+(+m.monto||0),0),ofi=eg.filter(m=>m.obra==="_oficina").reduce((a,m)=>a+(+m.monto||0),0);
  const est=fijos+ofi,pe=jor?est/jor:0;
  const porObra={};for(const m of [...det.comida,...det.vivienda,...det.viaticos,...det.otros]){const k=obraNombre(m.obra);porObra[k]=(porObra[k]||0)+(+m.monto||0)}
  const fila=(t,v)=>`<tr><td>${t}</td><td>${fmt(v)}</td><td class="note" style="text-align:right">${jor?fmt(v/jor)+" /jornal":""}</td></tr>`;
  return `<div class="row between">${selMes()}</div>
  <p class="note" style="margin:0">Todo lo que cuesta la gente de obra además del sueldo: comida, vivienda (alquiler, luz, gas) y viáticos. Sale de lo que ya cargás en las cajas; no hay que cargar nada aparte.</p>
  <section class="card"><table><tbody>${fila("Sueldos y adelantos de jornaleros",sueldos)}${fila("Comida de empleados",g.comida)}${fila("Vivienda (alquiler, luz, gas)",g.vivienda)}${fila("Viáticos y peajes",g.viaticos)}${g.otros?fila("Otros (farmacia, etc.)",g.otros):""}</tbody>
    <tfoot><tr><td>Total</td><td>${fmt(total)}</td><td></td></tr></tfoot></table>
    <p style="margin:10px 0 0">${jor} jornales cargados → <b>costo real por jornal: ${jor?fmt(pj):"—"}</b></p>
    ${jor&&cfg?`<p class="note" style="margin:4px 0 0">En la configuración figura ${fmt(cfg)} como costo del jornal.</p>`:""}</section>
  <section class="card"><h3 style="margin-bottom:6px">Estructura: sueldos fijos y oficina</h3>
    <p class="note" style="margin:0 0 8px">Los sueldos fijos (administración, encargados) y la oficina no son de una obra, pero se pagan gracias a los jornales que se cobran. Repartidos entre los jornales del período:</p>
    <table><tbody>${fila("Sueldos fijos",fijos)}${fila("Oficina",ofi)}</tbody><tfoot><tr><td>Estructura</td><td>${fmt(est)}</td><td class="note" style="text-align:right">${jor?fmt(pe)+" /jornal":""}</td></tr></tfoot></table>
    ${jor?`<p style="margin:10px 0 0">Costo completo por jornal (gente + estructura): <b>${fmt(pj+pe)}</b>${pc?` · precio al cliente ${fmt(pc)} → ganancia neta por jornal <b style="color:${pc-pj-pe<0?"var(--bad)":"var(--good)"}">${fmt(pc-pj-pe)}</b>`:""}</p>`:""}</section>
  ${Object.keys(porObra).length?`<section class="card"><h3 style="margin-bottom:8px">Comida, vivienda y viáticos por obra</h3><table><tbody>${Object.entries(porObra).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${fmt(v)}</td></tr>`).join("")}</tbody></table></section>`:""}
  ${["comida","vivienda","viaticos"].map(k=>det[k].length?`<section class="card"><h3 style="margin-bottom:8px">${{comida:"Comida",vivienda:"Vivienda",viaticos:"Viáticos"}[k]} · detalle</h3><div class="list">${det[k].sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")).map(m=>`<button class="item" data-edit-mov="${esc(m.id)}"><span class="t">${esc(m.detalle||m.categoria)}</span><span class="s">${esc(fdate(m.fecha))} · ${esc(obraNombre(m.obra))} · Caja ${esc(m.caja)}</span><span class="m">${fmt(m.monto)}</span></button>`).join("")}</div></section>`:"").join("")}
  <p class="note" style="margin:0">Para que quede bien separado, al cargar elegí la categoría “Comida empleados” o “Vivienda empleados”. Lo que está como “Gastos de empleados” se reparte solo según el detalle (alojamiento, luz y gas van a vivienda; el resto a comida).</p>`;
}
function vVehiculos(){
  const mes=S.filt.mes,enMes=m=>mes==="todo"||(m.fecha||"").startsWith(mes);
  const V=vehs();
  const mov=S.movs.filter(m=>m.tipo==="egreso"&&enMes(m));
  const comb=mov.filter(m=>rubroDe(m)==="Combustible"),viat=mov.filter(m=>rubroDe(m)==="Viáticos y peajes"),mant=mov.filter(m=>rubroDe(m)==="Mantenimiento de vehículos");
  const sum=a=>a.reduce((x,m)=>x+(+m.monto||0),0);
  const porObra={};for(const m of [...comb,...viat]){const k=obraNombre(m.obra);porObra[k]=(porObra[k]||0)+(+m.monto||0)}
  return `<div class="row between">${selMes()}</div>
  <div class="grid"><div class="card stat"><div class="lbl">Combustible</div><div class="num">${fmt(sum(comb))}</div></div>
    <div class="card stat"><div class="lbl">Viáticos y peajes</div><div class="num">${fmt(sum(viat))}</div></div>
    <div class="card stat"><div class="lbl">Mantenimiento</div><div class="num">${fmt(sum(mant))}</div></div></div>
  <div class="list">${V.map(v=>{const L=movsDeVeh(v).filter(enMes);const c=sum(L.filter(m=>rubroDe(m)==="Combustible")),mt=sum(L.filter(m=>rubroDe(m)!=="Combustible"));
    return `<button class="item" data-edit-veh="${esc(v.id)}"><span class="t">${esc(v.nombre)}${v.patente?" · "+esc(v.patente):""}</span><span class="s">Combustible ${fmt(c)} · Mantenimiento y otros ${fmt(mt)}${v.responsable?" · "+esc(v.responsable):""}</span><span class="m">${fmt(c+mt)}</span></button>`}).join("")||`<div class="empty">Todavía no hay vehículos. Tocá “+ Vehículo”.</div>`}</div>
  ${Object.keys(porObra).length?`<section class="card"><h3 style="margin-bottom:8px">Combustible y viáticos por obra</h3><table><tbody>${Object.entries(porObra).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${fmt(v)}</td></tr>`).join("")}</tbody></table></section>`:""}
  <p class="note" style="margin:0">Al cargar un gasto de combustible o mantenimiento elegí el vehículo. Si no lo elegís, se lo asigna igual cuando el detalle dice su nombre (ej: “Combustible Amarok”).</p>
  <div class="fab"><button class="btn pri" data-new-veh>+ Vehículo</button></div>`;
}
function openVeh(v){
  const e=!!v;v=v||{nombre:"",clase:"vehiculo"};
  const L=e?movsDeVeh(v).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")):[];
  openSheet(`<form id="fv" style="display:flex;flex-direction:column;gap:12px">${sheetHead(e?v.nombre:"Nuevo vehículo")}
    <div class="two"><label class="f">Nombre<input id="v_nom" value="${esc(v.nombre)}" required placeholder="Ej: Amarok"></label><label class="f">Patente<input id="v_pat" value="${esc(v.patente||"")}"></label>
    <label class="f">Marca, modelo y año<input id="v_mod" value="${esc(v.marca||"")}"></label><label class="f">Quién la usa<input id="v_resp" value="${esc(v.responsable||"")}"></label>
    <label class="f">Valor $<input id="v_val" inputmode="decimal" value="${esc(v.valor||"")}"></label><label class="f">Vence el seguro<input type="date" id="v_seg" value="${esc(v.seguro||"")}"></label>
    <label class="f">Último service (km)<input id="v_km" inputmode="numeric" value="${esc(v.kmService||"")}"></label><label class="f">VTV vence<input type="date" id="v_vtv" value="${esc(v.vtv||"")}"></label></div>
    <label class="f">Notas<textarea id="v_not">${esc(v.notas||"")}</textarea></label>
    ${L.length?`<div><h3 style="margin-bottom:6px">Gastos de este vehículo · ${fmt(L.reduce((a,m)=>a+(+m.monto||0),0))}</h3><div class="list">${L.slice(0,40).map(m=>`<div class="item" style="cursor:default"><span class="t">${esc(m.detalle||m.categoria)}</span><span class="s">${esc(fdate(m.fecha))} · ${esc(m.categoria||"")} · Caja ${esc(m.caja)}</span><span class="m">${fmt(m.monto)}</span></div>`).join("")}</div></div>`:""}
    ${footBtns(e)}</form>`,sh=>{
    wireCommon(sh,"inventario",v.id);
    $("#fv").onsubmit=async ev=>{ev.preventDefault();const n=$("#v_nom").value.trim();if(!n)return toast("Falta el nombre");
      const d={clase:"vehiculo",nombre:n,patente:$("#v_pat").value.trim(),marca:$("#v_mod").value.trim(),responsable:$("#v_resp").value.trim(),valor:num($("#v_val").value),
        seguro:$("#v_seg").value,vtv:$("#v_vtv").value,kmService:num($("#v_km").value)||"",notas:$("#v_not").value.trim(),cantidad:1,estado:"Bueno",ubic:"galpon",creado:v.creado};
      if(await save("inventario",v.id,d)){closeSheet();toast("Guardado")}};
  });
}
function vEmpGastos(){
  const f=S.filt;const mes=f.mes==="todo"?"todo":f.mes;
  const meses=[...new Set(S.movs.map(m=>(m.fecha||"").slice(0,7)).filter(Boolean).concat(hoy().slice(0,7)))].sort().reverse();
  const L=S.movs.filter(m=>m.tipo==="egreso"&&EMP_IDS.includes(m.obra)&&(mes==="todo"||(m.fecha||"").startsWith(mes))).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||""));
  const tot=L.reduce((a,m)=>a+(+m.monto||0),0);
  const porT={},porC={};for(const m of L){porT[m.obra]=(porT[m.obra]||0)+(+m.monto||0);const c=m.categoria||"Varios";porC[c]=(porC[c]||0)+(+m.monto||0)}
  let html="",last="";for(const m of L){if(m.fecha!==last){html+=`<div class="day">${esc(dlabel(m.fecha))}</div>`;last=m.fecha}
    html+=`<button class="item" data-edit-mov="${esc(m.id)}"><span class="t">${esc(m.detalle||m.categoria)}</span><span class="s">${esc(obraNombre(m.obra))} · ${esc(m.categoria||"")} · Caja ${esc(m.caja)}</span><span class="m">− ${fmt(m.monto)}</span></button>`}
  return `<p class="note" style="margin:0">Gastos que no son de una obra: galpón, herramientas que quedan en la empresa, oficina, sueldos fijos y gastos personales de Federico. Se cargan como un movimiento de caja eligiendo en “Obra” una opción de “Sin obra”.</p>
  <div class="row between"><label class="f" style="flex:1;min-width:160px">Mes<select id="mesSel"><option value="todo" ${mes==="todo"?"selected":""}>Todos</option>${meses.map(m=>`<option value="${m}" ${mes===m?"selected":""}>${esc(mlabel(m))}</option>`).join("")}</select></label>
  <div class="stat card" style="padding:8px 12px"><div class="lbl">Total</div><div class="num neg">${fmt(tot)}</div></div></div>
  ${L.length?`<section class="card"><h3 style="margin-bottom:8px">Por tipo</h3><table><tbody>${Object.entries(porT).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(obraNombre(k))}</td><td>${fmt(v)}</td></tr>`).join("")}</tbody></table>
  <h3 style="margin:14px 0 8px">Por categoría</h3><table><tbody>${Object.entries(porC).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${fmt(v)}</td></tr>`).join("")}</tbody></table></section>`:""}
  <div class="list">${html||`<div class="empty">No hay gastos de empresa ${mes==="todo"?"":"en "+esc(mlabel(mes))}.</div>`}</div>
  <div class="fab"><button class="btn pri" data-new-emp>+ Gasto de empresa</button></div>`;
}
function vInventario(){
  const u=S.filt.ubic||"todas";
  const ubics=["galpon",...new Set(herrs().map(i=>i.ubic).filter(x=>x&&x!=="galpon"))];
  let L=herrs().sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||""));if(u!=="todas")L=L.filter(i=>(i.ubic||"galpon")===u);
  const valor=herrs().reduce((a,i)=>a+(+i.valor||0)*(+i.cantidad||1),0);
  const malos=herrs().filter(i=>["Para reparar","Roto","Perdido"].includes(i.estado)).length;
  const linked=new Set(S.inv.map(i=>i.movId).filter(Boolean));
  const pend=S.movs.filter(m=>m.tipo==="egreso"&&/herramient/i.test(m.categoria||"")&&!linked.has(m.id)).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")).slice(0,15);
  return `<div class="grid"><div class="card stat"><div class="lbl">Herramientas</div><div class="num">${herrs().reduce((a,i)=>a+(+i.cantidad||1),0)}</div></div>
    <div class="card stat"><div class="lbl">Valor de compra</div><div class="num">${fmt(valor)}</div></div>
    <div class="card stat"><div class="lbl">A reparar / rotas / perdidas</div><div class="num ${malos?"neg":""}">${malos}</div></div></div>
  <div class="row between"><div class="chips" style="flex:1"><button class="chip" data-ubic="todas" aria-pressed="${u==="todas"}">Todas</button>${ubics.map(x=>`<button class="chip" data-ubic="${esc(x)}" aria-pressed="${u===x}">${esc(ubicNombre(x))}</button>`).join("")}</div>${dl?`<button class="btn sm" id="expInv">Descargar</button>`:""}</div>
  <div class="list">${L.map(i=>`<button class="item" data-edit-inv="${esc(i.id)}"><span class="t">${esc(i.nombre)}${+i.cantidad>1?` ×${+i.cantidad}`:""}</span>
    <span class="s">${esc(ubicNombre(i.ubic))}${i.responsable?" · "+esc(i.responsable):""}${i.marca?" · "+esc(i.marca):""}</span>
    <span class="m"><span class="pill ${i.estado==="Bueno"||!i.estado?"p-good":i.estado==="Regular"?"p-warn":"p-bad"}">${esc(i.estado||"Bueno")}</span></span></button>`).join("")||`<div class="empty">Todavía no hay herramientas cargadas.</div>`}</div>
  ${pend.length?`<section class="card"><h3 style="margin-bottom:6px">Compras de herramientas para inventariar</h3><p class="note" style="margin:0 0 8px">Salen de la caja (categoría Herramientas y equipos). Tocá una para pasarla al inventario.</p>
    <div class="list">${pend.map(m=>`<button class="item" data-inv-from="${esc(m.id)}"><span class="t">${esc(m.detalle||"Herramienta")}</span><span class="s">${esc(fdate(m.fecha))} · ${esc(obraNombre(m.obra))}</span><span class="m">${fmt(m.monto)}</span></button>`).join("")}</div></section>`:""}
  <div class="fab"><button class="btn pri" data-new-inv>+ Herramienta</button></div>`;
}
function openInv(it,preset){
  const e=!!it; it=it||{nombre:"",cantidad:1,estado:"Bueno",ubic:"galpon",fechaCompra:hoy(),...(preset||{})};
  const ubOpts=`<option value="galpon" ${!it.ubic||it.ubic==="galpon"?"selected":""}>Depósito / Galpón</option><option value="persona" ${it.ubic==="persona"?"selected":""}>Prestada a una persona</option><optgroup label="Obras">${sortObras(S.obras).filter(o=>o.estado!=="Terminada"||o.id===it.ubic).map(o=>`<option value="${esc(o.id)}" ${it.ubic===o.id?"selected":""}>${esc(o.nombre)}</option>`).join("")}</optgroup>`;
  const hist=(it.historial||[]).slice().reverse();
  openSheet(`<form id="fi" style="display:flex;flex-direction:column;gap:12px">${sheetHead(e?it.nombre:"Nueva herramienta")}
    <label class="f">Herramienta<input id="i_nom" value="${esc(it.nombre)}" required placeholder="Ej: Soldadora inverter 200A"></label>
    <div class="two"><label class="f">Cantidad<input id="i_cant" inputmode="numeric" value="${esc(it.cantidad||1)}"></label>
    <label class="f">Estado<select id="i_est">${EST_INV.map(x=>`<option ${it.estado===x?"selected":""}>${x}</option>`).join("")}</select></label>
    <label class="f">Dónde está<select id="i_ubic">${ubOpts}</select></label><label class="f">Responsable<input id="i_resp" value="${esc(it.responsable||"")}" placeholder="Quién la tiene"></label>
    <label class="f">Marca / modelo<input id="i_marca" value="${esc(it.marca||"")}"></label><label class="f">N° de serie<input id="i_serie" value="${esc(it.serie||"")}"></label>
    <label class="f">Fecha de compra<input type="date" id="i_fecha" value="${esc(it.fechaCompra||"")}"></label><label class="f">Valor de compra $<input id="i_val" inputmode="decimal" value="${esc(it.valor||"")}"></label></div>
    <label class="f">Notas<textarea id="i_not">${esc(it.notas||"")}</textarea></label>
    ${hist.length?`<div><h3 style="margin-bottom:6px">Movimientos de la herramienta</h3><div class="list">${hist.map(x=>`<div class="item" style="cursor:default"><span class="t">${esc(ubicNombre(x.de))} → ${esc(ubicNombre(x.a))}</span><span class="s">${esc(fdate(x.fecha))}${x.resp?" · "+esc(x.resp):""}</span></div>`).join("")}</div></div>`:""}
    ${footBtns(e)}</form>`,sh=>{
    wireCommon(sh,"inventario",it.id);
    $("#fi").onsubmit=async ev=>{ev.preventDefault();const n=$("#i_nom").value.trim();if(!n)return toast("Falta el nombre");
      const ub=$("#i_ubic").value,resp=$("#i_resp").value.trim();const historial=[...(it.historial||[])];
      if(e&&(it.ubic||"galpon")!==ub)historial.push({fecha:hoy(),de:it.ubic||"galpon",a:ub,resp});
      const d={nombre:n,cantidad:num($("#i_cant").value)||1,estado:$("#i_est").value,ubic:ub,responsable:resp,marca:$("#i_marca").value.trim(),serie:$("#i_serie").value.trim(),
        fechaCompra:$("#i_fecha").value,valor:num($("#i_val").value),notas:$("#i_not").value.trim(),historial,movId:it.movId||"",creado:it.creado};
      if(await save("inventario",it.id,d)){closeSheet();toast(e&&(it.ubic||"galpon")!==ub?"Herramienta movida a "+ubicNombre(ub):"Guardado")}};
  });
}
function exportInv(){
  saveFile(`inventario_herramientas_${hoy()}.csv`,[["Herramienta","Cantidad","Estado","Ubicación","Responsable","Marca/modelo","N° serie","Fecha compra","Valor $","Notas"],
    ...herrs().sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||"")).map(i=>[i.nombre,i.cantidad||1,i.estado||"",ubicNombre(i.ubic),i.responsable||"",i.marca||"",i.serie||"",fdate(i.fechaCompra),Math.round(+i.valor||0),i.notas||""])]);
}

/* ---------- sueldos ---------- */
function semanaDef(){const d=new Date();const a=new Date(d);a.setDate(d.getDate()-((d.getDay()+6)%7));const b=new Date(a);b.setDate(a.getDate()+5);return [isoD(a),isoD(b)]}
const empNombre=id=>(S.emp.find(e=>e.id===id)||{nombre:"(empleado borrado)"}).nombre;
function adelantosDe(empId,desde,hasta){return S.movs.filter(m=>m.empleadoId===empId&&/adelanto/i.test(m.categoria||"")&&m.fecha>=desde&&m.fecha<=hasta)}
function liqAbrir(desde,hasta){
  const saved=S.liqs.find(l=>l.id==="sem-"+desde);
  if(saved){S.liq={desde:saved.desde,hasta:saved.hasta,caja:saved.caja||"Numa",filas:Object.fromEntries((saved.filas||[]).map(f=>[f.empId,{dias:f.dias,jornal:f.jornal,fijo:f.fijo,desc:f.desc||"",obra:f.obra||""}])),saved:true,saved_ids:new Set((saved.filas||[]).map(f=>f.empId))}}
  else S.liq={desde,hasta,caja:"Numa",filas:{},saved:false};
}
function liqFilas(){
  const L=S.liq,ids=new Set([...S.emp.filter(e=>e.activo!==false).map(e=>e.id),...Object.keys(L.filas)]);
  return [...ids].map(id=>{const e=S.emp.find(x=>x.id===id)||{id,nombre:empNombre(id),tipo:"jornal"};const f=L.filas[id]||{};
    const tipo=e.tipo||"jornal",jornal=f.jornal!=null&&f.jornal!==""?num(f.jornal):num(e.jornal),fijo=f.fijo!=null&&f.fijo!==""?num(f.fijo):num(e.sueldoFijo),dias=num(f.dias),desc=num(f.desc);
    const fuera=L.saved&&!L.saved_ids.has(id)&&!dias; /* planilla guardada: quien no estaba no suma solo */
    const total=fuera?0:tipo==="fijo"?fijo:dias*jornal,adelanto=fuera?0:adelantosDe(id,L.desde,L.hasta).reduce((a,m)=>a+(+m.monto||0),0);
    const obra=f.obra!=null?f.obra:obraHabitual(id,e);
    return {empId:id,nombre:e.nombre,tipo,dias,jornal,fijo,total,adelanto,desc,obra,saldo:total-adelanto-desc}}).sort((a,b)=>(a.tipo==="fijo")-(b.tipo==="fijo")||b.jornal-a.jornal||a.nombre.localeCompare(b.nombre));
}
function obraHabitual(id,e){const ls=[...S.liqs].sort((a,b)=>(b.desde||"").localeCompare(a.desde||""));
  for(const l of ls){const f=(l.filas||[]).find(x=>x.empId===id&&x.obra);if(f)return f.obra}return (e&&e.obra)||""}
function liqObraHtml(F){const por={};let sin=0;for(const f of F){if(f.tipo==="fijo"||!f.total)continue;if(f.obra)por[f.obra]=(por[f.obra]||0)+f.total;else sin+=f.total}
  if(!Object.keys(por).length&&!sin)return "";
  return `<h3 style="margin-bottom:6px">Sueldos de albañiles por obra</h3><table><tbody>${Object.entries(por).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(obraNombre(k))}</td><td>${fmt(v)}</td></tr>`).join("")}
    ${sin?`<tr><td>Sin obra asignada <span class="note">(se reparte según los jornales cargados)</span></td><td>${fmt(sin)}</td></tr>`:""}</tbody></table>
    <p class="note" style="margin:6px 0 0">Con la planilla guardada, el resultado de cada obra usa estos sueldos reales en vez del costo promedio del jornal.</p>`}
function obraOptsCargo(sel){return `<option value="">Obra…</option>${sortObras(S.obras).filter(o=>o.estado!=="Terminada"||o.id===sel).map(o=>`<option value="${esc(o.id)}" ${sel===o.id?"selected":""}>${esc(o.nombre)}</option>`).join("")}`}
function liqTot(F){const t={total:0,adelanto:0,desc:0,saldo:0,jorTotal:0,jorSaldo:0,fijSaldo:0,dias:0};for(const f of F){t.total+=f.total;t.adelanto+=f.adelanto;t.desc+=f.desc||0;t.saldo+=f.saldo;
  if(f.tipo==="fijo")t.fijSaldo+=f.saldo;else{t.jorTotal+=f.total;t.jorSaldo+=f.saldo;t.dias+=f.dias}}return t}
function vSueldos(){
  const tab=S.filt.sue||"liq";
  return `<h2>Sueldos</h2>
  <div class="seg" style="max-width:520px"><button type="button" data-sue="liq" aria-pressed="${tab==="liq"}">Planilla semanal</button><button type="button" data-sue="emp" aria-pressed="${tab==="emp"}">Empleados (${S.emp.filter(e=>e.activo!==false).length})</button><button type="button" data-sue="hist" aria-pressed="${tab==="hist"}">Historial</button></div>
  ${tab==="liq"?vLiq():tab==="emp"?vEmpleados():vLiqHist()}`;
}
function vLiq(){
  if(!S.liq){const [a,b]=semanaDef();liqAbrir(a,b)}
  const L=S.liq,F=liqFilas(),T=liqTot(F);
  const sav=S.liqs.find(l=>l.id==="sem-"+L.desde);
  const jw=S.jorn.filter(j=>j.fecha>=L.desde&&j.fecha<=L.hasta).reduce((a,j)=>a+(+j.cantidad||0),0);
  return `<div class="two"><label class="f">Desde<input type="date" id="lq_d" value="${esc(L.desde)}"></label><label class="f">Hasta (día de pago)<input type="date" id="lq_h" value="${esc(L.hasta)}"></label></div>
  ${sav?`<div class="row">${sav.pagado?`<span class="pill p-good">Pagada el ${esc(fdate(sav.fechaPago||""))} · ${esc(cajasDe(sav))}</span>`:pagadoDe(sav)>0?`<span class="pill p-warn">Pago parcial ${fmt(pagadoDe(sav))} (${esc(cajasDe(sav))}) · falta ${fmt((+sav.saldo||0)-pagadoDe(sav))}</span>`:`<span class="pill p-warn">Guardada, sin registrar el pago</span>`}</div>`:""}
  ${F.length?`<div class="list" id="lq_rows">${F.map(f=>`<div class="item" style="cursor:default;grid-template-columns:1fr auto auto auto;align-items:center" data-row="${esc(f.empId)}">
    <span><span class="t">${esc(f.nombre)}</span><br><span class="s">${f.tipo==="fijo"?"Sueldo fijo "+fmt(f.fijo):"Jornal "+fmt(f.jornal)}</span>${f.tipo==="fijo"?"":`<br><select data-obr="${esc(f.empId)}" aria-label="Obra de ${esc(f.nombre)}" style="margin-top:4px;padding:4px 6px;font-size:13px;max-width:150px">${obraOptsCargo(f.obra)}</select>`}</span>
    ${f.tipo==="fijo"?`<span></span>`:`<label class="f" style="width:64px">Días<input data-dias="${esc(f.empId)}" inputmode="decimal" value="${f.dias||""}" placeholder="0" style="padding:8px;text-align:center"></label>`}
    <label class="f" style="width:92px" title="Pasajes u otros descuentos">Desc.<input data-desc="${esc(f.empId)}" inputmode="decimal" value="${f.desc||""}" placeholder="0" style="padding:8px;text-align:right"></label>
    <span style="text-align:right;font-variant-numeric:tabular-nums;min-width:118px"><b data-c="saldo">${fmt(f.saldo)}</b><br><span class="note" data-c="det">${fmt(f.total)}${f.adelanto?` − adel. ${fmt(f.adelanto)}`:""}${f.desc?` − desc. ${fmt(f.desc)}`:""}</span></span></div>`).join("")}</div>`
    :`<div class="card empty">No hay empleados cargados. Sumalos en la pestaña Empleados.</div>`}
  <section class="card" id="lq_tot">${liqTotHtml(T,jw)}</section>
  <section class="card" id="lq_obra">${liqObraHtml(F)}</section>
  <div class="row"><button class="btn" data-new-adel>+ Adelanto</button><button class="btn" id="lq_save">Guardar planilla</button><button class="btn pri" id="lq_pay">Registrar pago</button></div>
  <div class="row"><button class="btn sm" id="lq_copy">Copiar planilla</button>${dl?`<button class="btn sm" id="lq_csv">Descargar</button>`:""}</div>
  <p class="note" style="margin:0">Los adelantos se cargan con “+ Adelanto”: salen de la caja en el momento y se descuentan solos en la planilla de esa semana.</p>`;
}
function liqTotHtml(T,jw){const cj=jw&&T.jorTotal?T.jorTotal/jw:0;
  return `<table><tbody><tr><td>Sueldo total</td><td>${fmt(T.total)}</td></tr><tr><td>Adelantos</td><td>− ${fmt(T.adelanto)}</td></tr>${T.desc?`<tr><td>Pasajes y otros descuentos</td><td>− ${fmt(T.desc)}</td></tr>`:""}</tbody>
  <tfoot><tr><td>Saldo a pagar</td><td>${fmt(T.saldo)}</td></tr></tfoot></table>
  <p class="note" style="margin:8px 0 0">${T.dias} días de jornaleros en la planilla · ${jw} jornales cargados en obras esa semana${cj?` · costo real por jornal: <b>${fmt(cj)}</b>`:""}${jw&&T.dias&&Math.abs(jw-T.dias)>0.01?` · <b style="color:var(--warn)">no coinciden los días con los jornales cargados</b>`:""}</p>`}
function vEmpleados(){
  const L=[...S.emp].sort((a,b)=>(a.activo===false)-(b.activo===false)||(a.tipo==="fijo")-(b.tipo==="fijo")||a.nombre.localeCompare(b.nombre));
  return `<div class="list">${L.map(e=>`<button class="item" data-edit-emp="${esc(e.id)}"><span class="t">${esc(e.nombre)}</span><span class="s">${e.tipo==="fijo"?"Sueldo fijo semanal":"Por jornal"}${e.notas?" · "+esc(e.notas):""}</span>
    <span class="m">${e.activo===false?`<span class="pill p-mut">Inactivo</span>`:e.tipo==="fijo"?fmt(e.sueldoFijo):fmt(e.jornal)+" /día"}</span></button>`).join("")||`<div class="empty">Sin empleados.</div>`}</div>
  <div class="fab"><button class="btn pri" data-new-emp2>+ Empleado</button></div>`;
}
function vLiqHist(){
  const L=[...S.liqs].sort((a,b)=>(b.desde||"").localeCompare(a.desde||""));
  return `<div class="list">${L.map(l=>`<button class="item" data-open-liq="${esc(l.desde)}"><span class="t">Semana ${esc(fdate(l.desde))} al ${esc(fdate(l.hasta))}</span>
    <span class="s">${(l.filas||[]).length} personas · adelantos ${fmt(l.adelanto)} · ${l.pagado?"pagada · "+esc(cajasDe(l)):pagadoDe(l)>0?"falta pagar "+fmt((+l.saldo||0)-pagadoDe(l)):"sin pagar"}</span><span class="m">${fmt(l.saldo)}</span></button>`).join("")||`<div class="empty">Todavía no hay planillas guardadas.</div>`}</div>`;
}
async function liqGuardar(extra){
  const L=S.liq,F=liqFilas(),T=liqTot(F),prev=S.liqs.find(l=>l.id==="sem-"+L.desde)||{};
  const d={desde:L.desde,hasta:L.hasta,caja:L.caja,filas:F.filter(f=>f.total||f.adelanto||f.desc),total:T.total,adelanto:T.adelanto,desc:T.desc,saldo:T.saldo,
    pagado:!!prev.pagado,fechaPago:prev.fechaPago||"",movIds:prev.movIds||{},...(prev.pagos?{pagos:prev.pagos,pagadoMonto:prev.pagadoMonto}:{}),creado:prev.creado,...(extra||{})};
  return await save("sueldos","sem-"+L.desde,d);
}
function bindSueldos(){
  document.querySelectorAll("[data-sue]").forEach(b=>b.onclick=()=>{S.filt.sue=b.dataset.sue;render()});
  document.querySelectorAll("[data-edit-emp]").forEach(b=>b.onclick=()=>openEmp(S.emp.find(x=>x.id===b.dataset.editEmp)));
  document.querySelectorAll("[data-new-emp2]").forEach(b=>b.onclick=()=>openEmp());
  document.querySelectorAll("[data-open-liq]").forEach(b=>b.onclick=()=>{const l=S.liqs.find(x=>x.desde===b.dataset.openLiq);liqAbrir(l.desde,l.hasta);S.filt.sue="liq";render()});
  document.querySelectorAll("[data-new-adel]").forEach(b=>b.onclick=()=>openAdel());
  if(!$("#lq_d"))return;
  const L=S.liq;
  $("#lq_d").onchange=e=>{const d=e.target.value;if(!d)return;const b=new Date(d+"T12:00");b.setDate(b.getDate()+5);liqAbrir(d,isoD(b));render()};
  $("#lq_h").onchange=e=>{L.hasta=e.target.value||L.hasta;render()};
  document.querySelectorAll("[data-dias],[data-desc]").forEach(i=>i.oninput=()=>{const k=i.dataset.dias!=null?"dias":"desc",id=i.dataset[k];L.filas[id]={...(L.filas[id]||{}),[k]:i.value};
    const F=liqFilas(),f=F.find(x=>x.empId===id),row=document.querySelector(`[data-row="${CSS.escape(id)}"]`);
    row.querySelector('[data-c="saldo"]').textContent=fmt(f.saldo);row.querySelector('[data-c="det"]').textContent=fmt(f.total)+(f.adelanto?` − adel. ${fmt(f.adelanto)}`:"")+(f.desc?` − desc. ${fmt(f.desc)}`:"");
    const jw=S.jorn.filter(j=>j.fecha>=L.desde&&j.fecha<=L.hasta).reduce((a,j)=>a+(+j.cantidad||0),0);$("#lq_tot").innerHTML=liqTotHtml(liqTot(F),jw);$("#lq_obra").innerHTML=liqObraHtml(F)});
  document.querySelectorAll("[data-obr]").forEach(i=>i.onchange=()=>{const id=i.dataset.obr;L.filas[id]={...(L.filas[id]||{}),obra:i.value};$("#lq_obra").innerHTML=liqObraHtml(liqFilas())});
  $("#lq_save").onclick=async()=>{if(await liqGuardar())toast("Planilla guardada")};
  $("#lq_pay").onclick=()=>openPago();
  $("#lq_copy").onclick=async()=>{const F=liqFilas().filter(f=>f.total||f.adelanto),T=liqTot(F);
    const txt=`SINNER · Sueldos semana ${fdate(L.desde)} al ${fdate(L.hasta)}\n\n`+F.map(f=>`${f.nombre}: ${f.tipo==="fijo"?"fijo":f.dias+" días × "+fmt(f.jornal)} = ${fmt(f.total)}${f.adelanto?` − adelanto ${fmt(f.adelanto)}`:""}${f.desc?` − desc. ${fmt(f.desc)}`:""} → ${fmt(f.saldo)}`).join("\n")+`\n\nTOTAL: ${fmt(T.total)} · Adelantos: ${fmt(T.adelanto)}${T.desc?" · Descuentos: "+fmt(T.desc):""} · A PAGAR: ${fmt(T.saldo)}`;
    try{await navigator.clipboard.writeText(txt);toast("Planilla copiada")}catch(e){toast("No se pudo copiar")}};
  const c=$("#lq_csv");if(c)c.onclick=()=>{const F=liqFilas().filter(f=>f.total||f.adelanto),T=liqTot(F);
    saveFile(`sueldos_${L.desde}.csv`,[["Sinner - Planilla de sueldos "+fdate(L.desde)+" al "+fdate(L.hasta)],[],["Empleado","Días","Jornal","Sueldo fijo","Sueldo total","Adelanto","Descuentos","Saldo a pagar"],
      ...F.map(f=>[f.nombre,f.tipo==="fijo"?"":f.dias,f.tipo==="fijo"?"":f.jornal,f.tipo==="fijo"?f.fijo:"",f.total,f.adelanto||"",f.desc||"",f.saldo]),[],["TOTAL GENERAL","","","",T.total,T.adelanto,T.desc,T.saldo]])};
}
function openEmp(e){
  const ed=!!e;e=e||{nombre:"",tipo:"jornal",jornal:"",sueldoFijo:"",activo:true};
  openSheet(`<form id="fe" style="display:flex;flex-direction:column;gap:12px">${sheetHead(ed?e.nombre:"Nuevo empleado")}
    <label class="f">Nombre<input id="e_nom" value="${esc(e.nombre)}" required></label>
    <div class="two"><label class="f">Cobra<select id="e_tipo"><option value="jornal" ${e.tipo!=="fijo"?"selected":""}>Por jornal (día)</option><option value="fijo" ${e.tipo==="fijo"?"selected":""}>Sueldo fijo semanal</option></select></label>
    <label class="f" id="w_jor">Jornal por día $<input id="e_jor" inputmode="decimal" value="${esc(e.jornal||"")}"></label>
    <label class="f" id="w_fij">Sueldo fijo semanal $<input id="e_fij" inputmode="decimal" value="${esc(e.sueldoFijo||"")}"></label>
    <label class="f">Estado<select id="e_act"><option value="1" ${e.activo!==false?"selected":""}>Activo</option><option value="0" ${e.activo===false?"selected":""}>Ya no trabaja</option></select></label></div>
    <label class="f">Notas<input id="e_not" value="${esc(e.notas||"")}" placeholder="Ej: oficial, ayudante, CUIL…"></label>
    ${footBtns(ed&&!S.liqs.some(l=>(l.filas||[]).some(f=>f.empId===e.id)))}</form>`,sh=>{
    wireCommon(sh,"empleados",e.id);
    const upd=()=>{const f=$("#e_tipo").value==="fijo";$("#w_jor").style.display=f?"none":"";$("#w_fij").style.display=f?"":"none"};$("#e_tipo").onchange=upd;upd();
    $("#fe").onsubmit=async ev=>{ev.preventDefault();const n=$("#e_nom").value.trim();if(!n)return toast("Falta el nombre");
      if(await save("empleados",e.id,{nombre:n,tipo:$("#e_tipo").value,jornal:num($("#e_jor").value),sueldoFijo:num($("#e_fij").value),activo:$("#e_act").value==="1",notas:$("#e_not").value.trim(),creado:e.creado})){closeSheet();toast("Empleado guardado")}};
  });
}
function openAdel(){
  const act=S.emp.filter(e=>e.activo!==false).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  if(!act.length)return toast("Primero cargá los empleados");
  openSheet(`<form id="fa" style="display:flex;flex-direction:column;gap:12px">${sheetHead("Adelanto de sueldo")}
    <div class="two"><label class="f">Empleado<select id="a_emp">${act.map(e=>`<option value="${esc(e.id)}">${esc(e.nombre)}</option>`).join("")}</select></label>
    <label class="f">Fecha<input type="date" id="a_fecha" value="${hoy()}"></label>
    <label class="f">Monto $<input id="a_monto" inputmode="decimal" required></label>
    <label class="f">Sale de la caja<select id="a_caja">${CAJAS.map(c=>`<option ${c==="Numa"?"selected":""}>${c}</option>`).join("")}</select></label></div>
    <label class="f">Nota<input id="a_nota" placeholder="Opcional"></label>
    ${footBtns(false)}</form>`,sh=>{
    sh.querySelector("[data-close]").onclick=closeSheet;
    $("#fa").onsubmit=async ev=>{ev.preventDefault();const m=num($("#a_monto").value);if(!m)return toast("Falta el monto");const id=$("#a_emp").value;
      if(await save("movimientos",null,{fecha:$("#a_fecha").value,tipo:"egreso",caja:$("#a_caja").value,obra:"_jornales",categoria:"Adelantos de empleados",monto:m,
        detalle:"Adelanto "+empNombre(id)+($("#a_nota").value.trim()?" – "+$("#a_nota").value.trim():""),empleadoId:id})){closeSheet();toast("Adelanto cargado")}};
  });
}
function pagosDe(l){if(!l)return [];if(Array.isArray(l.pagos))return l.pagos;const m=l.movIds||{},o=[];
  if(m.jor)o.push({tipo:"jor",caja:l.caja,movId:m.jor,fecha:l.fechaPago});if(m.fij)o.push({tipo:"fij",caja:l.caja,movId:m.fij,fecha:l.fechaPago});
  for(const x of o){const mv=S.movs.find(v=>v.id===x.movId);x.monto=mv?+mv.monto||0:0;if(mv)x.caja=mv.caja}return o}
const pagadoDe=l=>pagosDe(l).reduce((a,x)=>a+(+x.monto||0),0);
function cajasDe(l){return [...new Set(pagosDe(l).filter(x=>+x.monto>0).map(x=>x.caja))].join(" + ")||l.caja||""}
function openPago(){
  const L=S.liq,F=liqFilas(),T=liqTot(F),prev=S.liqs.find(l=>l.id==="sem-"+L.desde)||{};
  if(!T.saldo&&!T.total)return toast("La planilla está vacía");
  const jw=S.jorn.filter(j=>j.fecha>=L.desde&&j.fecha<=L.hasta);const jc=jw.reduce((a,j)=>a+(+j.cantidad||0),0);const cj=jc&&T.jorTotal?T.jorTotal/jc:0;
  const viejos=pagosDe(prev);
  let lin=viejos.length?viejos.map(x=>({...x})):[{tipo:"jor",caja:L.caja||"Numa",monto:T.jorSaldo,fecha:L.hasta},{tipo:"fij",caja:L.caja||"Numa",monto:T.fijSaldo,fecha:L.hasta}].filter(x=>x.monto>0);
  const fila=(x,i)=>`<div class="item" style="cursor:default;grid-template-columns:1fr 1fr;gap:8px" data-pl="${i}">
      <label class="f">Caja<select data-k="caja">${CAJAS.map(c=>`<option ${x.caja===c?"selected":""}>${c}</option>`).join("")}</select></label>
      <label class="f">Importe<input data-k="monto" inputmode="decimal" value="${x.monto||""}" placeholder="0"></label>
      <label class="f">Qué se paga<select data-k="tipo"><option value="jor" ${x.tipo!=="fij"?"selected":""}>Jornaleros</option><option value="fij" ${x.tipo==="fij"?"selected":""}>Sueldos fijos</option></select></label>
      <label class="f">Fecha<input type="date" data-k="fecha" value="${esc(x.fecha||L.hasta)}"></label>
      <span class="note">${x.nota?esc(x.nota):""}</span><button type="button" class="btn sm" data-del-pl="${i}" style="justify-self:end">Quitar</button></div>`;
  const leer=()=>{lin=[...document.querySelectorAll("[data-pl]")].map((r,i)=>({...lin[i],caja:r.querySelector('[data-k="caja"]').value,monto:num(r.querySelector('[data-k="monto"]').value),tipo:r.querySelector('[data-k="tipo"]').value,fecha:r.querySelector('[data-k="fecha"]').value}))};
  const resumen=()=>{const pj=lin.filter(x=>x.tipo!=="fij").reduce((a,x)=>a+(+x.monto||0),0),pf=lin.filter(x=>x.tipo==="fij").reduce((a,x)=>a+(+x.monto||0),0),f=T.saldo-pj-pf;
    return `<table><tbody><tr><td>Jornaleros: a pagar ${fmt(T.jorSaldo)}</td><td>cargado ${fmt(pj)}</td></tr><tr><td>Sueldos fijos: a pagar ${fmt(T.fijSaldo)}</td><td>cargado ${fmt(pf)}</td></tr></tbody>
      <tfoot><tr><td>${f>0.5?"Falta pagar":f<-0.5?"Pagado de más":"Completo"}</td><td>${fmt(Math.abs(f))}</td></tr></tfoot></table>`};
  openSheet(`<form id="fpg" style="display:flex;flex-direction:column;gap:12px">${sheetHead("Registrar pago de sueldos")}
    <p style="margin:0">Semana ${esc(fdate(L.desde))} al ${esc(fdate(L.hasta))} · saldo a pagar <b>${fmt(T.saldo)}</b></p>
    <p class="note" style="margin:0">Si el pago salió de varias cajas, cargá una línea por cada caja. Si todavía falta pagar una parte, cargá solo lo pagado y después volvé a entrar.</p>
    <div class="list" id="pg_lin">${lin.map(fila).join("")}</div>
    <div><button type="button" class="btn sm" id="pg_add">+ Otra caja</button></div>
    <section class="card" id="pg_res">${resumen()}</section>
    ${cj?`<label class="row" style="font-size:14px;font-weight:600;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="pg_cj" checked style="margin-top:3px"> Usar ${fmt(cj)} como costo de cada jornal de esa semana (${jc} jornales), así el resultado de las obras usa lo que se pagó de verdad</label>`:""}
    ${viejos.length?`<div class="banner">Esta semana ya tenía pagos cargados: se corrigen los mismos movimientos, no se duplica.</div>`:""}
    <div class="row between"><span></span><button class="btn pri" type="submit">Guardar pago</button></div></form>`,sh=>{
    sh.querySelector("[data-close]").onclick=closeSheet;
    const pintar=()=>{$("#pg_lin").innerHTML=lin.map(fila).join("");bindL()};
    const bindL=()=>{sh.querySelectorAll("[data-pl] input,[data-pl] select").forEach(i=>i.oninput=i.onchange=()=>{leer();$("#pg_res").innerHTML=resumen()});
      sh.querySelectorAll("[data-del-pl]").forEach(b=>b.onclick=()=>{leer();lin.splice(+b.dataset.delPl,1);pintar();$("#pg_res").innerHTML=resumen()})};
    bindL();
    $("#pg_add").onclick=()=>{leer();const pj=lin.filter(x=>x.tipo!=="fij").reduce((a,x)=>a+(+x.monto||0),0),pf=lin.filter(x=>x.tipo==="fij").reduce((a,x)=>a+(+x.monto||0),0);
      const fj=T.jorSaldo-pj,ff=T.fijSaldo-pf;lin.push({tipo:fj>0.5||ff<=0.5?"jor":"fij",caja:"Numa",monto:Math.max(0,fj>0.5?fj:ff),fecha:L.hasta});pintar();$("#pg_res").innerHTML=resumen()};
    $("#fpg").onsubmit=async ev=>{ev.preventDefault();leer();
      if(lin.some(x=>!(x.monto>0)))return toast("Hay una línea sin importe");
      const per=`semana ${fdate(L.desde)} al ${fdate(L.hasta)}`,libres=viejos.map(x=>x.movId).filter(Boolean),out=[];
      try{
        for(const x of lin){const reuse=x.movId&&libres.includes(x.movId)?x.movId:undefined;if(reuse)libres.splice(libres.indexOf(reuse),1);
          const ref=db.collection("movimientos").doc(reuse);const fij=x.tipo==="fij";
          await ref.set({fecha:x.fecha||L.hasta,tipo:"egreso",caja:x.caja,obra:fij?"_sueldos":"_jornales",categoria:fij?"Sueldos fijos":"Sueldos",monto:x.monto,
            detalle:(fij?"Sueldos fijos ":"Sueldos jornaleros ")+per+(x.nota?" – "+x.nota:""),liquidacion:"sem-"+L.desde,creado:Date.now()});
          out.push({tipo:x.tipo,caja:x.caja,monto:x.monto,fecha:x.fecha||L.hasta,movId:ref.id,...(x.nota?{nota:x.nota}:{})})}
        for(const id of libres)await db.collection("movimientos").doc(id).delete();
        if(cj&&$("#pg_cj")&&$("#pg_cj").checked){for(const j of jw){if(Math.abs((+j.costoUnit||0)-cj)>0.5){const {id,_por,...rest}=j;await db.collection("jornales").doc(id).set({...rest,costoUnit:Math.round(cj*100)/100})}}}
        const tot=out.reduce((a,x)=>a+x.monto,0),ult=out.map(x=>x.fecha).sort().pop()||"";
        L.caja=out[0]?out[0].caja:L.caja;
        await liqGuardar({pagos:out,movIds:{},pagado:tot>=T.saldo-0.5,pagadoMonto:tot,fechaPago:ult,caja:[...new Set(out.map(x=>x.caja))].join(" + ")});
        closeSheet();toast(tot>=T.saldo-0.5?"Pago registrado":"Pago parcial registrado: falta "+fmt(T.saldo-tot));
      }catch(e){toast(errMsg(e))}};
  });
}

/* ---------- portada ---------- */
function vPortada(){
  const enc=isEnc(),hoyS=hoy(),logo=($(".logo")||{}).src||"";
  const act=obrasActivas().filter(o=>o.estado==="En curso");
  const falt=act.filter(o=>!S.bit.some(b=>b.obra===o.id&&b.fecha===hoyS)).length;
  const hora=new Date().getHours(),saludo=hora<13?"Buen día":hora<20?"Buenas tardes":"Buenas noches";
  const nombre=(S.perfil&&S.perfil.nombre)||(typeof SUPABASE_URL==="undefined"?"Tami":"");
  const mesS=hoyS.slice(0,7),jm=S.jorn.filter(j=>(j.fecha||"").startsWith(mesS)).reduce((a,j)=>a+(+j.cantidad||0),0);
  const tiles=(enc?[
    ["inicio","Mi día","Lo que tenés que cargar hoy y tus últimos gastos."],
    ["caja","Mis gastos","Cargá los gastos de tu caja: materiales, combustible, comida."],
    ["jornales","Jornales","Anotá cuántos jornales se trabajaron por obra cada día."],
    ["bitacora","Bitácora","Registrá si se trabajó en la obra y, si no, por qué."]
  ]:[
    ["inicio","Resumen","Saldo de cada caja, lo que entró y salió en el mes y cómo va cada obra."],
    ["caja","Caja","Entradas, salidas y pases entre cajas, con filtro por caja y por mes."],
    ["obras","Obras","Cobrado, gastos, jornales y resultado de cada obra, más el histórico de terminadas."],
    ["jornales","Jornales","Cantidad de jornales por obra y por día, con su costo."],
    ["bitacora","Bitácora","Parte diario de cada obra: si se trabajó y los motivos de demora."],
    ["presupuestos","Presupuestos","Armá presupuestos para clientes y calculá mano de obra y hormigón."],
    ["clientes","Clientes","Ficha de cada cliente: contacto, sus obras, pagos, presupuestos y recibos."],
    ["proveedores","Proveedores","Ficha de cada proveedor: rubro, contacto, compras, deuda y listas de precios."],
    ["sueldos","Sueldos","Planilla semanal: días, jornal de cada uno, adelantos y saldo a pagar."],
    ["empresa","Empresa","Gastos de la empresa (galpón, oficina, sueldos fijos) e inventario de herramientas."],
    ["buscar","Buscar","Encontrá cualquier movimiento por palabra, monto o fecha."]
  ]);
  return (enc?"":importBanner())+`
  <section class="hero">
    ${logo?`<img src="${logo}" alt="Sinner Construcciones" class="hero-logo">`:`<div class="hero-name">SINNER</div>`}
    <div class="mision"><span>Calidad</span><i></i><span>Eficiencia</span><i></i><span>Confort</span></div>
  </section>
  <div class="row between"><h2>${saludo}${nombre?", "+esc(nombre):""}</h2><span class="note">${esc(dlabel(hoyS))}</span></div>
  <div class="tiles">${tiles.map(([v,t,s])=>`<button class="tile" data-go="${v}"><b>${t}</b><span>${esc(s)}</span></button>`).join("")}</div>`;
}

/* ---------- buscador ---------- */
const norm=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const isoD=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
function rango(k){const d=new Date();
  if(k==="hoy")return [hoy(),hoy()];
  if(k==="ayer"){d.setDate(d.getDate()-1);return [isoD(d),isoD(d)]}
  if(k==="semana"){d.setDate(d.getDate()-((d.getDay()+6)%7));return [isoD(d),hoy()]}
  if(k==="mes")return [hoy().slice(0,8)+"01",hoy()];
  if(k==="mesant"){const a=new Date(d.getFullYear(),d.getMonth()-1,1),b=new Date(d.getFullYear(),d.getMonth(),0);return [isoD(a),isoD(b)]}
  return ["",""]}
function vBuscar(){
  const q=S.q||(S.q={t:"",desde:"",hasta:"",que:"todo"});
  const adm=typeof isAdmin==="function"?isAdmin():true;
  const tipos=[["todo","Todo"],["movs",isEnc&&isEnc()?"Gastos":"Caja"],["jorn","Jornales"],["bit","Bitácora"]].concat(adm&&!(typeof isEnc==="function"&&isEnc())?[["pres","Presup."]]:[]);
  return `<h2>Buscar</h2>
  <label class="f">Qué buscás<input id="q_t" type="search" autocomplete="off" placeholder="Ej: cemento, Lucas, 60000, lluvia, Colegio" value="${esc(q.t)}"></label>
  <div class="chips">${[["hoy","Hoy"],["ayer","Ayer"],["semana","Esta semana"],["mes","Este mes"],["mesant","Mes pasado"],["todo","Cualquier fecha"]].map(([k,l])=>{const [a,b]=rango(k);return `<button class="chip" data-rng="${k}" aria-pressed="${q.desde===a&&q.hasta===b}">${l}</button>`}).join("")}</div>
  <div class="two"><label class="f">Desde<input type="date" id="q_d" value="${esc(q.desde)}"></label><label class="f">Hasta<input type="date" id="q_h" value="${esc(q.hasta)}"></label></div>
  <div class="seg" id="q_que">${tipos.map(([k,l])=>`<button type="button" data-que="${k}" aria-pressed="${q.que===k}">${l}</button>`).join("")}</div>
  <div id="q_res" style="display:flex;flex-direction:column;gap:12px">${buscarRes()}</div>`;
}
function buscarRes(){
  const q=S.q,W=norm(q.t).split(/\s+/).filter(Boolean);
  if(!W.length&&!q.desde&&!q.hasta)return `<div class="card empty">Escribí algo o elegí una fecha para buscar.</div>`;
  const inR=f=>(!q.desde||(f||"")>=q.desde)&&(!q.hasta||(f||"")<=q.hasta);
  const ok=parts=>{const t=norm(parts.join(" "));return W.every(w=>t.includes(w))};
  const out=[],enc=typeof isEnc==="function"&&isEnc();
  if(q.que==="todo"||q.que==="movs")for(const m of S.movs){if(!inR(m.fecha))continue;
    if(ok([m.detalle,m.categoria,m.caja,m.cajaDestino,m.tipo==="pase"?"pase transferencia":m.tipo==="ingreso"?"entrada ingreso cobro":"salida gasto egreso",m.tipo!=="pase"?obraNombre(m.obra):"",Math.round(+m.monto||0),fmt(m.monto)]))out.push({k:"mov",f:m.fecha,x:m})}
  if(q.que==="todo"||q.que==="jorn")for(const j of S.jorn){if(!inR(j.fecha))continue;if(ok([obraNombre(j.obra),j.nota,"jornal jornales",j.cantidad]))out.push({k:"jor",f:j.fecha,x:j})}
  if(q.que==="todo"||q.que==="bit")for(const b of S.bit){if(!inR(b.fecha))continue;
    if(ok([obraNombre(b.obra),b.motivo,b.detalle,"bitacora",b.trabajo==="si"?"se trabajo":b.trabajo==="no"?"no se trabajo":"parcial"]))out.push({k:"bit",f:b.fecha,x:b})}
  if((q.que==="todo"||q.que==="pres")&&!enc)for(const p of S.pres){if(!inR(p.fecha))continue;
    if(ok(["presupuesto",p.numero,p.cliente,p.obra,p.estado,(p.items||[]).map(i=>i.d).join(" ")]))out.push({k:"pres",f:p.fecha,x:p})}
  if(q.que==="todo"&&!enc)for(const i of S.inv){if((q.desde||q.hasta)&&!inR(i.fechaCompra))continue;
    if(ok(["herramienta inventario",i.nombre,i.marca,i.serie,i.responsable,i.estado,ubicNombre(i.ubic),i.notas]))out.push({k:"inv",f:i.fechaCompra||"",x:i})}
  if(!out.length)return `<div class="card empty">No encontré nada con esa búsqueda.</div>`;
  out.sort((a,b)=>(b.f||"").localeCompare(a.f||""));
  const ms=out.filter(r=>r.k==="mov"&&r.x.tipo!=="pase").map(r=>r.x);
  const ing=ms.filter(m=>m.tipo==="ingreso").reduce((a,m)=>a+(+m.monto||0),0),egr=ms.filter(m=>m.tipo==="egreso").reduce((a,m)=>a+(+m.monto||0),0);
  const jt=out.filter(r=>r.k==="jor").reduce((a,r)=>a+(+r.x.cantidad||0),0);
  const lim=out.slice(0,300);let html="",last="";
  for(const r of lim){if(r.f!==last){html+=`<div class="day">${r.f?esc(dlabel(r.f)):"Sin fecha"}</div>`;last=r.f}const x=r.x;
    if(r.k==="mov"){const pase=x.tipo==="pase";html+=`<button class="item" data-edit-mov="${esc(x.id)}"><span class="t">${pase?`Pase ${esc(x.caja)} → ${esc(x.cajaDestino)}`:esc(x.detalle||x.categoria||"Movimiento")}</span><span class="s">Caja ${esc(x.caja)}${pase?"":" · "+esc(obraNombre(x.obra))+(x.categoria?" · "+esc(x.categoria):"")}</span><span class="m" style="color:${x.tipo==="ingreso"?"var(--good)":"var(--ink)"}">${pase?"":x.tipo==="ingreso"?"+ ":"− "}${fmt(x.monto)}</span></button>`}
    else if(r.k==="jor")html+=`<button class="item" data-edit-jor="${esc(x.id)}"><span class="t">Jornales · ${esc(obraNombre(x.obra))}</span><span class="s">${esc(x.nota||"")}</span><span class="m">${+x.cantidad} jornal${+x.cantidad===1?"":"es"}</span></button>`;
    else if(r.k==="bit")html+=`<button class="item" data-edit-bit="${esc(x.id)}"><span class="t">Bitácora · ${esc(obraNombre(x.obra))}</span><span class="s">${x.motivo&&x.trabajo!=="si"?esc(x.motivo)+(x.detalle?" — ":""):""}${esc(x.detalle||"")}</span><span class="m">${pillTrab(x.trabajo)}</span></button>`;
    else if(r.k==="inv")html+=`<button class="item" data-edit-inv="${esc(x.id)}"><span class="t">Herramienta · ${esc(x.nombre)}</span><span class="s">${esc(ubicNombre(x.ubic))}${x.responsable?" · "+esc(x.responsable):""}</span><span class="m"><span class="pill p-mut">${esc(x.estado||"Bueno")}</span></span></button>`;
    else html+=`<button class="item" data-edit-pres="${esc(x.id)}"><span class="t">Presupuesto N° ${esc(x.numero)} · ${esc(x.cliente||"Sin cliente")}</span><span class="s">${esc(x.obra||"")} ${presPill(x.estado)}</span><span class="m">${fmt(presTot(x).total)}</span></button>`;
  }
  return `<div class="grid"><div class="card stat"><div class="lbl">Resultados</div><div class="num">${out.length}</div></div>
    ${ms.length?`${enc?"":`<div class="card stat"><div class="lbl">Entradas</div><div class="num pos">${fmt(ing)}</div></div>`}<div class="card stat"><div class="lbl">Salidas</div><div class="num neg">${fmt(egr)}</div></div>`:""}
    ${jt?`<div class="card stat"><div class="lbl">Jornales</div><div class="num">${jt}</div></div>`:""}</div>
    <div class="list">${html}</div>${out.length>300?`<p class="note">Se muestran los 300 más recientes. Acotá la búsqueda para ver el resto.</p>`:""}`;
}
function bindEdits(root){
  root.querySelectorAll("[data-edit-mov]").forEach(b=>b.onclick=()=>openMov(S.movs.find(x=>x.id===b.dataset.editMov)));
  root.querySelectorAll("[data-edit-jor]").forEach(b=>b.onclick=()=>openJor(S.jorn.find(x=>x.id===b.dataset.editJor)));
  root.querySelectorAll("[data-edit-bit]").forEach(b=>b.onclick=()=>openBit(S.bit.find(x=>x.id===b.dataset.editBit)));
  root.querySelectorAll("[data-edit-inv]").forEach(b=>b.onclick=()=>openInv(S.inv.find(x=>x.id===b.dataset.editInv)));
  root.querySelectorAll("[data-edit-pres]").forEach(b=>b.onclick=()=>openPres(S.pres.find(x=>x.id===b.dataset.editPres)));
}
function bindBuscar(){
  const q=S.q,upd=()=>{$("#q_res").innerHTML=buscarRes();bindEdits($("#q_res"))};
  let tm;$("#q_t").oninput=e=>{q.t=e.target.value;clearTimeout(tm);tm=setTimeout(upd,150)};
  $("#q_d").onchange=e=>{q.desde=e.target.value;render()};$("#q_h").onchange=e=>{q.hasta=e.target.value;render()};
  document.querySelectorAll("[data-rng]").forEach(b=>b.onclick=()=>{[q.desde,q.hasta]=rango(b.dataset.rng);render()});
  document.querySelectorAll("[data-que]").forEach(b=>b.onclick=()=>{q.que=b.dataset.que;render()});
  if(!render.qFocused){render.qFocused=1;setTimeout(()=>$("#q_t")&&$("#q_t").focus(),50)}
}

/* ---------- eventos de vistas ---------- */
function bindView(v){
  const V=$("#view");
  if(v==="cierre")bindCierre(V);
  if(v==="presupuestos")bindPrecios(V);
  if(v==="fede")bindFede(V);
  if(v==="usd")bindUsd(V);
  if(v==="tarjetas")bindTarjetas(V);
  const cq=V.querySelector("#cajaQ");if(cq){cq.oninput=()=>{S.filt.cq=cq.value;const pos=cq.selectionStart;render();const n=$("#cajaQ");if(n){n.focus();try{n.setSelectionRange(pos,pos)}catch(e){}}}}
  V.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>location.hash=b.dataset.go);
  V.querySelectorAll("[data-new]").forEach(b=>b.onclick=()=>({mov:()=>openMov(),jor:()=>openJor(),bit:()=>openBit(),obra:()=>openObra(),pres:()=>openPres()}[b.dataset.new])());
  V.querySelectorAll("[data-edit-pres]").forEach(b=>b.onclick=()=>openPres(S.pres.find(x=>x.id===b.dataset.editPres)));
  const ib=$("#impBtn");if(ib)ib.onclick=runImport;
  V.querySelectorAll("[data-emp]").forEach(b=>b.onclick=()=>{S.filt.emp=b.dataset.emp;render()});
  V.querySelectorAll("[data-ubic]").forEach(b=>b.onclick=()=>{S.filt.ubic=b.dataset.ubic;render()});
  V.querySelectorAll("[data-edit-inv]").forEach(b=>b.onclick=()=>openInv(S.inv.find(x=>x.id===b.dataset.editInv)));
  V.querySelectorAll("[data-inv-from]").forEach(b=>b.onclick=()=>{const m=S.movs.find(x=>x.id===b.dataset.invFrom);
    openInv(null,{nombre:m.detalle||"Herramienta",valor:Math.round(+m.monto||0),fechaCompra:m.fecha,movId:m.id,ubic:m.obra&&!m.obra.startsWith("_")?m.obra:"galpon"})});
  V.querySelectorAll("[data-new-emp]").forEach(b=>b.onclick=()=>openMov(null,{obra:"_empresa",categoria:"Gastos de empresa",caja:"Numa"}));
  V.querySelectorAll("[data-new-inv]").forEach(b=>b.onclick=()=>openInv());
  V.querySelectorAll("[data-new-veh]").forEach(b=>b.onclick=()=>openVeh());
  const db_=V.querySelector("#dictarBtn");if(db_)db_.onclick=()=>openDictado();
  V.querySelectorAll("[data-rubro]").forEach(b=>b.onclick=()=>{S.filt.rubro=S.filt.rubro===b.dataset.rubro?null:b.dataset.rubro;render()});
  V.querySelectorAll("[data-edit-veh]").forEach(b=>b.onclick=()=>openVeh(S.inv.find(x=>x.id===b.dataset.editVeh)));
  const ei=$("#expInv");if(ei)ei.onclick=exportInv;
  if(v==="sueldos")bindSueldos();
  if(v==="legajo")bindLegajo();
  if(v==="cliente")bindCliente();
  if(v==="proveedor")bindProveedor();
  V.querySelectorAll("[data-cli]").forEach(b=>b.onclick=e=>{e.preventDefault();S.cliSel=b.dataset.cli;location.hash="cliente"});
  V.querySelectorAll("[data-prov]").forEach(b=>b.onclick=e=>{e.preventDefault();S.provSel=b.dataset.prov;location.hash="proveedor"});
  V.querySelectorAll("[data-new-cli]").forEach(b=>b.onclick=()=>openCliente());
  V.querySelectorAll("[data-new-prov]").forEach(b=>b.onclick=()=>openProv());
  const ac=$("#autoCli");if(ac)ac.onclick=crearClientesDesdeObras;
  V.querySelectorAll("[data-edit-mov]").forEach(b=>b.onclick=()=>openMov(S.movs.find(x=>x.id===b.dataset.editMov)));
  V.querySelectorAll("[data-edit-jor]").forEach(b=>b.onclick=()=>openJor(S.jorn.find(x=>x.id===b.dataset.editJor)));
  V.querySelectorAll("[data-edit-bit]").forEach(b=>b.onclick=()=>openBit(S.bit.find(x=>x.id===b.dataset.editBit)));
  V.querySelectorAll("[data-bit-new]").forEach(b=>b.onclick=()=>{const ex=S.bit.find(x=>x.obra===b.dataset.bitNew&&x.fecha===hoy());openBit(ex||{obra:b.dataset.bitNew})});
  V.querySelectorAll("[data-edit-obra]").forEach(b=>b.onclick=()=>{S.legObra=b.dataset.editObra;location.hash="legajo"});
  V.querySelectorAll("[data-caja]").forEach(b=>b.onclick=()=>{S.filt.caja=b.dataset.caja;render()});
  V.querySelectorAll("[data-encv]").forEach(b=>b.onclick=()=>{S.filt.encv=b.dataset.encv;render()});
  V.querySelectorAll("[data-oh]").forEach(b=>b.onclick=()=>{S.filt.oh=b.dataset.oh;render()});
  V.querySelectorAll("[data-bobra]").forEach(b=>b.onclick=()=>{S.filt.bobra=b.dataset.bobra;render()});
  const ms=$("#mesSel");if(ms)ms.onchange=()=>{S.filt.mes=ms.value;render()};
  const em=$("#expMov");if(em)em.onclick=exportMovs;
  const er=$("#expRes");if(er)er.onclick=exportRes;
  if(v==="buscar")bindBuscar();
  if(v==="presupuestos"&&$("#c_pared")){
    ["pared","revoque","platea","fibra"].forEach(k=>{const i=$("#c_"+k);i.oninput=()=>{S.cot[k]=i.value;$("#cotRes").innerHTML=cotTabla()}});
    $("#c_bomba").onchange=e=>{S.cot.bomba=e.target.checked;$("#cotRes").innerHTML=cotTabla()};
    $("#openCfg2").onclick=()=>openCfg();
    $("#toPres").onclick=()=>{const rows=cotCalc();if(!rows.length)return toast("Primero cargá algún metro");
      openPres(null,rows.map(r=>r[3]?{d:r[0],cant:r[4],unid:r[5],precio:Math.round(r[2]/r[4]*100)/100,jor:r[3]}:{d:r[0],cant:1,unid:"gl",precio:Math.round(r[2])}))};
    $("#copyCot").onclick=async()=>{const rows=cotCalc();if(!rows.length)return toast("No hay nada para copiar");
      const tot=rows.reduce((a,r)=>a+r[2],0);
      const txt=rows.map(r=>`${r[0]}: ${r[1]} → ${fmt(r[2])}`).join("\n")+`\nTOTAL: ${fmt(tot)}`+(S.cfg.cotizacion?` (${fmtU(tot/S.cfg.cotizacion)} a blue ${fmt(S.cfg.cotizacion)})`:"");
      try{await navigator.clipboard.writeText(txt);toast("Cotización copiada")}catch(e){toast("No se pudo copiar")}};
  }
}

/* ---------- hoja (formularios) ---------- */
function openSheet(html,onReady){const bg=$("#sheetBg");$("#sheet").innerHTML=html;bg.classList.add("open");onReady&&onReady($("#sheet"));
  const f=$("#sheet").querySelector("input,select,textarea");if(f&&matchMedia("(min-width:700px)").matches)f.focus()}
function closeSheet(){$("#sheetBg").classList.remove("open");if(dict&&closeSheet.listening){dict.stop().catch(()=>{})}}
$("#sheetBg").addEventListener("click",e=>{if(e.target.id==="sheetBg")closeSheet()});
addEventListener("keydown",e=>{if(e.key==="Escape")closeSheet()});
function sheetHead(t){return `<div class="row between"><h2 style="font-size:19px">${esc(t)}</h2><button class="btn sm" type="button" data-close>Cerrar</button></div>`}
function obraOpts(sel,extra){const enc=isEnc();return `<optgroup label="Obras">${sortObras(S.obras).filter(o=>!enc||o.estado!=="Terminada"||o.id===sel).map(o=>`<option value="${esc(o.id)}" ${sel===o.id?"selected":""}>${esc(o.nombre)}${o.estado==="Terminada"?" (terminada)":""}</option>`).join("")}</optgroup>`+
  (extra?`<optgroup label="Sin obra">${SIN_OBRA.filter(o=>!enc||o.id==="_empresa").map(o=>`<option value="${o.id}" ${sel===o.id?"selected":""}>${o.nombre}</option>`).join("")}</optgroup>`:"")}
function footBtns(edit){return `<div class="row between" style="margin-top:4px">${edit?`<button class="btn danger" type="button" data-del>Borrar</button>`:"<span></span>"}<button class="btn pri" type="submit">Guardar</button></div>`}
function wireCommon(sh,coll,id,after){
  sh.querySelector("[data-close]").onclick=closeSheet;
  const d=sh.querySelector("[data-del]");
  if(d)d.onclick=async()=>{if(!d.dataset.sure){d.dataset.sure=1;d.textContent="Tocá de nuevo para borrar";return}
    try{await db.collection(coll).doc(id).delete();closeSheet();toast("Borrado")}catch(e){toast(errMsg(e))}};
}
function errMsg(e){return e&&e.code==="quota_exceeded"?"La base de datos está llena: hay que borrar registros viejos.":e&&e.code==="invalid_argument"?"No tenés permiso para guardar en esta app.":"No se pudo guardar. Probá de nuevo."}
async function save(coll,id,data){
  if(!db){toast("Sin conexión a la base de datos");return false}
  try{const ref=id?db.collection(coll).doc(id):db.collection(coll).doc();
    await ref.set({...data,creado:data.creado||Date.now(),por:S.uid||null});return ref.id||true}
  catch(e){toast(errMsg(e));return false}
}

/* movimiento */
function openMov(m,preset){
  if(m&&m.tipo==="pagoTarjeta"){if(confirm(`${m.detalle||"Pago de tarjeta"}: ${fmt(m.monto)} desde la caja ${m.caja}.\n\n¿Querés borrar este pago?`))db.collection("movimientos").doc(m.id).delete().then(()=>toast("Pago borrado")).catch(e=>toast(errMsg(e)));return}
  if(isEnc()&&!S.perfil?.caja)return toast("Tu usuario no tiene caja asignada. Pedile a administración que te la asigne.");
  const e=!!m; m=m||{fecha:hoy(),tipo:"egreso",caja:isEnc()?S.perfil.caja:(S.filt.caja!=="Todas"?S.filt.caja:"General"),obra:"",categoria:"Materiales",...(preset||{})};
  const legacyUsd=!!m.usd&&!m.moneda&&m.tipo!=="cambio";
  const st={tipo:m.tipo,enUsd:legacyUsd,mon:esUsd(m)?"USD":"ARS",pago:m.pago==="tarjeta"?"tarjeta":"caja"};
  const TARJ=(S.cfg.tarjetas&&S.cfg.tarjetas.length?S.cfg.tarjetas:["Bancor Federico"]);
  openSheet(`<form id="fm" style="display:flex;flex-direction:column;gap:12px">${sheetHead(e?"Editar movimiento":"Nuevo movimiento")}
    <div class="seg" id="segTipo">${[["egreso","Salida"],["ingreso","Entrada"],["pase","Pase entre cajas"],...(isEnc()?[]:[["cambio","Cambio US$ → $"]])].map(([v,l])=>`<button type="button" data-t="${v}" aria-pressed="${st.tipo===v}">${l}</button>`).join("")}</div>
    <div class="seg" id="segPago" style="max-width:340px">${[["caja","Pagado con la caja"],["tarjeta","Con tarjeta de crédito"]].map(([v,l])=>`<button type="button" data-pago="${v}" aria-pressed="${st.pago===v}">${l}</button>`).join("")}</div>
    <div class="two" id="wTarj"><label class="f">Tarjeta<select id="m_tarj">${[...new Set([...TARJ,...(m.tarjeta?[m.tarjeta]:[])])].map(t=>`<option ${m.tarjeta===t?"selected":""}>${esc(t)}</option>`).join("")}</select></label>
      <label class="f">Cuotas<input id="m_cuotas" inputmode="numeric" value="${m.cuotas||1}"></label>
      <label class="f">Primer resumen (mes)<input type="month" id="m_mes1" value="${esc(m.mesPrimerResumen||sigMes(hoy().slice(0,7)))}"></label>
      <p class="note" id="m_cuotaInfo" style="margin:0;align-self:end"></p></div>
    <div class="seg" id="segMon" style="max-width:280px">${[["ARS","En pesos"],["USD","En dólares"]].map(([v,l])=>`<button type="button" data-mon="${v}" aria-pressed="${st.mon===v}">${l}</button>`).join("")}</div>
    <div class="two"><label class="f">Fecha<input type="date" id="m_fecha" value="${esc(m.fecha)}" required></label>
      <label class="f"><span id="lblCaja">Caja</span><select id="m_caja" ${isEnc()?"disabled":""}>${(CAJAS.includes(m.caja)?CAJAS:[m.caja,...CAJAS]).map(c=>`<option ${m.caja===c?"selected":""}>${esc(c)}</option>`).join("")}</select></label></div>
    <label class="f" id="wDest">A la caja<select id="m_dest">${CAJAS.map(c=>`<option ${m.cajaDestino===c?"selected":""}>${c}</option>`).join("")}</select></label>
    <label class="row" id="wUsd" style="font-size:14px;font-weight:600;${legacyUsd?"":"display:none"}"><input type="checkbox" id="m_enusd" ${st.enUsd?"checked":""}> Es en dólares (cambiados a pesos)</label>
    <label class="f" id="wUsdX"><span id="lblUsdX">Monto en dólares</span><input id="m_usdx" inputmode="decimal" value="${esUsd(m)||m.tipo==="cambio"?(m.usd||""):""}" placeholder="US$"></label>
    <p class="note" id="m_usdInfo" style="margin:0"></p>
    <div id="wUsdF" style="display:grid;gap:10px">
      <div class="two"><label class="f">Dólares<input id="m_usd" inputmode="decimal" value="${m.usd||""}"></label>
      <label class="f">¿A cuánto nos lo tomaron?<input id="m_cot" inputmode="decimal" value="${m.cotizacion||S.cfg.cotizacion||""}" placeholder="Precio de cada dólar"></label></div>
      <p class="note" id="m_cotInfo" style="margin:0"></p></div>
    <label class="f" id="wMonto"><span id="lblMonto">Monto en pesos</span><input id="m_monto" inputmode="decimal" value="${esUsd(m)?"":(m.monto||"")}" placeholder="0"></label>
    <div id="wObra" style="display:flex;flex-direction:column;gap:12px">
      <label class="f">Obra<select id="m_obra"><option value="">Elegí…</option>${obraOpts(m.obra,true)}</select></label>
      <label class="f" id="wRubP">Gasto personal de Federico: ¿de qué?<select id="m_rubp">${RUBROS_FEDE.map(r=>`<option ${m.rubroPersonal===r?"selected":""}>${esc(r)}</option>`).join("")}</select></label>
      <label class="f">Categoría<select id="m_cat">${(m.categoria&&!CATEGORIAS.includes(m.categoria)?[m.categoria,...CATEGORIAS]:CATEGORIAS).map(c=>`<option ${m.categoria===c?"selected":""}>${esc(c)}</option>`).join("")}</select></label>
    </div>
    <label class="f" id="wVeh">Vehículo<select id="m_veh"><option value="">—</option>${vehs().map(v=>`<option value="${esc(v.id)}" ${m.vehiculo===v.id?"selected":""}>${esc(v.nombre)}${v.patente?" · "+esc(v.patente):""}</option>`).join("")}</select></label>
    ${S.prov.length?`<label class="f" id="wProv">Proveedor (opcional)<select id="m_prov"><option value="">—</option>${[...S.prov].sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(p=>`<option value="${esc(p.id)}" ${m.proveedorId===p.id?"selected":""}>${esc(p.nombre)}${p.rubro?" · "+esc(p.rubro):""}</option>`).join("")}</select></label>`:""}
    <label class="f">Detalle<input id="m_det" value="${esc(m.detalle||"")}" placeholder="Ej: 20 bolsas de cemento – Corralón"></label>
    ${!e?`<label class="row" id="wRem" style="font-size:14px;font-weight:600;gap:6px"><input type="checkbox" id="m_rem" ${m.conRemito?"checked":""}> 📄 Generar remito de pago al guardar</label>`:""}
    ${e&&m.tipo==="egreso"?`<button type="button" class="btn" id="m_remb">📄 ${m.remitoNro?"Ver remito N° "+String(m.remitoNro).padStart(4,"0"):"Emitir remito de pago"}</button>`:""}
    ${e&&m.tipo==="ingreso"&&!isEnc()?`<button type="button" class="btn" id="m_rec">🧾 ${m.reciboNro?"Ver recibo N° "+String(m.reciboNro).padStart(4,"0"):"Emitir recibo"}</button>`:""}
    ${footBtns(e)}</form>`,sh=>{
    if($("#m_rec"))$("#m_rec").onclick=()=>emitirRecibo(m);
    if($("#m_remb"))$("#m_remb").onclick=()=>emitirRemito(m);
    wireCommon(sh,"movimientos",m.id);
    const upd=()=>{sh.querySelectorAll("#segTipo button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.t===st.tipo));
      const tc=st.tipo==="egreso"&&st.pago==="tarjeta"&&!isEnc();if(tc)st.mon="ARS";
      $("#segPago").style.display=st.tipo==="egreso"&&!isEnc()&&!legacyUsd?"":"none";
      sh.querySelectorAll("#segPago button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.pago===st.pago));
      $("#wTarj").style.display=tc?"grid":"none";$("#lblCaja").parentElement.style.display=tc?"none":"";cuotaInfo();
      const p=st.tipo==="pase",cb=st.tipo==="cambio",usd=!cb&&st.mon==="USD";
      sh.querySelectorAll("#segMon button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.mon===st.mon));
      $("#segMon").style.display=cb||tc||isEnc()||legacyUsd?"none":"";
      $("#wDest").style.display=p?"":"none";if($("#wProv"))$("#wProv").style.display=st.tipo==="egreso"?"":"none";$("#wObra").style.display=p||cb?"none":"flex";$("#lblCaja").textContent=p?"De la caja":"Caja";
      $("#wUsdF").style.display=st.enUsd&&!cb&&!usd?"grid":"none";$("#m_monto").readOnly=false;
      $("#wUsdX").style.display=cb||usd?"":"none";$("#lblUsdX").textContent=cb?"Dólares que cambiaste":"Monto en dólares";
      $("#wMonto").style.display=usd?"none":"";$("#lblMonto").textContent=cb?"Pesos que te dieron":"Monto en pesos";usdInfo();
      if($("#wRem"))$("#wRem").style.display=st.tipo==="egreso"?"":"none";
      $("#wVeh").style.display=st.tipo==="egreso"&&vehs().length&&/combustible|mantenimiento veh|vi[aá]tic/i.test($("#m_cat").value)?"":"none";
      if(!e&&st.tipo==="ingreso"&&$("#m_cat").value==="Materiales")$("#m_cat").value="Pago recibido";
      $("#wRubP").style.display=st.tipo==="egreso"&&($("#m_obra").value==="_federico"||$("#m_cat").value==="Personal Federico")?"":"none"};
    $("#m_obra").addEventListener("change",()=>{if($("#m_obra").value==="_federico")$("#m_cat").value="Personal Federico";upd()});
    sh.querySelectorAll("#segTipo button").forEach(b=>b.onclick=()=>{st.tipo=b.dataset.t;upd()});
    sh.querySelectorAll("#segMon button").forEach(b=>b.onclick=()=>{st.mon=b.dataset.mon;upd()});
    sh.querySelectorAll("#segPago button").forEach(b=>b.onclick=()=>{st.pago=b.dataset.pago;upd()});
    function cuotaInfo(){const el=$("#m_cuotaInfo");if(!el)return;const n=Math.max(1,parseInt($("#m_cuotas").value)||1),t=num($("#m_monto").value);el.textContent=t?`${n} cuota${n>1?"s":""} de ${fmt(t/n)}`:""}
    $("#m_cuotas").addEventListener("input",cuotaInfo);$("#m_monto").addEventListener("input",cuotaInfo);
    function usdInfo(){const el=$("#m_usdInfo");if(!el)return;const u=num($("#m_usdx").value),pz=num($("#m_monto").value),b=num(S.cfg.cotizacion);
      if(st.tipo==="cambio"){if(u&&pz){const c=pz/u;el.innerHTML=`Te lo tomaron a <b>${fmt(m2(c))}</b> por dólar.${b?` El blue hoy está a ${fmt(b)}: <b style="color:${c<b?"var(--bad)":"var(--good)"}">${c<b?"la cueva se quedó con":"ganaste"} ${fmt(Math.abs(u*(b-c)))}</b>.`:""}`}else el.textContent="Poné cuántos dólares diste y cuántos pesos te dieron: la app calcula a cuánto te lo tomaron.";el.style.display="";return}
      if(st.mon==="USD"&&!legacyUsd){const r=ultimoCambio($("#m_caja").value,$("#m_fecha").value);el.style.display="";
        el.innerHTML=r?`Sale de los dólares de la caja. Para los números de la obra se toma a ${fmt(r.cot)}, el último cambio real (${esc(fdate(r.fecha))}, caja ${esc(r.caja)})${u?`: ${fmt(u*r.cot)}`:""}.`:`Sale de los dólares de la caja. Todavía no hay ningún cambio cargado: para los números de la obra se toma el blue de hoy hasta que cambien.`;return}
      el.style.display="none"}
    $("#m_usdx").addEventListener("input",usdInfo);$("#m_monto").addEventListener("input",usdInfo);$("#m_caja").addEventListener("change",usdInfo);
    $("#m_cat").addEventListener("change",upd);
    if(isEnc()){$("#segTipo").style.display="none";st.tipo="egreso"}
    $("#m_enusd").onchange=ev=>{st.enUsd=ev.target.checked;upd();calc()};
    /* en dólares: se puede poner a cuánto lo tomaron o directamente los pesos que dieron; uno calcula el otro */
    const info=()=>{const u=num($("#m_usd").value),c=num($("#m_cot").value),b=num(S.cfg.cotizacion);
      $("#m_cotInfo").innerHTML=st.enUsd&&u&&c?`Entran <b>${fmt(u*c)}</b> en pesos.${b&&Math.abs(c-b)>=1?` Con el blue de hoy (${fmt(b)}) serían ${fmt(u*b)}: <b style="color:${c<b?"var(--bad)":"var(--good)"}">${c<b?"perdimos":"ganamos"} ${fmt(Math.abs(u*(c-b)))}</b> en el cambio.`:""}`:"Poné los dólares y a cuánto te tomaron cada uno, o directamente los pesos que te dieron en “Monto”."};
    const calc=()=>{if(st.enUsd){const v=num($("#m_usd").value)*num($("#m_cot").value);$("#m_monto").value=v?Math.round(v*100)/100:""}info()};
    const desdePesos=()=>{if(st.enUsd){const u=num($("#m_usd").value),p=num($("#m_monto").value);if(u&&p)$("#m_cot").value=Math.round(p/u*100)/100}info()};
    $("#m_usd").oninput=calc;$("#m_cot").oninput=calc;$("#m_monto").addEventListener("input",desdePesos);upd();info();
    $("#fm").onsubmit=async ev=>{ev.preventDefault();
      const usdMode=st.tipo!=="cambio"&&st.mon==="USD"&&!legacyUsd&&!isEnc(),ux=num($("#m_usdx").value);
      let monto=num($("#m_monto").value);
      if(usdMode){if(!ux)return toast("Falta el monto en dólares");const r=ultimoCambio($("#m_caja").value,$("#m_fecha").value);const cot=r?r.cot:num(S.cfg.cotizacion);monto=m2(ux*(cot||0))}
      else if(st.tipo==="cambio"){if(!ux||!monto)return toast("Completá los dólares y los pesos que te dieron")}
      else if(!monto)return toast("Falta el monto");
      const d={fecha:$("#m_fecha").value,tipo:st.tipo,caja:$("#m_caja").value,monto,detalle:$("#m_det").value.trim(),creado:m.creado};
      for(const k of ["reciboNro","remitoNro","remitoA","remitoDoc","remitoForma","remitoItems","origen"])if(m[k]!=null&&m[k]!=="")d[k]=m[k];
      if(st.tipo==="egreso"&&st.pago==="tarjeta"&&!isEnc()){d.pago="tarjeta";d.tarjeta=$("#m_tarj").value;d.cuotas=Math.max(1,parseInt($("#m_cuotas").value)||1);d.mesPrimerResumen=$("#m_mes1").value||sigMes(d.fecha.slice(0,7));d.caja=duenoTarjeta(d.tarjeta)}
      else if(e&&m.pago==="tarjeta"){d.pago=null;d.tarjeta=null;d.cuotas=null;d.mesPrimerResumen=null}
      if(usdMode){d.moneda="USD";d.usd=ux;const r=ultimoCambio(d.caja,d.fecha);d.cotizacion=r?r.cot:num(S.cfg.cotizacion);d.cotRef=r?"ultimo cambio":"blue"}
      if(st.tipo==="cambio"){d.usd=ux;d.cotizacion=m2(monto/ux);if(num(S.cfg.cotizacion))d.cotizacionBlue=num(S.cfg.cotizacion);d.categoria="Cambio de dólares";d.obra="_empresa"}
      if(st.tipo==="pase"){d.cajaDestino=$("#m_dest").value;if(d.cajaDestino===d.caja)return toast("Elegí dos cajas distintas")}
      else if(st.tipo==="cambio"){}
      else{d.obra=$("#m_obra").value;d.categoria=$("#m_cat").value;if(!d.obra)return toast("Elegí la obra (o “Sin obra”)");
        if(d.categoria==="Personal Federico"&&d.tipo==="egreso")d.obra="_federico";
        if(d.obra==="_federico"&&d.tipo==="egreso"){d.categoria="Personal Federico";d.rubroPersonal=$("#m_rubp").value}}
      if(st.enUsd&&legacyUsd){d.usd=num($("#m_usd").value);d.cotizacion=num($("#m_cot").value);
        if(!d.usd||!d.cotizacion)return toast("Completá los dólares y a cuánto los tomaron");
        if(num(S.cfg.cotizacion))d.cotizacionBlue=num(S.cfg.cotizacion)}
      if(st.tipo==="egreso"&&$("#m_prov")&&$("#m_prov").value)d.proveedorId=$("#m_prov").value;
      if(st.tipo==="egreso"&&$("#wVeh").style.display!=="none"&&$("#m_veh").value)d.vehiculo=$("#m_veh").value;
      for(const k of ["empleadoId","liquidacion","usdRef"])if(m[k]!=null&&d[k]==null)d[k]=m[k];
      const rem=!e&&st.tipo==="egreso"&&$("#m_rem")&&$("#m_rem").checked;
      const nid=await save("movimientos",m.id,d);if(nid){closeSheet();toast("Guardado en la caja "+d.caja);if(rem)setTimeout(()=>emitirRemito({...d,id:typeof nid==="string"?nid:m.id},true),350)}};
  });
}

/* jornales */
function openJor(j){
  const e=!!j; j=j||{fecha:hoy(),cantidad:"",obra:obrasActivas()[0]?.id||""};
  openSheet(`<form id="fj" style="display:flex;flex-direction:column;gap:12px">${sheetHead(e?"Editar jornales":"Cargar jornales")}
    <div class="two"><label class="f">Fecha<input type="date" id="j_fecha" value="${esc(j.fecha)}" required></label>
    <label class="f">Cantidad de jornales<input id="j_cant" inputmode="decimal" value="${esc(j.cantidad)}" required placeholder="0"></label></div>
    <label class="f">Obra<select id="j_obra">${obraOpts(j.obra,false)}</select></label>
    <label class="f">Nota<input id="j_nota" value="${esc(j.nota||"")}" placeholder="Opcional"></label>
    ${isEnc()?"":`<p class="note" style="margin:0">Costo: ${fmt(j.costoUnit||S.cfg.costoJornal)} por jornal.</p>`}
    ${footBtns(e)}</form>`,sh=>{
    wireCommon(sh,"jornales",j.id);
    $("#fj").onsubmit=async ev=>{ev.preventDefault();const c=num($("#j_cant").value);if(!c)return toast("Falta la cantidad");
      if(!$("#j_obra").value)return toast("Primero cargá una obra");
      if(await save("jornales",j.id,{fecha:$("#j_fecha").value,obra:$("#j_obra").value,cantidad:c,nota:$("#j_nota").value.trim(),costoUnit:j.costoUnit||S.cfg.costoJornal,creado:j.creado})){closeSheet();toast("Jornales guardados")}};
  });
}

/* bitácora */
function openBit(b){
  const e=!!(b&&b.id); b=b||{}; b={fecha:hoy(),trabajo:"si",obra:obrasActivas()[0]?.id||"",...b};
  const st={t:b.trabajo};
  openSheet(`<form id="fb" style="display:flex;flex-direction:column;gap:12px">${sheetHead(e?"Editar registro":"Registro del día")}
    <div class="two"><label class="f">Fecha<input type="date" id="b_fecha" value="${esc(b.fecha)}" required></label>
    <label class="f">Obra<select id="b_obra">${obraOpts(b.obra,false)}</select></label></div>
    <div class="f" style="display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;color:var(--muted)">¿Se trabajó?
      <div class="seg" id="segT">${[["si","Sí"],["parcial","Parcial"],["no","No"]].map(([v,l])=>`<button type="button" data-t="${v}" aria-pressed="${st.t===v}">${l}</button>`).join("")}</div></div>
    <label class="f" id="wMot">Motivo<select id="b_mot">${MOTIVOS.map(x=>`<option ${b.motivo===x?"selected":""}>${x}</option>`).join("")}</select></label>
    <label class="f">Personas en obra<input id="b_jor" inputmode="numeric" value="${esc(b.jornales||"")}" placeholder="Opcional"></label>
    <label class="f"><span class="row between">Qué se hizo / observaciones ${dict?`<button type="button" class="mic" id="micBtn">Dictar</button>`:""}</span>
      <textarea id="b_det" placeholder="Ej: se terminó el encofrado del aula 3; el hierro llega el lunes">${esc(b.detalle||"")}</textarea></label>
    ${!e&&b.obra&&S.bit.some(x=>x.obra===b.obra&&x.fecha===b.fecha)?`<div class="banner">Ya hay un registro de esta obra para ese día.</div>`:""}
    ${footBtns(e)}</form>`,sh=>{
    wireCommon(sh,"bitacora",b.id);
    const upd=()=>{sh.querySelectorAll("#segT button").forEach(x=>x.setAttribute("aria-pressed",x.dataset.t===st.t));$("#wMot").style.display=st.t==="si"?"none":""};
    sh.querySelectorAll("#segT button").forEach(x=>x.onclick=()=>{st.t=x.dataset.t;upd()});upd();
    const mic=$("#micBtn");
    if(mic){const ta=$("#b_det");let base="";
      dict.onPartial(({text})=>{if(closeSheet.listening)ta.value=(base?base+" ":"")+text});
      dict.onFinal(({text})=>{base=(base?base+" ":"")+text;ta.value=base});
      dict.onState(({state})=>{closeSheet.listening=state==="listening";mic.classList.toggle("on",closeSheet.listening);mic.textContent=closeSheet.listening?"Detener":"Dictar"});
      mic.onclick=()=>{if(closeSheet.listening){dict.stop().catch(()=>{});return}base=ta.value.trim();
        dict.start().catch(err=>{if(err&&err.code==="not_granted"){mic.remove()}toast("No se pudo usar el micrófono")})};
    }
    $("#fb").onsubmit=async ev=>{ev.preventDefault();if(!$("#b_obra").value)return toast("Primero cargá una obra");
      const d={fecha:$("#b_fecha").value,obra:$("#b_obra").value,trabajo:st.t,motivo:st.t==="si"?"":$("#b_mot").value,jornales:num($("#b_jor").value)||"",detalle:$("#b_det").value.trim(),creado:b.creado};
      if(await save("bitacora",b.id,d)){closeSheet();toast("Registro guardado")}};
  });
}

/* obra */
function openObra(o){
  const e=!!o; o=o||{nombre:"",estado:"En curso"};
  const r=e?resObra(o.id):null;
  openSheet(`<form id="fo" style="display:flex;flex-direction:column;gap:12px">${sheetHead(e?o.nombre:"Nueva obra")}
    ${e?`<div class="grid"><div class="stat"><div class="lbl">Cobrado</div><div class="num">${fmt(r.cobros)}</div></div><div class="stat"><div class="lbl">Gastos + jornales</div><div class="num">${fmt(r.gastos+r.costoJ)}</div></div><div class="stat"><div class="lbl">Resultado</div><div class="num ${r.res<0?"neg":"pos"}">${fmt(r.res)}</div></div></div>`:""}
    <label class="f">Nombre<input id="o_nom" value="${esc(o.nombre)}" required></label>
    <div class="two"><label class="f">Encargado<input id="o_enc" value="${esc(o.encargado||"")}"></label>
    <label class="f">Estado<select id="o_est">${["En curso","Por comenzar","Terminada"].map(x=>`<option ${o.estado===x?"selected":""}>${x}</option>`).join("")}</select></label></div>
    <div class="two"><label class="f">Fecha de inicio<input type="date" id="o_ini" value="${esc(o.fechaInicio||"")}"></label><label class="f">Fecha de fin<input type="date" id="o_fin" value="${esc(o.fechaFin||"")}"></label></div>
    <div class="two"><label class="f">Contrato (US$ blue)<input id="o_usd" inputmode="decimal" value="${o.contratoUsd||""}"></label>
    <label class="f">Cliente<select id="o_cli"><option value="">Sin cliente</option>${[...S.cli].sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(c=>`<option value="${esc(c.id)}" ${o.clienteId===c.id?"selected":""}>${esc(c.nombre)}</option>`).join("")}${o.cliente&&!S.cli.some(c=>c.id===o.clienteId)?`<option value="txt:${esc(o.cliente)}" selected>${esc(o.cliente)} (sin ficha)</option>`:""}</select></label></div>
    <label class="f">Notas<textarea id="o_not">${esc(o.notas||"")}</textarea></label>
    ${e&&(S.movs.some(m=>m.obra===o.id)||S.jorn.some(j=>j.obra===o.id))?`<p class="note" style="margin:0">Esta obra tiene movimientos cargados: en vez de borrarla, pasala a “Terminada”.</p>`:""}
    ${footBtns(e&&!S.movs.some(m=>m.obra===o.id)&&!S.jorn.some(j=>j.obra===o.id)&&!S.bit.some(b=>b.obra===o.id))}</form>`,sh=>{
    wireCommon(sh,"obras",o.id);
    $("#fo").onsubmit=async ev=>{ev.preventDefault();const n=$("#o_nom").value.trim();if(!n)return toast("Falta el nombre");
      let fin=$("#o_fin").value;if($("#o_est").value==="Terminada"&&!fin)fin=hoy();
      if(await save("obras",o.id,{...(o.encargados?{encargados:o.encargados}:{}),nombre:n,encargado:$("#o_enc").value.trim(),estado:$("#o_est").value,fechaInicio:$("#o_ini").value,fechaFin:fin,contratoUsd:num($("#o_usd").value)||0,...(()=>{const v=$("#o_cli").value;if(!v)return {cliente:"",clienteId:""};if(v.startsWith("txt:"))return {cliente:v.slice(4),clienteId:""};const c=S.cli.find(x=>x.id===v);return {cliente:c?c.nombre:"",clienteId:v}})(),notas:$("#o_not").value.trim(),creado:o.creado})){closeSheet();toast($("#o_est").value==="Terminada"&&o.estado!=="Terminada"?"Obra terminada: quedó en el Histórico":"Obra guardada")}};
  });
}

/* configuración */
function openCfg(){
  const c=S.cfg;
  openSheet(`<form id="fc" style="display:flex;flex-direction:column;gap:12px">${sheetHead("Precios y rendimientos")}
    <div class="two"><label class="f">Dólar blue de hoy <span class="note">(se actualiza solo cada 30 min)</span><input id="k_cot" inputmode="decimal" value="${c.cotizacion||""}"></label>
    <label class="f">Lo que nos cuesta el jornal<input id="k_jor" inputmode="decimal" value="${c.costoJornal}"></label></div>
    <label class="f">Lista de precios que usa la IA para presupuestar <span class="note">(pegá acá las listas de tus proveedores)</span><textarea id="k_lista" rows="5">${esc(c.listaPrecios||"")}</textarea></label>
    <label class="f">Precio del jornal al cliente<input id="k_pj" inputmode="decimal" value="${c.precioJornal||""}" placeholder="Ej: 130000"></label>
    <p class="note" style="margin:0">La ganancia está en la diferencia entre lo que cobramos el jornal y lo que nos cuesta. El cliente solo ve el precio; la diferencia la ves vos.</p>
    <h3>Precios</h3>
    <div class="two"><label class="f">Hormigón H21 por m³<input id="k_h" inputmode="decimal" value="${c.precios.hormigon}"></label>
    <label class="f">Macrofibra bolsa 4 kg<input id="k_f" inputmode="decimal" value="${c.precios.macrofibra}"></label>
    <label class="f">Bomba: instalación<input id="k_bf" inputmode="decimal" value="${c.precios.bombaFija}"></label>
    <label class="f">Bomba: por m³<input id="k_bm" inputmode="decimal" value="${c.precios.bombaM3}"></label></div>
    <h3>Rendimientos</h3>
    <div class="two"><label class="f">Pared: m² por jornal<input id="k_rp" inputmode="decimal" value="${c.rend.pared}"></label>
    <label class="f">Revoque: m² por jornal<input id="k_rr" inputmode="decimal" value="${c.rend.revoque}"></label>
    <label class="f">Llenado de platea (jornales)<input id="k_rl" inputmode="decimal" value="${c.rend.platea}"></label></div>
    <h3>Saldos de las cajas</h3>
    <label class="f">Contar movimientos desde<input type="date" id="k_cd" value="${esc(c.cajasDesde||"")}"></label>
    <div class="two">${CAJAS.map((x,i)=>`<label class="f">Saldo inicial ${esc(x)}<input data-si="${esc(x)}" inputmode="decimal" value="${(c.saldosIniciales||{})[x]||""}" placeholder="0"></label>`).join("")}</div>
    <p class="note" style="margin:0">El saldo de cada caja = saldo inicial + entradas − salidas desde esa fecha. Los movimientos anteriores quedan en el historial y en los resultados de obra.</p>
    <h3>Arranque de cada caja con el efectivo contado</h3>
    <p class="note" style="margin:0">Si una caja tiene fecha acá, su saldo arranca ese día con estos pesos y dólares (lo de antes queda solo como historial). Dejá la fecha vacía para usar lo de arriba.</p>
    ${CAJAS.map(x=>{const I=(c.inicioCajas||{})[x]||{};return `<div class="two" style="grid-template-columns:1.1fr 1fr 1fr"><label class="f">${esc(x)}: desde el<input type="date" data-ini-f="${esc(x)}" value="${esc(I.fecha||"")}"></label><label class="f">Pesos<input data-ini-a="${esc(x)}" inputmode="decimal" value="${I.fecha?(I.ars||0):""}" placeholder="0"></label><label class="f">Dólares<input data-ini-u="${esc(x)}" inputmode="decimal" value="${I.fecha?(I.usd||0):""}" placeholder="0"></label></div>`}).join("")}
    <button type="button" class="btn" id="usersBtn">Usuarios y permisos</button>
    <button type="button" class="btn" id="backupBtn">Descargar copia de seguridad</button>
    <button type="button" class="btn" id="packBtn">Importar archivo de datos (.json)</button>
    <p class="note" style="margin:0">El costo por jornal nuevo se aplica a los jornales que cargues de ahora en más; los ya cargados mantienen su costo.</p>
    ${footBtns(false)}</form>`,sh=>{
    sh.querySelector("[data-close]").onclick=closeSheet;
    $("#usersBtn").onclick=()=>{closeSheet();openUsers()};
    $("#backupBtn").onclick=()=>copiaSeguridad();
    $("#packBtn").onclick=()=>{closeSheet();runPack()};
    $("#fc").onsubmit=async ev=>{ev.preventDefault();if(!db)return toast("Sin conexión");
      const d={cotizacion:num($("#k_cot").value),costoJornal:num($("#k_jor").value)||100000,precioJornal:num($("#k_pj").value),cotizacionFecha:hoy(),
        precios:{hormigon:num($("#k_h").value),macrofibra:num($("#k_f").value),bombaFija:num($("#k_bf").value),bombaM3:num($("#k_bm").value)},
        rend:{pared:num($("#k_rp").value)||10,revoque:num($("#k_rr").value)||12,platea:num($("#k_rl").value)||16},
        inicioCajas:Object.fromEntries(CAJAS.map(x=>{const f=document.querySelector(`[data-ini-f="${x}"]`).value;return [x,f?{fecha:f,ars:num(document.querySelector(`[data-ini-a="${x}"]`).value),usd:num(document.querySelector(`[data-ini-u="${x}"]`).value)}:null]}).filter(([,v])=>v)),
        cajasDesde:$("#k_cd").value||"",saldosIniciales:Object.fromEntries([...document.querySelectorAll("[data-si]")].map(i=>[i.dataset.si,num(i.value)]))};
      d.listaPrecios=$("#k_lista").value.trim();
      const {id:_i,_por:_p,...resto}=S.cfg;
      try{await db.doc("config/general").set({...resto,...d});closeSheet();toast("Guardado")}catch(e){toast(errMsg(e))}};
  });
}

/* ---------- presupuestos ---------- */
const EST_P=["Borrador","Enviado","Aprobado","Rechazado"];
function presPill(e){e=e||"Borrador";return `<span class="pill ${e==="Aprobado"?"p-good":e==="Rechazado"?"p-bad":e==="Enviado"?"p-acc":"p-mut"}">${esc(e)}</span>`}
function presTot(p){const sub=(p.items||[]).reduce((a,i)=>a+num(i.cant)*num(i.precio),0);const gan=0;const neto=sub+gan;const iva=neto*num(p.iva)/100;const total=neto+iva;
  const cot=num(p.cotizacion)||S.cfg.cotizacion;return {sub,gan,neto,iva,total,usd:cot?total/cot:0,cot}}
function openPres(p,extraItems){
  const e=!!(p&&p.id);
  if(p&&!p.id&&p.desdeIA){const ia=p;p=null;openPres.ia=ia}
  const next=S.pres.reduce((a,x)=>Math.max(a,+x.numero||0),0)+1;
  const st=structuredClone(p||{numero:next,fecha:hoy(),cliente:"",obra:"",estado:"Borrador",ganancia:0,iva:0,cotizacion:S.cfg.cotizacion||0,notas:"",items:[]});
  if(openPres.ia){const ia=openPres.ia;openPres.ia=null;st.cliente=ia.cliente||"";st.obra=ia.obra||ia.titulo||"";st.items=ia.items||[];
    st.notas=[ia.nota,(ia.supuestos||[]).filter(Boolean).length?"Supuestos: "+ia.supuestos.filter(Boolean).join("; "):""].filter(Boolean).join("\n");st.dictado=ia.dictado||""}
  if(extraItems)st.items=[...(st.items||[]),...extraItems];
  if(!st.items.length)st.items=[{d:"",cant:1,unid:"u",precio:""}];
  const itemsHtml=()=>st.items.map((it,k)=>`<div class="card" style="padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--soft)">
    <label class="f">Ítem ${k+1}<input data-i="${k}" data-k="d" value="${esc(it.d)}" placeholder="Ej: Placa EPS 10 cm"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr 1.6fr auto;gap:8px;align-items:end">
      <label class="f">Cant.<input data-i="${k}" data-k="cant" inputmode="decimal" value="${esc(it.cant)}"></label>
      <label class="f">Unidad<input data-i="${k}" data-k="unid" value="${esc(it.unid)}" placeholder="m², u, gl"></label>
      <label class="f">Precio unit. $<input data-i="${k}" data-k="precio" inputmode="decimal" value="${esc(it.precio)}"></label>
      <button type="button" class="btn sm" data-rm="${k}" aria-label="Quitar ítem ${k+1}">Quitar</button></div></div>`).join("");
  const totHtml=()=>{const t=presTot(st);return `<table><tbody><tr><td>Subtotal</td><td>${fmt(t.sub)}</td></tr>
    ${num(st.iva)?`<tr><td>IVA ${num(st.iva)}%</td><td>${fmt(t.iva)}</td></tr>`:""}</tbody><tfoot><tr><td>Total al cliente</td><td>${fmt(t.total)}</td></tr>${t.usd?`<tr><td>En dólar blue (a ${fmt(t.cot)})</td><td>${fmtU(t.usd)}</td></tr>`:""}</tfoot></table>`+(()=>{let jt=0,cob=0;for(const it of st.items){const j=/jornal/i.test(it.unid||"")?num(it.cant):num(it.jor);if(j){jt+=j;cob+=num(it.cant)*num(it.precio)}}return ganInterna(jt,cob)})()};
  openSheet(`<form id="fp" style="display:flex;flex-direction:column;gap:12px">${sheetHead(e?"Presupuesto N° "+st.numero:"Nuevo presupuesto")}
    <div class="two"><label class="f">Cliente<input id="p_cli" list="dl_cli" value="${esc(st.cliente)}"><datalist id="dl_cli">${S.cli.map(c=>`<option value="${esc(c.nombre)}"></option>`).join("")}</datalist></label><label class="f">Obra / dirección<input id="p_obra" value="${esc(st.obra)}"></label>
    <label class="f">Fecha<input type="date" id="p_fecha" value="${esc(st.fecha)}"></label><label class="f">Estado<select id="p_est">${EST_P.map(x=>`<option ${st.estado===x?"selected":""}>${x}</option>`).join("")}</select></label></div>
    <h3>Ítems</h3><div id="p_items" style="display:flex;flex-direction:column;gap:8px">${itemsHtml()}</div>
    <button type="button" class="btn" id="p_add">+ Agregar ítem</button>
    <div class="two"><label class="f">IVA %<input id="p_iva" inputmode="decimal" value="${esc(st.iva)}" placeholder="0 o 10,5 o 21"></label>
    <label class="f">Dólar blue<input id="p_cot" inputmode="decimal" value="${esc(st.cotizacion||"")}"></label></div>
    <p class="note" style="margin:0">Para mano de obra poné la unidad “jornales” (o pasala desde el cálculo rápido) y abajo ves tu ganancia interna. El cliente no la ve.</p>
    <div id="p_tot" class="card">${totHtml()}</div>
    <label class="f">Notas / condiciones<textarea id="p_not" placeholder="Ej: validez 7 días, forma de pago 50% anticipo">${esc(st.notas)}</textarea></label>
    <div class="row"><button type="button" class="btn pri" id="p_wa">📲 Mandar por WhatsApp</button><button type="button" class="btn" id="p_copy">Copiar texto</button>${dl?`<button type="button" class="btn" id="p_csv">Descargar CSV</button>`:""}<button type="button" class="btn" id="p_dup">Duplicar</button></div>
    ${footBtns(e)}</form>`,sh=>{
    wireCommon(sh,"presupuestos",st.id);
    const refreshTot=()=>$("#p_tot").innerHTML=totHtml();
    const wireItems=()=>{sh.querySelectorAll("#p_items input").forEach(i=>i.oninput=()=>{st.items[+i.dataset.i][i.dataset.k]=i.value;refreshTot()});
      sh.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{st.items.splice(+b.dataset.rm,1);if(!st.items.length)st.items.push({d:"",cant:1,unid:"u",precio:""});$("#p_items").innerHTML=itemsHtml();wireItems();refreshTot()})};
    wireItems();
    $("#p_add").onclick=()=>{st.items.push({d:"",cant:1,unid:"u",precio:""});$("#p_items").innerHTML=itemsHtml();wireItems();sh.querySelector(`[data-i="${st.items.length-1}"][data-k="d"]`).focus()};
    [["p_iva","iva"],["p_cot","cotizacion"]].forEach(([id,k])=>$("#"+id).oninput=ev=>{st[k]=ev.target.value;refreshTot()});
    const collect=()=>{st.cliente=$("#p_cli").value.trim();st.obra=$("#p_obra").value.trim();st.fecha=$("#p_fecha").value;st.estado=$("#p_est").value;st.notas=$("#p_not").value.trim()};
    const txt=()=>{collect();const t=presTot(st);const f=1;
      return `SINNER CONSTRUCCIONES — Presupuesto N° ${st.numero}\nFecha: ${fdate(st.fecha)}\nCliente: ${st.cliente}\n${st.obra?"Obra: "+st.obra+"\n":""}\n`+
      st.items.filter(i=>i.d||num(i.precio)).map(i=>`• ${i.d}: ${num(i.cant)} ${i.unid} × ${fmt(num(i.precio)*f)} = ${fmt(num(i.cant)*num(i.precio)*f)}`).join("\n")+
      `\n\n${num(st.iva)?`Subtotal: ${fmt(t.neto)}\nIVA ${num(st.iva)}%: ${fmt(t.iva)}\n`:""}TOTAL: ${fmt(t.total)}${t.usd?` (${fmtU(t.usd)} a dólar blue ${fmt(t.cot)})`:""}${st.notas?"\n\n"+st.notas:""}`};
    $("#p_wa").onclick=async()=>{const t=txt();if(navigator.share){try{await navigator.share({text:t});return}catch(er){if(er&&er.name==="AbortError")return}}
      window.open("https://wa.me/?text="+encodeURIComponent(t),"_blank","noopener")};
    $("#p_copy").onclick=async()=>{try{await navigator.clipboard.writeText(txt());toast("Presupuesto copiado")}catch(er){toast("No se pudo copiar")}};
    const csv=$("#p_csv");if(csv)csv.onclick=()=>{collect();const t=presTot(st);const f=1;
      saveFile(`presupuesto_${st.numero}_${(st.cliente||"cliente").replace(/[^\w]+/g,"_")}.csv`,[["Sinner Construcciones - Presupuesto N° "+st.numero],["Cliente",st.cliente],["Obra",st.obra],["Fecha",fdate(st.fecha)],[],
        ["Ítem","Cantidad","Unidad","Precio unitario $","Subtotal $"],...st.items.filter(i=>i.d||num(i.precio)).map(i=>[i.d,num(i.cant),i.unid,Math.round(num(i.precio)*f),Math.round(num(i.cant)*num(i.precio)*f)]),
        [],["Subtotal","","","",Math.round(t.neto)],["IVA "+num(st.iva)+"%","","","",Math.round(t.iva)],["TOTAL","","","",Math.round(t.total)],["Total US$ blue","","","",t.usd?Math.round(t.usd):""]])};
    $("#p_dup").onclick=()=>{collect();const c=structuredClone(st);delete c.id;c.numero=next+(e?0:1);c.estado="Borrador";c.fecha=hoy();closeSheet();setTimeout(()=>openPres(c),50)};
    $("#fp").onsubmit=async ev=>{ev.preventDefault();collect();
      const d={numero:+st.numero,fecha:st.fecha,cliente:st.cliente,obra:st.obra,estado:st.estado,ganancia:0,iva:num(st.iva),cotizacion:num(st.cotizacion),notas:st.notas,
        items:st.items.filter(i=>i.d||num(i.precio)).map(i=>({d:i.d,cant:num(i.cant),unid:i.unid,precio:num(i.precio),...(num(i.jor)?{jor:num(i.jor)}:{})})),creado:st.creado};
      if(await save("presupuestos",st.id,d)){closeSheet();toast("Presupuesto guardado")}};
  });
}

/* ---------- pase de datos desde la app anterior ---------- */
function importBanner(){
  if(isAdmin()&&S.importing)return `<div class="card"><b>Pasando los datos…</b><p class="note" style="margin:6px 0 0">${S.importing.n} de ${S.importing.total}. No cierres la página hasta que termine.</p></div>`;
  if(!isAdmin())return "";
  const adm=`<section class="card"><h3 style="margin-bottom:8px">Administración</h3><div class="row">
    <button class="btn sm pri" type="button" data-adm="pagorem">+ Pago con remito</button>
    <button class="btn sm pri" type="button" data-adm="newenc">+ Encargado</button>
    <button class="btn sm pri" type="button" data-adm="newobra">+ Obra</button>
    <button class="btn sm pri" type="button" data-adm="newcli">+ Cliente</button>
    <button class="btn sm pri" type="button" data-adm="newprov">+ Proveedor</button>
    <button class="btn sm pri" type="button" data-adm="newherr">+ Herramienta</button>
    <button class="btn sm" type="button" data-adm="users">Usuarios y contraseñas</button>
    <button class="btn sm" type="button" data-go="sueldos">Sueldos de la semana</button>
    <button class="btn sm" type="button" data-adm="pack">Importar datos (.json)</button>
    <button class="btn sm" type="button" data-adm="cfg">Precios, jornal y saldos</button>
    <button class="btn sm" type="button" data-adm="backup">Copia de seguridad</button>
    <button class="btn sm" type="button" data-go="empresa">Empresa: gastos, herramientas y vehículos</button></div></section>`;
  if(S.imp===undefined||(S.imp&&S.imp.done))return "";
  return `<div class="card" style="border-color:var(--gold);display:flex;flex-direction:column;gap:8px"><b>Datos listos para pasar</b>
    <p class="note" style="margin:0">Obras, movimientos y jornales que estaban en la app de Claude (Colegio Las Tejas, Santa Rosa, Emilia VGB, Villa María Eleven y el resto de las obras). Tocá el botón y elegí el archivo <b>datos.json</b> que te pasó Claude. Se hace una sola vez.</p>
    <div><button class="btn pri" id="impBtn">Pasar datos ahora</button></div></div>`;
}
async function runImport(){
  if(S.importing)return;
  const file=await new Promise(res=>{const i=document.createElement("input");i.type="file";i.style.display="none";document.body.appendChild(i);i.onchange=()=>{res(i.files[0]);i.remove()};i.click()});
  if(!file)return;
  let pack;try{pack=JSON.parse(await file.text());if(!Array.isArray(pack.docs))throw 0}catch(e){return toast("Ese archivo no es datos.json")}
  const by={};for(const x of pack.docs){const[t,id]=x.p.split("/");(by[t]=by[t]||[]).push({id,data:x.d})}
  S.importing={n:0,total};render();
  try{
    for(const [t,rows] of Object.entries(by)){
      for(let i=0;i<rows.length;i+=200){const {error}=await sb.from(t).upsert(rows.slice(i,i+200));if(error)throw error;S.importing.n+=Math.min(200,rows.length-i);render()}
    }
    const {error}=await sb.from("config").upsert({id:"importacion",data:{done:true,version:pack.version,cantidad:pack.docs.length,fin:Date.now()}});if(error)throw error;
    S.importing=null;await cargarTodo();toast("Datos pasados");render();
  }catch(e){S.importing=null;toast("Se cortó el pase. Tocá de nuevo: no se duplica nada.");render()}
}

async function runPack(){
  if(!isAdmin())return toast("Solo administradores");
  if(S.importing)return;
  const file=await new Promise(res=>{const i=document.createElement("input");i.type="file";i.style.display="none";document.body.appendChild(i);i.onchange=()=>{res(i.files[0]);i.remove()};i.click()});
  if(!file)return;
  let pack;try{pack=JSON.parse(await file.text());if(!Array.isArray(pack.docs))throw 0}catch(e){return toast("Ese archivo no es un paquete de datos")}
  const by={},cnt={};
  for(const x of pack.docs){const[t,id]=String(x.p||"").split("/");
    if(!(t in TABLAS)||(t==="config"&&!(id==="general"&&x.d&&x.d.mezclar===true&&Object.keys(x.d).every(k=>["mezclar","inicioCajas"].includes(k))))||!id||!/^[\w-]{1,80}$/.test(id)||!x.d||typeof x.d!=="object")return toast("El archivo tiene datos no válidos ("+String(x.p).slice(0,40)+")");
    (by[t]=by[t]||[]).push({id,data:x.d});cnt[t]=(cnt[t]||0)+1}
  /* ajustes que se suman a la configuración sin pisar el resto */
  let cfgMerge=null;if(by.config){const g=by.config.find(r=>r.id==="general"&&r.data.mezclar);if(g){const {mezclar,...x}=g.data;cfgMerge=x}by.config=by.config.filter(r=>!(r.id==="general"&&r.data.mezclar));if(!by.config.length)delete by.config}
  const borrar=[];for(const t of Object.keys(by)){by[t]=by[t].filter(r=>{if(r.data.borrar===true){borrar.push({t,id:r.id,motivo:r.data.motivo||""});return false}return true});if(!by[t].length)delete by[t]}
  /* no pisar lo que ya existe ni duplicar lo que se cargó a mano */
  const kMov=m=>[m.fecha,m.caja,m.tipo,Math.round(+m.monto||0),m.tipo==="pase"?m.cajaDestino:(m.obra||"")].join("|");
  const yaMov=new Map();for(const m of S.movs){const k=kMov(m);yaMov.set(k,(yaMov.get(k)||0)+1)}
  const local={movimientos:S.movs,jornales:S.jorn,bitacora:S.bit,obras:S.obras,empleados:S.emp,sueldos:S.liqs};
  const salteados=[];let total=0;
  for(const t of Object.keys(by)){by[t]=by[t].filter(r=>{
    if(!(+pack.version>=22))return true;
    const L=local[t]||[];if(L.some(x=>x.id===r.id)){if(r.data.actualizar)return true;salteados.push(t+": ya estaba ("+r.id+")");return false}
    if(t==="movimientos"&&r.data.revisarDuplicado){const k=kMov(r.data);if(yaMov.get(k)){yaMov.set(k,yaMov.get(k)-1);salteados.push(`${fdate(r.data.fecha)} ${r.data.caja} ${fmt(r.data.monto)}: ya estaba cargado a mano`);return false}}
    if((t==="jornales"||t==="bitacora")&&L.some(x=>x.id!==r.id&&x.fecha===r.data.fecha&&x.obra===r.data.obra)){salteados.push(`${t} ${fdate(r.data.fecha)} ${obraNombre(r.data.obra)}: ya estaba cargado`);return false}
    return true});total+=by[t].length;if(!by[t].length)delete by[t]}
  const local2={movimientos:S.movs,jornales:S.jorn,bitacora:S.bit,obras:S.obras,empleados:S.emp,sueldos:S.liqs};
  const aBorrar=borrar.filter(b=>(local2[b.t]||[]).some(x=>x.id===b.id));
  const cfgTxt=cfgMerge?.inicioCajas?"Arranque de cajas: "+Object.entries(cfgMerge.inicioCajas).map(([c,v])=>`${c} desde ${fdate(v.fecha)}: ${fmt(v.ars||0)}${v.usd?" + "+fmtU(v.usd):""}`).join(" · "):"";
  if(!total&&!aBorrar.length&&!cfgMerge)return alert("Todo lo de este archivo ya estaba cargado. No se agregó nada.\n\n"+salteados.slice(0,25).join("\n"));
  const res=Object.entries(by).map(([t,L])=>L.length+" "+t).join(", ");
  if(!confirm(`${cfgTxt?cfgTxt+"\n\n":""}Se van a cargar ${total} registros nuevos${res?" ("+res+")":""}.${aBorrar.length?`\nSe borran ${aBorrar.length} que quedan reemplazados:\n`+aBorrar.map(b=>"• "+b.motivo).join("\n"):""}${salteados.length?`\n\nSe saltean ${salteados.length} porque ya estaban:\n`+salteados.slice(0,15).join("\n")+(salteados.length>15?"\n…":""):""}\n\n¿Seguimos?`))return;
  S.importing={n:0,total};render();
  try{
    for(const [t,rows] of Object.entries(by)){
      for(let i=0;i<rows.length;i+=200){const {error}=await sb.from(t).upsert(rows.slice(i,i+200));if(error)throw error;S.importing.n+=Math.min(200,rows.length-i);render()}
    }
    for(const b of aBorrar){const {error}=await sb.from(b.t).delete().eq("id",b.id);if(error)throw error}
    if(cfgMerge){const {id:_i,_por:_p,...resto}=S.cfg;const nx={...resto,...cfgMerge};if(cfgMerge.inicioCajas)nx.inicioCajas={...(resto.inicioCajas||{}),...cfgMerge.inicioCajas};await db.doc("config/general").set(nx)}
    S.importing=null;await cargarTodo();toast("Listo: "+total+" registros cargados");render();
  }catch(e){S.importing=null;toast("Se cortó la carga. Probá de nuevo: no se duplica nada.");render()}
}

/* ---------- exportar ---------- */
const csvCell=v=>{let s=String(v??"");if(typeof v==="string"&&/^[=+\-@\t\r]/.test(s))s="'"+s;return /[";\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
async function saveFile(name,rows){
  const txt="﻿"+rows.map(r=>r.map(csvCell).join(";")).join("\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([txt],{type:"text/csv;charset=utf-8"}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)
}
function exportMovs(){
  const f=S.filt;let L=S.movs.filter(m=>f.mes==="todo"||(m.fecha||"").startsWith(f.mes));
  if(f.caja!=="Todas")L=L.filter(m=>m.caja===f.caja||m.cajaDestino===f.caja);
  L=[...L].sort((a,b)=>(a.fecha||"").localeCompare(b.fecha||""));
  saveFile(`caja_${f.caja}_${f.mes}.csv`,[["Fecha","Tipo","Caja","Caja destino","Obra","Categoría","Detalle","Dólares","Cotización","Pesos"],
    ...L.map(m=>[fdate(m.fecha),m.tipo==="pase"?"Pase":m.tipo==="ingreso"?"Entrada":"Salida",m.caja,m.cajaDestino||"",m.tipo==="pase"?"":obraNombre(m.obra),m.categoria||"",m.detalle||"",m.usd||"",m.cotizacion||"",Math.round(+m.monto||0)])]);
}
function exportRes(){
  saveFile(`resultado_obras_${hoy()}.csv`,[["Obra","Estado","Inicio","Fin","Encargado","Contrato US$","Cobrado $","Gastos $","Jornales","Costo jornales $","Resultado $","Días trabajados","Parciales","Días perdidos"],
    ...sortObras(S.obras).map(o=>{const r=resObra(o.id);const f=fechasObra(o);return [o.nombre,o.estado,fdate(f.ini),fdate(f.fin),o.encargado||"",o.contratoUsd||"",Math.round(r.cobros),Math.round(r.gastos),r.cantJ,Math.round(r.costoJ),Math.round(r.res),r.trab,r.parc,r.perd]})]);
}

/* ---------- encargado: inicio ---------- */
function vInicioEnc(){
  const hoyS=hoy(),nom=(S.perfil?.nombre||"").toLowerCase();
  let mias=sortObras(obrasActivas()).filter(o=>o.estado==="En curso");
  const propias=mias.filter(o=>nom&&(o.encargado||"").toLowerCase().includes(nom));if(propias.length)mias=propias;
  const ult=S.movs.filter(m=>m.caja===S.perfil?.caja||m.cajaDestino===S.perfil?.caja).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")||(b.creado||0)-(a.creado||0)).slice(0,5);
  return `<div class="row between"><h2>Hola, ${esc(S.perfil?.nombre||"")}</h2><span class="note">${esc(dlabel(hoyS))}</span></div>
  <div class="grid"><button class="btn pri" data-new="mov" style="padding:16px">+ Gasto</button><button class="btn pri" data-new="jor" style="padding:16px">+ Jornales</button><button class="btn pri" data-new="bit" style="padding:16px">+ Bitácora</button></div>
  ${S.perfil?.caja?`<section class="card"><div class="row between"><h3>Saldo de tu caja (${esc(S.perfil.caja)})</h3><span class="num ${saldoCaja(S.perfil.caja)<0?"neg":""}" style="font-size:22px;font-weight:800">${fmt(saldoCaja(S.perfil.caja))}</span></div></section>`:""}
  <section class="card"><h3 style="margin-bottom:10px">Bitácora de hoy</h3>
    ${mias.length?`<div class="list">${mias.map(o=>{const b=S.bit.find(x=>x.obra===o.id&&x.fecha===hoyS);
      return `<button class="item" data-bit-new="${esc(o.id)}"><span class="t">${esc(o.nombre)}</span><span class="s">${b?"Cargada":"Tocá para cargar"}</span><span class="m">${b?pillTrab(b.trabajo):`<span class="pill p-warn">Falta cargar</span>`}</span></button>`}).join("")}</div>`:`<div class="empty">No hay obras en curso.</div>`}</section>
  <section class="card"><div class="row between" style="margin-bottom:10px"><h3>Últimos movimientos de tu caja</h3><button class="btn sm" data-go="caja">Ver todos</button></div>
    ${ult.length?`<div class="list">${ult.map(m=>`<button class="item" data-edit-mov="${esc(m.id)}"><span class="t">${esc(m.detalle||m.categoria)}</span><span class="s">${esc(fdate(m.fecha))} · ${esc(obraNombre(m.obra))}</span><span class="m">${fmt(m.monto)}</span></button>`).join("")}</div>`:`<div class="empty">Todavía no cargaste gastos.</div>`}</section>`;
}

/* ---------- login ---------- */
const configurado=()=>!SUPABASE_URL.startsWith("PEGAR")&&!SUPABASE_KEY.startsWith("PEGAR");
function vLogin(){
  const box=(inner)=>`<div class="card" style="max-width:400px;width:100%;margin:24px auto;display:flex;flex-direction:column;gap:12px">${inner}</div>`;
  if(!configurado())return box(`<h2>Falta configurar</h2><p class="note" style="margin:0">Pegá la URL y la clave de Supabase al principio del archivo index.html.</p>`);
  if(S.auth==="loading")return box(`<div class="empty">Cargando…</div>`);
  if(S.auth==="pending")return box(`<h2>Usuario sin habilitar</h2><p style="margin:0">Tu usuario (${esc(S.perfil?.email||"")}) todavía no tiene permisos. Pedile a administración que te habilite.</p>`);
  if(S.auth==="recovery")return box(`<form id="fRec" style="display:flex;flex-direction:column;gap:12px"><h2>Nueva contraseña</h2>
    <label class="f">Contraseña nueva<input type="password" id="r_pw" autocomplete="new-password" minlength="8" required></label>
    <label class="f">Repetila<input type="password" id="r_pw2" autocomplete="new-password" minlength="8" required></label>
    ${S.authMsg?`<div class="banner">${esc(S.authMsg)}</div>`:""}<button class="btn pri" type="submit">Guardar contraseña</button></form>`);
  return box(`<form id="fLog" style="display:flex;flex-direction:column;gap:12px"><h2>Ingresar</h2>
    ${(()=>{const rec=recUser();return rec?`<input type="hidden" id="l_mail" value="${esc(rec)}"><div class="row between"><span>Hola, <b>${esc(rec)}</b></span><button class="btn sm" type="button" id="l_other">No soy yo</button></div>`
      :`<label class="f">Usuario o mail<input type="text" id="l_mail" autocomplete="username" autocapitalize="none" placeholder="Ej: Lucas Fissore" required></label>`})()}
    <label class="f">Contraseña<input type="password" id="l_pw" autocomplete="current-password" required></label>
    <label class="row" style="font-size:14px;font-weight:600"><input type="checkbox" id="l_rec" ${recUser()?"checked":""}> Recordar mi usuario en este dispositivo</label>
    ${S.authMsg?`<div class="banner">${esc(S.authMsg)}</div>`:""}
    <button class="btn pri" type="submit">Entrar</button>
    <button class="btn" type="button" id="l_forgot">Olvidé mi contraseña</button></form>`);
}
const recUser=()=>{try{return localStorage.getItem("sinner_usuario")||""}catch(_){return ""}};
const slugUser=s=>norm(s).replace(/\s+/g,"").replace(/[^a-z0-9._-]/g,"");
const aMail=v=>{v=String(v||"").trim();return v.includes("@")?v.toLowerCase():slugUser(v)+"@sinner.app"};
const verUsuario=u=>u.usuario||((u.email||"").endsWith("@sinner.app")?u.email.replace("@sinner.app",""):u.email);
function bindLogin(){
  const f=$("#fLog");
  if(f){f.onsubmit=async e=>{e.preventDefault();S.authMsg="";
      const u=$("#l_mail").value.trim();
      const {error}=await sb.auth.signInWithPassword({email:aMail(u),password:$("#l_pw").value});
      if(error){S.authMsg="Usuario o contraseña incorrectos.";render();return}
      try{if($("#l_rec").checked)localStorage.setItem("sinner_usuario",u);else localStorage.removeItem("sinner_usuario")}catch(_){}};
    const oth=$("#l_other");if(oth)oth.onclick=()=>{try{localStorage.removeItem("sinner_usuario")}catch(_){}S.authMsg="";render()};
    setTimeout(()=>{const pw=$("#l_pw");if(pw&&recUser())pw.focus()},50);
    $("#l_forgot").onclick=async()=>{const m=$("#l_mail").value.trim();if(!m){S.authMsg="Escribí tu mail arriba y tocá de nuevo.";render();return}
      if(!m.includes("@")){S.authMsg="Si entrás con usuario, pedile a administración que te cambie la contraseña.";render();return}
      const {error}=await sb.auth.resetPasswordForEmail(m,{redirectTo:location.origin+location.pathname});
      S.authMsg=error?"No se pudo mandar el mail. Probá en un rato.":"Te mandamos un mail con un link para crear una contraseña nueva.";render()}}
  const r=$("#fRec");
  if(r)r.onsubmit=async e=>{e.preventDefault();const a=$("#r_pw").value,b=$("#r_pw2").value;
    if(a!==b){S.authMsg="Las contraseñas no coinciden.";render();return}
    const {error}=await sb.auth.updateUser({password:a});
    if(error){S.authMsg="No se pudo guardar. Usá al menos 8 caracteres.";render();return}
    S.authMsg="";toast("Contraseña guardada");const {data}=await sb.auth.getSession();iniciar(data.session,true)};
}
$("#outBtn").addEventListener("click",async()=>{await sb.auth.signOut();location.hash="";location.reload()});

/* ---------- usuarios (solo administración) ---------- */
const isAdmin=()=>S.rol==="admin";
const obrasCargo=()=>sortObras(S.obras).filter(o=>o.estado!=="Terminada");
async function asignarObras(uid,ids){
  for(const o of obrasCargo()){const tiene=(o.encargados||[]).includes(uid),quiere=ids.includes(o.id);
    if(tiene===quiere)continue;const {id,_por,...rest}=o;
    const enc=quiere?[...(o.encargados||[]),uid]:(o.encargados||[]).filter(x=>x!==uid);
    await db.collection("obras").doc(id).set({...rest,encargados:enc})}}
async function openUsers(){
  const {data,error}=await sb.from("perfiles").select("*").order("creado");
  if(error)return toast("No se pudieron leer los usuarios");
  const rolOpts=sel=>[["encargado","Encargado de obra"],["admin","Administración"],["pendiente","Sin acceso"]].map(([v,l])=>`<option value="${v}" ${sel===v?"selected":""}>${l}</option>`).join("");
  const cajaOpts=sel=>`<option value="">—</option>${CAJAS.map(c=>`<option ${sel===c?"selected":""}>${c}</option>`).join("")}`;
  openSheet(`<div style="display:flex;flex-direction:column;gap:12px">${sheetHead("Usuarios y permisos")}
    <p class="note" style="margin:0"><b>Administración</b> ve y carga todo. <b>Encargado</b> solo carga gastos de su caja, jornales y bitácora.</p>
    <form id="nu" class="card" style="display:flex;flex-direction:column;gap:8px;border-color:var(--gold)"><h3>Nuevo usuario</h3>
      <div class="two"><label class="f">Nombre y apellido<input id="nu_nom" required placeholder="Ej: Lucas Fissore"></label>
      <label class="f">Usuario para entrar<input id="nu_user" required autocapitalize="none" placeholder="lucasfissore"></label>
      <label class="f">Contraseña<input id="nu_pw" required minlength="8" placeholder="Mínimo 8 caracteres"></label>
      <label class="f">Permiso<select id="nu_rol">${rolOpts("encargado")}</select></label>
      <label class="f">Caja (encargados)<select id="nu_caja">${cajaOpts("")}</select></label></div>
      <div id="nu_obw"><span class="note"><b>Obras a cargo</b> (encargados):</span><div class="row" style="margin-top:4px">${obrasCargo().map(o=>`<label class="row" style="font-size:14px;gap:4px"><input type="checkbox" data-nob="${esc(o.id)}"> ${esc(o.nombre)}</label>`).join("")}</div></div>
      <p class="note" style="margin:0">Anotá el usuario y la contraseña en tu lista: la contraseña después no se puede ver, solo cambiar.</p>
      <div><button class="btn pri" type="submit">Crear usuario</button></div></form>
    ${data.map(u=>`<div class="card" style="display:flex;flex-direction:column;gap:8px;background:var(--soft)" data-u="${esc(u.id)}">
      <div class="row between"><b>${esc(u.nombre||verUsuario(u))}</b><span class="note">Entra con: <b>${esc(verUsuario(u))}</b></span></div>
      <div class="two"><label class="f">Nombre<input data-k="nombre" value="${esc(u.nombre||"")}"></label>
      <label class="f">Permiso<select data-k="rol">${rolOpts(u.rol)}</select></label>
      <label class="f">Caja (encargados)<select data-k="caja">${cajaOpts(u.caja)}</select></label>
      <label class="f">Nueva contraseña<input data-k="pw" placeholder="Dejalo vacío si no cambia"></label></div>
      ${u.rol==="encargado"?`<div><span class="note"><b>Obras a cargo</b> (solo ve y carga en estas):</span><div class="row" style="margin-top:4px">${obrasCargo().map(o=>`<label class="row" style="font-size:14px;gap:4px"><input type="checkbox" data-ob="${esc(o.id)}" ${(o.encargados||[]).includes(u.id)?"checked":""}> ${esc(o.nombre)}</label>`).join("")||`<span class="note">No hay obras en curso.</span>`}</div></div>`:""}
      <div class="row between"><button type="button" class="btn sm pri" data-save>Guardar</button>${u.id===S.uid?"":`<button type="button" class="btn sm danger" data-delu>Borrar usuario</button>`}</div></div>`).join("")}</div>`,sh=>{
    sh.querySelector("[data-close]").onclick=closeSheet;
    const nom=$("#nu_nom"),usr=$("#nu_user");let tocado=false;
    usr.oninput=()=>{tocado=true};nom.oninput=()=>{if(!tocado)usr.value=slugUser(nom.value)};
    const rolUpd=()=>{$("#nu_obw").style.display=$("#nu_rol").value==="encargado"?"":"none"};$("#nu_rol").onchange=rolUpd;rolUpd();
    if(S.preRol){$("#nu_rol").value=S.preRol;S.preRol=null;rolUpd();setTimeout(()=>nom.focus(),50)}
    $("#nu").onsubmit=async ev=>{ev.preventDefault();const u=slugUser(usr.value);
      if(u.length<3)return toast("El usuario tiene que tener al menos 3 letras");
      if($("#nu_rol").value==="encargado"&&!$("#nu_caja").value&&!confirm0())return;
      const {data:nid,error}=await sb.rpc("admin_crear_usuario",{p_usuario:u,p_password:$("#nu_pw").value,p_nombre:nom.value.trim(),p_rol:$("#nu_rol").value,p_caja:$("#nu_caja").value});
      if(error)return toast(error.message.replace(/^.*?:\s*/,"")||"No se pudo crear");
      if(nid&&$("#nu_rol").value==="encargado")await asignarObras(nid,[...sh.querySelectorAll("[data-nob]:checked")].map(i=>i.dataset.nob));
      toast("Usuario "+u+" creado");closeSheet();setTimeout(openUsers,100)};
    function confirm0(){toast("A un encargado elegile su caja para que pueda cargar gastos");return false}
    sh.querySelectorAll("[data-u]").forEach(card=>{
      const v=k=>card.querySelector(`[data-k="${k}"]`).value,id=card.dataset.u;
      card.querySelector("[data-save]").onclick=async()=>{
        if(id===S.uid&&v("rol")!=="admin")return toast("No te podés sacar el permiso de administración a vos misma");
        const {error}=await sb.from("perfiles").update({nombre:v("nombre").trim(),rol:v("rol"),caja:v("caja")||null}).eq("id",id);
        if(error)return toast("No se pudo guardar");
        if(card.querySelector("[data-ob]"))await asignarObras(id,[...card.querySelectorAll("[data-ob]:checked")].map(i=>i.dataset.ob));
        if(v("pw")){const r=await sb.rpc("admin_cambiar_password",{p_id:id,p_password:v("pw")});if(r.error)return toast(r.error.message.replace(/^.*?:\s*/,""));card.querySelector('[data-k="pw"]').value="";toast("Guardado, con contraseña nueva");return}
        toast("Guardado")};
      const d=card.querySelector("[data-delu]");
      if(d)d.onclick=async()=>{if(!d.dataset.sure){d.dataset.sure=1;d.textContent="Tocá de nuevo para borrar";return}
        const {error}=await sb.rpc("admin_borrar_usuario",{p_id:id});if(error)return toast(error.message.replace(/^.*?:\s*/,""));toast("Usuario borrado");closeSheet();setTimeout(openUsers,100)};
    });
  });
}

/* ---------- legajo de obra (archivos) ---------- */
const LEG_CATS=[["presupuestos","Presupuestos"],["planos","Planos"],["contrato","Contrato"],["recibos","Recibos"],["fotos","Fotos"],["facturas","Facturas y comprobantes"],["otros","Otros"]];
const CLI_CATS=[["presupuestos","Presupuestos"],["recibos","Recibos"],["contratos","Contratos"],["documentacion","Documentación"],["otros","Otros"]];
const PROV_CATS=[["precios","Listas de precios"],["facturas","Facturas"],["remitos","Remitos"],["otros","Otros"]];
S.leg={};
const safeName=n=>norm(n).replace(/[^a-z0-9._-]+/gi,"_").replace(/_+/g,"_").slice(-120);
const verNombre=n=>n.replace(/^\d{10,}_/,"");
const fmtKB=b=>b>1048576?(b/1048576).toFixed(1)+" MB":Math.max(1,Math.round(b/1024))+" KB";
async function cargarArchivos(key,cats){
  S.leg[key]={loading:true,files:{}};
  try{const res=await Promise.all(cats.map(([c])=>sb.storage.from("legajos").list(`${key}/${c}`,{limit:1000,sortBy:{column:"created_at",order:"desc"}})));
    res.forEach((r,i)=>{if(r.error)throw r.error;S.leg[key].files[cats[i][0]]=(r.data||[]).filter(f=>f.id&&!f.name.startsWith("."))});
    S.leg[key].loading=false;}catch(e){S.leg[key]={error:true,files:{}}}
  if(["legajo","cliente","proveedor"].includes(cur()))safeRender();
}
const cargarLegajo=id=>cargarArchivos(id,LEG_CATS);
function archivosHtml(key,cats,titulo,donde){
  if(!S.leg[key])cargarArchivos(key,cats);
  const L=S.leg[key]||{loading:true,files:{}},cat=S.filt["cat:"+key]||cats[0][0],files=L.files[cat]||[];
  const tot=Object.values(L.files).reduce((a,x)=>a+x.length,0);
  return `<section class="card" style="display:flex;flex-direction:column;gap:10px">
    <div class="row between"><h3>${esc(titulo)} ${L.loading?"":`(${tot})`}</h3>
      <label class="btn pri sm" style="cursor:pointer">+ Subir archivos<input type="file" id="legUp" multiple style="display:none"></label></div>
    <div class="chips">${cats.map(([k,l])=>`<button class="chip" data-legcat="${k}" aria-pressed="${cat===k}">${l}${(L.files[k]||[]).length?` (${L.files[k].length})`:""}</button>`).join("")}</div>
    <div id="legProg"></div>
    ${L.error?`<div class="banner">No se pudieron leer los archivos. Revisá que esté corrido el paso 2 en Supabase.</div>`:L.loading?`<div class="empty">Cargando archivos…</div>`:
      files.length?`<div class="list">${files.map(x=>`<div class="item" style="cursor:default;grid-template-columns:minmax(0,1fr) auto;align-items:center">
        <span style="overflow-wrap:anywhere"><span class="t">${esc(verNombre(x.name))}</span><br><span class="s">${x.metadata?fmtKB(x.metadata.size||0)+" · ":""}${x.created_at?esc(fdate(x.created_at.slice(0,10))):""}</span></span>
        <span style="display:flex;flex-direction:column;gap:4px"><button class="btn sm" data-open="${esc(x.name)}">Abrir</button><button class="btn sm danger" data-delf="${esc(x.name)}">Borrar</button></span></div>`).join("")}</div>`
      :`<div class="empty">No hay ${esc(cats.find(c=>c[0]===cat)[1].toLowerCase())} ${esc(donde)}. Tocá “+ Subir archivos” (podés elegir varios juntos).</div>`}
  </section>`;
}
function bindArchivos(key,cats){
  const catNow=()=>S.filt["cat:"+key]||cats[0][0];
  document.querySelectorAll("[data-legcat]").forEach(b=>b.onclick=()=>{S.filt["cat:"+key]=b.dataset.legcat;render()});
  const up=$("#legUp");if(up)up.onchange=async()=>{const fs=[...up.files];if(!fs.length)return;const cat=catNow();let ok=0,bad=0;
    for(const [i,f] of fs.entries()){$("#legProg").innerHTML=`<div class="banner">Subiendo ${i+1} de ${fs.length}: ${esc(f.name)}…</div>`;
      const {error}=await sb.storage.from("legajos").upload(`${key}/${cat}/${Date.now()}_${safeName(f.name)}`,f,{contentType:f.type||undefined,upsert:false});
      error?bad++:ok++}
    toast(bad?`Se subieron ${ok}. ${bad} no se pudieron subir (máximo 50 MB cada uno).`:`${ok} archivo${ok===1?"":"s"} subido${ok===1?"":"s"}`);cargarArchivos(key,cats)};
  document.querySelectorAll("[data-open]").forEach(b=>b.onclick=async()=>{const w=window.open("","_blank");
    const {data,error}=await sb.storage.from("legajos").createSignedUrl(`${key}/${catNow()}/${b.dataset.open}`,600);
    if(error||!data){if(w)w.close();return toast("No se pudo abrir el archivo")}if(w)w.location=data.signedUrl;else location.href=data.signedUrl});
  document.querySelectorAll("[data-delf]").forEach(b=>b.onclick=async()=>{if(!b.dataset.sure){b.dataset.sure=1;b.textContent="¿Seguro?";return}
    const {error}=await sb.storage.from("legajos").remove([`${key}/${catNow()}/${b.dataset.delf}`]);toast(error?"No se pudo borrar":"Archivo borrado");cargarArchivos(key,cats)});
}
function vLegajo(){
  const o=S.obras.find(x=>x.id===S.legObra);
  if(!o)return `<div class="card empty">Elegí una obra desde Obras.</div>`;
  const r=resObra(o.id),f=fechasObra(o),cl=S.cli.find(c=>c.id===o.clienteId);
  const porF=(a,b)=>(b.fecha||"").localeCompare(a.fecha||"")||(b.creado||0)-(a.creado||0);
  const ING=S.movs.filter(m=>m.obra===o.id&&m.tipo==="ingreso").sort(porF);
  const EGR=S.movs.filter(m=>m.obra===o.id&&m.tipo==="egreso").sort(porF);
  const tot=L=>L.reduce((a,m)=>a+valorPesos(m),0);
  const rub={};for(const m of EGR){const k=m.categoria||"Otros";(rub[k]=rub[k]||[]).push(m)}
  const egTot=r.gastos+r.costoJ;
  const linea=m=>`<button class="item" data-edit-mov="${esc(m.id)}"><span class="t">${esc(m.detalle||m.categoria||"Movimiento")}</span><span class="s">${esc(fdate(m.fecha))} · Caja ${esc(m.caja)}${m.usd?" · "+fmtU(m.usd)+(esUsd(m)?" pagados en dólares":m.cotizacion?" a "+fmt(m.cotizacion):""):""}</span><span class="m">${fmt(valorPesos(m))}</span></button>`;
  const rubros=Object.entries(rub).sort((a,b)=>tot(b[1])-tot(a[1]));
  const ultB=S.bit.filter(b=>b.obra===o.id).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")).slice(0,5);
  return `<div class="row between"><button class="btn sm" data-go="obras">← Obras</button><button class="btn sm" id="legEdit">Editar datos de la obra</button></div>
  <section class="card" style="display:flex;flex-direction:column;gap:6px">
    <div class="row between"><h2>${esc(o.nombre)}</h2><span class="pill ${o.estado==="En curso"?"p-acc":o.estado==="Terminada"?"p-mut":"p-warn"}">${esc(o.estado||"En curso")}</span></div>
    <div class="note">${o.cliente?`Cliente: ${cl?`<a href="#cliente" data-cli="${esc(cl.id)}">${esc(o.cliente)}</a>`:esc(o.cliente)} · `:""}Encargado: ${esc(o.encargado||"—")}${f.ini?" · Desde "+esc(fdate(f.ini)):""}${f.fin?" al "+esc(fdate(f.fin)):""}${o.contratoUsd?" · Contrato "+fmtU(o.contratoUsd):""}</div>
    ${o.notas?`<div class="note">${esc(o.notas)}</div>`:""}
    <div class="grid" style="margin-top:6px"><div class="card stat"><div class="lbl">Ingresos</div><div class="num pos">${fmt(r.cobros)}</div></div>
      <div class="card stat"><div class="lbl">Egresos</div><div class="num neg">${fmt(egTot)}</div></div>
      <div class="card stat"><div class="lbl">Resultado</div><div class="num ${r.res<0?"neg":""}">${fmt(r.res)}</div></div></div>
  </section>
  <section class="card" style="border-color:var(--good)"><div class="row between"><h3>Ingresos (${ING.length})</h3><b class="pos">${fmt(r.cobros)}</b></div>
    ${ING.length?`<div class="list" style="margin-top:6px">${ING.map(linea).join("")}</div>`:`<div class="empty">Todavía no hay cobros cargados para esta obra.</div>`}</section>
  <section class="card" style="border-color:var(--bad)"><div class="row between"><h3>Egresos por rubro</h3><b class="neg">${fmt(egTot)}</b></div>
    <p class="note" style="margin:2px 0 4px">Tocá un rubro para ver cada gasto.</p>
    ${rubros.map(([k,L])=>`<details class="grpd"><summary><span>${esc(k)} <span class="note">(${L.length})</span></span><b>${fmt(tot(L))}</b></summary><div class="list">${L.map(linea).join("")}</div></details>`).join("")}
    <details class="grpd"><summary><span>Mano de obra <span class="note">(${r.cantJ} jornales)</span></span><b>${fmt(r.costoJ)}</b></summary><p class="note" style="margin:0 0 10px">Sale de lo pagado en Sueldos a esta obra; los días sin sueldo pagado se calculan con jornales × costo del jornal. El detalle por día está en Jornales.</p></details>
    ${!rubros.length&&!r.costoJ?`<div class="empty">Todavía no hay gastos cargados para esta obra.</div>`:""}</section>
  ${archivosHtml(o.id,LEG_CATS,"Archivos del legajo","en esta obra")}
  <section class="card"><h3 style="margin-bottom:8px">Bitácora reciente</h3>
    ${ultB.length?`<div class="list">${ultB.map(b=>`<button class="item" data-edit-bit="${esc(b.id)}"><span class="t">${esc(fdate(b.fecha))}</span><span class="s">${b.motivo&&b.trabajo!=="si"?esc(b.motivo)+" — ":""}${esc(b.detalle||"")}</span><span class="m">${pillTrab(b.trabajo)}</span></button>`).join("")}</div>`:`<div class="empty">Sin registros de bitácora.</div>`}</section>`;
}
function bindLegajo(){
  const o=S.obras.find(x=>x.id===S.legObra);if(!o)return;
  const e=$("#legEdit");if(e)e.onclick=()=>openObra(o);
  const s=$("#legSrch");if(s)s.onclick=()=>{S.q={t:o.nombre,desde:"",hasta:"",que:"movs"};location.hash="buscar"};
  bindArchivos(o.id,LEG_CATS);
}

/* ---------- clientes ---------- */
const obrasDeCliente=c=>S.obras.filter(o=>o.clienteId===c.id||(!o.clienteId&&o.cliente&&norm(o.cliente)===norm(c.nombre)));
const presDeCliente=c=>S.pres.filter(p=>p.clienteId===c.id||(p.cliente&&norm(p.cliente)===norm(c.nombre)));
function vClientes(){
  const L=[...S.cli].sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const sinFicha=[...new Set(S.obras.filter(o=>o.cliente&&!o.clienteId&&!S.cli.some(c=>norm(c.nombre)===norm(o.cliente))).map(o=>o.cliente))];
  return `<div class="row between"><h2>Clientes</h2><button class="btn pri sm" data-new-cli>+ Cliente</button></div>
  ${sinFicha.length?`<div class="card" style="display:flex;flex-direction:column;gap:8px;border-color:var(--gold)"><b>${sinFicha.length} cliente${sinFicha.length>1?"s":""} de las obras todavía sin ficha</b><span class="note">${sinFicha.map(esc).join(", ")}</span><div><button class="btn sm" id="autoCli">Crear sus fichas</button></div></div>`:""}
  <div class="list">${L.map(c=>{const ob=obrasDeCliente(c);const cob=ob.reduce((a,o)=>a+resObra(o.id).cobros,0);
    return `<button class="item" data-cli="${esc(c.id)}"><span class="t">${esc(c.nombre)}</span><span class="s">${ob.length} obra${ob.length===1?"":"s"}${c.telefono?" · "+esc(c.telefono):""}</span><span class="m">${fmt(cob)}</span></button>`}).join("")||`<div class="empty">Todavía no hay clientes cargados.</div>`}</div>`;
}
async function crearClientesDesdeObras(){
  const nombres=[...new Set(S.obras.filter(o=>o.cliente&&!o.clienteId&&!S.cli.some(c=>norm(c.nombre)===norm(o.cliente))).map(o=>o.cliente))];
  for(const n of nombres){const ref=db.collection("clientes").doc();await ref.set({nombre:n,creado:Date.now()});
    for(const o of S.obras.filter(x=>x.cliente===n&&!x.clienteId)){const {id,_por,...rest}=o;await db.collection("obras").doc(id).set({...rest,clienteId:ref.id})}}
  toast(nombres.length+" ficha(s) creada(s)");
}
function vCliente(){
  const c=S.cli.find(x=>x.id===S.cliSel);if(!c)return `<div class="card empty">Elegí un cliente desde Clientes.</div>`;
  const ob=obrasDeCliente(c),ids=new Set(ob.map(o=>o.id));
  const pagos=S.movs.filter(m=>m.tipo==="ingreso"&&ids.has(m.obra)).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||""));
  const cob=pagos.reduce((a,m)=>a+(+m.monto||0),0),cobU=pagos.reduce((a,m)=>a+(+m.usd||+m.usdRef||0),0),contr=ob.reduce((a,o)=>a+(+o.contratoUsd||0),0);
  const pr=presDeCliente(c).sort((a,b)=>(b.numero||0)-(a.numero||0));
  return `<div class="row between"><button class="btn sm" data-go="clientes">← Clientes</button><button class="btn sm" id="cliEdit">Editar datos</button></div>
  <section class="card" style="display:flex;flex-direction:column;gap:6px"><h2>${esc(c.nombre)}</h2>
    <div class="note">${[c.cuit&&"CUIT "+c.cuit,c.telefono&&"Tel. "+c.telefono,c.mail,c.direccion].filter(Boolean).map(esc).join(" · ")||"Sin datos de contacto"}</div>
    ${c.notas?`<div class="note">${esc(c.notas)}</div>`:""}
    <div class="mini" style="margin-top:6px"><div>Obras<b>${ob.length}</b></div><div>Pagó<b>${fmt(cob)}</b></div><div>En dólares<b>${fmtU(cobU)}</b></div><div>Falta cobrar<b>${contr?fmtU(Math.max(0,contr-cobU)):"—"}</b></div></div></section>
  <section class="card"><h3 style="margin-bottom:8px">Sus obras</h3>${ob.length?`<div class="list">${ob.map(o=>{const r=resObra(o.id);return `<button class="item" data-edit-obra="${esc(o.id)}"><span class="t">${esc(o.nombre)}</span><span class="s">${esc(o.estado||"")}${o.contratoUsd?" · Contrato "+fmtU(o.contratoUsd):""}</span><span class="m">${fmt(r.cobros)}</span></button>`}).join("")}</div>`:`<div class="empty">No tiene obras asignadas. Asignale la obra desde “Editar datos de la obra”.</div>`}</section>
  <section class="card"><h3 style="margin-bottom:8px">Pagos recibidos (${pagos.length})</h3>${pagos.length?`<div class="list">${pagos.slice(0,30).map(m=>`<button class="item" data-edit-mov="${esc(m.id)}"><span class="t">${esc(m.detalle||"Pago")}</span><span class="s">${esc(fdate(m.fecha))} · ${esc(obraNombre(m.obra))} · Caja ${esc(m.caja)}</span><span class="m" style="color:var(--good)">+ ${fmt(m.monto)}</span></button>`).join("")}</div>`:`<div class="empty">Sin pagos registrados.</div>`}</section>
  <section class="card"><h3 style="margin-bottom:8px">Presupuestos (${pr.length})</h3>${pr.length?`<div class="list">${pr.map(p=>`<button class="item" data-edit-pres="${esc(p.id)}"><span class="t">N° ${esc(p.numero)} · ${esc(p.obra||"")}</span><span class="s">${esc(fdate(p.fecha))} ${presPill(p.estado)}</span><span class="m">${fmt(presTot(p).total)}</span></button>`).join("")}</div>`:`<div class="empty">Sin presupuestos armados en la app.</div>`}</section>
  ${archivosHtml("clientes/"+c.id,CLI_CATS,"Carpeta del cliente","de este cliente")}`;
}
function bindCliente(){
  const c=S.cli.find(x=>x.id===S.cliSel);if(!c)return;
  $("#cliEdit").onclick=()=>openCliente(c);
  document.querySelectorAll("[data-edit-pres]").forEach(b=>b.onclick=()=>openPres(S.pres.find(x=>x.id===b.dataset.editPres)));
  bindArchivos("clientes/"+c.id,CLI_CATS);
}
function openCliente(c){
  const e=!!c;c=c||{nombre:""};const tieneObras=e&&obrasDeCliente(c).length>0;
  openSheet(`<form id="fcl" style="display:flex;flex-direction:column;gap:12px">${sheetHead(e?c.nombre:"Nuevo cliente")}
    <label class="f">Nombre o razón social<input id="c_nom" value="${esc(c.nombre)}" required></label>
    <div class="two"><label class="f">CUIT / DNI<input id="c_cuit" value="${esc(c.cuit||"")}"></label><label class="f">Teléfono<input id="c_tel" inputmode="tel" value="${esc(c.telefono||"")}"></label>
    <label class="f">Mail<input id="c_mail" type="email" value="${esc(c.mail||"")}"></label><label class="f">Dirección<input id="c_dir" value="${esc(c.direccion||"")}"></label></div>
    <label class="f">Notas<textarea id="c_not">${esc(c.notas||"")}</textarea></label>
    ${tieneObras?`<p class="note" style="margin:0">Tiene obras asignadas, por eso no se puede borrar.</p>`:""}
    ${footBtns(e&&!tieneObras)}</form>`,sh=>{
    wireCommon(sh,"clientes",c.id);
    $("#fcl").onsubmit=async ev=>{ev.preventDefault();const n=$("#c_nom").value.trim();if(!n)return toast("Falta el nombre");
      if(await save("clientes",c.id,{nombre:n,cuit:$("#c_cuit").value.trim(),telefono:$("#c_tel").value.trim(),mail:$("#c_mail").value.trim(),direccion:$("#c_dir").value.trim(),notas:$("#c_not").value.trim(),creado:c.creado})){closeSheet();toast("Cliente guardado")}};
  });
}

/* ---------- proveedores ---------- */
const pagosProv=p=>S.movs.filter(m=>m.tipo==="egreso"&&m.proveedorId===p.id);
function ctaProv(p){const fac=(p.facturas||[]).reduce((a,f)=>a+(+f.monto||0),0),pag=pagosProv(p).reduce((a,m)=>a+(+m.monto||0),0);return {fac,pag,saldo:fac-pag}}
function vProveedores(){
  const q=norm(S.filt.provQ||"");
  const L=[...S.prov].filter(p=>!q||norm([p.nombre,p.rubro].join(" ")).includes(q)).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const deuda=S.prov.reduce((a,p)=>a+Math.max(0,ctaProv(p).saldo),0);
  return `<div class="row between"><h2>Proveedores</h2><button class="btn pri sm" data-new-prov>+ Proveedor</button></div>
  ${deuda?`<div class="card stat"><div class="lbl">Total que se les debe</div><div class="num neg">${fmt(deuda)}</div></div>`:""}
  <div class="list">${L.map(p=>{const c=ctaProv(p);return `<button class="item" data-prov="${esc(p.id)}"><span class="t">${esc(p.nombre)}</span><span class="s">${esc(p.rubro||"Sin rubro")}${p.telefono?" · "+esc(p.telefono):""}</span>
    <span class="m">${c.saldo>0?`<span class="pill p-bad">Debemos ${fmt(c.saldo)}</span>`:`<span class="pill p-good">Al día</span>`}</span></button>`}).join("")||`<div class="empty">Todavía no hay proveedores cargados. Por ejemplo: el del hierro, el de las placas (Raybeck Liendo), Dick Haus.</div>`}</div>`;
}
function vProveedor(){
  const p=S.prov.find(x=>x.id===S.provSel);if(!p)return `<div class="card empty">Elegí un proveedor desde Proveedores.</div>`;
  const c=ctaProv(p);
  const mov=[...(p.facturas||[]).map(f=>({k:"f",fecha:f.fecha,x:f})),...pagosProv(p).map(m=>({k:"p",fecha:m.fecha,x:m}))].sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||""));
  return `<div class="row between"><button class="btn sm" data-go="proveedores">← Proveedores</button><button class="btn sm" id="provEdit">Editar datos</button></div>
  <section class="card" style="display:flex;flex-direction:column;gap:6px"><div class="row between"><h2>${esc(p.nombre)}</h2>${p.rubro?`<span class="pill p-acc">${esc(p.rubro)}</span>`:""}</div>
    <div class="note">${[p.contacto&&"Contacto: "+p.contacto,p.telefono&&"Tel. "+p.telefono,p.mail,p.cuit&&"CUIT "+p.cuit,p.direccion].filter(Boolean).map(esc).join(" · ")||"Sin datos de contacto"}</div>
    ${p.alias?`<div class="note">Alias / CBU para pagarle: <b>${esc(p.alias)}</b></div>`:""}${p.notas?`<div class="note">${esc(p.notas)}</div>`:""}
    <div class="mini" style="margin-top:6px"><div>Facturado<b>${fmt(c.fac)}</b></div><div>Pagado<b>${fmt(c.pag)}</b></div><div>Le debemos<b style="color:${c.saldo>0?"var(--bad)":"var(--good)"}">${fmt(Math.max(0,c.saldo))}</b></div><div>A favor<b>${c.saldo<0?fmt(-c.saldo):"—"}</b></div></div></section>
  <section class="card"><div class="row between" style="margin-bottom:8px"><h3>Cuenta corriente</h3><button class="btn sm pri" id="provFac">+ Factura / deuda</button></div>
    <p class="note" style="margin:0 0 8px">Las facturas que nos hace suman deuda. Los pagos salen de la caja: al cargar una salida elegí este proveedor y se descuenta solo.</p>
    ${mov.length?`<div class="list">${mov.map(r=>r.k==="f"?`<button class="item" data-fac="${esc(r.x.id)}"><span class="t">Factura ${esc(r.x.numero||"")}</span><span class="s">${esc(fdate(r.x.fecha))}${r.x.vence?" · vence "+esc(fdate(r.x.vence)):""}${r.x.obra?" · "+esc(obraNombre(r.x.obra)):""}${r.x.nota?" · "+esc(r.x.nota):""}</span><span class="m" style="color:var(--bad)">+ ${fmt(r.x.monto)}</span></button>`
      :`<button class="item" data-edit-mov="${esc(r.x.id)}"><span class="t">Pago · ${esc(r.x.detalle||r.x.categoria||"")}</span><span class="s">${esc(fdate(r.x.fecha))} · Caja ${esc(r.x.caja)} · ${esc(obraNombre(r.x.obra))}</span><span class="m" style="color:var(--good)">− ${fmt(r.x.monto)}</span></button>`).join("")}</div>`:`<div class="empty">Sin facturas ni pagos cargados.</div>`}</section>
  ${archivosHtml("proveedores/"+p.id,PROV_CATS,"Carpeta del proveedor","de este proveedor")}`;
}
function bindProveedor(){
  const p=S.prov.find(x=>x.id===S.provSel);if(!p)return;
  $("#provEdit").onclick=()=>openProv(p);
  $("#provFac").onclick=()=>openFactura(p);
  document.querySelectorAll("[data-fac]").forEach(b=>b.onclick=()=>openFactura(p,(p.facturas||[]).find(f=>f.id===b.dataset.fac)));
  bindArchivos("proveedores/"+p.id,PROV_CATS);
}
const provData=p=>{const {id,_por,...rest}=p;return rest};
function openProv(p){
  const e=!!p;p=p||{nombre:""};
  openSheet(`<form id="fpv" style="display:flex;flex-direction:column;gap:12px">${sheetHead(e?p.nombre:"Nuevo proveedor")}
    <div class="two"><label class="f">Nombre o razón social<input id="v_nom" value="${esc(p.nombre)}" required></label>
    <label class="f">Rubro<input id="v_rub" list="dl_rub" value="${esc(p.rubro||"")}" placeholder="Hierro, placas, corralón…"><datalist id="dl_rub">${["Hierro","Placas / paneles","Corralón","Hormigón","Ferretería","Electricidad","Sanitarios","Aberturas","Fletes","Herramientas"].map(x=>`<option value="${x}"></option>`).join("")}</datalist></label>
    <label class="f">Persona de contacto<input id="v_con" value="${esc(p.contacto||"")}"></label><label class="f">Teléfono / WhatsApp<input id="v_tel" inputmode="tel" value="${esc(p.telefono||"")}"></label>
    <label class="f">Mail<input id="v_mail" type="email" value="${esc(p.mail||"")}"></label><label class="f">CUIT<input id="v_cuit" value="${esc(p.cuit||"")}"></label>
    <label class="f">Alias o CBU para pagarle<input id="v_alias" value="${esc(p.alias||"")}"></label><label class="f">Dirección<input id="v_dir" value="${esc(p.direccion||"")}"></label></div>
    <label class="f">Notas<textarea id="v_not" placeholder="Ej: entrega en 48 h, cuenta corriente a 30 días">${esc(p.notas||"")}</textarea></label>
    ${footBtns(e&&!pagosProv(p).length&&!(p.facturas||[]).length)}</form>`,sh=>{
    wireCommon(sh,"proveedores",p.id);
    $("#fpv").onsubmit=async ev=>{ev.preventDefault();const n=$("#v_nom").value.trim();if(!n)return toast("Falta el nombre");
      const d={...(e?provData(p):{}),nombre:n,rubro:$("#v_rub").value.trim(),contacto:$("#v_con").value.trim(),telefono:$("#v_tel").value.trim(),mail:$("#v_mail").value.trim(),cuit:$("#v_cuit").value.trim(),alias:$("#v_alias").value.trim(),direccion:$("#v_dir").value.trim(),notas:$("#v_not").value.trim(),creado:p.creado};
      if(await save("proveedores",p.id,d)){closeSheet();toast("Proveedor guardado")}};
  });
}
function openFactura(p,f){
  const e=!!f;f=f||{fecha:hoy(),numero:"",monto:"",vence:"",obra:"",nota:""};
  openSheet(`<form id="ffa" style="display:flex;flex-direction:column;gap:12px">${sheetHead((e?"Editar factura":"Nueva factura")+" · "+p.nombre)}
    <div class="two"><label class="f">Fecha<input type="date" id="f_fecha" value="${esc(f.fecha)}" required></label><label class="f">N° de factura<input id="f_num" value="${esc(f.numero||"")}"></label>
    <label class="f">Monto $<input id="f_monto" inputmode="decimal" value="${esc(f.monto||"")}" required></label><label class="f">Vence<input type="date" id="f_vence" value="${esc(f.vence||"")}"></label></div>
    <label class="f">Obra (opcional)<select id="f_obra"><option value="">—</option>${obraOpts(f.obra,true)}</select></label>
    <label class="f">Nota<input id="f_nota" value="${esc(f.nota||"")}" placeholder="Ej: 2 tn hierro del 8"></label>
    <div class="row between">${e?`<button class="btn danger" type="button" id="f_del">Borrar</button>`:"<span></span>"}<button class="btn pri" type="submit">Guardar</button></div></form>`,sh=>{
    sh.querySelector("[data-close]").onclick=closeSheet;
    const guardar=async lista=>{if(await save("proveedores",p.id,{...provData(p),facturas:lista})){closeSheet();toast("Cuenta corriente actualizada")}};
    const d=$("#f_del");if(d)d.onclick=()=>{if(!d.dataset.sure){d.dataset.sure=1;d.textContent="Tocá de nuevo para borrar";return}guardar((p.facturas||[]).filter(x=>x.id!==f.id))};
    $("#ffa").onsubmit=ev=>{ev.preventDefault();const monto=num($("#f_monto").value);if(!monto)return toast("Falta el monto");
      const nf={id:f.id||("f"+Date.now().toString(36)),fecha:$("#f_fecha").value,numero:$("#f_num").value.trim(),monto,vence:$("#f_vence").value,obra:$("#f_obra").value,nota:$("#f_nota").value.trim()};
      guardar(e?(p.facturas||[]).map(x=>x.id===f.id?nf:x):[...(p.facturas||[]),nf])};
  });
}

/* ---------- seguridad: cierre de sesión por inactividad ---------- */
const INACTIVIDAD_MIN=120;
let ultimaActividad=Date.now();
["click","keydown","touchstart","scroll"].forEach(ev=>addEventListener(ev,()=>{ultimaActividad=Date.now()},{passive:true}));
setInterval(async()=>{if(S.auth==="in"&&Date.now()-ultimaActividad>INACTIVIDAD_MIN*60000){await sb.auth.signOut();location.hash="";location.reload()}},60000);

/* ---------- copia de seguridad (solo administración) ---------- */
async function copiaSeguridad(){
  if(!isAdmin())return;
  const out={app:"Sinner Construcciones",fecha:new Date().toISOString(),tablas:{}};
  try{for(const t of Object.keys(TABLAS)){let all=[];for(let from=0;;from+=1000){const {data,error}=await sb.from(t).select("id,data,creado_por,actualizado").range(from,from+999);if(error){if(from===0&&t==="cierres"){all=null;break}throw error}all=all.concat(data);if(data.length<1000)break}out.tablas[t]=all}
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(out)],{type:"application/json"}));a.download=`sinner_copia_${hoy()}.json`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);
    toast("Copia descargada. Guardala en un lugar privado.");
  }catch(e){toast("No se pudo armar la copia")}
}

/* ---------- conexión a Supabase ---------- */
const TABLAS={movimientos:"movs",cierres:"cierres",obras:"obras",jornales:"jorn",bitacora:"bit",presupuestos:"pres",inventario:"inv",empleados:"emp",sueldos:"liqs",clientes:"cli",proveedores:"prov",config:null};
function mapErr(e){const m=(e&&e.message||"")+"";return {code:(e&&e.code==="42501")||/row-level security|permission/i.test(m)?"invalid_argument":"unavailable",message:m}}
async function cargarTabla(t){
  let all=[];for(let from=0;;from+=1000){const {data,error}=await sb.from(t).select("id,data,creado_por").range(from,from+999);
    if(error&&t==="cierres"){S.cierres=[];S.sinCierres=true;return}  /* la tabla todavía no existe: la app sigue andando */
    if(error)throw error;all=all.concat(data);if(data.length<1000)break}
  if(t==="config"){const g=all.find(r=>r.id==="general");if(g){const d=g.data;S.cfg={...DEF_CFG,...d,precios:{...DEF_CFG.precios,...(d.precios||{})},rend:{...DEF_CFG.rend,...(d.rend||{})}};if(S.blue)S.cfg.cotizacion=S.blue.venta}
    const im=all.find(r=>r.id==="importacion");S.imp=im?im.data:null;
    const li=all.find(r=>r.id==="lista");S.lista=li&&Array.isArray(li.data.items)?li.data.items:null}
  else S[TABLAS[t]]=all.map(r=>({...r.data,id:r.id,_por:r.creado_por}));
}
async function cargarTodo(){await Promise.all(Object.keys(TABLAS).map(t=>cargarTabla(t)))}
function safeRender(){if($("#sheetBg").classList.contains("open"))render.dirty=true;else render()}
function hacerDb(){
  return {collection:c=>({doc:id=>{id=id||(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
      return {id,
        set:async d=>{const {error}=await sb.from(c).upsert({id,data:d,actualizado:new Date().toISOString()});if(error)throw mapErr(error);await cargarTabla(c);safeRender()},
        delete:async()=>{const {error}=await sb.from(c).delete().eq("id",id);if(error)throw mapErr(error);await cargarTabla(c);safeRender()}}}}),
    doc(p){const [c,id]=p.split("/");return this.collection(c).doc(id)}};
}
let iniciado=false;
async function iniciar(session,force){
  if(!session){S.auth="out";S.rol=null;render();return}
  if(iniciado&&!force)return;
  S.uid=session.user.id;
  const {data:perfil,error}=await sb.from("perfiles").select("*").eq("id",S.uid).maybeSingle();
  S.perfil=perfil||{email:session.user.email};
  if(error||!perfil||perfil.rol==="pendiente"){S.auth="pending";render();return}
  S.rol=perfil.rol;S.owner=perfil.rol==="admin";db=hacerDb();
  try{await cargarTodo()}catch(e){S.err="No se pudieron traer los datos. Revisá la conexión.";db=null}
  actualizarBlue();actualizarClima();if(!S.blueTimer)S.blueTimer=setInterval(()=>{actualizarBlue();actualizarClima()},30*60*1000);
  iniciado=true;S.auth="in";render();
  let pend=new Set(),tm=null;
  sb.channel("cambios").on("postgres_changes",{event:"*",schema:"public"},p=>{if(!(p.table in TABLAS))return;pend.add(p.table);clearTimeout(tm);
    tm=setTimeout(async()=>{const ts=[...pend];pend.clear();for(const t of ts){try{await cargarTabla(t)}catch(e){}}safeRender()},400)}).subscribe();
}
render();
if(configurado()){
  sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
  sb.auth.onAuthStateChange((ev,session)=>{
    if(ev==="PASSWORD_RECOVERY"){S.auth="recovery";render();return}
    if(ev==="SIGNED_OUT"){S.auth="out";render();return}
    if(S.auth==="recovery")return;
    setTimeout(()=>iniciar(session),0);
  });
}
// re-render pendiente al cerrar la hoja
new MutationObserver(()=>{if(!$("#sheetBg").classList.contains("open")&&render.dirty){render.dirty=false;render()}}).observe($("#sheetBg"),{attributes:true,attributeFilter:["class"]});

/* ---------- ojito para ver la contraseña ---------- */
function ponerOjitos(root){
  (root||document).querySelectorAll('input[type="password"]:not([data-ojo])').forEach(inp=>{
    inp.dataset.ojo="1";
    const w=document.createElement("span");w.style.cssText="position:relative;display:block";
    inp.parentNode.insertBefore(w,inp);w.appendChild(inp);inp.style.paddingRight="48px";inp.style.width="100%";inp.style.boxSizing="border-box";
    const b=document.createElement("button");b.type="button";b.setAttribute("aria-label","Mostrar contraseña");
    b.style.cssText="position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;cursor:pointer;padding:6px;line-height:0;color:var(--muted)";
    const ojo='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    const tachado='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7c2 0 3.8.7 5.2 1.6M22 12s-3.5 7-10 7c-2 0-3.8-.7-5.2-1.6"/><path d="M3 3l18 18"/></svg>';
    b.innerHTML=ojo;
    b.onclick=()=>{const ver=inp.type==="password";inp.type=ver?"text":"password";b.innerHTML=ver?tachado:ojo;b.setAttribute("aria-label",ver?"Ocultar contraseña":"Mostrar contraseña");inp.focus()};
    w.appendChild(b);
  });
}
ponerOjitos();
new MutationObserver(()=>ponerOjitos()).observe(document.body,{childList:true,subtree:true});

document.addEventListener("click",ev=>{const b=ev.target.closest&&ev.target.closest("[data-adm]");if(!b)return;
  const k=b.dataset.adm;
  if(k==="pagorem")openMov(null,{tipo:"egreso",conRemito:true});else if(k==="users")openUsers();else if(k==="newenc"){S.preRol="encargado";openUsers()}else if(k==="newobra")openObra();
  else if(k==="newcli")openCliente();else if(k==="newprov")openProv();else if(k==="newherr")openInv();
  else if(k==="backup")copiaSeguridad();else if(k==="pack")runPack();else openCfg()});


/* ---------- recibos digitales (no válidos como factura) ---------- */
function numLetras(n){n=Math.floor(Math.abs(n));if(n===0)return "cero";
  const U=["","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez","once","doce","trece","catorce","quince","dieciséis","diecisiete","dieciocho","diecinueve","veinte","veintiuno","veintidós","veintitrés","veinticuatro","veinticinco","veintiséis","veintisiete","veintiocho","veintinueve"];
  const D=["","","","treinta","cuarenta","cincuenta","sesenta","setenta","ochenta","noventa"];
  const C=["","ciento","doscientos","trescientos","cuatrocientos","quinientos","seiscientos","setecientos","ochocientos","novecientos"];
  const cien=x=>{if(x===0)return "";if(x===100)return "cien";const c=Math.floor(x/100),r=x%100;let t=C[c];
    if(r){t+=(t?" ":"")+(r<30?U[r]:D[Math.floor(r/10)]+(r%10?" y "+U[r%10]:""))}return t};
  const mil=x=>{const m=Math.floor(x/1000),r=x%1000;let t=m?(m===1?"mil":cien(m).replace(/veintiuno$/,"veintiún").replace(/uno$/,"un")+" mil"):"";if(r)t+=(t?" ":"")+cien(r);return t};
  const mm=Math.floor(n/1e6),r=n%1e6;let t=mm?(mm===1?"un millón":mil(mm).replace(/veintiuno$/,"veintiún").replace(/uno$/,"un")+" millones"):"";if(r)t+=(t?" ":"")+mil(r);return t}
async function emitirRecibo(m){
  let nro=m.reciboNro;
  if(!nro){nro=Math.max(0,...S.movs.map(x=>+x.reciboNro||0),+(S.cfg.ultimoRecibo||0))+1;
    const {id,_por,...rest}=m;try{await db.collection("movimientos").doc(id).set({...rest,reciboNro:nro});m.reciboNro=nro}catch(e){return toast("No se pudo numerar el recibo")}}
  const o=S.obras.find(x=>x.id===m.obra),cli=(o&&(o.cliente||(S.cli.find(c=>c.id===o.clienteId)||{}).nombre))||"";
  const ent=Math.floor(+m.monto||0),cts=Math.round(((+m.monto||0)-ent)*100);
  const logo=(document.querySelector("img.logo")||{}).src||"";
  const forma=/efectivo/i.test(m.detalle||"")?"Efectivo":/transf/i.test(m.detalle||"")?"Transferencia":"";
  openSheet(`<div style="display:flex;flex-direction:column;gap:12px">${sheetHead("Recibo N° "+String(nro).padStart(4,"0"))}
    <div class="two"><label class="f">Recibí de<input id="r_cli" value="${esc(cli)}"></label><label class="f">Forma de pago<input id="r_for" value="${esc(forma)}" placeholder="Efectivo / Transferencia"></label></div>
    <label class="f">En concepto de<input id="r_con" value="${esc((m.detalle||"")+(o?" – Obra "+o.nombre:""))}"></label>
    <div id="recibo" style="background:#fff;color:#111;border:1px solid #ccc;border-radius:10px;padding:18px;font-size:14px"></div>
    <div class="row"><button class="btn pri" id="r_print">Imprimir / Guardar PDF</button><button class="btn" id="r_copy">Copiar texto</button></div>
    <p class="note" style="margin:0">En el celu: “Imprimir” → “Guardar como PDF” o compartir por WhatsApp. El número queda guardado en el movimiento: si lo volvés a abrir, es el mismo recibo.</p></div>`,sh=>{
    sh.querySelector("[data-close]").onclick=closeSheet;
    const pintar=()=>{const cliV=$("#r_cli").value,con=$("#r_con").value,fo=$("#r_for").value;
      $("#recibo").innerHTML=`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:2px solid #c9a227;padding-bottom:10px">
        ${logo?`<img src="${logo}" alt="Sinner Construcciones" style="height:54px">`:"<b>Sinner Construcciones</b>"}
        <div style="text-align:right"><div style="font-size:20px;font-weight:800">RECIBO</div><div>N° ${String(nro).padStart(4,"0")}</div><div>Fecha: ${esc(fdate(m.fecha))}</div></div></div>
        <p style="margin:14px 0 6px">Recibí de <b>${esc(cliV||"____________________")}</b></p>
        <p style="margin:6px 0">la suma de <b>pesos ${esc(numLetras(ent))}${cts?" con "+cts+"/100":""}</b> (${fmt(m.monto)})${m.usd?`, equivalente a US$ ${(+m.usd).toLocaleString("es-AR",{maximumFractionDigits:2})}${m.cotizacion?" (cotización $"+(+m.cotizacion).toLocaleString("es-AR")+")":""}`:""}</p>
        <p style="margin:6px 0">en concepto de <b>${esc(con)}</b>.</p>
        ${fo?`<p style="margin:6px 0">Forma de pago: ${esc(fo)}</p>`:""}
        <div style="display:flex;justify-content:flex-end;margin-top:38px"><div style="border-top:1px solid #111;width:220px;text-align:center;padding-top:4px;font-size:12px">Firma y aclaración<br>Sinner Construcciones</div></div>
        <p style="margin:18px 0 0;font-size:11px;color:#555;text-align:center">Documento no válido como factura.</p>`};
    ["r_cli","r_con","r_for"].forEach(i=>$("#"+i).oninput=pintar);pintar();
    $("#r_print").onclick=()=>{const w=document.createElement("div");w.id="printArea";w.innerHTML=$("#recibo").innerHTML;document.body.appendChild(w);
      document.body.classList.add("imprimiendo");setTimeout(()=>{window.print();setTimeout(()=>{w.remove();document.body.classList.remove("imprimiendo")},500)},50)};
    $("#r_copy").onclick=()=>{navigator.clipboard.writeText(`RECIBO N° ${String(nro).padStart(4,"0")} – Sinner Construcciones\nFecha: ${fdate(m.fecha)}\nRecibí de ${$("#r_cli").value} la suma de pesos ${numLetras(ent)} (${fmt(m.monto)})${m.usd?` – US$ ${m.usd}`:""}\nEn concepto de: ${$("#r_con").value}\n${$("#r_for").value?"Forma de pago: "+$("#r_for").value+"\n":""}Documento no válido como factura.`).then(()=>toast("Copiado"))};
  });
}


/* ---------- remito / comprobante de pago: se genera desde el mismo gasto, sin doble carga ---------- */
async function emitirRemito(m,recien){
  let nro=m.remitoNro;
  if(!nro){nro=Math.max(0,...S.movs.map(x=>+x.remitoNro||0))+1;
    const {id,_por,...rest}=m;try{await db.collection("movimientos").doc(id).set({...rest,remitoNro:nro});m.remitoNro=nro}catch(e){return toast("No se pudo numerar el remito")}}
  const prov=(S.prov.find(p=>p.id===m.proveedorId)||{}).nombre||"";
  const logo=(document.querySelector("img.logo")||{}).src||"";
  const N=String(nro).padStart(4,"0");
  const ent=Math.floor(+m.monto||0),cts=Math.round(((+m.monto||0)-ent)*100);
  openSheet(`<div style="display:flex;flex-direction:column;gap:12px">${sheetHead("Remito de pago N° "+N)}
    ${recien?`<div class="banner">✅ El gasto ya quedó cargado en la caja <b>${esc(m.caja)}</b>. Este remito es el comprobante para que firme quien cobra.</div>`:""}
    <div class="two"><label class="f">Pagado a<input id="rm_a" value="${esc(m.remitoA||prov)}" placeholder="Nombre de quien cobra"></label><label class="f">DNI / CUIT<input id="rm_doc" value="${esc(m.remitoDoc||"")}"></label></div>
    <label class="f">Forma de pago<input id="rm_for" value="${esc(m.remitoForma||(/transf/i.test(m.detalle||"")?"Transferencia":"Efectivo"))}"></label>
    <label class="f">Detalle (una línea por ítem: cantidad y descripción)<textarea id="rm_it" rows="3" placeholder="Ej: 10 bolsas de cemento">${esc(m.remitoItems||"")}</textarea></label>
    <div id="remito" style="background:#fff;color:#111;border:1px solid #ccc;border-radius:10px;padding:18px;font-size:14px"></div>
    <div class="row"><button class="btn pri" id="rm_print">Imprimir / Guardar PDF</button><button class="btn" id="rm_save">Guardar datos del remito</button></div>
    <p class="note" style="margin:0">El monto, la fecha, la obra y la caja salen del gasto: si hay que corregirlos, se corrige el gasto y el remito se actualiza solo.</p></div>`,sh=>{
    sh.querySelector("[data-close]").onclick=closeSheet;
    const pintar=()=>{const it=$("#rm_it").value.split("\n").map(x=>x.trim()).filter(Boolean);
      $("#remito").innerHTML=`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:2px solid #c9a227;padding-bottom:10px">
        ${logo?`<img src="${logo}" alt="Sinner Construcciones" style="height:54px">`:"<b>Sinner Construcciones</b>"}
        <div style="text-align:right"><div style="font-size:18px;font-weight:800">REMITO DE PAGO</div><div>N° ${N}</div><div>Fecha: ${esc(fdate(m.fecha))}</div></div></div>
        <table style="width:100%;margin:12px 0;border-collapse:collapse;font-size:13px">
          <tr><td style="padding:3px 0;color:#555;width:38%">Pagado a</td><td><b>${esc($("#rm_a").value||"____________________")}</b>${$("#rm_doc").value?" · "+esc($("#rm_doc").value):""}</td></tr>
          <tr><td style="padding:3px 0;color:#555">Obra</td><td>${esc(obraNombre(m.obra))}</td></tr>
          <tr><td style="padding:3px 0;color:#555">Concepto</td><td>${esc(m.detalle||m.categoria||"")}</td></tr>
          <tr><td style="padding:3px 0;color:#555">Categoría</td><td>${esc(m.categoria||"")}</td></tr>
          <tr><td style="padding:3px 0;color:#555">Pagado desde</td><td>Caja ${esc(m.caja)} · ${esc($("#rm_for").value)}</td></tr></table>
        ${it.length?`<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px"><thead><tr><th style="text-align:left;border-bottom:1px solid #999;padding:4px 0">Detalle</th></tr></thead><tbody>${it.map(x=>`<tr><td style="border-bottom:1px solid #eee;padding:4px 0">${esc(x)}</td></tr>`).join("")}</tbody></table>`:""}
        <p style="margin:8px 0;font-size:15px">Importe: <b>${fmt(m.monto)}</b></p>
        <p style="margin:0 0 6px;font-size:12px;color:#333">Son pesos ${esc(numLetras(ent))}${cts?" con "+cts+"/100":""}.</p>
        <div style="display:flex;justify-content:space-between;gap:20px;margin-top:40px;font-size:12px">
          <div style="border-top:1px solid #111;flex:1;text-align:center;padding-top:4px">Recibí conforme<br>Firma, aclaración y DNI</div>
          <div style="border-top:1px solid #111;flex:1;text-align:center;padding-top:4px">Entregó<br>Sinner Construcciones</div></div>
        <p style="margin:18px 0 0;font-size:11px;color:#555;text-align:center">Documento no válido como factura.</p>`};
    ["rm_a","rm_doc","rm_for","rm_it"].forEach(i=>$("#"+i).oninput=pintar);pintar();
    const guardar=async()=>{const {id,_por,...rest}=m;const add={remitoA:$("#rm_a").value.trim(),remitoDoc:$("#rm_doc").value.trim(),remitoForma:$("#rm_for").value.trim(),remitoItems:$("#rm_it").value.trim()};
      try{await db.collection("movimientos").doc(id).set({...rest,...add});Object.assign(m,add);return true}catch(e){toast(errMsg(e));return false}};
    $("#rm_save").onclick=async()=>{if(await guardar())toast("Remito guardado")};
    $("#rm_print").onclick=async()=>{await guardar();const w=document.createElement("div");w.id="printArea";w.innerHTML=$("#remito").innerHTML;document.body.appendChild(w);
      document.body.classList.add("imprimiendo");setTimeout(()=>{window.print();setTimeout(()=>{w.remove();document.body.classList.remove("imprimiendo")},500)},50)};
  });
}


/* ---------- dólar blue automático (DolarApi.com, mismos datos públicos que usan los portales) ---------- */
async function actualizarBlue(){
  try{
    const r=await fetch("https://dolarapi.com/v1/dolares/blue",{cache:"no-store"});if(!r.ok)return;
    const j=await r.json();const v=+j.venta,c=+j.compra;if(!(v>0))return;
    const f=j.fechaActualizacion?new Date(j.fechaActualizacion):new Date();
    S.blue={venta:v,compra:c,hora:f.toLocaleString("es-AR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})};
    const antes=num(S.cfg.cotizacion);S.cfg.cotizacion=v;
    if(isAdmin()&&db&&Math.abs(antes-v)>=1){try{const {id,_por,...rest}=S.cfg;await db.collection("config").doc("general").set({...rest,cotizacion:v,cotizacionFecha:new Date().toISOString()})}catch(e){}}
    pintarHoy();render();
  }catch(e){/* sin internet o la página no responde: queda el último valor guardado */}
}
/* clima de la zona (Open-Meteo, gratis y sin clave) */
const ZONA={nombre:"Villa General Belgrano",lat:-31.98,lon:-64.56};
function dondeEstoy(){return new Promise(res=>{
  if(!navigator.geolocation)return res(null);
  navigator.geolocation.getCurrentPosition(p=>res({lat:+p.coords.latitude.toFixed(2),lon:+p.coords.longitude.toFixed(2)}),()=>res(null),{enableHighAccuracy:false,timeout:8000,maximumAge:30*60*1000})})}
async function actualizarClima(){
  try{const pos=await dondeEstoy();const z=pos||ZONA;S.climaAca=!!pos;
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${z.lat}&longitude=${z.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=America%2FArgentina%2FCordoba`,{cache:"no-store"});
    if(!r.ok)return;const j=await r.json();
    S.clima={t:Math.round(j.current.temperature_2m),code:j.current.weather_code,max:Math.round(j.daily.temperature_2m_max[0]),min:Math.round(j.daily.temperature_2m_min[0]),lluvia:j.daily.precipitation_probability_max[0]};
    pintarHoy();
  }catch(e){}
}
function climaIcono(c){if(c===0)return "☀️";if(c<=2)return "🌤️";if(c===3)return "☁️";if(c<=48)return "🌫️";if(c<=67||(c>=80&&c<=82))return "🌧️";if(c<=77||c===85||c===86)return "🌨️";if(c>=95)return "⛈️";return "🌥️"}
function pintarHoy(){const el=document.getElementById("hoyBar");if(!el)return;
  if(S.auth!=="in"||(!S.blue&&!S.clima)){el.classList.remove("on");el.innerHTML="";return}
  const b=S.blue,c=S.clima;
  el.innerHTML=(b&&!isEnc()?`<span class="pz"><span class="k">Blue</span> <span>Compra <span class="v">${fmt(b.compra)}</span></span> · <span>Venta <span class="v">${fmt(b.venta)}</span></span></span>`:"")+
    (c?`<span class="pz" title="${S.climaAca?"Donde estás ahora":esc(ZONA.nombre)} · hoy ${c.min}° / ${c.max}°${c.lluvia!=null?" · lluvia "+c.lluvia+"%":""}">${S.climaAca?'<span aria-hidden="true" style="font-size:11px">📍</span>':""}<span aria-hidden="true">${climaIcono(c.code)}</span> <span class="v">${c.t}°</span> <span style="opacity:.75;font-weight:500">${c.min}°/${c.max}°${c.lluvia>=40?" · 💧"+c.lluvia+"%":""}</span></span>`:"");
  el.classList.add("on")}


/* ---------- menú lateral (☰) ---------- */
function menuItems(){
  const enc=isEnc();
  if(enc)return [["General",[["portada","🏠","Inicio"],["inicio","📋","Mi día"],["caja","💵","Gastos y mi caja"],["cierre","🔒","Cierre de caja"],["jornales","👷","Jornales"],["bitacora","📒","Bitácora"]]]];
  return [
    ["General",[["portada","🏠","Inicio"],["inicio","📊","Resumen"],["buscar","🔎","Buscar"]]],
    ["Dinero",[["caja","💵","Cajas y movimientos"],["usd","💲","Dólares y cambios"],["tarjetas","💳","Tarjetas de crédito"],["fede","👤","Caja y gastos de Federico"],["cierre","🔒","Apertura y cierre de cajas"],["sueldos","🧾","Sueldos"]]],
    ["Obras",[["obras","🏗️","Obras"],["jornales","👷","Jornales"],["bitacora","📒","Bitácora"],["presupuestos","📐","Precios y presupuestos"]]],
    ["Empresa",[["empresa","🏢","Empresa: gastos, herramientas y vehículos"],["clientes","🤝","Clientes"],["proveedores","🚚","Proveedores"]]]];
}
function pintarMenu(){
  const d=$("#drawer"),v=cur();
  d.innerHTML=`<div class="dh"><b>${esc(S.perfil?.nombre||"Menú")}</b><button type="button" class="btn sm" id="menuClose" aria-label="Cerrar menú">✕</button></div>
  ${menuItems().map(([g,its])=>`<div class="grp">${esc(g)}</div>${its.map(([k,ic,t])=>`<a href="#${k}" ${k===v?'aria-current="page"':""}><span class="ic" aria-hidden="true">${ic}</span>${esc(t)}</a>`).join("")}`).join("")}
  ${isEnc()?"":`<div class="grp">Cargar nuevo</div>
    <button type="button" class="it" data-adm="pagorem"><span class="ic" aria-hidden="true">📄</span>Pago con remito</button>
    <button type="button" class="it" data-adm="newenc"><span class="ic" aria-hidden="true">🦺</span>Encargado</button>
    <button type="button" class="it" data-adm="newobra"><span class="ic" aria-hidden="true">🏗️</span>Obra</button>
    <button type="button" class="it" data-adm="newcli"><span class="ic" aria-hidden="true">🤝</span>Cliente</button>
    <button type="button" class="it" data-adm="newprov"><span class="ic" aria-hidden="true">🚚</span>Proveedor</button>
    <button type="button" class="it" data-adm="newherr"><span class="ic" aria-hidden="true">🛠️</span>Herramienta</button>
  <div class="grp">Administración</div>
    <button type="button" class="it" data-adm="users"><span class="ic" aria-hidden="true">👥</span>Usuarios y contraseñas</button>
    <button type="button" class="it" data-adm="cfg"><span class="ic" aria-hidden="true">⚙️</span>Ajustes: precios, jornal y saldos</button>
    <button type="button" class="it" data-adm="pack"><span class="ic" aria-hidden="true">📥</span>Importar datos (.json)</button>
    <button type="button" class="it" data-adm="backup"><span class="ic" aria-hidden="true">💾</span>Copia de seguridad</button>`}
  <div class="grp"></div><button type="button" class="it" id="menuOut"><span class="ic" aria-hidden="true">🚪</span>Salir</button><div class="grp" style="text-transform:none">Versión ${VERSION}</div>`;
  $("#menuClose").onclick=cerrarMenu;
  d.querySelectorAll("a").forEach(a=>a.onclick=()=>setTimeout(cerrarMenu,0));
  d.querySelectorAll("[data-adm]").forEach(b=>b.addEventListener("click",()=>cerrarMenu()));
  $("#menuOut").onclick=async()=>{await sb.auth.signOut();location.hash="";location.reload()};
}
function abrirMenu(){pintarMenu();const d=$("#drawer");d.hidden=false;$("#drawerBg").hidden=false;requestAnimationFrame(()=>d.classList.add("open"));$("#menuBtn").setAttribute("aria-expanded","true");setTimeout(()=>{const a=d.querySelector('[aria-current="page"]')||d.querySelector("a");a&&a.focus()},60)}
function cerrarMenu(){const d=$("#drawer");if(!d||d.hidden)return;d.classList.remove("open");$("#drawerBg").hidden=true;$("#menuBtn").setAttribute("aria-expanded","false");setTimeout(()=>{d.hidden=true},200)}
$("#menuBtn").addEventListener("click",()=>$("#drawer").hidden?abrirMenu():cerrarMenu());
$("#drawerBg").addEventListener("click",cerrarMenu);
document.addEventListener("keydown",e=>{if(e.key==="Escape")cerrarMenu()});

/* ---------- apertura y cierre de cajas ---------- */
function diaAnterior(f){const d=new Date(f+"T12:00:00");d.setDate(d.getDate()-1);return d.toISOString().slice(0,10)}
function saldoCajaHasta(c,hasta){return saldos(c,hasta).ars}
function movDia(c,f){let ent=0,sal=0,n=0;for(const m of S.movs){if(m.fecha!==f)continue;const [x]=efecto(m,c);
    if(m.caja===c||m.cajaDestino===c)n++;if(x>0)ent+=x;else sal-=x}
  return {ent,sal,n}}
function datosCierre(c,f){const ap=saldoCajaHasta(c,diaAnterior(f)),{ent,sal,n}=movDia(c,f);const ua=saldos(c,diaAnterior(f)).usd,ut=saldos(c,f).usd;
  return {apertura:ap,entradas:ent,salidas:sal,ent,sal,teorico:ap+ent-sal,cant:n,aperturaUsd:ua,teoricoUsd:ut,conUsd:!!(ua||ut)}}
function vCierre(){
  const enc=isEnc(),f=S.filt.cierreF||hoy();
  const cajas=enc?[S.perfil?.caja].filter(Boolean):CAJAS.filter(c=>c!=="General"||S.movs.some(m=>m.caja==="General"||m.cajaDestino==="General"));
  if(S.sinCierres)return `<h2>Apertura y cierre de cajas</h2><div class="banner">Falta un paso en la base de datos: ejecutar en Supabase el archivo <b>7_cierres_de_caja.sql</b>. Hasta entonces, el cierre se puede ver pero no guardar.</div>`+tablaCierre(cajas,f,true);
  const hist=[...S.cierres].filter(x=>!enc||x.caja===S.perfil?.caja).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")||(a.caja||"").localeCompare(b.caja||"")).slice(0,40);
  return `<div class="row between"><h2>Apertura y cierre de cajas</h2></div>
  <div class="row" style="align-items:flex-end;gap:10px"><label class="f">Día<input type="date" id="ci_f" value="${esc(f)}" max="${hoy()}"></label>
    <button class="btn sm" id="ci_hoy">Hoy</button>${enc?"":`<button class="btn sm" id="ci_wsp" style="background:#25D366;color:#fff;border-color:#25D366">Enviar por WhatsApp</button><button class="btn sm" id="ci_wa">Copiar resumen</button>`}</div>
  <p class="note" style="margin:0">Apertura = saldo con el que arrancó la caja ese día. Contá la plata que hay realmente y ponela en “Contado”: la app calcula la diferencia. Si hay diferencia, podés registrarla como ajuste para que el saldo quede igual a la realidad.</p>
  ${tablaCierre(cajas,f,false)}
  ${enc?"":resumenDiaHtml(f)}
  <section class="card"><h3 style="margin-bottom:8px">Últimos cierres</h3>${hist.length?`<div class="list">${hist.map(x=>{const now=datosCierre(x.caja,x.fecha),cambio=Math.abs(now.teorico-(x.ajusteMovId?+x.contado:+x.teorico||0))>=1;
    return `<div class="item" style="cursor:default"><span class="t">${esc(fdate(x.fecha))} · Caja ${esc(x.caja)}</span><span class="s">Teórico ${fmt(x.teorico)} · Contado ${fmt(x.contado)}${x.cerradoPor?" · "+esc(x.cerradoPor):""}${x.nota?" · "+esc(x.nota):""}${cambio?` · <b style="color:var(--bad)">⚠ se cargaron o corrigieron movimientos después del cierre</b>`:""}</span><span class="m" style="color:${Math.abs(+x.diferencia||0)<1?"var(--good)":"var(--bad)"}">${Math.abs(+x.diferencia||0)<1?"OK":(x.diferencia>0?"+ ":"− ")+fmt(Math.abs(x.diferencia))}</span></div>`}).join("")}</div>`:`<div class="empty">Todavía no hay cierres.</div>`}</section>`;
}
function tablaCierre(cajas,f,soloVer){
  return `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${cajas.map(c=>{const d=datosCierre(c,f),ya=S.cierres.find(x=>x.caja===c&&x.fecha===f);
    return `<section class="card" data-ci="${esc(c)}" style="display:flex;flex-direction:column;gap:6px">
      <div class="row between"><h3>Caja ${esc(c)}</h3>${ya?`<span class="pill p-good">Cerrada</span>`:`<span class="pill p-warn">Abierta</span>`}</div>
      <table><tbody><tr><td>Apertura</td><td>${fmt(d.apertura)}</td></tr>
        <tr><td>Entradas${d.cant?` <span class="note">(${d.cant} mov.)</span>`:""}</td><td style="color:var(--good)">${d.ent?"+ "+fmt(d.ent):"—"}</td></tr>
        <tr><td>Salidas</td><td>${d.sal?"− "+fmt(d.sal):"—"}</td></tr></tbody>
        <tfoot><tr><td>Debería haber</td><td>${fmt(d.teorico)}</td></tr></tfoot></table>
      <label class="f">Pesos contados (lo que hay de verdad)<input data-cont inputmode="decimal" value="${ya?ya.contado:((S.ciDraft||{})[c+f]||{}).a||""}" placeholder="${Math.round(d.teorico)}" ${soloVer?"disabled":""}></label>
      ${d.conUsd||ya?.contadoUsd!=null&&ya?.teoricoUsd?`<div class="row between note" style="margin:0"><span>Dólares: apertura ${fmtU(d.aperturaUsd)}</span><b>Debería haber ${fmtU(d.teoricoUsd)}</b></div>
      <label class="f">Dólares contados<input data-contu inputmode="decimal" value="${ya&&ya.contadoUsd!=null?ya.contadoUsd:((S.ciDraft||{})[c+f]||{}).u||""}" placeholder="${d.teoricoUsd}" ${soloVer?"disabled":""}></label>
      <span data-difu>${ya&&ya.contadoUsd!=null?difUsdHtml(ya.contadoUsd-d.teoricoUsd):""}</span>`:""}
      <div class="row between"><span data-dif>${ya?difHtml(ya.contado-d.teorico):""}</span>${soloVer?"":`<button class="btn sm ${ya?"":"pri"}" data-cerrar>${ya?"Actualizar cierre":"Cerrar caja"}</button>`}</div>
    </section>`}).join("")}</div>
  ${soloVer||cajas.length<2?"":`<div class="row between"><span class="note">Las cajas sin “Contado” se cierran con lo que debería haber.</span><button class="btn pri" id="ci_todas">Cerrar todas las cajas</button></div>`}`;
}
const difUsdHtml=d=>Math.abs(d)<1?`<span style="color:var(--good)">Dólares OK</span>`:`<b style="color:var(--bad)">Dólares: ${d>0?"+ sobran ":"− faltan "}${fmtU(Math.abs(d))}</b>`;
const difHtml=d=>Math.abs(d)<1?`<span style="color:var(--good)">OK</span>`:`<b style="color:var(--bad)">${d>0?"+ sobra ":"− falta "}${fmt(Math.abs(d))}</b>`;
function resumenDia(f){const mv=S.movs.filter(m=>m.fecha===f);const eg=mv.filter(m=>m.tipo==="egreso"),ing=mv.filter(m=>m.tipo==="ingreso"&&!/cambio/i.test(m.categoria||""));
  const porObra={};for(const m of eg){const k=obraNombre(m.obra);porObra[k]=(porObra[k]||0)+(+m.monto||0)}
  const jor=S.jorn.filter(j=>j.fecha===f),jc=jor.reduce((a,j)=>a+(+j.cantidad||0),0);
  const act=sortObras(obrasActivas()).filter(o=>o.estado==="En curso"),sinBit=act.filter(o=>!S.bit.some(b=>b.obra===o.id&&b.fecha===f));
  return {eg:eg.reduce((a,m)=>a+(+m.monto||0),0),ing:ing.reduce((a,m)=>a+(+m.monto||0),0),porObra,jor,jc,sinBit}}
function resumenDiaHtml(f){const r=resumenDia(f);
  return `<section class="card"><h3 style="margin-bottom:8px">Resumen del día ${esc(fdate(f))}</h3>
  <div class="grid"><div class="stat"><div class="lbl">Entró</div><div class="num" style="color:var(--good)">${fmt(r.ing)}</div></div><div class="stat"><div class="lbl">Salió</div><div class="num neg">${fmt(r.eg)}</div></div><div class="stat"><div class="lbl">Jornales</div><div class="num">${r.jc}</div></div></div>
  ${Object.keys(r.porObra).length?`<table style="margin-top:8px"><tbody>${Object.entries(r.porObra).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>Gastos ${esc(k)}</td><td>${fmt(v)}</td></tr>`).join("")}</tbody></table>`:""}
  ${r.sinBit.length?`<p class="note" style="margin:8px 0 0">Falta la bitácora de: <b>${r.sinBit.map(o=>esc(o.nombre)).join(", ")}</b></p>`:`<p class="note" style="margin:8px 0 0">Bitácora completa ✅</p>`}</section>`}
function textoResumen(f){const r=resumenDia(f),cajas=CAJAS.filter(c=>c!=="General"||S.movs.some(m=>m.caja==="General"||m.cajaDestino==="General"));
  const dias=["domingo","lunes","martes","miércoles","jueves","viernes","sábado"],dd=new Date(f+"T12:00:00");
  let t=`*Cierre de cajas – ${dias[dd.getDay()]} ${f.slice(8,10)}/${f.slice(5,7)}*\n`;
  for(const c of cajas){const d=datosCierre(c,f),ya=S.cierres.find(x=>x.caja===c&&x.fecha===f);
    const cambios=S.movs.filter(m=>m.fecha===f&&m.tipo==="cambio"&&m.caja===c);
    let line=`${c}: ${fmt(ya?ya.contado:d.teorico)}`;if(d.conUsd||ya?.contadoUsd)line+=` · ${fmtU(ya&&ya.contadoUsd!=null?ya.contadoUsd:d.teoricoUsd)}`;
    if(!ya)line+=" (sin cerrar)";else{const dp=ya.contado-d.teorico,du=ya.contadoUsd!=null?ya.contadoUsd-d.teoricoUsd:0;
      line+=Math.abs(dp)<1&&Math.abs(du)<1?" ✅":` ⚠️${Math.abs(dp)>=1?` ${dp>0?"sobran":"faltan"} ${fmt(Math.abs(dp))}`:""}${Math.abs(du)>=1?` ${du>0?"sobran":"faltan"} ${fmtU(Math.abs(du))}`:""}`}
    if(ya&&(Math.abs(+ya.diferencia||0)>=1||Math.abs(+ya.diferenciaUsd||0)>=1)&&Math.abs(ya.contado-d.teorico)<1)line+=` (se ajustó: ${[Math.abs(+ya.diferencia||0)>=1?`${ya.diferencia>0?"sobraban":"faltaban"} ${fmt(Math.abs(ya.diferencia))}`:"",Math.abs(+ya.diferenciaUsd||0)>=1?`${ya.diferenciaUsd>0?"sobraban":"faltaban"} ${fmtU(Math.abs(ya.diferenciaUsd))}`:""].filter(Boolean).join(" y ")})`;
    if(cambios.length)line+=` (cambió ${cambios.map(m=>`${fmtU(m.usd)} a ${fmt(+m.monto/(+m.usd))}`).join(", ")})`;
    t+=line+"\n"}
  const nMov=S.movs.filter(m=>m.fecha===f).length;
  t+=`\nMovimientos del día: ${nMov} · Entradas ${fmt(r.ing)} · Salidas ${fmt(r.eg)}${r.jc?` · Jornales ${r.jc}`:""}\n`;
  for(const [k,v] of Object.entries(r.porObra))t+=`  - ${k}: ${fmt(v)}\n`;
  if(r.sinBit.length)t+=`\nFalta bitácora: ${r.sinBit.map(o=>o.nombre).join(", ")}\n`;
  return t}
async function guardarCierre(c,f,contadoTxt,preguntar,contUsdTxt){
  const d=datosCierre(c,f),cont=contadoTxt===""?d.teorico:num(contadoTxt),dif=Math.round((cont-d.teorico)*100)/100;
  const contU=contUsdTxt==null||contUsdTxt===""?d.teoricoUsd:num(contUsdTxt),difU=m2(contU-d.teoricoUsd);
  const prev=S.cierres.find(x=>x.caja===c&&x.fecha===f);let ajusteMovId=prev&&prev.ajusteMovId||"";
  if(Math.abs(dif)>=1&&preguntar){
    if(confirm(`Caja ${c}: ${dif>0?"sobran":"faltan"} ${fmt(Math.abs(dif))}.\n\n¿Registro un ajuste "Diferencia de caja" para que el saldo de la app quede igual a lo contado?\n\n(Aceptar = sí, registrar ajuste · Cancelar = cerrar igual sin ajuste)`)){
      const ref=db.collection("movimientos").doc(ajusteMovId||undefined);
      await ref.set({fecha:f,tipo:dif>0?"ingreso":"egreso",caja:c,obra:"_empresa",categoria:"Diferencia de caja",monto:Math.abs(dif),detalle:`Diferencia de caja al cierre del ${fdate(f)} (${dif>0?"sobrante":"faltante"})`,creado:Date.now()});
      ajusteMovId=ref.id}}
  let ajusteUsdId=prev&&prev.ajusteUsdId||"";
  if(Math.abs(difU)>=1&&preguntar){
    if(confirm(`Caja ${c}: ${difU>0?"sobran":"faltan"} ${fmtU(Math.abs(difU))}.\n\n¿Registro un ajuste en dólares para que la app quede igual a lo contado?`)){
      const ref=db.collection("movimientos").doc(ajusteUsdId||undefined),r=ultimoCambio(c,f),cot=r?r.cot:num(S.cfg.cotizacion);
      await ref.set({fecha:f,tipo:difU>0?"ingreso":"egreso",caja:c,obra:"_empresa",categoria:"Diferencia de caja",moneda:"USD",usd:Math.abs(difU),cotizacion:cot,monto:m2(Math.abs(difU)*(cot||0)),detalle:`Diferencia de dólares al cierre del ${fdate(f)} (${difU>0?"sobrante":"faltante"})`,creado:Date.now()});
      ajusteUsdId=ref.id}}
  const ref=db.collection("cierres").doc(`${c}-${f}`.replace(/[^\w-]/g,"_"));
  await ref.set({caja:c,fecha:f,apertura:d.apertura,entradas:d.ent,salidas:d.sal,teorico:d.teorico,contado:cont,diferencia:dif,ajusteMovId,...(d.conUsd||contU?{aperturaUsd:d.aperturaUsd,teoricoUsd:d.teoricoUsd,contadoUsd:contU,diferenciaUsd:difU,ajusteUsdId}:{}),cerradoPor:S.perfil?.nombre||"",creado:prev?.creado||Date.now()});
}
function bindCierre(V){
  const f=S.filt.cierreF||hoy();
  const fi=V.querySelector("#ci_f");if(fi)fi.onchange=()=>{S.filt.cierreF=fi.value||hoy();render()};
  const bh=V.querySelector("#ci_hoy");if(bh)bh.onclick=()=>{S.filt.cierreF=hoy();render()};
  V.querySelectorAll("[data-ci]").forEach(tr=>{const c=tr.dataset.ci,inp=tr.querySelector("[data-cont]"),iu=tr.querySelector("[data-contu]");
    const dr=()=>{S.ciDraft=S.ciDraft||{};S.ciDraft[c+f]={a:inp?inp.value:"",u:iu?iu.value:""}};
    if(inp)inp.oninput=()=>{dr();const d=datosCierre(c,f);tr.querySelector("[data-dif]").innerHTML=inp.value===""?"":difHtml(num(inp.value)-d.teorico)};
    if(iu)iu.oninput=()=>{dr();const d=datosCierre(c,f);tr.querySelector("[data-difu]").innerHTML=iu.value===""?"":difUsdHtml(num(iu.value)-d.teoricoUsd)};
    const b=tr.querySelector("[data-cerrar]");if(b)b.onclick=async()=>{try{await guardarCierre(c,f,inp.value,true,iu?iu.value:null);toast("Caja "+c+" cerrada")}catch(e){toast(errMsg(e))}}});
  const bt=V.querySelector("#ci_todas");if(bt)bt.onclick=async()=>{try{for(const tr of V.querySelectorAll("[data-ci]"))await guardarCierre(tr.dataset.ci,f,tr.querySelector("[data-cont]").value,true,tr.querySelector("[data-contu]")?tr.querySelector("[data-contu]").value:null);toast("Cajas cerradas")}catch(e){toast(errMsg(e))}};
  const bw=V.querySelector("#ci_wa");if(bw)bw.onclick=()=>navigator.clipboard.writeText(textoResumen(f)).then(()=>toast("Resumen copiado: pegalo en WhatsApp"));
  const bz=V.querySelector("#ci_wsp");if(bz)bz.onclick=()=>{const u="https://wa.me/?text="+encodeURIComponent(textoResumen(f));const w=window.open(u,"_blank");if(!w)location.href=u};
}


/* ---------- presupuesto dictado con IA ---------- */
function openDictado(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,grabando=false;
  openSheet(`<div style="display:flex;flex-direction:column;gap:12px">${sheetHead("🎤 Dictar presupuesto")}
    <p class="note" style="margin:0">Ejemplo: “Presupuesto para Juan Pérez, casa en Santa Rosa de 8 por 10, paredes de panel de 10 cm de 2,60 de alto, con revoque de los dos lados y platea con bomba.”</p>
    <label class="f">Lo que hay que presupuestar<textarea id="dc_txt" rows="7" placeholder="Tocá el micrófono y hablá, o escribí acá"></textarea></label>
    <div class="row">${SR?`<button type="button" class="btn" id="dc_mic">🎤 Empezar a dictar</button>`:`<span class="note">En este celu usá el micrófono del teclado para dictar.</span>`}
      <button type="button" class="btn pri" id="dc_go">Armar presupuesto</button></div>
    <div id="dc_est" class="note" aria-live="polite"></div></div>`,sh=>{
    sh.querySelector("[data-close]").onclick=()=>{try{rec&&rec.stop()}catch(e){}closeSheet()};
    const txt=$("#dc_txt"),est=$("#dc_est");
    if(SR){const b=$("#dc_mic");let base="";
      b.onclick=()=>{if(grabando){rec.stop();return}
        rec=new SR();rec.lang="es-AR";rec.continuous=true;rec.interimResults=true;base=txt.value?txt.value.trim()+" ":"";
        rec.onresult=ev=>{let fin="",tmp="";for(let i=0;i<ev.results.length;i++){const r=ev.results[i];if(r.isFinal)fin+=r[0].transcript;else tmp+=r[0].transcript}txt.value=base+fin+tmp};
        rec.onend=()=>{grabando=false;b.textContent="🎤 Seguir dictando";est.textContent=""};
        rec.onerror=e=>{est.textContent=e.error==="not-allowed"?"Dale permiso al micrófono en el navegador.":"No se pudo usar el micrófono ("+e.error+").";};
        rec.start();grabando=true;b.textContent="⏹️ Terminar";est.textContent="Escuchando… hablá tranquila."}}
    $("#dc_go").onclick=async()=>{try{rec&&grabando&&rec.stop()}catch(e){}
      const t=txt.value.trim();if(t.length<5)return toast("Contá qué hay que presupuestar");
      const g=$("#dc_go");g.disabled=true;g.textContent="Armando… (unos segundos)";est.textContent="La IA está calculando cantidades y precios.";
      try{const {data,error}=await sb.functions.invoke("presupuesto-ia",{body:{texto:t}});
        if(error){let m="";try{m=(await error.context.json()).error}catch(_){}
          throw new Error(m||(String(error.message||"").includes("Failed to send")?"Falta activar la IA en Supabase (función presupuesto-ia).":"La IA no respondió."))}
        if(data&&data.error)throw new Error(data.error);
        closeSheet();
        setTimeout(()=>{openPres({desdeIA:true,...data,dictado:t});
          const q=(data.preguntas||[]).filter(Boolean);if(q.length)setTimeout(()=>toast("Revisá: "+q.join(" · ")),400)},300);
      }catch(e){g.disabled=false;g.textContent="Armar presupuesto";est.textContent="";toast(e.message||"No se pudo armar")}};
  });
}


/* ---------- lista de precios y calculadora de pared ---------- */
const RUBROS_P=["Paneles","Mallas","Cemento y áridos","Hormigón","Hierros","Ferretería","Aberturas","Techos","Instalaciones","Terminaciones","Mano de obra","Otros"];
function listaBase(){const p=S.cfg.precios||{};const U=(id,codigo,nombre,rubro,unidad,precio)=>({id,codigo,nombre,rubro,unidad,precio,moneda:"USD",proveedor:"Concrehaus",act:"2026-09"});
  const A=(id,nombre,rubro,unidad,precio,prov)=>({id,codigo:"",nombre,rubro,unidad,precio:precio||0,moneda:"ARS",proveedor:prov||"",act:""});
  return [U("pce04","PCE 04","Panel EPS 4 cm","Paneles","m²",9.07),U("pce06","PCE 06","Panel EPS 6 cm","Paneles","m²",10.53),U("pce08","PCE 08","Panel EPS 8 cm","Paneles","m²",11.84),U("pce10","PCE 10","Panel EPS 10 cm","Paneles","m²",13.17),
    U("pce12","PCE 12","Panel EPS 12 cm","Paneles","m²",14.80),U("pce14","PCE 14","Panel EPS 14 cm","Paneles","m²",16.28),U("pce16","PCE 16","Panel EPS 16 cm","Paneles","m²",17.90),U("pce18","PCE 18","Panel EPS 18 cm","Paneles","m²",19.97),
    U("mpc15","MPC 15","Malla plana 22,5 x 123","Mallas","u",1.18),U("mpc30","MPC 30","Malla plana 30 x 123","Mallas","u",1.69),U("mac15","MAC 15","Malla angular 18,5 x 18,5 x 123","Mallas","u",2.11),U("mac30","MAC 30","Malla angular 30 x 30 x 123","Mallas","u",3.06),
    U("muc0812","MUC 08/12","Malla U (paneles 8 a 12)","Mallas","u",2.36),U("muc1418","MUC 14/18","Malla U (paneles 14 a 18)","Mallas","u",2.64),U("mec2401","MEC 2401","Malla entera 124 x 240","Mallas","u",9.86),
    A("cemento","Cemento portland bolsa 50 kg","Cemento y áridos","bolsa"),A("arena","Arena gruesa","Cemento y áridos","m³"),A("cal","Cal hidratada bolsa 25 kg","Cemento y áridos","bolsa"),A("hidrofugo","Hidrófugo 10 L","Cemento y áridos","u"),
    A("hormigon","Hormigón H21","Hormigón","m³",p.hormigon),A("macrofibra","Macrofibra bolsa 4 kg","Hormigón","bolsa",p.macrofibra)]}
const lista=()=>S.lista||listaBase();
const precioARS=it=>(+it.precio||0)*(it.moneda==="USD"?(num(S.cfg.cotizacion)||0):1);
async function guardarLista(items){try{await db.doc("config/lista").set({items});S.lista=items;return true}catch(e){toast(errMsg(e));return false}}
function vPresupuestos(){
  const tab=S.filt.ptab||"lista";
  const tabs=[["lista","Lista de precios"],["pared","Calcular pared"],["pres","Presupuestos"]];
  return `<h2>Precios y presupuestos</h2>
  <div class="seg" style="max-width:520px">${tabs.map(([k,l])=>`<button type="button" data-ptab="${k}" aria-pressed="${tab===k}">${l}</button>`).join("")}</div>
  ${tab==="lista"?vLista():tab==="pared"?vPared():vPresupuestosLista()}`}
function vLista(){const L=lista(),f=S.filt;const rub=[...new Set([...RUBROS_P,...L.map(i=>i.rubro).filter(Boolean)])];
  return `<div class="row" style="gap:8px;align-items:flex-end">
    <label class="f" style="flex:2;min-width:180px">Buscar<input id="li_q" type="search" value="${esc(f.liq||"")}" placeholder="Ej: panel 10, cemento, malla"></label>
    <label class="f" style="flex:1;min-width:140px">Rubro<select id="li_r"><option value="">Todos</option>${rub.map(r=>`<option ${f.lir===r?"selected":""}>${esc(r)}</option>`).join("")}</select></label></div>
  ${isAdmin()?`<div class="row"><button class="btn sm pri" id="li_new">+ Producto</button><button class="btn sm" id="li_paste">Pegar lista de un proveedor</button><button class="btn sm" id="li_csv">Descargar lista</button></div>`:""}
  <p class="note" style="margin:0">Los precios en dólares se pasan a pesos con el blue de hoy (${fmt(S.cfg.cotizacion||0)}). Tocá un producto para editarlo.</p>
  <div class="list" id="li_list">${listaItemsHtml()}</div>`}
function listaFiltrada(){const f=S.filt,q=(f.liq||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").split(/\s+/).filter(Boolean);
  return lista().filter(i=>(!f.lir||i.rubro===f.lir)&&q.every(w=>((i.codigo||"")+" "+(i.nombre||"")+" "+(i.proveedor||"")+" "+(i.rubro||"")).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").includes(w)))
    .sort((a,b)=>(a.rubro||"").localeCompare(b.rubro||"")||(a.nombre||"").localeCompare(b.nombre||"",undefined,{numeric:true}))}
function listaItemsHtml(){const L=listaFiltrada();
  return L.map(i=>`<button class="item" data-prod="${esc(i.id)}"><span class="t">${i.codigo?`<span class="note">${esc(i.codigo)}</span> `:""}${esc(i.nombre)}</span>
    <span class="s">${esc(i.rubro||"")}${i.proveedor?" · "+esc(i.proveedor):""} · por ${esc(i.unidad||"u")}${i.act?" · act. "+esc(i.act):""}</span>
    <span class="m">${+i.precio?`${precioARS(i)?fmt(precioARS(i)):""}${i.moneda==="USD"?`<br><span class="note">US$ ${(+i.precio).toLocaleString("es-AR")}</span>`:""}`:`<span class="pill p-warn">sin precio</span>`}</span></button>`).join("")||`<div class="empty">No hay productos con esa búsqueda.</div>`}
function openProd(it){if(!isAdmin())return;const e=!!it;it=it||{id:"",codigo:"",nombre:"",rubro:S.filt.lir||"Otros",unidad:"u",precio:"",moneda:"ARS",proveedor:""};
  openSheet(`<form id="fp2" style="display:flex;flex-direction:column;gap:12px">${sheetHead(e?"Editar producto":"Nuevo producto")}
    <label class="f">Nombre<input id="pp_n" required value="${esc(it.nombre)}"></label>
    <div class="two"><label class="f">Código<input id="pp_c" value="${esc(it.codigo||"")}"></label><label class="f">Rubro<select id="pp_r">${[...new Set([...RUBROS_P,it.rubro])].map(r=>`<option ${it.rubro===r?"selected":""}>${esc(r)}</option>`).join("")}</select></label>
    <label class="f">Unidad<input id="pp_u" value="${esc(it.unidad||"u")}" placeholder="m², u, bolsa, m³…"></label><label class="f">Proveedor<input id="pp_p" value="${esc(it.proveedor||"")}"></label>
    <label class="f">Precio<input id="pp_pr" inputmode="decimal" value="${esc(it.precio||"")}"></label><label class="f">Moneda<select id="pp_m"><option value="ARS" ${it.moneda!=="USD"?"selected":""}>Pesos</option><option value="USD" ${it.moneda==="USD"?"selected":""}>Dólares</option></select></label></div>
    <div class="row between">${e?`<button type="button" class="btn danger" id="pp_del">Borrar</button>`:"<span></span>"}<button class="btn pri" type="submit">Guardar</button></div></form>`,sh=>{
    sh.querySelector("[data-close]").onclick=closeSheet;
    $("#fp2").onsubmit=async ev=>{ev.preventDefault();const L=[...lista()];
      const d={id:it.id||("p"+Date.now().toString(36)),codigo:$("#pp_c").value.trim(),nombre:$("#pp_n").value.trim(),rubro:$("#pp_r").value,unidad:$("#pp_u").value.trim()||"u",precio:num($("#pp_pr").value),moneda:$("#pp_m").value,proveedor:$("#pp_p").value.trim(),act:hoy().slice(0,7)};
      const k=L.findIndex(x=>x.id===d.id);if(k>=0)L[k]=d;else L.push(d);if(await guardarLista(L)){closeSheet();toast("Guardado");render()}};
    if($("#pp_del"))$("#pp_del").onclick=async()=>{if(!confirm("¿Borrar "+it.nombre+"?"))return;if(await guardarLista(lista().filter(x=>x.id!==it.id))){closeSheet();render()}};
  })}
function openPegar(){openSheet(`<div style="display:flex;flex-direction:column;gap:12px">${sheetHead("Pegar lista de un proveedor")}
    <p class="note" style="margin:0">Copiá las filas desde Excel o el PDF del proveedor y pegalas acá. Una fila por producto, columnas en este orden (separadas por tabulación o “;”): <b>Código · Nombre · Unidad · Precio</b>. Si un producto ya existe (mismo código o nombre), se actualiza el precio.</p>
    <div class="two"><label class="f">Proveedor<input id="pg_p"></label><label class="f">Rubro<select id="pg_r">${RUBROS_P.map(r=>`<option>${esc(r)}</option>`).join("")}</select></label>
    <label class="f">Moneda<select id="pg_m"><option value="ARS">Pesos</option><option value="USD">Dólares</option></select></label></div>
    <textarea id="pg_t" rows="8" placeholder="PCE 10;Panel EPS 10 cm;m²;13,17"></textarea>
    <div id="pg_prev" class="note"></div><button class="btn pri" id="pg_ok">Cargar</button></div>`,sh=>{
    sh.querySelector("[data-close]").onclick=closeSheet;
    const parse=()=>$("#pg_t").value.split(/\r?\n/).map(l=>l.split(/\t|;/).map(x=>x.trim())).filter(c=>c.length>=2&&c.some(Boolean)).map(c=>{
      let [cod,nom,uni,pr]=c;if(c.length===2){nom=c[0];pr=c[1];cod="";uni="u"}if(c.length===3){nom=c[0];uni=c[1];pr=c[2];cod=""}
      return {codigo:cod||"",nombre:nom||cod,unidad:uni||"u",precio:num(String(pr||"").replace(/[^\d.,-]/g,""))}}).filter(x=>x.nombre);
    $("#pg_t").oninput=()=>{const r=parse();$("#pg_prev").textContent=r.length?`${r.length} productos detectados. Ej: ${r[0].nombre} – ${r[0].precio}`:""};
    $("#pg_ok").onclick=async()=>{const r=parse();if(!r.length)return toast("No detecté productos");const L=[...lista()],prov=$("#pg_p").value.trim(),rub=$("#pg_r").value,mon=$("#pg_m").value;let n=0,u=0;
      for(const x of r){const k=L.findIndex(i=>(x.codigo&&i.codigo===x.codigo)||(i.nombre||"").toLowerCase()===x.nombre.toLowerCase());
        const d={...(k>=0?L[k]:{id:"p"+Date.now().toString(36)+Math.random().toString(36).slice(2,6),rubro:rub}),codigo:x.codigo||(k>=0?L[k].codigo:""),nombre:x.nombre,unidad:x.unidad,precio:x.precio,moneda:mon,proveedor:prov||(k>=0?L[k].proveedor:""),act:hoy().slice(0,7)};
        if(k>=0){L[k]=d;u++}else{L.push(d);n++}}
      if(await guardarLista(L)){closeSheet();toast(`Listo: ${n} nuevos, ${u} actualizados`);render()}};
  })}
/* calculadora de pared de panel */
function vPared(){const c=S.par||(S.par={largo:"",alto:"2.6",abN:"",abM2:"",esq:"2",caras:"2",esp:"3",panel:"pce10",desp:"5"});const P=lista().filter(i=>i.rubro==="Paneles");
  return `<p class="note" style="margin:0">Poné las medidas y elegí la placa: calcula placas, mallas, cemento, arena y mano de obra con tus precios.</p>
  <section class="card" style="display:flex;flex-direction:column;gap:10px"><div class="two">
    <label class="f">Largo de pared (m)<input data-par="largo" inputmode="decimal" value="${esc(c.largo)}" placeholder="Ej: 20"></label>
    <label class="f">Alto (m)<input data-par="alto" inputmode="decimal" value="${esc(c.alto)}"></label>
    <label class="f">¿Qué placa?<select data-par="panel">${P.map(i=>`<option value="${esc(i.id)}" ${c.panel===i.id?"selected":""}>${esc(i.nombre)}${i.codigo?" ("+esc(i.codigo)+")":""}</option>`).join("")}</select></label>
    <label class="f">Esquinas<input data-par="esq" inputmode="numeric" value="${esc(c.esq)}"></label>
    <label class="f">Aberturas (cantidad)<input data-par="abN" inputmode="numeric" value="${esc(c.abN)}" placeholder="0"></label>
    <label class="f">m² de aberturas en total<input data-par="abM2" inputmode="decimal" value="${esc(c.abM2)}" placeholder="0"></label>
    <label class="f">Caras con revoque<select data-par="caras"><option value="2" ${c.caras==="2"?"selected":""}>Las dos</option><option value="1" ${c.caras==="1"?"selected":""}>Una</option><option value="0" ${c.caras==="0"?"selected":""}>Ninguna</option></select></label>
    <label class="f">Espesor de revoque por cara (cm)<input data-par="esp" inputmode="decimal" value="${esc(c.esp)}"></label>
  </div></section>
  <section class="card" id="par_res">${paredHtml()}</section>
  <div class="row"><button class="btn pri" id="par_pres">Pasar a un presupuesto</button><button class="btn" id="par_copy">Copiar</button></div>`}
function paredCalc(){const c=S.par,L=lista(),by=id=>L.find(i=>i.id===id)||L.find(i=>(i.codigo||"").replace(/\s/g,"").toLowerCase()===String(id).toLowerCase())||null;
  const largo=num(c.largo),alto=num(c.alto),abN=num(c.abN),abM2=num(c.abM2),esq=num(c.esq),caras=+c.caras||0,esp=num(c.esp),desp=num(c.desp)||5;
  if(!largo||!alto)return null;
  const panel=by(c.panel)||L.find(i=>i.rubro==="Paneles");const espP=+(String(panel&&panel.codigo||"").match(/\d+/)||[10])[0];
  const m2=Math.max(0,largo*alto-abM2),m2P=Math.ceil(m2*(1+desp/100)*10)/10,placas=Math.ceil(largo/1.2);
  const piezaAlto=Math.ceil(alto/1.23);
  const perim=abN&&abM2?abN*4*Math.sqrt(abM2/abN):0;
  const vol=m2*caras*esp/100*1.1;
  const rows=[];const add=(prod,d,cant,unid,nota)=>{if(cant>0)rows.push({prod,d,cant:Math.ceil(cant*100)/100,unid,nota,precio:prod?precioARS(prod):0})};
  add(panel,panel?panel.nombre:"Panel EPS",m2P,"m²",`${placas} placas de 1,20 m × ${alto} m · ${fmtN(m2)} m² netos + ${desp}% desperdicio`);
  add(by("mac15"),"Malla angular (esquinas)",esq*2*piezaAlto,"u",`${esq} esquinas × 2 caras × ${piezaAlto} tramos de 1,23 m`);
  add(by("mpc30"),"Malla plana (refuerzo de aberturas)",abN*4*2,"u",`${abN} aberturas × 4 diagonales × 2 caras`);
  add(by(espP>12?"muc1418":"muc0812"),"Malla U (bordes de aberturas)",Math.ceil(perim/1.23),"u",perim?`≈ ${fmtN(perim)} m de bordes`:"");
  if(vol>0){add(by("cemento"),"Cemento portland 50 kg",Math.ceil(vol*(num(S.cfg.mortCem)||8.5)),"bolsa",`${fmtN(vol)} m³ de mortero 1:3 (${caras} cara/s × ${esp} cm, +10%)`);
    add(by("arena"),"Arena gruesa",Math.ceil(vol*(num(S.cfg.mortArena)||1.1)*10)/10,"m³","")}
  const r=S.cfg.rend||{pared:10,revoque:12},jp=Math.ceil(m2/(r.pared||10)*2)/2,jr=caras?Math.ceil(m2*caras/(r.revoque||12)*2)/2:0;
  const mo=[];if(jp)mo.push({d:"Levantar pared de panel",cant:jp,unid:"jornales",precio:precioJ(),jor:jp,nota:`${fmtN(m2)} m² ÷ ${r.pared} m²/jornal`});
  if(jr)mo.push({d:"Revoque",cant:jr,unid:"jornales",precio:precioJ(),jor:jr,nota:`${fmtN(m2*caras)} m² ÷ ${r.revoque} m²/jornal`});
  return {rows,mo,m2}}
const fmtN=n=>(Math.round(n*100)/100).toLocaleString("es-AR");
function paredHtml(){const R=paredCalc();if(!R)return `<div class="empty">Poné el largo y el alto de la pared.</div>`;
  const tm=R.rows.reduce((a,x)=>a+x.cant*x.precio,0),tl=R.mo.reduce((a,x)=>a+x.cant*x.precio,0),falta=R.rows.filter(x=>!x.precio);
  return `<h3 style="margin-bottom:6px">Materiales · ${fmtN(R.m2)} m² de pared</h3><table><tbody>${R.rows.map(x=>`<tr><td>${esc(x.d)}<br><span class="note">${esc(x.nota||"")}</span></td><td style="white-space:nowrap">${fmtN(x.cant)} ${esc(x.unid)}</td><td style="white-space:nowrap">${x.precio?fmt(x.cant*x.precio):`<span class="pill p-warn">sin precio</span>`}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="2">Materiales</td><td>${fmt(tm)}</td></tr></tfoot></table>
  <h3 style="margin:10px 0 6px">Mano de obra</h3><table><tbody>${R.mo.map(x=>`<tr><td>${esc(x.d)}<br><span class="note">${esc(x.nota)}</span></td><td>${fmtN(x.cant)} jornales</td><td>${fmt(x.cant*x.precio)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="2">Total pared</td><td>${fmt(tm+tl)}</td></tr></tfoot></table>
  ${falta.length?`<p class="note" style="margin:8px 0 0;color:var(--warn)">Falta el precio de: ${falta.map(x=>esc(x.d)).join(", ")}. Cargalo en “Lista de precios”.</p>`:""}
  ${ganInterna(R.mo.reduce((a,x)=>a+x.jor,0))}
  <p class="note" style="margin:8px 0 0">Mallas y mortero según criterio general de panel EPS: revisalos con el encargado para cada obra.</p>`}
function bindPrecios(V){
  V.querySelectorAll("[data-ptab]").forEach(b=>b.onclick=()=>{S.filt.ptab=b.dataset.ptab;render()});
  const q=V.querySelector("#li_q");if(q)q.oninput=()=>{S.filt.liq=q.value;$("#li_list").innerHTML=listaItemsHtml();bindProd(V)};
  const r=V.querySelector("#li_r");if(r)r.onchange=()=>{S.filt.lir=r.value;$("#li_list").innerHTML=listaItemsHtml();bindProd(V)};
  bindProd(V);
  const n=V.querySelector("#li_new");if(n)n.onclick=()=>openProd();
  const pg=V.querySelector("#li_paste");if(pg)pg.onclick=()=>openPegar();
  const cs=V.querySelector("#li_csv");if(cs)cs.onclick=()=>saveFile("lista-de-precios.csv",[["Código","Nombre","Rubro","Unidad","Precio","Moneda","Precio en pesos","Proveedor","Actualizado"],...listaFiltrada().map(i=>[i.codigo,i.nombre,i.rubro,i.unidad,i.precio,i.moneda,Math.round(precioARS(i)),i.proveedor,i.act])]);
  V.querySelectorAll("[data-par]").forEach(i=>i.oninput=i.onchange=()=>{S.par[i.dataset.par]=i.value;$("#par_res").innerHTML=paredHtml()});
  const pp=V.querySelector("#par_pres");if(pp)pp.onclick=()=>{const R=paredCalc();if(!R)return toast("Poné el largo y el alto");
    openPres(null,[...R.rows.map(x=>({d:x.d,cant:x.cant,unid:x.unid,precio:Math.round(x.precio*100)/100})),...R.mo.map(x=>({d:x.d,cant:x.cant,unid:"jornales",precio:x.precio,jor:x.jor}))])};
  const pc=V.querySelector("#par_copy");if(pc)pc.onclick=()=>{const R=paredCalc();if(!R)return;
    const t=`Pared ${S.par.largo} m × ${S.par.alto} m (${fmtN(R.m2)} m²)\n`+[...R.rows,...R.mo].map(x=>`• ${x.d}: ${fmtN(x.cant)} ${x.unid}${x.precio?" – "+fmt(x.cant*x.precio):""}`).join("\n");
    navigator.clipboard.writeText(t).then(()=>toast("Copiado"))};
}
function bindProd(V){V.querySelectorAll("[data-prod]").forEach(b=>b.onclick=()=>openProd(lista().find(x=>x.id===b.dataset.prod)))}


/* ---------- caja y gastos personales de Federico ---------- */
const RUBROS_FEDE=["Casa","Familia","Auto particular","Tarjeta personal","Salud","Comida y salidas","Impuestos y servicios","Retiro en efectivo","Otros"];
const esPersonalFede=m=>m.tipo==="egreso"&&(m.obra==="_federico"||m.categoria==="Personal Federico");
function grupoSalida(m){if(esPersonalFede(m))return "Gastos personales";if(m.obra&&m.obra.startsWith("_"))return "Empresa";return "Obras"}
function vFede(){
  if(!isAdmin())return `<div class="empty">Solo administración.</div>`;
  const C="Federico",f=S.filt,mes=f.fmes||hoy().slice(0,7);
  const meses=[...new Set(S.movs.map(m=>(m.fecha||"").slice(0,7)).filter(Boolean).concat(hoy().slice(0,7)))].sort().reverse();
  const desde=S.cfg.cajasDesde||"";const enMes=m=>mes==="todo"?(m.fecha||"")>=desde:(m.fecha||"").startsWith(mes);
  const M=S.movs.filter(enMes);
  const entr=M.filter(m=>(m.tipo==="ingreso"&&m.caja===C)||(m.tipo==="pase"&&m.cajaDestino===C));
  const sal=M.filter(m=>(m.tipo==="egreso"&&m.caja===C&&m.pago!=="tarjeta")||(m.tipo==="pase"&&m.caja===C)||(m.tipo==="pagoTarjeta"&&m.caja===C));
  const pers=M.filter(esPersonalFede);
  const sum=L=>L.reduce((a,m)=>a+(+m.monto||0),0);
  const gE={},gS={},gP={};
  for(const m of entr){const k=m.tipo==="pase"?"Pases desde caja "+m.caja:(m.obra&&!m.obra.startsWith("_")?"Cobros de obras":"Otras entradas");(gE[k]=gE[k]||[]).push(m)}
  for(const m of sal){const k=m.tipo==="pase"?"Pases a otras cajas":grupoSalida(m);(gS[k]=gS[k]||[]).push(m)}
  for(const m of pers){const k=m.rubroPersonal||"Sin clasificar";(gP[k]=gP[k]||[]).push(m)}
  const otrasCajas=pers.filter(m=>m.caja!==C);
  const item=m=>`<button class="item" data-edit-mov="${esc(m.id)}"><span class="t">${esc(m.detalle||m.categoria||"")}</span><span class="s">${esc(fdate(m.fecha))} · ${m.tipo==="pase"?`${esc(m.caja)} → ${esc(m.cajaDestino)}`:esc(obraNombre(m.obra))+(m.rubroPersonal?" · "+esc(m.rubroPersonal):"")} · Caja ${esc(m.caja)}</span><span class="m">${fmt(m.monto)}</span></button>`;
  const grupos=(G,signo)=>Object.entries(G).sort((a,b)=>sum(b[1])-sum(a[1])).map(([k,L])=>`<details class="grpd"><summary><span>${esc(k)} <span class="note">(${L.length})</span></span><b class="${signo}">${fmt(sum(L))}</b></summary><div class="list">${L.sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")).map(item).join("")}</div></details>`).join("")||`<div class="empty">Nada en este período.</div>`;
  const te=sum(entr),ts=sum(sal),tp=sum(pers);
  return `<div class="row between"><h2>Caja y gastos de Federico</h2>
    <label class="f" style="min-width:160px">Mes<select id="fdMes"><option value="todo" ${mes==="todo"?"selected":""}>${desde?"Todo desde "+esc(fdate(desde)):"Todos"}</option>${meses.filter(m=>!desde||m>=desde.slice(0,7)).map(m=>`<option value="${m}" ${mes===m?"selected":""}>${esc(mlabel(m))}</option>`).join("")}</select></label></div>
  <div class="grid"><div class="card stat"><div class="lbl">Saldo hoy en su caja</div><div class="num ${saldoCaja(C)<0?"neg":""}">${fmt(saldoCaja(C))}</div></div>
    <div class="card stat"><div class="lbl">Entró ${mes==="todo"?"":"en el mes"}</div><div class="num pos">${fmt(te)}</div></div>
    <div class="card stat"><div class="lbl">Salió ${mes==="todo"?"":"en el mes"}</div><div class="num neg">${fmt(ts)}</div></div>
    <div class="card stat"><div class="lbl">Gastos personales</div><div class="num neg">${fmt(tp)}</div></div></div>
  <section class="card"><h3 style="margin-bottom:6px">Qué entró a la caja de Federico</h3>${grupos(gE,"pos")}</section>
  <section class="card"><h3 style="margin-bottom:6px">En qué salió</h3><p class="note" style="margin:0 0 6px">Obras, empresa, gastos personales y pases a otras cajas. Tocá un grupo para ver cada carga.</p>${grupos(gS,"neg")}</section>
  <section class="card"><h3 style="margin-bottom:6px">Gastos personales de Federico por rubro</h3>
    <p class="note" style="margin:0 0 6px">Cuenta todos sus gastos personales, salgan de su caja o de otra${otrasCajas.length?` (${otrasCajas.length} pagados desde otras cajas: ${fmt(sum(otrasCajas))})`:""}.</p>${grupos(gP,"neg")}</section>
  <div class="fab"><button class="btn pri" id="fdNew">+ Gasto personal de Federico</button></div>`;
}
function bindFede(V){const s=V.querySelector("#fdMes");if(s)s.onchange=()=>{S.filt.fmes=s.value;render()};
  const n=V.querySelector("#fdNew");if(n)n.onclick=()=>openMov(null,{tipo:"egreso",caja:"Federico",obra:"_federico",categoria:"Personal Federico"});
  V.querySelectorAll("[data-edit-mov]").forEach(b=>b.onclick=()=>openMov(S.movs.find(x=>x.id===b.dataset.editMov)))}


/* ---------- dólares: saldos y a cuánto nos tomaron el dólar ---------- */
function vUsd(){
  if(!isAdmin())return `<div class="empty">Solo administración.</div>`;
  const mes=S.filt.umes||"todo";
  const C=S.movs.filter(m=>m.tipo==="cambio"&&+m.usd&&(mes==="todo"||(m.fecha||"").startsWith(mes))).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")||(b.creado||0)-(a.creado||0));
  const meses=[...new Set(S.movs.filter(m=>m.tipo==="cambio").map(m=>(m.fecha||"").slice(0,7)))].sort().reverse();
  const tu=C.reduce((a,m)=>a+(+m.usd||0),0),tp=C.reduce((a,m)=>a+(+m.monto||0),0);
  const conBlue=C.filter(m=>+m.cotizacionBlue),perd=conBlue.reduce((a,m)=>a+(+m.usd)*(+m.cotizacionBlue)-(+m.monto),0);
  const cajasU=CAJAS.map(c=>[c,saldoUsd(c)]).filter(([,u])=>u);
  return `<div class="row between"><h2>Dólares y cambios</h2><button class="btn pri sm" id="usdCambio">+ Cambié dólares</button></div>
  <section class="card"><h3 style="margin-bottom:6px">Dólares en cada caja</h3>
    ${cajasU.length?`<div class="grid">${cajasU.map(([c,u])=>`<div class="stat"><div class="lbl">${esc(c)}</div><div class="num ${u<0?"neg":""}">${fmtU(u)}</div></div>`).join("")}</div>`:`<div class="empty">Ninguna caja tiene dólares. Cargá el arranque en Ajustes → “Arranque de cada caja”.</div>`}
    <p class="note" style="margin:6px 0 0">Total: <b>${fmtU(cajasU.reduce((a,[,u])=>a+u,0))}</b></p></section>
  <section class="card"><div class="row between"><h3>¿A cuánto nos tomaron el dólar?</h3>
    <select id="usdMes" style="max-width:180px"><option value="todo">Todos</option>${meses.map(m=>`<option value="${m}" ${mes===m?"selected":""}>${esc(mlabel(m))}</option>`).join("")}</select></div>
    ${C.length?`<div class="grid" style="margin:8px 0"><div class="stat"><div class="lbl">Cambiados</div><div class="num">${fmtU(tu)}</div></div><div class="stat"><div class="lbl">Recibimos</div><div class="num">${fmt(tp)}</div></div><div class="stat"><div class="lbl">Promedio</div><div class="num">${fmt(tu?tp/tu:0)}</div></div>${conBlue.length?`<div class="stat"><div class="lbl">Contra el blue</div><div class="num ${perd>0?"neg":"pos"}">${perd>0?"− ":"+ "}${fmt(Math.abs(perd))}</div></div>`:""}</div>
    <div class="list">${C.map(m=>{const c=+m.monto/(+m.usd),b=+m.cotizacionBlue;return `<button class="item" data-edit-mov="${esc(m.id)}"><span class="t">${esc(fdate(m.fecha))} · Caja ${esc(m.caja)}: ${fmtU(m.usd)} → ${fmt(m.monto)}</span><span class="s">A ${fmt(c)} por dólar${b?` · blue ${fmt(b)} · ${c<b?"la cueva se quedó con":"ganamos"} ${fmt(Math.abs((+m.usd)*(b-c)))}`:""}${m.detalle?" · "+esc(m.detalle):""}</span><span class="m">${fmt(c)}</span></button>`}).join("")}</div>
    <p class="note" style="margin:6px 0 0">El blue es solo referencia: los pesos salen siempre de lo que dieron en la cueva.</p>`:`<div class="empty">Todavía no hay cambios cargados. Cuando cambien dólares, tocá “+ Cambié dólares”.</div>`}</section>`}
function bindUsd(V){const s=V.querySelector("#usdMes");if(s)s.onchange=()=>{S.filt.umes=s.value;render()};
  const b=V.querySelector("#usdCambio");if(b)b.onclick=()=>openMov(null,{tipo:"cambio",caja:"Numa"})}


/* ---------- tarjetas de crédito: compras en cuotas que no tocan la caja hasta que se paga el resumen ---------- */
function sigMes(ym,k=1){const [y,mm]=ym.split("-").map(Number);const d=new Date(y,mm-1+k,1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")}
const duenoTarjeta=t=>CAJAS.find(c=>(t||"").toLowerCase().includes(c.toLowerCase()))||"General";
function cuotasDe(m){const n=Math.max(1,+m.cuotas||1),v=(+m.monto||0)/n,m1=m.mesPrimerResumen||sigMes((m.fecha||hoy()).slice(0,7));return Array.from({length:n},(_,i)=>({mes:sigMes(m1,i),monto:v,n:i+1,de:n,m}))}
function vTarjetas(){
  if(!isAdmin())return `<div class="empty">Solo administración.</div>`;
  const TARJ=S.cfg.tarjetas&&S.cfg.tarjetas.length?S.cfg.tarjetas:["Bancor Federico"];
  const compras=S.movs.filter(m=>m.pago==="tarjeta"),pagos=S.movs.filter(m=>m.tipo==="pagoTarjeta");
  const mesAct=hoy().slice(0,7);
  return `<div class="row between"><h2>Tarjetas de crédito</h2><button class="btn sm" id="tjNueva">+ Tarjeta</button></div>
  <p class="note" style="margin:0">Las compras con tarjeta cuentan como gasto de la obra o la empresa el día de la compra, pero no tocan ninguna caja. La caja baja recién cuando se paga el resumen.</p>
  ${TARJ.map(t=>{const C=compras.filter(m=>m.tarjeta===t),P=pagos.filter(m=>m.tarjeta===t);
    const deuda=C.reduce((a,m)=>a+(+m.monto||0),0)-P.reduce((a,m)=>a+(+m.monto||0),0);
    const porMes={};for(const m of C)for(const q of cuotasDe(m))(porMes[q.mes]=porMes[q.mes]||[]).push(q);
    const pagoMes=mes=>P.filter(x=>x.mesResumen===mes).reduce((a,x)=>a+(+x.monto||0),0);
    const meses=Object.keys(porMes).sort().filter(ms=>ms>=sigMes(mesAct,-2));
    return `<section class="card"><div class="row between"><h3>${esc(t)}</h3><div style="text-align:right"><div class="note">Deuda total</div><b class="${deuda>0?"neg":""}">${fmt(deuda)}</b></div></div>
      <h4 style="margin:10px 0 4px">Cuotas por resumen</h4>
      ${meses.length?meses.map(ms=>{const L=porMes[ms],tot=L.reduce((a,q)=>a+q.monto,0),pg=pagoMes(ms);
        return `<details class="grpd"><summary><span>${esc(mlabel(ms))} <span class="note">(${L.length} cuota${L.length>1?"s":""})</span>${pg?` <span class="pill ${pg+1>=tot?"p-good":"p-warn"}">${pg+1>=tot?"Pagado":"Pagado "+fmt(pg)}</span>`:""}</span><b>${fmt(tot)}</b></summary>
          <div class="list">${L.map(q=>`<button class="item" data-edit-mov="${esc(q.m.id)}"><span class="t">${esc(q.m.detalle||q.m.categoria||"Compra")}</span><span class="s">Cuota ${q.n} de ${q.de} · compra ${esc(fdate(q.m.fecha))} · ${esc(obraNombre(q.m.obra))}</span><span class="m">${fmt(q.monto)}</span></button>`).join("")}</div>
          ${pg+1>=tot?"":`<div class="row" style="margin:6px 0 10px"><button class="btn sm pri" data-pagar="${esc(t)}|${ms}|${Math.round((tot-pg)*100)/100}">Pagar resumen de ${esc(mlabel(ms))}</button></div>`}</details>`}).join(""):`<div class="empty">Sin compras con esta tarjeta todavía.</div>`}
      ${P.length?`<h4 style="margin:10px 0 4px">Pagos de resumen</h4><div class="list">${P.sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")).map(x=>`<button class="item" data-edit-mov="${esc(x.id)}"><span class="t">Resumen ${esc(mlabel(x.mesResumen||""))}</span><span class="s">${esc(fdate(x.fecha))} · pagado desde la caja ${esc(x.caja)}</span><span class="m">${fmt(x.monto)}</span></button>`).join("")}</div>`:""}
    </section>`}).join("")}`}
function openPagoTarjeta(t,mes,monto){openSheet(`<form id="fpt" style="display:flex;flex-direction:column;gap:12px">${sheetHead("Pagar resumen "+esc(t))}
    <div class="two"><label class="f">Resumen de<input type="month" id="pt_mes" value="${esc(mes)}"></label><label class="f">Fecha de pago<input type="date" id="pt_f" value="${hoy()}"></label>
    <label class="f">Monto pagado<input id="pt_m" inputmode="decimal" value="${monto}"></label><label class="f">Sale de la caja<select id="pt_c">${CAJAS.map(c=>`<option ${c===duenoTarjeta(t)?"selected":""}>${c}</option>`).join("")}</select></label></div>
    <p class="note" style="margin:0">Baja la plata de esa caja. No se suma como gasto otra vez: el gasto ya se contó el día de cada compra.</p>
    <button class="btn pri" type="submit">Registrar pago</button></form>`,sh=>{sh.querySelector("[data-close]").onclick=closeSheet;
    $("#fpt").onsubmit=async ev=>{ev.preventDefault();const v=num($("#pt_m").value);if(!v)return toast("Falta el monto");
      try{await db.collection("movimientos").doc().set({tipo:"pagoTarjeta",tarjeta:t,mesResumen:$("#pt_mes").value,fecha:$("#pt_f").value,caja:$("#pt_c").value,monto:v,detalle:`Pago resumen ${t} ${mlabel($("#pt_mes").value)}`,categoria:"Pago de tarjeta",obra:"_empresa",creado:Date.now()});closeSheet();toast("Pago registrado")}catch(e){toast(errMsg(e))}}})}
function bindTarjetas(V){V.querySelectorAll("[data-pagar]").forEach(b=>b.onclick=()=>{const [t,ms,mo]=b.dataset.pagar.split("|");openPagoTarjeta(t,ms,mo)});
  V.querySelectorAll("[data-edit-mov]").forEach(b=>b.onclick=()=>{const m=S.movs.find(x=>x.id===b.dataset.editMov);if(m)openMov(m)});
  const n=V.querySelector("#tjNueva");if(n)n.onclick=async()=>{const t=(prompt("Nombre de la tarjeta (por ejemplo: Visa Macro Ana)")||"").trim();if(!t)return;
    const L=[...new Set([...(S.cfg.tarjetas||["Bancor Federico"]),t])];const {id:_i,_por:_p,...resto}=S.cfg;try{await db.doc("config/general").set({...resto,tarjetas:L});toast("Tarjeta agregada")}catch(e){toast(errMsg(e))}}}
