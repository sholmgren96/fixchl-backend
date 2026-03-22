import { Router } from 'express'
import { procesarMensaje } from '../services/chatbot.js'

const router = Router()

router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200)
  const numero = req.body.From
  const texto  = req.body.Body
  console.log('📩 Mensaje recibido:', numero, '->', texto)
  if (!numero || !texto) {
    console.log('⚠️ Mensaje sin número o texto')
    return
  }
  try {
    await procesarMensaje(numero, texto)
  } catch (err) {
    console.error('❌ Error en chatbot:', err)
  }
})

export default router
