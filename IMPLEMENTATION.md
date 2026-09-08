# Implementación del sensor (Arduino/ESP32) — guía para estudiantes

Esta guía explica qué debe hacer el código de **su** sensor para enviar datos
al agregador del curso. Sigan esta guía exactamente — el backend valida el
formato y **rechaza** bloques que no cumplan el contrato descrito aquí.

Repo de referencia con un ejemplo funcional (DHT11 + ESP32/ESP8266):
https://github.com/farandal/fablab-inacap-sensors-aggregator

## 1. Datos que les entregaremos

El profesor/ayudante les dará:

- **`SERVER_URL`**: URL del endpoint de ingesta, ej.
  `https://fablab-inacap-sensors-backend.onrender.com/ingest`
- **`SENSOR_ID`**: identificador único para su sensor/grupo, ej.
  `arduino_r3_lab_3`
- **`BEARER_TOKEN`**: token secreto asignado a su `SENSOR_ID`

Guarden estos 3 valores — sin ellos su sensor no podrá enviar datos.

## 2. Requisitos de hardware/software

- Placa con WiFi: **ESP32** o **ESP8266** (un Arduino UNO/R3 sin WiFi
  necesita un módulo adicional, ej. ESP8266 en modo AT, o un shield Ethernet).
- Arduino IDE con las librerías:
  - `ArduinoJson` (v6 o superior)
  - Librería del/los sensor(es) que estén usando (ej. `DHT sensor library`
    de Adafruit para DHT11/DHT22)
- Credenciales de la red WiFi del laboratorio.

## 3. Qué debe hacer su código (contrato obligatorio)

### 3.1. Acumular lecturas en un bloque

- Mantengan un buffer en memoria de tamaño `MAX_REGISTROS` (ustedes lo
  definen, ej. 5 o 10 — pero no puede superar el límite configurado en el
  servidor, que por defecto es 50).
- Cada lectura del buffer debe tener:
  - `atributo` (string): nombre de la variable medida, ej. `"temperatura"`,
    `"humedad"`, `"luz"`.
  - `valor` (número): el valor medido.
  - `delta_ms` (entero): milisegundos transcurridos **desde la primera
    lectura del bloque actual** (no desde el boot de la placa). Usen
    `millis()` y resten el `millis()` de cuando empezó el bloque.

### 3.2. Enviar el bloque cuando se llena

Cuando el buffer alcanza `MAX_REGISTROS`, arma un JSON con esta forma exacta y
hace un `POST` a `SERVER_URL`:

```json
{
  "sensor_id": "arduino_r3_lab_3",
  "lecturas": [
    { "atributo": "temperatura", "valor": 24.5, "delta_ms": 0 },
    { "atributo": "humedad",     "valor": 60.2, "delta_ms": 0 },
    { "atributo": "temperatura", "valor": 24.6, "delta_ms": 2000 },
    { "atributo": "humedad",     "valor": 60.4, "delta_ms": 2000 }
  ]
}
```

Headers requeridos en el POST:

```
Content-Type: application/json
Authorization: Bearer <BEARER_TOKEN>
```

### 3.3. Después de enviar

- Si el servidor responde `201`, limpien el buffer y empiecen un bloque nuevo.
- Si responde un error (ver sección 5), **no descarten** el bloque sin
  revisar el motivo — puede ser un problema de token, de formato, o de
  tamaño de bloque.
- Si no hay conexión WiFi, descarten el bloque (no hay forma de reintentar
  sin acumular memoria indefinidamente) y sigan intentando con el próximo.

## 4. Ejemplo de referencia

Usen como base
[`sensor_ejemplo.ino`](https://github.com/farandal/fablab-inacap-sensors-aggregator/blob/main/sensor_ejemplo/sensor_ejemplo.ino),
que ya implementa:

- Conexión WiFi
- Buffer con `delta_ms` calculado correctamente
- Armado del JSON con `ArduinoJson`
- `POST` con `HTTPClient` incluyendo el header `Authorization: Bearer`

Solo necesitan cambiar al inicio del archivo:

```cpp
const char* WIFI_SSID     = "SU_WIFI";
const char* WIFI_PASSWORD = "SU_PASSWORD";
const char* SERVER_URL    = "URL_QUE_LES_DIMOS/ingest";
const char* SENSOR_ID     = "SU_SENSOR_ID";
const char* BEARER_TOKEN  = "SU_TOKEN";
```

Y reemplazar la función que simula/lee sensores por las llamadas reales a su
librería de sensor (ej. `dht.readTemperature()`, `dht.readHumidity()`).

## 5. Errores comunes y qué significan

| Respuesta HTTP | Causa | Qué revisar |
|---|---|---|
| `401` | Falta el header `Authorization` o no viene como `Bearer <token>` | Revisar que el header se esté agregando en cada request |
| `403` | El token no coincide con el `sensor_id` enviado | Confirmar `SENSOR_ID` y `BEARER_TOKEN` con el profesor |
| `413` | El bloque tiene más lecturas que `MAX_REGISTROS` permitido en el servidor | Reducir el tamaño de su buffer |
| `400` | Falta `sensor_id`, `lecturas` está vacío, o alguna lectura no tiene `atributo`/`valor` válidos | Revisar el JSON armado (imprímanlo por `Serial.println` antes de enviarlo) |

## 6. Cómo verificar que están enviando datos correctamente

Después de que su sensor envíe al menos un bloque, pueden consultar sus
propias lecturas (no requiere token, es de solo lectura):

```
GET https://<SERVER_URL_BASE>/lecturas?sensor_id=SU_SENSOR_ID
```

Desde el navegador, o con `curl`:

```bash
curl "https://<SERVER_URL_BASE>/lecturas?sensor_id=SU_SENSOR_ID"
```

Deberían ver un arreglo JSON con sus lecturas y un `timestamp` calculado por
el servidor. Si el arreglo viene vacío, su sensor aún no ha enviado datos
exitosamente — revisen el monitor serial de su placa para ver el código de
respuesta HTTP.

## 7. Qué deben entregarme (checklist)

- [ ] Código `.ino` final subido a su repositorio.
- [ ] Captura o log del monitor serial mostrando al menos un `POST` exitoso
      (`201`).
- [ ] Captura de la respuesta de `GET /lecturas?sensor_id=SU_SENSOR_ID`
      mostrando sus datos.
- [ ] `SENSOR_ID` usado (para que quede registrado cuál grupo es cuál).
