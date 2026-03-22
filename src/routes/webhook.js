import { Router } from 'express'
import { procesarMensaje } from '../services/chatbot.js'

const router = Router()

router.post('/whatsapp', async (req, res) => {
  res.set('Content-Type', 'text/xml')
  res.send('<Response></Response>')

  const numero = req.body.From
  const texto  = req.body.Body
  console.log('📩 Mensaje recibido:', numero, '->', texto)
  if (!numero || !texto) return
  try {
    await procesarMensaje(numero, texto)
  } catch (err) {
    console.error('❌ Error en chatbot:', err)
  }
})

export default router