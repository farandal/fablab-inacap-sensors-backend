# Documentación técnica — fablab-inacap-sensors-backend

Este documento describe en detalle qué se construyó, por qué se tomaron ciertas
decisiones, y cómo operan todas las piezas del agregador. Complementa a
[README.md](README.md) (que se enfoca en "cómo levantarlo rápido").

## 1. Objetivo del sistema

Centralizar lecturas de sensores IoT (Arduino/ESP32/ESP8266) enviadas en
bloques periódicos, normalizarlas a un esquema común, persistirlas en una base
de datos gratuita en la nube, y exponerlas via:

- API REST (`GET /lecturas`, `GET /sensores`)
- Servidor MCP (`POST /mcp`) para clientes de IA (Claude Desktop, agentes, etc.)

## 2. Stack elegido y por qué

| Pieza | Elección | Motivo |
|---|---|---|
| Base de datos | Supabase (Postgres, plan Free) | SQL nativo, permite índices y consultas por rango de fechas eficientes; el plan gratuito no tiene límite agresivo de escrituras (a diferencia de Firestore Spark: 20k/día). |
| Hosting | Render (Web Service, plan Free) | Despliegue directo desde GitHub, soporta procesos Node.js persistentes (`app.listen`), variables de entorno gestionadas desde el dashboard. |
| Framework backend | Express 4 | Minimalista, cada ruta REST y el endpoint MCP conviven en el mismo proceso/puerto. |
| Cliente de datos | `@supabase/supabase-js` con `service_role` key | El backend necesita bypass de Row Level Security porque hace sus propias validaciones de auth (Bearer token), no las de Supabase Auth. |
| MCP | `@modelcontextprotocol/sdk` (v1.x) con `StreamableHTTPServerTransport`, modo *stateless* (`sessionIdGenerator: undefined`) | Permite exponer MCP como un endpoint HTTP normal (`POST /mcp`) dentro del mismo Express app, sin necesitar un proceso separado ni manejo de sesiones — ideal para hosting serverless-like como Render free tier. |

## 3. Modelo de datos (EAV simplificado)

Tabla `lecturas` (ver [supabase/schema.sql](supabase/schema.sql)):

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | bigserial PK | Identificador interno |
| `sensor_id` | text | Identificador único del sensor/dispositivo (ej. `arduino_r3_lab_1`) |
| `atributo` | text | Nombre de la variable medida (ej. `temperatura`, `humedad`) |
| `valor` | double precision | Valor numérico de la lectura |
| `timestamp` | timestamptz | Instante absoluto reconstruido de la lectura (ver sección 5) |
| `received_at` | timestamptz | Instante en que el backend recibió el bloque completo |

Se eligió **EAV (Entity-Attribute-Value)** en vez de una columna por atributo
porque los sensores del laboratorio no tienen un esquema fijo: cada uno puede
reportar distintas variables (temperatura, humedad, luz, CO2, etc.) sin requerir
migraciones de esquema cada vez que se agrega un sensor nuevo.

Índices creados: `sensor_id`, `atributo`, `timestamp`, y compuesto
`(sensor_id, timestamp)` — cubren el patrón de consulta principal
(`GET /lecturas?sensor_id=&from=&to=`).

Tabla `sensor_tokens`:

| Columna | Tipo | Descripción |
|---|---|---|
| `sensor_id` | text PK | Debe coincidir con el `sensor_id` que el sensor envía |
| `token` | text | Token Bearer esperado para ese sensor |
| `activo` | boolean | Permite desactivar un sensor sin borrar su token |
| `creado_en` | timestamptz | Auditoría |

## 4. Flujo de ingesta (`POST /ingest`)

```
Arduino/ESP32                 Backend (Express)                  Supabase
     |  POST /ingest                |                                 |
     |  Authorization: Bearer <tok> |                                 |
     |  { sensor_id, lecturas[] }   |                                 |
     |----------------------------->|                                 |
     |                              | 1. requireAuth (auth.js)        |
     |                              | 2. valida MAX_REGISTROS         |
     |                              | 3. normalizarBloque()           |
     |                              |    -> timestamp absoluto        |
     |                              | 4. insertLecturas()             |
     |                              |--------------------------------->|
     |                              |            INSERT               |
     |<-----------------------------|                                 |
     |  { ok, insertados, serverTimestamp }                           |
```

Código relevante: [src/index.js](src/index.js) (ruta `/ingest`),
[src/normalizar.js](src/normalizar.js), [src/db.js](src/db.js).

### Validaciones aplicadas

1. `Authorization: Bearer <token>` obligatorio (middleware `requireAuth`).
2. Tamaño del bloque (`lecturas.length`) no puede superar `MAX_REGISTROS`
   (variable de entorno) → responde `413` si se excede.
3. `sensor_id` debe ser string no vacío.
4. Cada lectura requiere `atributo` (string) y `valor` (number).

## 5. Reconstrucción de timestamps absolutos

Los sensores no tienen reloj de pared confiable (no siempre tienen NTP), pero sí
tienen `millis()` (tiempo relativo desde el boot). Por eso cada lectura incluye
`delta_ms`: milisegundos transcurridos desde la **primera lectura del bloque**.

El backend, al recibir el bloque completo, fija `serverTimestamp = new Date()`
(instante de llegada del bloque, que aproxima el instante de la **última**
lectura, ya que el bloque se envía justo después de completarse).

Fórmula aplicada por lectura (ver [src/normalizar.js](src/normalizar.js)):

$$
timestamp_i = serverTimestamp - (\Delta_{max} - \Delta_i)
$$

donde $\Delta_{max}$ es el mayor `delta_ms` del bloque y $\Delta_i$ es el
`delta_ms` de la lectura `i`. Esto distribuye las lecturas del bloque en el
tiempo, ancladas al instante real de recepción, preservando el espaciado
relativo entre lecturas capturado por el sensor.

**Limitación conocida**: asume que la latencia de red entre "sensor termina de
armar el bloque" y "backend recibe el POST" es pequeña y constante. Para
sensores en redes muy inestables, el error se traslada uniformemente a todas
las lecturas del bloque (no se acumula entre bloques).

## 6. Autenticación

Implementada en [src/auth.js](src/auth.js). Orden de resolución para cada
`sensor_id` recibido:

1. **`SENSOR_TOKENS` en variables de entorno** — formato `sensor_id:token,...`.
   Se resuelve en memoria al iniciar el proceso (rápido, sin round-trip a DB).
2. **Tabla `sensor_tokens` en Supabase** — permite añadir/rotar tokens sin
   redeploy, vía SQL o vía un script Node puntual (ver sección 9).
3. **`API_TOKEN` global** — fallback para pruebas rápidas en clase; cualquier
   sensor puede usarlo si no tiene un token específico asignado.

Esto se decidió como capas (en vez de una sola tabla) para poder demostrar el
sistema en clase sin depender de que cada estudiante primero inserte su fila en
Supabase — pero permitiendo escalar a credenciales por sensor cuando se
necesite aislar el acceso.

`GET /lecturas` y `GET /sensores` **no** requieren autenticación en esta
versión (se prioriza que cualquier cliente/MCP pueda consultar). Si se necesita
restringir lectura, se agrega `requireAuth` como middleware de esas rutas.

## 7. Servidor MCP

Implementado en [src/mcp.js](src/mcp.js), montado sobre el mismo Express app
en `POST /mcp` (Streamable HTTP, sin estado — cada request crea su propio
`McpServer` + `StreamableHTTPServerTransport` y los cierra al terminar la
respuesta; no hay sesiones persistentes entre llamadas).

Tools expuestas:

| Tool | Parámetros | Retorna |
|---|---|---|
| `getLecturas` | `sensor_id?`, `atributo?`, `from?`, `to?` | JSON con lecturas filtradas (mismo shape que `GET /lecturas`) |
| `listSensores` | — | Lista de `sensor_id` distintos que han enviado datos |

Un cliente MCP compatible con Streamable HTTP (Claude Desktop, agentes con
AGUI, etc.) puede apuntar directamente a `https://<host>/mcp`.

## 8. Endpoints REST — referencia completa

| Método | Ruta | Auth | Query/Body | Respuesta |
|---|---|---|---|---|
| `GET` | `/health` | No | — | `{ ok: true }` |
| `POST` | `/ingest` | Sí (Bearer) | `{ sensor_id, lecturas: [{atributo, valor, delta_ms}] }` | `201 { ok, insertados, serverTimestamp }` |
| `GET` | `/lecturas` | No* | `?sensor_id=&atributo=&from=&to=&limit=` | `200 [{sensor_id, atributo, valor, timestamp}]` |
| `GET` | `/sensores` | No* | — | `200 ["sensor_id", ...]` |
| `POST` | `/mcp` | No (nivel transporte) | JSON-RPC MCP | Streamable HTTP (JSON-RPC) |

\* Ver sección 6 sobre cómo restringir lectura si se requiere.

## 9. Operaciones realizadas durante la puesta en marcha

Registro de lo ejecutado en esta implementación (para trazabilidad):

1. Se creó el proyecto Supabase (`zzjylhtbjbmvgebftxya`) y se ejecutó
   [supabase/schema.sql](supabase/schema.sql) desde el SQL Editor, creando
   `lecturas` y `sensor_tokens`.
2. Se configuró `.env` local con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`
   (clave legacy `service_role`, **no** la `service_role`/`secret` nueva ni la
   `anon`/`publishable`, y **nunca** un Personal Access Token `sbp_...` ni la
   contraseña de la base de datos — esos no se usan en este proyecto).
3. Se insertó una fila en `sensor_tokens` para `arduino_r3_lab_1` con el token
   `token-lab-1` (coincide con `SENSOR_TOKENS` en `.env`), usando un script
   Node puntual con `@supabase/supabase-js` y la `service_role` key.
4. Se corrió `npm install` y `npm run dev` localmente (`node --watch src/index.js`).
5. Se validó el flujo completo con `curl`:
   - `POST /ingest` con Bearer `token-lab-1` → `201 { ok: true, insertados: 2 }`.
   - `GET /lecturas?sensor_id=arduino_r3_lab_1` → devolvió ambas lecturas con
     `timestamp` reconstruido.
6. Se subió el repo a GitHub (`git init`, commit, `git remote add origin`,
   `git push -u origin main`) y se agregó `package-lock.json` para builds
   reproducibles en Render.

### Nota de seguridad

Durante la configuración se compartieron por error, y luego se recomendó
rotar/revocar:
- Un Personal Access Token de Supabase (`sbp_...`, control total de la cuenta) — **revocado**.
- La contraseña de la base de datos Postgres — **se recomendó rotar**.
- La `service_role` key legacy usada para levantar el proyecto — se recomienda
  regenerarla desde **Project Settings → API → Legacy anon, service_role API
  keys** una vez el flujo esté validado en producción, ya que fue pegada en un
  chat.

Ninguno de esos valores se commiteó al repositorio (`.env` está en
[.gitignore](.gitignore)).

## 10. Despliegue en Render

Ver [README.md](README.md#7-deploy-gratuito-en-render) para el paso a paso.
Configuración usada:

- **Root Directory**: vacío (repo dedicado, no monorepo)
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Health Check Path**: `/health`
- **Environment Variables**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `API_TOKEN`, `SENSOR_TOKENS`, `MAX_REGISTROS` (mismos valores que `.env` local)
- **Pre-Deploy Command**: vacío (no hay migraciones automatizadas; el schema
  se aplica manualmente vía SQL Editor)
- **Auto-Deploy**: habilitado (on commit a `main`)

## 11. Estructura del repositorio

```
fablab-inacap-sensors-backend/
├── package.json
├── package-lock.json
├── .env.example
├── render.yaml
├── supabase/
│   └── schema.sql        # DDL: tablas lecturas, sensor_tokens + índices
└── src/
    ├── index.js          # Express app: rutas REST + monta MCP
    ├── db.js             # Cliente Supabase + queries (insert/query/list/token lookup)
    ├── auth.js           # Middleware Bearer token (env > DB > fallback global)
    ├── normalizar.js     # Reconstrucción de timestamp absoluto desde delta_ms
    └── mcp.js            # Servidor MCP (getLecturas, listSensores) sobre /mcp
```

## 12. Extensiones futuras consideradas (no implementadas)

- Autenticación también en `GET /lecturas` (agregar `requireAuth` a esa ruta).
- Endpoint GraphQL adicional para consultas más flexibles.
- Migrar de Supabase a Firebase Firestore (solo requiere reescribir `src/db.js`,
  el contrato de `normalizarBloque` y las rutas no cambian).
- Row Level Security en Supabase si se decide usar la `anon`/`publishable` key
  desde algún cliente en vez de `service_role` desde el backend.
