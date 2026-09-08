# fablab-inacap-sensors-backend

Agregador de datos de sensores (Arduino/ESP32) — REST + MCP.

Backend gratuito para que estudiantes centralicen lecturas de sensores (Arduino/ESP32),
las consulten via REST, y las expongan a clientes de IA via MCP.

Firmware de ejemplo para los sensores: [fablab-inacap-sensors-aggregator](https://github.com/farandal/fablab-inacap-sensors-aggregator).

Documentación adicional:
- [DOCUMENTATION.md](DOCUMENTATION.md) — documentación técnica completa (arquitectura, decisiones, operaciones realizadas).
- [IMPLEMENTATION.md](IMPLEMENTATION.md) — guía para estudiantes: qué debe implementar su código de sensor.

## Arquitectura

```
Arduino/ESP32 --POST /ingest (Bearer token)--> [Express API] --> Supabase (Postgres)
                                                     |
                                    GET /lecturas ---+--- POST /mcp (MCP tools)
```

- **Base de datos**: Supabase (Postgres gratuito, plan Free).
- **Hosting**: Render (o Vercel) — plan gratuito.
- **Autenticacion**: Bearer token por sensor (o token global para pruebas).
- **MCP**: mismo servidor Express expone `/mcp` (Streamable HTTP) con las
  herramientas `getLecturas` y `listSensores`.

## 1. Crear el proyecto Supabase (gratis)

1. Crea una cuenta en https://supabase.com y un proyecto nuevo (plan Free).
2. Ve a **SQL Editor** y ejecuta el contenido de [`supabase/schema.sql`](supabase/schema.sql).
3. Ve a **Project Settings > API** y copia:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key (secreta, solo backend) → `SUPABASE_SERVICE_ROLE_KEY`

## 2. Configurar el backend localmente

```bash
cp .env.example .env
# edita .env con tus valores de Supabase y tokens
npm install
npm run dev
```

El servidor queda escuchando en `http://localhost:3000`.

Prueba rapida:

```bash
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cambia-este-token" \
  -d '{
    "sensor_id": "arduino_r3_lab_1",
    "lecturas": [
      {"atributo":"temperatura","valor":24.5,"delta_ms":0},
      {"atributo":"humedad","valor":60.2,"delta_ms":0}
    ]
  }'

curl "http://localhost:3000/lecturas?sensor_id=arduino_r3_lab_1"
```

## 3. Autenticacion por sensor

Cada sensor debe enviar `Authorization: Bearer <token>`. Hay dos formas de asignar tokens:

- **Rapida (.env)**: variable `SENSOR_TOKENS` con pares `sensor_id:token` separados por coma.
- **Por base de datos**: insertar filas en la tabla `sensor_tokens` (creada por `schema.sql`):

```sql
insert into sensor_tokens (sensor_id, token) values ('arduino_r3_lab_1', 'token-lab-1');
```

Si ninguno de los dos aplica, se acepta el token global `API_TOKEN` (util para pruebas rapidas en clase).

## 4. Endpoints REST

| Metodo | Ruta         | Descripcion                                              | Auth |
|--------|--------------|-----------------------------------------------------------|------|
| POST   | `/ingest`    | Recibe un bloque `{sensor_id, lecturas:[...]}`             | Si   |
| GET    | `/lecturas`  | `?sensor_id=&atributo=&from=&to=&limit=`                   | No*  |
| GET    | `/sensores`  | Lista de `sensor_id` distintos                             | No*  |
| GET    | `/health`    | Chequeo de disponibilidad                                  | No   |

\* Agrega `requireAuth` en [`src/index.js`](src/index.js) si necesitas restringir tambien la lectura.

Ejemplo de respuesta de `/lecturas`:

```json
[
  { "sensor_id": "arduino_r3_lab_1", "atributo": "temperatura", "valor": 24.5, "timestamp": "2026-09-07T21:40:00.000Z" },
  { "sensor_id": "arduino_r3_lab_1", "atributo": "humedad", "valor": 60.2, "timestamp": "2026-09-07T21:40:00.000Z" }
]
```

## 5. Reconstruccion de timestamps

El sensor envia `delta_ms` (milisegundos desde el inicio del bloque). El backend
fija `serverTimestamp` al recibir el bloque (aprox. el instante de la ultima
lectura) y calcula, para cada lectura: `timestamp = serverTimestamp - (max(delta_ms) - delta_ms)`.
Ver [`src/normalizar.js`](src/normalizar.js).

## 6. MCP para clientes de IA (Claude Desktop, etc.)

El servidor expone MCP (Streamable HTTP) en `POST /mcp` con dos tools:

- `getLecturas(sensor_id?, atributo?, from?, to?)`
- `listSensores()`

Config de ejemplo para un cliente MCP remoto (Claude Desktop con conector HTTP,
o cualquier cliente compatible con Streamable HTTP):

```json
{
  "mcpServers": {
    "sensores": {
      "url": "https://tu-servicio.onrender.com/mcp"
    }
  }
}
```

## 7. Deploy gratuito en Render

1. Sube este repo a GitHub.
2. En https://render.com crea un **Web Service** nuevo apuntando al repo (o usa
   [`render.yaml`](render.yaml) con "Blueprint").
3. Configura variables de entorno: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `API_TOKEN`, `SENSOR_TOKENS`, `MAX_REGISTROS`.
4. Build command: `npm install` — Start command: `npm start`.
5. Al desplegar, tu URL sera algo como `https://sensores-aggregator.onrender.com`.
   Usa `<esa-url>/ingest`, `<esa-url>/lecturas`, `<esa-url>/mcp`.

> Nota: el plan free de Render "duerme" el servicio tras inactividad; la primera
> peticion tras dormir tarda unos segundos en responder. Suficiente para uso
> academico.

## 8. Estructura del proyecto

```
fablab-inacap-sensors-backend/
├── package.json
├── .env.example
├── render.yaml
├── supabase/schema.sql
└── src/
    ├── index.js       # Express app (REST + monta MCP)
    ├── db.js          # Cliente Supabase + queries
    ├── auth.js        # Middleware Bearer token
    ├── normalizar.js  # Reconstruccion de timestamps
    └── mcp.js         # Servidor MCP (getLecturas, listSensores)
```

## 9. Siguientes pasos opcionales

- Agregar `requireAuth` a `GET /lecturas` si se requiere lectura protegida.
- Cambiar Supabase por Firebase Firestore si se prefiere NoSQL (mismo contrato
  de API, solo cambia `src/db.js`).
- Agregar un endpoint GraphQL adicional si se necesitan consultas mas flexibles.
