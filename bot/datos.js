/* Datos de la app (Supabase). El bot entra con su propia cuenta y solo ve lo que su rol permite. */
import {createClient} from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || 'https://wxbshdkqsydfebaayfhv.supabase.co';
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_1JDNJsu4UljQs9NOfOW6AA_su8T1AZ_';
const COLS = ['usuarios', 'clientes', 'equipos', 'items', 'ordenes', 'cargas', 'meta'];

export function crearDatos(log){
  const sb = createClient(URL, KEY, {auth:{persistSession:false, autoRefreshToken:true}});
  const db = {usuarios:[], clientes:[], equipos:[], items:[], ordenes:[], cargas:[], meta:{}, mpVistos:new Set()};
  let desde = null, uidBot = null;

  async function entrar(){
    const {data, error} = await sb.auth.signInWithPassword({email:process.env.BOT_EMAIL, password:process.env.BOT_PASSWORD});
    if(error) throw new Error('No pudo entrar a Supabase con BOT_EMAIL / BOT_PASSWORD: ' + error.message);
    uidBot = data.user.id;
  }
  function aplicar(r){
    if(!COLS.includes(r.col)) return;
    if(r.col === 'meta'){ if(r.borrado) delete db.meta[r.id]; else db.meta[r.id] = r.data && r.data.v; return; }
    const a = db[r.col], i = a.findIndex(x => x.id === r.id);
    if(r.borrado){ if(i >= 0) a.splice(i, 1); return; }
    if(i >= 0) a[i] = r.data; else a.push(r.data);
  }
  async function refrescar(){
    let ultimo = desde;
    for(let i = 0; ; i += 1000){
      let q = sb.from('docs').select('col,id,data,borrado,actualizado').in('col', COLS).order('actualizado').order('col').order('id').range(i, i + 999);
      if(desde) q = q.gt('actualizado', desde); else q = q.eq('borrado', false);
      const {data, error} = await q; if(error) throw error;
      data.forEach(aplicar);
      if(data.length) ultimo = data[data.length - 1].actualizado;
      if(data.length < 1000) break;
    }
    desde = ultimo;
  }
  /* registros nuevos (gastos, cargas): insert simple, así puede cargarlos a nombre de otra persona */
  async function guardar(rows){
    const {error} = await sb.from('docs').insert(rows.map(r => ({col:r.col, id:r.id, data:r.data, borrado:false, ...(r.por ? {por:r.por} : {})})));
    if(error) throw error;
    rows.forEach(r => aplicar({...r, borrado:false}));
  }
  /* inserta y, si ya existía, lo deja como está (no pisa lo que se clasificó en la app) */
  async function guardarSiNo(rows){
    const {error} = await sb.from('docs').upsert(rows.map(r => ({col:r.col, id:r.id, data:r.data, borrado:false})), {onConflict:'col,id', ignoreDuplicates:true});
    if(error) throw error;
  }
  async function estadoMP(v){
    const {error} = await sb.from('docs').upsert({col:'meta', id:'mpEstado', data:{v}, borrado:false}, {onConflict:'col,id'});
    if(error) log.warn({e:error.message}, 'no pudo guardar el estado de Mercado Pago');
  }
  async function estado(v){
    const {error} = await sb.from('docs').upsert({col:'meta', id:'botEstado', data:{v}, borrado:false}, {onConflict:'col,id'});
    if(error) log.warn({e:error.message}, 'no pudo guardar el estado');
  }
  return {db, entrar, refrescar, guardar, guardarSiNo, estado, estadoMP, get uid(){ return uidBot; }};
}
