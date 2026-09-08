-- Ejecutar en el editor SQL de Supabase (Project > SQL Editor)
-- Esquema EAV simplificado: sensor_id, atributo, valor, timestamp

create table if not exists lecturas (
  id bigserial primary key,
  sensor_id text not null,
  atributo text not null,
  valor double precision not null,
  "timestamp" timestamptz not null,
  received_at timestamptz not null default now()
);

-- Indices para consultas rapidas por sensor, atributo y rango de fechas
create index if not exists idx_lecturas_sensor on lecturas (sensor_id);
create index if not exists idx_lecturas_atributo on lecturas (atributo);
create index if not exists idx_lecturas_timestamp on lecturas ("timestamp");
create index if not exists idx_lecturas_sensor_ts on lecturas (sensor_id, "timestamp");

-- Tabla de credenciales por sensor (Bearer token simple)
create table if not exists sensor_tokens (
  sensor_id text primary key,
  token text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
