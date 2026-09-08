import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el entorno (.env)');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

/**
 * Inserta lecturas normalizadas (ya con timestamp absoluto).
 * @param {{sensor_id:string, atributo:string, valor:number, timestamp:string}[]} rows
 */
export async function insertLecturas(rows) {
  const { error } = await supabase.from('lecturas').insert(rows);
  if (error) throw error;
}

/**
 * Consulta lecturas filtrando por sensor_id, atributo y rango de fechas.
 */
export async function queryLecturas({ sensor_id, atributo, from, to, limit = 1000 }) {
  let query = supabase
    .from('lecturas')
    .select('sensor_id, atributo, valor, timestamp')
    .order('timestamp', { ascending: true })
    .limit(limit);

  if (sensor_id) query = query.eq('sensor_id', sensor_id);
  if (atributo) query = query.eq('atributo', atributo);
  if (from) query = query.gte('timestamp', from);
  if (to) query = query.lte('timestamp', to);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** Lista los sensor_id distintos que han enviado datos. */
export async function listSensores() {
  const { data, error } = await supabase
    .from('lecturas')
    .select('sensor_id')
    .order('sensor_id', { ascending: true });
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.sensor_id))];
}

/** Busca el token registrado para un sensor_id en la tabla sensor_tokens. */
export async function getSensorToken(sensor_id) {
  const { data, error } = await supabase
    .from('sensor_tokens')
    .select('token, activo')
    .eq('sensor_id', sensor_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
