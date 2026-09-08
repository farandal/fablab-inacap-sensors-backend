/**
 * Normaliza un bloque enviado por un sensor a registros con timestamp absoluto.
 *
 * Formato de entrada esperado:
 * {
 *   sensor_id: "arduino_r3_lab_1",
 *   lecturas: [
 *     { atributo: "temperatura", valor: 24.5, delta_ms: 0 },
 *     { atributo: "humedad",     valor: 60.2, delta_ms: 0 },
 *     { atributo: "temperatura", valor: 24.6, delta_ms: 1000 }
 *   ]
 * }
 *
 * delta_ms es el tiempo transcurrido (ms) desde el inicio del bloque hasta la
 * captura de esa lectura. El backend fija serverTimestamp al recibir el bloque
 * (aproximando el instante de la ULTIMA lectura) y reconstruye cada timestamp
 * absoluto restando el tiempo restante hasta el fin del bloque.
 */
export function normalizarBloque({ sensor_id, lecturas }, serverTimestamp = new Date()) {
  if (!sensor_id || typeof sensor_id !== 'string') {
    throw new Error('sensor_id es requerido y debe ser texto');
  }
  if (!Array.isArray(lecturas) || lecturas.length === 0) {
    throw new Error('lecturas debe ser un arreglo no vacio');
  }

  const maxDelta = Math.max(...lecturas.map((l) => Number(l.delta_ms) || 0));

  return lecturas.map((l) => {
    const { atributo, valor, delta_ms } = l;
    if (!atributo || typeof valor !== 'number') {
      throw new Error('Cada lectura requiere atributo (string) y valor (number)');
    }
    const delta = Number(delta_ms) || 0;
    const offsetMs = maxDelta - delta; // ms antes del fin del bloque
    const timestamp = new Date(serverTimestamp.getTime() - offsetMs);
    return {
      sensor_id,
      atributo,
      valor,
      timestamp: timestamp.toISOString(),
    };
  });
}
