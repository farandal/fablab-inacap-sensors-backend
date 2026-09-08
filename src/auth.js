import 'dotenv/config';
import { getSensorToken } from './db.js';

function parseSensorTokensEnv() {
  const raw = process.env.SENSOR_TOKENS || '';
  const map = new Map();
  for (const pair of raw.split(',')) {
    const [sensorId, token] = pair.split(':').map((s) => s?.trim());
    if (sensorId && token) map.set(sensorId, token);
  }
  return map;
}

const envTokens = parseSensorTokensEnv();

/**
 * Middleware de autenticacion obligatoria (Bearer Token).
 * Orden de validacion:
 *  1. Token especifico del sensor definido en SENSOR_TOKENS (.env)
 *  2. Token especifico del sensor guardado en la tabla sensor_tokens (Supabase)
 *  3. Token global API_TOKEN (uso rapido en pruebas de estudiantes)
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Falta encabezado Authorization: Bearer <token>' });
  }

  const sensorId = req.body?.sensor_id || req.query?.sensor_id;

  if (sensorId && envTokens.has(sensorId)) {
    if (envTokens.get(sensorId) === token) return next();
    return res.status(403).json({ error: 'Token invalido para este sensor_id' });
  }

  if (sensorId) {
    try {
      const record = await getSensorToken(sensorId);
      if (record && record.activo && record.token === token) return next();
    } catch (err) {
      // si la tabla no existe o falla, seguimos al fallback global
    }
  }

  if (process.env.API_TOKEN && token === process.env.API_TOKEN) return next();

  return res.status(403).json({ error: 'Token invalido' });
}
