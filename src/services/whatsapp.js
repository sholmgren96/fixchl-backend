import twilio from 'twilio'
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER, NODE_ENV } from '../config.js'

let client

function getClient() {
  if (!client && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  }
  return client
}

/**
 * Envía un mensaje de WhatsApp al cliente usando Twilio.
 * El número destino debe tener formato: whatsapp:+5698765XXXX
 */
export async function enviarMensajeWA(numeroDestino, mensaje) {
  // En desarrollo, solo loguea el mensaje
  if (NODE_ENV === 'development') {
    console.log(`\n📱 [WA SIMULADO] → ${numeroDestino}`)
    console.log(`   Mensaje: "${mensaje}"\n`)
    return { sid: 'dev-simulado' }
  }

  try {
    const twilio = getClient()
    if (!twilio) {
      console.warn('⚠️ Twilio no configurado — mensaje no enviado')
      return null
    }
    const result = await twilio.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: `whatsapp:${numeroDestino}`,
      body: mensaje,
    })
    return result
  } catch (err) {
    console.error('Error enviando WhatsApp:', err.message)
    return null
  }
}
