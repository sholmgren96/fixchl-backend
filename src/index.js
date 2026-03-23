import express from 'express'
import cors from 'cors'
import { PORT, PWA_URL, NODE_ENV } from './config.js'
import { initDb } from './db/database.js'

import authRoutes          from './routes/auth.js'
import tecnicoRoutes       from './routes/tecnico.js'
import trabajosRoutes      from './routes/trabajos.js'
import chatRoutes          from './routes/chat.js'
import webhookRoutes       from './routes/webhook.js'
import disponibilidadRoutes from './routes/disponibilidad.js'

const app = express()

app.use(cors({ origin: '*', credentials: true }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api/auth',           authRoutes)
app.use('/api/tecnico',        tecnicoRoutes)
app.use('/api/trabajos',       trabajosRoutes)
app.use('/api/chat',           chatRoutes)
app.use('/api/disponibilidad', disponibilidadRoutes)
app.use('/webhook',            webhookRoutes)

app.get('/health', (_, res) => res.json({ status: 'ok', env: NODE_ENV }))
app.use((req, res) => res.status(404).json({ error: `Ruta ${req.path} no encontrada` }))

initDb()
app.listen(process.env.PORT || PORT, () => {
  console.log(`\n🚀 FixChl Backend corriendo en http://localhost:${process.env.PORT || PORT}`)
  console.log(`   Entorno: ${NODE_ENV}`)
  console.log(`   Webhook WA: http://localhost:${process.env.PORT || PORT}/webhook/whatsapp\n`)
})
