import express from 'express'
import cors from 'cors'
import { PORT, PWA_URL, NODE_ENV } from './config.js'
import { initDb } from './db/database.js'

import authRoutes    from './routes/auth.js'
import tecnicoRoutes from './routes/tecnico.js'
import trabajosRoutes from './routes/trabajos.js'
import chatRoutes    from './routes/chat.js'
import webhookRoutes from './routes/webhook.js'

const app = express()

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  credentials: true,
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true })) // necesario para webhook de Twilio

// ── Rutas ───────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes)
app.use('/api/tecnico',  tecnicoRoutes)
app.use('/api/trabajos', trabajosRoutes)
app.use('/api/chat',     chatRoutes)
app.use('/webhook',      webhookRoutes)

// ── Health check ────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', env: NODE_ENV }))

// ── 404 ─────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Ruta ${req.path} no encontrada` }))

// ── Iniciar ─────────────────────────────────────────────────────────────────
initDb()
app.listen(PORT, () => {
  console.log(`\n🚀 FixChl Backend corriendo en http://localhost:${PORT}`)
  console.log(`   Entorno: ${NODE_ENV}`)
  console.log(`   Webhook WA: http://localhost:${PORT}/webhook/whatsapp\n`)
})
