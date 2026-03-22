import twilio from 'twilio'
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER, NODE_ENV } from '../config.js'

let client
function getClient() {
  if (!client && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  }
  return client
}

function fromNumber() {
  const n = TWILIO_WHATSAPP_NUMBER || ''
  return n.startsWith('whatsapp:') ? n : `whatsapp:${n}`
}

function toNumber(numero) {
  return numero.startsWith('whatsapp:') ? numero : `whatsapp:${numero}`
}

export async function enviarMensajeWA(numero, mensaje) {
  if (NODE_ENV === 'development') {
    console.log(`\n📱 [WA] → ${numero}\n   "${mensaje}"\n`)
    return { sid: 'dev' }
  }
  try {
    const c = getClient()
    if (!c) return null
    return await c.messages.create({
      from: fromNumber(),
      to: toNumber(numero),
      body: mensaje,
    })
  } catch (err) { console.error('Error WA texto:', err.message); return null }
}

export async function enviarLista(numero, cuerpo, boton, secciones) {
  if (NODE_ENV === 'development') {
    const items = secciones.flatMap(s => s.rows).map((r,i) => `*${i+1}* ${r.title}`).join('\n')
    console.log(`\n📱 [LISTA] → ${numero}\n${cuerpo}\n${items}\n`)
    return { sid: 'dev' }
  }
  try {
    const c = getClient()
    if (!c) return null
    const content = await c.content.v1.contents.create({
      friendlyName: `lista_${Date.now()}`,
      language: 'es',
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
      from: fromNumber(),
      to: toNumber(numero),
      contentSid: content.sid
    })
  } catch (err) {
    console.error('Error lista WA:', err.message)
    // Fallback a texto
    const items = secciones.flatMap(s => s.rows).map((r,i) => `*${i+1}* ${r.title}`).join('\n')
    return enviarMensajeWA(numero, `${cuerpo}\n\n${items}`)
  }
}

export async function enviarBotones(numero, cuerpo, botones) {
  if (NODE_ENV === 'development') {
    const opts = botones.map(b => `[${b.title}]`).join(' ')
    console.log(`\n📱 [BOTONES] → ${numero}\n${cuerpo}\n${opts}\n`)
    return { sid: 'dev' }
  }
  try {
    const c = getClient()
    if (!c) return null
    const content = await c.content.v1.contents.create({
      friendlyName: `botones_${Date.now()}`,
      language: 'es',
      types: {
        'twilio/quick-reply': {
          body: cuerpo,
          actions: botones.map(b => ({ title: b.title.slice(0,20), id: b.id }))
        }
      }
    })
    return await c.messages.create({
      from: fromNumber(),
      to: toNumber(numero),
      contentSid: content.sid
    })
  } catch (err) {
    console.error('Error botones WA:', err.message)
    // Fallback a texto
    const opts = botones.map((b,i) => `*${i+1}* ${b.title}`).join('\n')
    return enviarMensajeWA(numero, `${cuerpo}\n\n${opts}`)
  }
}
