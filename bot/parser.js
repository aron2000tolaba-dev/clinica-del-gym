/* Entiende frases como "cargué 30 mil de nafta, 40 litros, la camioneta marca 12.300 km, en efectivo" */
function parseGastoVoz(t){
  const base = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let s = ' ' + base.replace(/(\d)[.,](\d{3})(?!\d)/g, '$1$2').replace(/(\d)[.,](\d{3})(?!\d)/g, '$1$2').replace(/\$\s*/g, '$') + ' ';
  const W = {un:1, uno:1, una:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10, quince:15, veinte:20, treinta:30, cuarenta:40, cincuenta:50, sesenta:60, setenta:70, ochenta:80, noventa:90, cien:100, ciento:100, doscientos:200, trescientos:300, cuatrocientos:400, quinientos:500};
  s = s.replace(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos)\b(?=\s+(mil|millon|millones|litros|lts|pesos|kilometros|km)\b)/g, w => W[w]);
  const out = {texto:String(t || '').trim()};
  const n = x => parseFloat(String(x).replace(',', '.'));
  const mult = w => w === 'mil' || w === 'k' ? 1000 : /^millon/.test(w || '') ? 1e6 : 1;
  const usados = [];
  let m = s.match(/(\d+(?:[.,]\d+)?)\s*(litros|litro|lts|lt)\b/);
  if(m){ out.litros = n(m[1]); usados.push(m.index); }
  m = s.match(/(?:marca|kilometraje|odometro|tiene)\s+(\d+(?:[.,]\d+)?)\s*(mil)?/) || s.match(/(\d+(?:[.,]\d+)?)\s*(mil)?\s*(kilometros|kilometro|km|kms)\b/);
  if(m){ out.km = Math.round(n(m[1]) * (m[2] ? 1000 : 1)); usados.push(s.indexOf(m[1], m.index)); }
  const cands = []; const re = /(\$)?(\d+(?:[.,]\d+)?)\s*(mil|millones|millon|k)?\s*(pesos|mangos)?/g; let x;
  while((x = re.exec(s))){ const idx = x.index + (x[1] ? 1 : 0); if(usados.includes(idx) || usados.includes(x.index)) continue;
    const after = s.slice(re.lastIndex, re.lastIndex + 12); if(/^\s*(litros|litro|lts|lt|km|kilometro|kms)/.test(after)) continue;
    const v = n(x[2]) * mult(x[3]); cands.push({v, fuerte:!!(x[1] || x[3] || x[4])}); }
  const f = cands.filter(c => c.fuerte); const elegido = (f.length ? f : cands).sort((a, b) => b.v - a.v)[0];
  if(elegido) out.monto = Math.round(elegido.v);
  const CAT = [['Combustible', /nafta|gasoil|gas oil|combustible|diesel|carga de|cargue|surtidor|ypf|shell|axion/], ['Sueldos y adelantos', /sueldo|adelanto|quincena|jornal/],
    ['Repuestos', /repuesto|lona|correa|rulem|rodamiento|placa|motor/], ['Alquiler', /alquiler/], ['Servicios (luz, agua, internet)', /\bluz\b|\bagua\b|internet|telefono|celular|edesa|aguas del norte/],
    ['Publicidad', /publicidad|anuncio|instagram|facebook|promocion/], ['Herramientas', /herramienta|mecha|taladro|llave|amoladora|destornillador/], ['Impuestos', /impuesto|monotributo|iibb|ingresos brutos|\bafip\b|\barca\b|rentas|percepcion/]];
  const c = CAT.find(([, r]) => r.test(s)); if(c) out.categoria = c[0];
  const MED = [['Efectivo', /efectivo|cash/], ['Transferencia', /transferencia|transferi/], ['Mercado Pago', /mercado ?pago/], ['Tarjeta', /tarjeta|debito|credito/]];
  const md = MED.find(([, r]) => r.test(s)); if(md) out.medio = md[0];
  if(/\b(cobre|me pagaron|ingreso|entro plata|nos pagaron)\b/.test(s)) out.tipo = 'ingreso';
  return out;
}

export default parseGastoVoz;
