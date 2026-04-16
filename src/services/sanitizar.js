/**
 * Detecta y redacta números de teléfono en mensajes de chat.
 * Cubre los formatos chilenos más comunes:
 *   9 1234 5678 / 91234567 / +56 9 1234 5678 / 56912345678
 *   09 1234 5678 / 09-1234-5678
 *   2 2345 6789 (fijo Santiago) / +56 2 2345 6789
 */

const PATRONES_TELEFONO = [
  // +56 9 XXXX XXXX  /  56 9 XXXX XXXX  /  +569XXXXXXXX
  /(\+?56[\s\-.]?)?0?9[\s\-.]?\d{4}[\s\-.]?\d{4}/g,
  // fijo: +56 2 XXXX XXXX  /  2 XXXX XXXX
  /(\+?56[\s\-.]?)?2[\s\-.]?\d{4}[\s\-.]?\d{4}/g,
  // secuencia de 8+ dígitos seguidos (cualquier número largo)
  /\b\d[\d\s\-\.]{7,}\d\b/g,
]

const REEMPLAZO = '[número eliminado]'

export function sanitizarMensaje(texto) {
  if (!texto || typeof texto !== 'string') return texto
  let resultado = texto
  for (const patron of PATRONES_TELEFONO) {
    resultado = resultado.replace(patron, REEMPLAZO)
  }
  return resultado
}
