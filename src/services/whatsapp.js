import twilio from 'twilio'
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER, NODE_ENV } from '../config.js'

let client
function getClient() {
  if (!client && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  }
  return client
}

// Envía mensaje de texto simple
export async function enviarMensajeWA(numero, mensaje) {
  if (NODE_ENV === 'development') {
    console.log(`\n📱 [WA SIMULADO] → ${numero}\n   "${mensaje}"\n`)
    return { sid: 'dev-simulado' }
  }
  try {
    const c = getClient()
    if (!c) { console.warn('⚠️ Twilio no configurado'); return null }
    return await c.messages.create({
      from: `whatsapp:${TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${numero}`,
      body: mensaje,
    })
  } catch (err) { console.error('Error WA:', err.message); return null }
}

// Envía lista de opciones (hasta 10 items) con botón desplegable
export async function enviarLista(numero, cuerpo, boton, secciones) {
  if (NODE_ENV === 'development') {
    const items = secciones.flatMap(s => s.rows).map((r,i) => `*${i+1}* ${r.title}`).join('\n')
    console.log(`\n📱 [LISTA SIMULADA] → ${numero}\n${cuerpo}\n${items}\n`)
    return { sid: 'dev-simulado' }
  }
  try {
    const c = getClient()
    if (!c) return null
    const content = await c.content.v1.contents.create({
      friendlyName: `lista_${Date.now()}`,
      types: {
        'twilio/list-picker': {
          body: cuerpo,
          button: boton,
          items: secciones.flatMap(s => s.rows.map(r => ({
            id: r.id,
            item: r.title,
            description: r.description || ''
          })))
        }
      }
    })
    return await c.messages.create({
      from: `whatsapp:${TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${numero}`,
      contentSid: content.sid
    })
  } catch (err) {
    console.error('Error lista WA:', err.message)
    return enviarMensajeWA(numero, cuerpo)
  }
}

// Envía botones de respuesta rápida (máximo 3)
export async function enviarBotones(numero, cuerpo, botones) {
  if (NODE_ENV === 'development') {
    const opts = botones.map(b => `[${b.title}]`).join(' ')
    console.log(`\n📱 [BOTONES SIMULADOS] → ${numero}\n${cuerpo}\n${opts}\n`)
    return { sid: 'dev-simulado' }
  }
  try {
    const c = getClient()
    if (!c) return null
    const content = await c.content.v1.contents.create({
      friendlyName: `botones_${Date.now()}`,
      types: {
        'twilio/quick-reply': {
          body: cuerpo,
          actions: botones.map(b => ({ title: b.title.slice(0,20), id: b.id }))
        }
      }
    })
    return await c.messages.create({
      from: `whatsapp:${TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${numero}`,
      contentSid: content.sid
    })
  } catch (err) {
    console.error('Error botones WA:', err.message)
    return enviarMensajeWA(numero, cuerpo)
  }
}
