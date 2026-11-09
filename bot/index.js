/* Bot de WhatsApp de Clínica del Gym.
   Se vincula al número del negocio como "dispositivo vinculado" (igual que WhatsApp Web).
   - Clientes: responde poco y solo en horario (estado del equipo, si hay un repuesto, saludo).
   - Familia: audios o textos con gastos → los entiende, pide confirmación y los guarda en la app. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, normalizeMessageContent,
  isJidGroup, isJidBroadcast, isJidStatusBroadcast, isPnUser, isLidUser, jidNormalizedUser, Browsers} from '@whiskeysockets/baileys';
import {crearDatos} from './datos.js';
import * as L from './logica.js';
import {crearMP} from './mp.js';

const log = pino({level:process.env.LOG_LEVEL || 'info'});
const DATA = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.resolve('datos-bot'));
const AUTH = path.join(DATA, 'sesion-whatsapp');
const ESTADO = path.join(DATA, 'estado.json');
fs.mkdirSync(AUTH, {recursive:true});

const datos = crearDatos(log);
const st = (() => { try{ return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); }catch(e){ return {}; } })();
st.pausas = st.pausas || {}; st.ultimos = st.ultimos || {}; st.cuenta = st.cuenta || {dia:'', n:0};
let guardarTimer = null;
const guardarEstado = () => { clearTimeout(guardarTimer); guardarTimer = setTimeout(() => { try{ fs.writeFileSync(ESTADO, JSON.stringify(st)); }catch(e){} }, 1000); };

const H = 3600e3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const eventos = []; const evento = t => { eventos.unshift(new Date().toLocaleString('es-AR', {timeZone:'America/Argentina/Salta'}) + ' · ' + t); eventos.length = Math.min(eventos.length, 40); log.info(t); };

let sock = null, qrActual = null, codigoVinc = null, conectado = false, numeroPropio = '', lidPropio = '', estadoNube = '';
const enviados = new Set();
const pendientes = new Map();
const colas = new Map();

/* ---------- personas y clientes ---------- */
let familia = new Map(), clientesTel = new Map();
function indexar(){
  const db = datos.db;
  familia = new Map(); db.usuarios.filter(u => u.rol !== 'bot').forEach(u => { const t = L.telNorm(u.tel); if(t) familia.set(t, u); });
  clientesTel = new Map(); const abiertas = new Set(db.ordenes.filter(o => o.estado !== 'Entregado').map(o => o.clienteId));
  db.clientes.forEach(c => { const t = L.telNorm(c.tel); if(!t) return; const ya = clientesTel.get(t); if(!ya || (!abiertas.has(ya.id) && abiertas.has(c.id))) clientesTel.set(t, c); });
}
const kmAnterior = () => Math.max(0, ...datos.db.cargas.filter(c => !c.ejemplo && c.km).map(c => c.km));
const dueno = () => familia.get(numeroPropio) || datos.db.usuarios.find(u => u.rol === 'admin') || {nombre:'Aarón'};

async function nubeEstado(v){ const k = JSON.stringify([v.conectado, v.necesitaVincular, v.numero]); if(k === estadoNube) return; estadoNube = k; await datos.estado({...v, cuando:new Date().toISOString()}); }

/* ---------- WhatsApp ---------- */
async function conectar(){
  const {state, saveCreds} = await useMultiFileAuthState(AUTH);
  let version; try{ ({version} = await fetchLatestBaileysVersion()); }catch(e){}
  sock = makeWASocket({version, auth:state, logger:log.child({level:'warn'}), browser:Browsers.ubuntu('Chrome'),
    markOnlineOnConnect:false, syncFullHistory:false, shouldSyncHistoryMessage:() => false, generateHighQualityLinkPreview:false});
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async u => {
    if(u.qr){
      qrActual = u.qr; conectado = false;
      if(process.env.WA_NUMERO && !state.creds.registered && !codigoVinc){
        try{ codigoVinc = await sock.requestPairingCode(String(process.env.WA_NUMERO).replace(/\D/g, '')); evento('Código para vincular: ' + codigoVinc); }catch(e){ log.warn(e.message); }
      }
      nubeEstado({conectado:false, necesitaVincular:true});
    }
    if(u.connection === 'open'){
      conectado = true; qrActual = null; codigoVinc = null;
      numeroPropio = L.telNorm(sock.user.id); lidPropio = sock.user.lid ? jidNormalizedUser(sock.user.lid) : '';
      evento('Conectado a WhatsApp (' + numeroPropio + ')'); nubeEstado({conectado:true, numero:numeroPropio});
    }
    if(u.connection === 'close'){
      conectado = false; const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
      if(code === DisconnectReason.loggedOut){
        evento('WhatsApp cerró la sesión (lo desvincularon desde el celular). Hay que volver a vincular.');
        fs.rmSync(AUTH, {recursive:true, force:true}); fs.mkdirSync(AUTH, {recursive:true}); codigoVinc = null;
        nubeEstado({conectado:false, necesitaVincular:true});
      } else evento('Se cortó la conexión (' + (code || 'sin código') + '), reconectando…');
      setTimeout(() => conectar().catch(e => log.error(e)), code === DisconnectReason.loggedOut ? 1000 : 4000);
    }
  });
  sock.ev.on('messages.upsert', ({messages, type}) => {
    for(const m of messages){
      const reciente = Date.now() / 1000 - Number(m.messageTimestamp || 0) < 120;
      if(type !== 'notify' && !(m.key.fromMe && reciente)) continue;
      if(!reciente) continue;
      const jid = m.key.remoteJid; if(!jid) continue;
      const prev = colas.get(jid) || Promise.resolve();
      const sig = prev.then(() => procesar(m)).catch(e => log.error({err:e.message}, 'error procesando mensaje'));
      colas.set(jid, sig); sig.finally(() => { if(colas.get(jid) === sig) colas.delete(jid); });
    }
  });
}

async function telDe(jid, key){
  if(isPnUser(jid)) return L.telNorm(jid);
  if(key.remoteJidAlt && isPnUser(key.remoteJidAlt)) return L.telNorm(key.remoteJidAlt);
  if(isLidUser(jid)){ try{ const pn = await sock.signalRepository.lidMapping.getPNForLID(jid); if(pn) return L.telNorm(pn); }catch(e){} }
  return '';
}
function contenido(m){
  const c = normalizeMessageContent(m.message) || {};
  const texto = c.conversation || (c.extendedTextMessage && c.extendedTextMessage.text) || (c.imageMessage && c.imageMessage.caption) || '';
  return {texto:String(texto).trim(), audio:!!c.audioMessage, nada:!Object.keys(c).length || !!c.protocolMessage || !!c.reactionMessage};
}
async function enviar(jid, texto, cliente){
  if(cliente){
    const hoy = new Date().toISOString().slice(0, 10); if(st.cuenta.dia !== hoy) st.cuenta = {dia:hoy, n:0};
    if(st.cuenta.n >= L.conf(datos.db.meta.bot).maxDia){ evento('Tope diario de mensajes automáticos alcanzado'); return; }
    try{ await sock.sendPresenceUpdate('composing', jid); }catch(e){}
    await sleep(1800 + Math.random() * 2500);
    st.cuenta.n++;
  }
  const r = await sock.sendMessage(jid, {text:texto}); if(r && r.key) enviados.add(r.key.id);
  if(enviados.size > 500) enviados.delete(enviados.values().next().value);
  guardarEstado();
}

async function transcribir(m){
  if(!process.env.GROQ_API_KEY) return {error:'Para entender audios falta poner GROQ_API_KEY en Railway. Mientras tanto, escribilo.'};
  const buf = await downloadMediaMessage(m, 'buffer', {}, {logger:log, reuploadRequest:sock.updateMediaMessage});
  const fd = new FormData();
  fd.append('file', new Blob([buf], {type:'audio/ogg'}), 'audio.ogg');
  fd.append('model', 'whisper-large-v3-turbo'); fd.append('language', 'es'); fd.append('response_format', 'json');
  fd.append('prompt', 'Gastos de un taller en Salta, Argentina: nafta, gasoil, litros, kilómetros, mil pesos, efectivo, transferencia, Mercado Pago.');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {method:'POST', headers:{Authorization:'Bearer ' + process.env.GROQ_API_KEY}, body:fd});
  if(!r.ok) return {error:'No pude escuchar el audio (' + r.status + '). Probá de nuevo o escribilo.'};
  const j = await r.json(); return {texto:String(j.text || '').trim()};
}

/* ---------- un mensaje ---------- */
async function procesar(m){
  const jid = m.key.remoteJid;
  if(isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid) || jid.endsWith('@newsletter')) return;
  if(m.key.fromMe && enviados.has(m.key.id)) return;
  const {texto, audio, nada} = contenido(m); if(nada) return;
  const propio = jidNormalizedUser(jid) === jidNormalizedUser(sock.user.id) || (lidPropio && jidNormalizedUser(jid) === lidPropio);

  if(propio){ if(m.key.fromMe) return gastoFamilia(jid, dueno(), m, texto, audio); return; }
  if(m.key.fromMe){ st.pausas[jid] = Date.now(); guardarEstado(); return; }   // escribió una persona: el bot se calla en ese chat

  const tel = await telDe(jid, m.key);
  const persona = tel && familia.get(tel);
  if(persona) return gastoFamilia(jid, persona, m, texto, audio);
  return cliente(jid, tel, texto);
}

async function cliente(jid, tel, texto){
  const c = L.conf(datos.db.meta.bot); if(!c.activo) return;
  if(st.pausas[jid] && Date.now() - st.pausas[jid] < c.pausaHoras * H) return;
  const u = st.ultimos[jid] = st.ultimos[jid] || {};
  if(!L.abierto(c)){
    if(c.avisoCerrado && !(u.cerrado && Date.now() - u.cerrado < 12 * H)){ u.cerrado = Date.now(); await enviar(jid, c.cerrado, true); evento('Aviso de cerrado a ' + (tel || 'un cliente')); }
    return;
  }
  const db = datos.db, cl = tel ? clientesTel.get(tel) : null;
  const r = L.respuestaEstado(texto, cl, db.ordenes, db.equipos, db.meta.config || {}) || L.respuestaProducto(texto, db.items);
  if(r){
    if(u.ultimaResp === r && Date.now() - (u.resp || 0) < 6 * H) return;
    u.ultimaResp = r; u.resp = Date.now(); await enviar(jid, r, true); evento('Respondió a ' + (cl ? cl.nombre : tel || 'un cliente')); return;
  }
  if(!(u.saludo && Date.now() - u.saludo < 24 * H) && !(u.resp && Date.now() - u.resp < 24 * H)){ u.saludo = Date.now(); await enviar(jid, c.saludo, true); evento('Saludó a ' + (cl ? cl.nombre : tel || 'un cliente nuevo')); }
}

async function gastoFamilia(jid, persona, m, texto, audio){
  let pen = pendientes.get(jid); if(pen && Date.now() - pen.creado > 30 * 60e3){ pendientes.delete(jid); pen = null; }
  let oido = '';
  if(audio){
    const t = await transcribir(m); if(t.error) return enviar(jid, t.error);
    texto = t.texto; oido = `Escuché: "${texto}"\n`;
    if(!texto) return enviar(jid, 'No escuché nada en el audio. Probá de nuevo.');
  }
  if(!texto) return;
  if(/^(ayuda|\?|como funciona)/.test(L.norm(texto))) return enviar(jid, L.AYUDA);
  if(pen && L.esNo(texto)){ pendientes.delete(jid); return enviar(jid, 'Cancelado. No guardé nada.'); }
  if(pen && L.esSi(texto)){
    const falta = L.faltaDato(pen, kmAnterior()); if(falta) return enviar(jid, falta);
    try{ await datos.guardar(L.docsGasto(pen, persona)); }catch(e){ log.error(e); return enviar(jid, 'No pude guardarlo en la app (' + e.message + '). Probá de nuevo en un rato.'); }
    pendientes.delete(jid); evento(`${persona.nombre} cargó por WhatsApp: ${L.resumenPendiente(pen)}`);
    return enviar(jid, 'Listo, guardado ✅\n' + L.resumenPendiente(pen));
  }
  const p = L.leerGasto(texto);
  if(pen) L.mezclar(pen, p, texto);
  else if(audio || L.pareceGasto(texto)){ pen = L.nuevoPendiente(p, texto); pendientes.set(jid, pen); }
  else return;   // un mensaje común de la familia: el bot no se mete
  const falta = L.faltaDato(pen, kmAnterior());
  if(falta) return enviar(jid, oido + falta);
  return enviar(jid, `${oido}Entendí: ${L.resumenPendiente(pen)}\n¿Lo guardo? Respondé *sí*, o decime qué cambiar (por ejemplo "fue con transferencia").`);
}

/* ---------- panel web para vincular y ver el estado ---------- */
const CLAVE = process.env.PANEL_CLAVE || '';
const pagina = async ok => {
  const est = conectado ? `<p class="ok">Conectado al número ${numeroPropio}</p>` : `<p class="mal">Sin vincular o reconectando</p>`;
  let vinc = '';
  if(ok && !conectado && qrActual) vinc = `<h2>Vincular</h2><p>En el celular del negocio: WhatsApp → ⋮ / Configuración → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b> y escaneá este código.</p><img alt="Código QR" src="${await QRCode.toDataURL(qrActual, {margin:2, width:300})}">${codigoVinc ? `<p>O tocá "Vincular con número de teléfono" y poné este código: <b style="font-size:28px;letter-spacing:3px">${codigoVinc}</b></p>` : ''}<p class="peq">La página se actualiza sola.</p>`;
  const c = L.conf(datos.db.meta.bot);
  const info = ok ? `<h2>Hoy</h2><p>Mensajes automáticos a clientes: ${st.cuenta.n || 0} de ${c.maxDia} · Atiende ${L.abierto(c) ? '<b>ahora sí</b>' : 'ahora no (fuera de horario)'} · Clientes: ${c.activo ? 'activado' : 'apagado'}</p><p>Familia reconocida: ${[...familia.values()].map(u => u.nombre).join(', ') || 'nadie (cargá los WhatsApp en la app → Empleados)'}</p><h2>Últimos eventos</h2><ul>${eventos.map(e => `<li>${e.replace(/</g, '&lt;')}</li>`).join('')}</ul>` : `<form><input name="clave" type="password" placeholder="Clave del panel" autofocus> <button>Entrar</button></form>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${ok && !conectado ? '<meta http-equiv="refresh" content="15">' : ''}<title>Bot Clínica del Gym</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:20px 16px;background:#F4F4F2;color:#1A1A1A}h1{font-size:22px}.ok{color:#0E6B44;font-weight:700}.mal{color:#A4231A;font-weight:700}img{background:#fff;border-radius:12px}li{margin:4px 0;font-size:14px}.peq{font-size:13px;color:#666}input,button{font-size:16px;padding:10px;border-radius:10px;border:1px solid #bbb}</style></head>
<body><h1>Bot de WhatsApp · Clínica del Gym</h1>${est}${vinc}${info}</body></html>`;
};
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if(u.pathname === '/salud'){ res.end('ok'); return; }
  const ok = !!CLAVE && u.searchParams.get('clave') === CLAVE;
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer'});
  res.end(await pagina(ok));
}).listen(process.env.BOT_TEST ? 0 : Number(process.env.PORT) || 3000, () => evento('Panel listo'));

/* ---------- arranque ---------- */
export const _prueba = {procesar, datos, indexar, st, pendientes, usar:(s, n) => { sock = s; numeroPropio = n; }};
if(!process.env.BOT_TEST) (async () => {
  if(!process.env.BOT_EMAIL || !process.env.BOT_PASSWORD){ evento('Faltan BOT_EMAIL y BOT_PASSWORD en las variables de Railway'); return; }
  if(!CLAVE) evento('Falta PANEL_CLAVE: sin eso no se puede ver el código para vincular');
  for(;;){ try{ await datos.entrar(); await datos.refrescar(); break; }catch(e){ evento('No pudo leer la app: ' + e.message); await sleep(30e3); } }
  indexar(); evento(`Datos cargados: ${datos.db.clientes.length} clientes, ${datos.db.ordenes.length} órdenes, ${datos.db.items.length} ítems`);
  setInterval(async () => { try{ await datos.refrescar(); indexar(); }catch(e){ try{ await datos.entrar(); }catch(e2){} } }, 60e3);
  const mp = crearMP({datos, st, guardarEstado, evento, log}); if(mp){ evento('Mercado Pago conectado: se lee cada 30 minutos'); mp.iniciar(); }
  await conectar();
})();
