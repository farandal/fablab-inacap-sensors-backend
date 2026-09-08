import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './auth.js';
import { normalizarBloque } from './normalizar.js';
import { insertLecturas, queryLecturas, listSensores } from './db.js';
import { mountMcp } from './mcp.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

const MAX_REGISTROS = Number(process.env.MAX_REGISTROS || 50);

app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * POST /ingest
 * Recibe un bloque JSON de un sensor y lo persiste normalizado.
 * Header requerido: Authorization: Bearer <token>
 */
app.post('/ingest', requireAuth, async (req, res) => {
  try {
    const { sensor_id, lecturas } = req.body || {};

    if (Array.isArray(lecturas) && lecturas.length > MAX_REGISTROS) {
      return res.status(413).json({
        error: `El bloque excede MAX_REGISTROS (${MAX_REGISTROS})`,
      });
    }

    const serverTimestamp = new Date();
    const registros = normalizarBloque({ sensor_id, lecturas }, serverTimestamp);

    await insertLecturas(registros);

    res.status(201).json({
      ok: true,
      insertados: registros.length,
      serverTimestamp: serverTimestamp.toISOString(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /lecturas?sensor_id=...&atributo=...&from=...&to=...
 * Consulta publica de lecturas normalizadas (no requiere auth por simplicidad;
 * agregar requireAuth aqui si se necesita restringir tambien la lectura).
 */
app.get('/lecturas', async (req, res) => {
  try {
    const { sensor_id, atributo, from, to, limit } = req.query;
    const data = await queryLecturas({
      sensor_id,
      atributo,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /sensores → lista de sensor_id distintos */
app.get('/sensores', async (_req, res) => {
  try {
    res.json(await listSensores());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

mountMcp(app);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Agregador de sensores escuchando en puerto ${port}`);
});
