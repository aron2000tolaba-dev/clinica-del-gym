/* Mercado Pago → app. Lee la cuenta con MP_ACCESS_TOKEN (solo en Railway) y deja cada movimiento
   en "mpMovs" para clasificarlo en la app (Más → Mercado Pago).
   - Lo que entra: la lista de pagos recibidos (con comisión y neto), cada 30 minutos.
   - Lo que sale (retiros, transferencias, pagos con el dinero de la cuenta): el reporte diario de dinero liberado. */
const API = 'https://api.mercadopago.com';
const H = 3600e3;

export function leerCSV(txt){
  const lineas = String(txt || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if(!lineas.length) return [];
  const sep = (lineas[0].match(/;/g) || []).length > (lineas[0].match(/,/g) || []).length ? ';' : ',';
  const partir = l => { const out = []; let cur = '', q = false; for(const ch of l){ if(ch === '"'){ q = !q; continue; } if(ch === sep && !q){ out.push(cur); cur = ''; continue; } cur += ch; } out.push(cur); return out.map(x => x.trim()); };
  const cab = partir(lineas[0]).map(x => x.toUpperCase());
  return lineas.slice(1).map(l => { const v = partir(l), o = {}; cab.forEach((k, i) => { o[k] = v[i]; }); return o; });
}
const num = x => { const s = String(x ?? '').trim(); if(!s) return 0; const n = Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')); return isNaN(n) ? 0 : n; };
const DESC = {payout:'Retiro o transferencia', payment:'Pago con dinero de la cuenta', refund:'Devolución', chargeback:'Contracargo', fee:'Comisión', 'reserve_for_payout':'Reserva para retiro', mediation:'Reclamo', shipping:'Envío', withdrawal:'Retiro'};

/* movimientos de salida del reporte de dinero liberado */
export function salidasDeReporte(filas){
  const out = [];
  filas.forEach((f, i) => {
    const deb = num(f.NET_DEBIT_AMOUNT); if(!(deb > 0)) return;
    const tipo = String(f.RECORD_TYPE || '').toLowerCase(); if(tipo && tipo !== 'release') return;
    const d = String(f.DESCRIPTION || '').toLowerCase(), src = f.SOURCE_ID || ('fila' + i);
    out.push({id:'s' + src + '-' + d.replace(/\W/g, '').slice(0, 12), fecha:new Date(f.DATE || Date.now()).toISOString(), tipo:'salida', monto:Math.round(deb * 100) / 100,
      detalle:DESC[d] || f.DESCRIPTION || 'Salida', quien:f.EXTERNAL_REFERENCE || '', origen:'reporte', estado:'pendiente'});
  });
  return out;
}
export function entradaDePago(p, yo){
  if(p.status !== 'approved') return null;
  const comision = (p.fee_details || []).reduce((s, f) => s + (f.amount || 0), 0);
  const quien = [p.payer && p.payer.first_name, p.payer && p.payer.last_name].filter(Boolean).join(' ') || (p.payer && p.payer.email) || '';
  const salgo = yo && p.payer && String(p.payer.id) === String(yo) && String(p.collector_id) !== String(yo);
  return {id:'p' + p.id, fecha:p.date_approved || p.date_created, tipo:salgo ? 'salida' : 'entrada', monto:p.transaction_amount, comision:salgo ? 0 : Math.round(comision * 100) / 100,
    neto:salgo ? p.transaction_amount : (p.transaction_details && p.transaction_details.net_received_amount) ?? p.transaction_amount,
    detalle:p.description || (salgo ? 'Pago con Mercado Pago' : 'Cobro ' + ({account_money:'por transferencia o dinero en cuenta', credit_card:'con tarjeta de crédito', debit_card:'con tarjeta de débito', bank_transfer:'por transferencia', ticket:'en efectivo'}[p.payment_type_id] || 'con Mercado Pago')), quien, medio:p.payment_type_id || '', origen:'pagos', estado:'pendiente'};
}

export function crearMP({datos, st, guardarEstado, evento, log}){
  const token = process.env.MP_ACCESS_TOKEN; if(!token) return null;
  const pedir = async (ruta, opt = {}) => { const r = await fetch(API + ruta, {...opt, headers:{Authorization:'Bearer ' + token, 'Content-Type':'application/json', ...(opt.headers || {})}});
    if(!r.ok) throw new Error('Mercado Pago ' + r.status + ' en ' + ruta.split('?')[0]); return /json/.test(r.headers.get('content-type') || '') ? r.json() : r.text(); };
  st.mp = st.mp || {pedidos:{}, bajados:{}};
  let yo = null;

  async function guardarMovs(movs){
    if(!movs.length) return 0;
    const nuevos = movs.filter(m => !datos.db.mpVistos.has(m.id)); if(!nuevos.length) return 0;
    await datos.guardarSiNo(nuevos.map(m => ({col:'mpMovs', id:m.id, data:m})));
    nuevos.forEach(m => datos.db.mpVistos.add(m.id)); return nuevos.length;
  }
  async function entradas(){
    if(!yo){ try{ yo = (await pedir('/users/me')).id; }catch(e){} }
    const desde = new Date(Date.now() - 3 * 24 * H).toISOString(), hasta = new Date().toISOString(), movs = [];
    for(let off = 0; off < 1000; off += 100){
      const r = await pedir(`/v1/payments/search?sort=date_created&criteria=desc&range=date_created&begin_date=${encodeURIComponent(desde)}&end_date=${encodeURIComponent(hasta)}&limit=100&offset=${off}`);
      (r.results || []).forEach(p => { const m = entradaDePago(p, yo); if(m) movs.push(m); });
      if(!r.results || r.results.length < 100) break;
    }
    return guardarMovs(movs);
  }
  /* el reporte de un día se pide a la mañana siguiente y se baja cuando está listo */
  async function salidas(){
    const hoy0 = new Date(); hoy0.setUTCHours(3, 0, 0, 0); if(hoy0 > new Date()) hoy0.setUTCDate(hoy0.getUTCDate() - 1);
    const ini = new Date(hoy0.getTime() - 24 * H), clave = ini.toISOString().slice(0, 10);
    if(!st.mp.pedidos[clave]){ await pedir('/v1/account/release_report', {method:'POST', body:JSON.stringify({begin_date:ini.toISOString().replace('.000', ''), end_date:hoy0.toISOString().replace('.000', '')})}); st.mp.pedidos[clave] = Date.now(); guardarEstado(); return 0; }
    const lista = await pedir('/v1/account/release_report/list');
    let n = 0;
    for(const r of (Array.isArray(lista) ? lista : []).slice(0, 15)){
      const nombre = r.file_name || r.fileName; if(!nombre || st.mp.bajados[nombre]) continue;
      if(r.status && !/processed|ready|finished|done/i.test(r.status)) continue;
      const csv = await pedir('/v1/account/release_report/' + encodeURIComponent(nombre));
      n += await guardarMovs(salidasDeReporte(leerCSV(csv))); st.mp.bajados[nombre] = Date.now(); guardarEstado();
    }
    for(const k of Object.keys(st.mp.pedidos)) if(Date.now() - st.mp.pedidos[k] > 10 * 24 * H) delete st.mp.pedidos[k];
    return n;
  }
  async function leer(){
    let n = 0, error = '';
    try{ n += await entradas(); }catch(e){ error = e.message; }
    try{ n += await salidas(); }catch(e){ error = error || e.message; }
    if(n) evento('Mercado Pago: ' + n + ' movimientos nuevos');
    if(error) log.warn({error}, 'mercado pago');
    await datos.estadoMP({cuando:new Date().toISOString(), error:error || null});
  }
  return {leer, iniciar(){ leer().catch(e => log.error(e)); setInterval(() => leer().catch(e => log.error(e)), 30 * 60e3); }};
}
