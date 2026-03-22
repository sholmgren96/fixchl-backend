import { Router } from 'express'
import { procesarMensaje } from '../services/chatbot.js'

const router = Router()

/**
 * POST /webhook/whatsapp
 * Twilio llama a este endpoint cada vez que el cliente envía un mensaje.
 * Debe responder con 200 rápido — el procesamiento es asíncrono.
 */
router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200) // Responder rápido para que Twilio no haga retry

  const numero = req.body.From   // ej: whatsapp:+56987654321
  const texto  = req.body.Body   // texto del mensaje

  if (!numero || !texto) return

  try {
    await procesarMensaje(numero, texto)
  } catch (err) {
    console.error('Error en chatbot:', err)
  }
})

export default router
