import express from 'express'
import cors from 'cors'
import { PORT, PWA_URL, NODE_ENV } from './config.js'
import { initDb, query } from './db/database.js'

import { checkJobsTimeout } from './services/chatbot.js'
import authRoutes          from './routes/auth.js'
import tecnicoRoutes       from './routes/tecnico.js'
import trabajosRoutes      from './routes/trabajos.js'
import chatRoutes          from './routes/chat.js'
import webhookRoutes       from './routes/webhook.js'
import disponibilidadRoutes from './routes/disponibilidad.js'
import adminRoutes          from './routes/admin.js'

const app = express()

app.use(cors({ origin: '*', credentials: true }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api/auth',           authRoutes)
app.use('/api/tecnico',        tecnicoRoutes)
app.use('/api/trabajos',       trabajosRoutes)
app.use('/api/chat',           chatRoutes)
app.use('/api/disponibilidad', disponibilidadRoutes)
app.use('/api/admin',          adminRoutes)
app.use('/webhook',            webhookRoutes)

app.get('/health', (_, res) => res.json({ status: 'ok', env: NODE_ENV }))

// Endpoint admin: resetear sesión de un número WhatsApp
app.delete('/admin/sesion/:numero', async (req, res) => {
  try {
    const numero = decodeURIComponent(req.params.numero)
    await query('DELETE FROM sesiones_bot WHERE cliente_wa=$1', [numero])
    res.json({ ok: true, mensaje: `Sesión de ${numero} eliminada` })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.use((req, res) => res.status(404).json({ error: `Ruta ${req.path} no encontrada` }))

initDb()

// Verificar cada 10 minutos trabajos sin técnico después de 2h
setInterval(async () => {
  try { await checkJobsTimeout() }
  catch (e) { console.error('Error en timeout check:', e) }
}, 10 * 60 * 1000)

app.listen(process.env.PORT || PORT, () => {
  console.log(`\n🚀 FixChl Backend corriendo en http://localhost:${process.env.PORT || PORT}`)
  console.log(`   Entorno: ${NODE_ENV}`)
  console.log(`   Webhook WA: http://localhost:${process.env.PORT || PORT}/webhook/whatsapp\n`)
})
