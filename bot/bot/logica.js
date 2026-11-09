/* Lógica del bot, sin WhatsApp ni Supabase: se puede probar sola. */
import parseGastoVoz from './parser.js';

export const DEFAULTS = {
  activo: true,                 // responder a clientes
  dias: [1, 2, 3, 4, 5],        // lunes a viernes (0 = domingo)
  desde: 7, hasta: 20,          // horario de atención
  pausaHoras: 12,               // si ustedes escriben en un chat, el bot se calla en ese chat
  avisoCerrado: true,
  saludo: '¡Hola! Gracias por escribir a Clínica del Gym. Si podés traer el equipo al taller, el presupuesto es sin cargo; si no, lo retiramos y el costo depende de la distancia. En un rato te responde una persona.',
  cerrado: 'Hola, gracias por escribir a Clínica del Gym. Ahora estamos cerrados: atendemos de lunes a viernes de 7 a 20. Te respondemos apenas abramos.',
  maxDia: 80                    // tope de mensajes automáticos por día
};
export const conf = b => ({...DEFAULTS, ...(b || {})});

/* ---- teléfonos argentinos: todo a 10 dígitos (código de área + número) ---- */
export function telNorm(t){
  let s = String(t || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if(!s) return '';
  if(s.startsWith('54')) s = s.slice(2);
  if(s.length === 11 && s.startsWith('9')) s = s.slice(1);
  if(s.startsWith('0')) s = s.slice(1);
  if(s.length === 12){ for(const a of [4, 3, 2]) if(s.slice(a, a + 2) === '15'){ s = s.slice(0, a) + s.slice(a + 2); break; } }
  if(s.length === 9 && s.startsWith('15')) s = '387' + s.slice(2);
  if(s.length === 7) s = '387' + s;
  return s.length === 10 ? s : '';
}

/* ---- horario (hora de Salta) ---- */
export function horaSalta(d = new Date()){
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:'America/Argentina/Salta', weekday:'short', hour:'numeric', minute:'numeric', hour12:false}).formatToParts(d).map(x => [x.type, x.value]));
  return {dia:['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hora:(Number(p.hour) % 24) + Number(p.minute) / 60};
}
export function abierto(c, d = new Date()){ const h = horaSalta(d); return c.dias.includes(h.dia) && h.hora >= c.desde && h.hora < c.hasta; }

/* ---- texto ---- */
export const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
const plata = n => '$ ' + Math.round(n || 0).toLocaleString('es-AR');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const diaLargo = ymd => { const d = new Date(ymd + 'T12:00:00'); return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const nCorto = c => String((c && c.nombre) || '').replace(/\s*\(ejemplo\)/, '').split(' ')[0];

/* ---- estado del equipo ---- */
const PIDE_ESTADO = /\b(estado|listo|lista|listos|como va|novedad|novedades|termin\w*|orden|equipo|cinta|bici\w*|maquina|cuando|retir\w*|buscar|arregl\w*|reparad\w*|repar\w*|presupuesto)\b/;
const TXT_ESTADO = {
  'Ingresado': 'ya está en el taller y lo va a revisar el técnico',
  'Presupuestado': 'ya tiene presupuesto: estamos esperando que nos confirmes si lo aprobás',
  'Aprobado': 'está aprobado y en la fila para reparar',
  'En reparación': 'está en reparación',
  'Listo': 'ya está para retirar'
};
export function totalOrden(o, cf){
  const tarjeta = o.medioPago === 'Tarjeta', pres = o.pres || {items:[]};
  const sub = (pres.items || []).reduce((s, x) => s + (x.precio || 0) * (x.cant || 1), 0);
  const iva = (o.comp === 'Factura' || tarjeta) ? sub * (cf.iva || 21) / 100 : 0;
  const base = sub + iva + (o.transporte || 0) + (o.garExt ? o.garExt.precio || 0 : 0);
  const total = base + (tarjeta ? base * (cf.recargoTarjeta || 0) / 100 : 0);
  const cobrado = (o.cobros || []).reduce((s, k) => s + (k.monto || 0), 0);
  return {total, falta:Math.max(0, total - cobrado)};
}
export function respuestaEstado(texto, cliente, ordenes, equipos, cf){
  if(!cliente || !PIDE_ESTADO.test(norm(texto))) return null;
  const abiertas = ordenes.filter(o => o.clienteId === cliente.id && o.estado !== 'Entregado' && TXT_ESTADO[o.estado]).sort((a, b) => (b.num || 0) - (a.num || 0)).slice(0, 2);
  if(!abiertas.length) return null;
  const lineas = abiertas.map(o => {
    const e = equipos.find(x => x.id === o.equipoId), eq = e ? [String(e.tipo || 'equipo').toLowerCase(), e.marca].filter(Boolean).join(' ') : 'equipo';
    let l = `Tu ${eq} (orden #${o.num}) ${TXT_ESTADO[o.estado]}`;
    if(o.estado === 'Listo'){ const t = totalOrden(o, cf); if(t.falta > 0) l += ` Falta abonar ${plata(t.falta)}.`; }
    else if(o.fechaEst) l += `. Fecha estimada: ${diaLargo(o.fechaEst)}.`;
    else l += '.';
    return l;
  });
  return `Hola ${nCorto(cliente)}. ${lineas.join('\n')}\nCualquier otra consulta, en un rato te responde una persona.`;
}

/* ---- repuestos: solo "sí hay" y precio aproximado ---- */
const PIDE_PRODUCTO = /\b(tenes|tienen|tiene|hay|precio|cuanto|sale|salen|vale|valen|venden|vendes|consigo|stock)\b/;
const VACIAS = new Set(['para', 'con', 'de', 'del', 'los', 'las', 'una', 'uno', 'cm', 'mm', 'por', 'sin', 'the']);
const fichas = t => norm(t).split(' ').filter(w => w && !VACIAS.has(w) && (w.length >= 3 || /\d/.test(w)));
export function respuestaProducto(texto, items){
  const n = norm(texto); if(!PIDE_PRODUCTO.test(n)) return null;
  const pal = new Set(fichas(texto));
  const hits = items.filter(i => i.tipo === 'repuesto' && i.nombre && !/\(ejemplo\)/.test(i.nombre)).map(i => {
    const f = fichas(i.nombre); const ok = f.filter(w => pal.has(w)).length;
    return {i, ok, need:Math.min(2, f.length)};
  }).filter(x => x.need && x.ok >= x.need).sort((a, b) => b.ok - a.ok).slice(0, 3);
  if(!hits.length) return null;
  const lin = hits.map(({i}) => {
    const hay = i.ctrl === false ? null : (i.stock || 0) > 0;
    const st = hay === null ? 'lo consultamos y te confirmamos' : hay ? 'sí hay' : 'ahora no hay, lo podemos pedir';
    return `• ${i.nombre}: ${st}${i.precio ? `. Precio aproximado ${plata(i.precio)}` : ''}.`;
  });
  return `${lin.join('\n')}\nEl precio final te lo confirmamos antes de cobrar. En un rato te responde una persona.`;
}

/* ---- gastos por audio o texto (solo familia) ---- */
export const NEGOCIOS = ['Clínica del Gym', 'Venta de repuestos', 'Alquiler de viviendas', 'Alquiler de máquinas', 'Sistemas mensuales'];
export const CATEGORIAS = ['Combustible', 'Repuestos', 'Sueldos y adelantos', 'Alquiler', 'Servicios (luz, agua, internet)', 'Publicidad', 'Herramientas', 'Impuestos', 'Otro'];
export const CAT_ING = ['Alquiler cobrado', 'Abono mensual', 'Venta', 'Trabajos del taller', 'Otro'];
export function leerGasto(texto){
  const p = parseGastoVoz(texto), n = norm(texto), out = {};
  for(const k of ['monto', 'litros', 'km', 'categoria', 'medio', 'tipo']) if(p[k] !== undefined) out[k] = p[k];
  if(/alquiler de (casa|vivienda|depto|departamento)|\b(inquilino|departamento|depto)\b/.test(n)) out.negocio = 'Alquiler de viviendas';
  else if(/alquiler de (maquina|equipo)/.test(n)) out.negocio = 'Alquiler de máquinas';
  else if(/venta de repuesto/.test(n)) out.negocio = 'Venta de repuestos';
  else if(/\bsistema/.test(n)) out.negocio = 'Sistemas mensuales';
  else if(/\b(clinica|taller)\b/.test(n)) out.negocio = 'Clínica del Gym';
  if(out.tipo === 'ingreso'){
    if(/abono/.test(n)) out.categoria = 'Abono mensual'; else if(/alquiler/.test(n)) out.categoria = 'Alquiler cobrado';
    else if(/\bvend/.test(n)) out.categoria = 'Venta'; else if(/trabajo|arreglo|service/.test(n)) out.categoria = 'Trabajos del taller';
    else if(out.categoria && !CAT_ING.includes(out.categoria)) delete out.categoria;
  }
  if(/\b(no es|no fue|cambia|cambialo|corregi)\b/.test(n)) out.correccion = true;
  return out;
}
export function nuevoPendiente(p, texto){
  const tipo = p.tipo || 'gasto';
  return {tipo, monto:p.monto || 0, categoria:p.categoria || 'Otro', negocio:p.negocio || 'Clínica del Gym', medio:p.medio || 'Efectivo',
    litros:p.litros || null, km:p.km || null, textos:[texto], creado:Date.now()};
}
export function mezclar(pen, p, texto){
  for(const k of ['monto', 'litros', 'km', 'categoria', 'medio', 'negocio', 'tipo']) if(p[k] !== undefined) pen[k] = p[k];
  pen.textos.push(texto); return pen;
}
export function faltaDato(pen, kmAnterior){
  if(!pen.monto) return 'No entendí el monto. Decime cuánto fue, por ejemplo "30 mil".';
  if(pen.tipo !== 'ingreso' && pen.categoria === 'Combustible'){
    if(!pen.litros && !pen.km) return 'Para la nafta necesito los litros y los km que marca la camioneta. Por ejemplo: "40 litros, marca 123.500 km".';
    if(!pen.litros) return '¿Cuántos litros cargaste?';
    if(!pen.km) return '¿Cuántos km marca la camioneta?';
    if(kmAnterior && pen.km < kmAnterior) return `Los km no pueden ser menos que la última carga (${kmAnterior.toLocaleString('es-AR')} km). ¿Cuántos marca?`;
  }
  return null;
}
export function resumenPendiente(pen){
  const ext = pen.categoria === 'Combustible' && pen.tipo !== 'ingreso' ? ` · ${String(pen.litros).replace('.', ',')} L · ${pen.km.toLocaleString('es-AR')} km` : '';
  return `${pen.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} ${plata(pen.monto)} · ${pen.categoria} · ${pen.negocio} · ${pen.medio}${ext}`;
}
export const esSi = t => /^(si|sí|dale|ok|okay|oka|listo|guardalo|guarda|confirmo|correcto|perfecto|de una|ya)\b/.test(norm(t));
export const esNo = t => /^(no|cancelar|cancela|borra|borralo|anula|olvidate)\b/.test(norm(t)) && !/\b\d/.test(norm(t));
export const pareceGasto = t => /^(gasto|gaste|ingreso|cargue|pague|cobre|compre|me pagaron|nafta|combustible)\b/.test(norm(t));
export const AYUDA = 'Mandame un audio o escribí el gasto, por ejemplo:\n"Cargué 30 mil de nafta, 40 litros, la camioneta marca 123.500 km, en efectivo"\n"Pagué 15 mil de luz por transferencia"\n"Cobré 200 mil de alquiler del depto"\nTe muestro lo que entendí y lo guardo cuando me digas "sí".';

export const uid = () => Math.random().toString(36).slice(2, 10);
export function docsGasto(pen, persona){
  const ahora = new Date().toISOString(), gid = uid();
  const det = pen.textos.join(' / ').slice(0, 160);
  const g = {id:gid, tipo:pen.tipo, monto:pen.monto, categoria:pen.categoria, negocio:pen.negocio, medio:pen.medio, detalle:'Por WhatsApp: ' + det, facturaA:false, iva:0, fecha:ahora, usuario:persona.nombre, foto:'', via:'WhatsApp'};
  const out = [{col:'gastos', id:gid, data:g, por:persona.uid || null}];
  if(pen.tipo !== 'ingreso' && pen.categoria === 'Combustible' && pen.km && pen.litros) {
    const cid = uid(); out.push({col:'cargas', id:cid, data:{id:cid, fecha:ahora, km:pen.km, litros:pen.litros, monto:pen.monto, lleno:false, usuario:persona.nombre, gastoId:gid, via:'WhatsApp'}, por:persona.uid || null});
  }
  return out;
}
