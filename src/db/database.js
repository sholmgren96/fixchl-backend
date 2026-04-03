import dns from 'dns'
dns.setDefaultResultOrder('ipv4first')
import pg from 'pg'

const { Pool } = pg

const dbUrl = process.env.DATABASE_URL
console.log('DB_URL presente:', !!dbUrl, dbUrl ? dbUrl.substring(0,40) : 'VACIA')
if (!dbUrl) { console.error('ERROR: DATABASE_URL no definida'); process.exit(1) }

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
})

export async function query(sql, params = []) {
  const client = await pool.connect()
  try {
    const res = await client.query(sql, params)
    return res
  } finally {
    client.release()
  }
}

const DURACION = {
  'Gasfiter': 2, 'Electricista': 2, 'Pintor': 4,
  'Servicio de aseo': 3, 'Maestro general': 3, 'Otro': 2,
}

function horasARangos(horas) {
  if (!horas.length) return []
  const sorted = [...horas].map(h => parseInt(h)).sort((a, b) => a - b)
  const rangos = []
  let inicio = sorted[0]
  let prev   = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) { prev = sorted[i] }
    else {
      rangos.push({ hora_inicio: `${String(inicio).padStart(2,'0')}:00`, hora_fin: `${String(prev + 1).padStart(2,'0')}:00` })
      inicio = sorted[i]; prev = sorted[i]
    }
  }
  rangos.push({ hora_inicio: `${String(inicio).padStart(2,'0')}:00`, hora_fin: `${String(prev + 1).padStart(2,'0')}:00` })
  return rangos
}

function formatFecha(fecha) {
  const d = new Date(fecha + 'T12:00:00')
  const dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`
}

export const db = {

  // ── TÉCNICOS ───────────────────────────────────────────────────────────────
  async getTecnico(id) {
    const r = await query('SELECT * FROM tecnicos WHERE id=$1', [id])
    return r.rows[0] || null
  },

  async getTecnicoByTelefono(tel) {
    const r = await query('SELECT * FROM tecnicos WHERE telefono=$1', [tel])
    return r.rows[0] || null
  },

  async getTecnicoByRutOrTelefono(rut, tel) {
    const r = await query('SELECT * FROM tecnicos WHERE rut=$1 OR telefono=$2', [rut, tel])
    return r.rows[0] || null
  },

  async createTecnico({ nombre, rut, telefono, password }) {
    const r = await query(
      'INSERT INTO tecnicos (nombre,rut,telefono,password) VALUES ($1,$2,$3,$4) RETURNING *',
      [nombre, rut, telefono, password]
    )
    return r.rows[0]
  },

  async updateTecnicoDisponible(id, disponible) {
    await query('UPDATE tecnicos SET disponible=$1 WHERE id=$2', [disponible, id])
  },

  async updateTecnicoRating(id, rating, totalReviews) {
    await query('UPDATE tecnicos SET rating=$1, total_reviews=$2 WHERE id=$3', [rating, totalReviews, id])
  },

  // ── COMUNAS ────────────────────────────────────────────────────────────────
  async getComunas(id) {
    const r = await query('SELECT comuna FROM tecnico_comunas WHERE tecnico_id=$1', [id])
    return r.rows.map(r => r.comuna)
  },

  async addComuna(tecnicoId, comuna) {
    await query('INSERT INTO tecnico_comunas (tecnico_id,comuna) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tecnicoId, comuna])
  },

  async deleteComuna(tecnicoId, comuna) {
    await query('DELETE FROM tecnico_comunas WHERE tecnico_id=$1 AND comuna=$2', [tecnicoId, comuna])
  },

  // ── CATEGORÍAS ─────────────────────────────────────────────────────────────
  async getCategorias(id) {
    const r = await query('SELECT categoria FROM tecnico_categorias WHERE tecnico_id=$1', [id])
    return r.rows.map(r => r.categoria)
  },

  async addCategoria(tecnicoId, categoria) {
    await query('INSERT INTO tecnico_categorias (tecnico_id,categoria) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tecnicoId, categoria])
  },

  async deleteCategoria(tecnicoId, categoria) {
    await query('DELETE FROM tecnico_categorias WHERE tecnico_id=$1 AND categoria=$2', [tecnicoId, categoria])
  },

  // ── TRABAJOS ───────────────────────────────────────────────────────────────
  async getTrabajo(id) {
    const r = await query('SELECT * FROM trabajos WHERE id=$1', [id])
    return r.rows[0] || null
  },

  async createTrabajo({ cliente_nombre, cliente_wa, categoria, descripcion, comuna, urgencia, fecha_agendada=null, hora_agendada=null }) {
    const r = await query(
      `INSERT INTO trabajos (cliente_nombre,cliente_wa,categoria,descripcion,comuna,urgencia,fecha_agendada,hora_agendada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [cliente_nombre, cliente_wa, categoria, descripcion, comuna, urgencia, fecha_agendada, hora_agendada]
    )
    return r.rows[0]
  },

  async getTrabajosdisponibles(comunas) {
    const r = await query(
      `SELECT * FROM trabajos WHERE estado='buscando' AND comuna=ANY($1) ORDER BY urgencia DESC, created_at DESC`,
      [comunas]
    )
    return r.rows
  },

  async getMisTrabajos(tecnicoId) {
    const r = await query(
      `SELECT * FROM trabajos WHERE tecnico_id=$1 AND estado IN ('activo','esperando_calificacion') ORDER BY accepted_at DESC`,
      [tecnicoId]
    )
    return r.rows
  },

  async aceptarTrabajo(id, tecnicoId, fecha = null, hora = null) {
    if (fecha && hora) {
      await query('UPDATE trabajos SET fecha_agendada=$1, hora_agendada=$2 WHERE id=$3', [fecha, hora, id])
    }
    const r = await query(
      `UPDATE trabajos SET estado='activo', tecnico_id=$1, accepted_at=NOW() WHERE id=$2 AND estado='buscando' RETURNING *`,
      [tecnicoId, id]
    )
    if (!r.rows[0]) return null
    const t = r.rows[0]
    if (t.fecha_agendada && t.hora_agendada) {
      const duracion = DURACION[t.categoria] || 2
      await this.bloquearHorario(tecnicoId, t.fecha_agendada, t.hora_agendada, duracion, id)
    }
    return t
  },

  async completarTrabajo(id, tecnicoId) {
    const r = await query(
      `UPDATE trabajos SET estado='esperando_calificacion', completed_at=NOW() WHERE id=$1 AND tecnico_id=$2 AND estado='activo' RETURNING id`,
      [id, tecnicoId]
    )
    return !!r.rows[0]
  },

  async updateTrabajoEstado(id, estado) {
    await query('UPDATE trabajos SET estado=$1 WHERE id=$2', [estado, id])
  },

  async updateTrabajoTecnico(id, tecnicoId) {
    await query('UPDATE trabajos SET tecnico_id=$1, accepted_at=NOW() WHERE id=$2', [tecnicoId, id])
  },

  // ── MENSAJES ───────────────────────────────────────────────────────────────
  async getMensajes(trabajoId) {
    const r = await query('SELECT * FROM mensajes WHERE trabajo_id=$1 ORDER BY created_at ASC', [trabajoId])
    return r.rows
  },

  async createMensaje(trabajoId, origen, contenido) {
    const r = await query(
      'INSERT INTO mensajes (trabajo_id,origen,contenido) VALUES ($1,$2,$3) RETURNING *',
      [trabajoId, origen, contenido]
    )
    return r.rows[0]
  },

  async marcarLeidos(trabajoId) {
    await query(`UPDATE mensajes SET leido=true WHERE trabajo_id=$1 AND origen='cliente' AND leido=false`, [trabajoId])
  },

  async countNoLeidos(trabajoId) {
    const r = await query(`SELECT COUNT(*) FROM mensajes WHERE trabajo_id=$1 AND origen='cliente' AND leido=false`, [trabajoId])
    return parseInt(r.rows[0].count)
  },

  // ── CALIFICACIONES ─────────────────────────────────────────────────────────
  async createCalificacion(trabajoId, tecnicoId, puntaje, comentario=null) {
    try {
      await query(
        'INSERT INTO calificaciones (trabajo_id,tecnico_id,puntaje,comentario) VALUES ($1,$2,$3,$4)',
        [trabajoId, tecnicoId, puntaje, comentario]
      )
      return true
    } catch { return false }
  },

  async getCalificacionesTecnico(tecnicoId) {
    const r = await query(
      `SELECT c.*, t.cliente_nombre, t.categoria, t.comuna FROM calificaciones c
       JOIN trabajos t ON t.id=c.trabajo_id WHERE c.tecnico_id=$1 ORDER BY c.created_at DESC LIMIT 20`,
      [tecnicoId]
    )
    return r.rows
  },

  async getRatingStats(tecnicoId) {
    const r = await query(
      'SELECT AVG(puntaje) as avg, COUNT(*) as total FROM calificaciones WHERE tecnico_id=$1',
      [tecnicoId]
    )
    return { avg: Math.round((r.rows[0].avg || 0) * 10) / 10, total: parseInt(r.rows[0].total) }
  },

  // ── SESIONES BOT ───────────────────────────────────────────────────────────
  async getSesion(wa) {
    const r = await query('SELECT * FROM sesiones_bot WHERE cliente_wa=$1', [wa])
    return r.rows[0] || null
  },

  async upsertSesion(clienteWa, estado, datos, trabajoId=null) {
    await query(
      `INSERT INTO sesiones_bot (cliente_wa,estado,datos_temp,trabajo_id,updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (cliente_wa) DO UPDATE SET
         estado=EXCLUDED.estado, datos_temp=EXCLUDED.datos_temp,
         trabajo_id=COALESCE(EXCLUDED.trabajo_id, sesiones_bot.trabajo_id),
         updated_at=NOW()`,
      [clienteWa, estado, JSON.stringify(datos), trabajoId]
    )
  },

  // ── MATCHING ───────────────────────────────────────────────────────────────
  async buscarTecnicos(categoria, comuna) {
    const r = await query(
      `SELECT t.id, t.nombre, t.rating, t.total_jobs FROM tecnicos t
       JOIN tecnico_categorias tc ON tc.tecnico_id=t.id AND tc.categoria=$1
       JOIN tecnico_comunas cm ON cm.tecnico_id=t.id AND cm.comuna=$2
       WHERE t.disponible=true ORDER BY t.rating DESC LIMIT 3`,
      [categoria, comuna]
    )
    return r.rows
  },

  // ── DISPONIBILIDAD ─────────────────────────────────────────────────────────
  async setDisponibilidadSemana(tecnicoId, bloques) {
    await query('DELETE FROM disponibilidad WHERE tecnico_id=$1 AND fecha>=CURRENT_DATE', [tecnicoId])
    for (const b of bloques) {
      await query(
        'INSERT INTO disponibilidad (tecnico_id,fecha,hora_inicio,hora_fin) VALUES ($1,$2,$3,$4)',
        [tecnicoId, b.fecha, b.hora_inicio, b.hora_fin]
      )
    }
  },

  async setDisponibilidadFecha(tecnicoId, fecha, horas) {
    await query('DELETE FROM disponibilidad WHERE tecnico_id=$1 AND fecha=$2', [tecnicoId, fecha])
    if (!horas.length) return
    const rangos = horasARangos(horas)
    for (const r of rangos) {
      await query(
        'INSERT INTO disponibilidad (tecnico_id, fecha, hora_inicio, hora_fin) VALUES ($1, $2, $3, $4)',
        [tecnicoId, fecha, r.hora_inicio, r.hora_fin]
      )
    }
  },

  async getBloquesOcupados(tecnicoId) {
    const r = await query(
      `SELECT b.fecha, b.hora_inicio, b.hora_fin, t.categoria, t.cliente_nombre
       FROM bloques_ocupados b
       LEFT JOIN trabajos t ON t.id = b.trabajo_id
       WHERE b.tecnico_id=$1 AND b.fecha >= CURRENT_DATE
       ORDER BY b.fecha, b.hora_inicio`,
      [tecnicoId]
    )
    return r.rows.map(row => ({
      ...row,
      fecha: typeof row.fecha === 'string' ? row.fecha : row.fecha.toISOString().split('T')[0]
    }))
  },

  async getDisponibilidadTecnico(tecnicoId) {
    const r = await query(
      'SELECT * FROM disponibilidad WHERE tecnico_id=$1 AND fecha>=CURRENT_DATE ORDER BY fecha, hora_inicio',
      [tecnicoId]
    )
    return r.rows.map(row => ({
      ...row,
      fecha: typeof row.fecha === 'string' ? row.fecha : row.fecha.toISOString().split('T')[0]
    }))
  },

  // ── FECHAS PROPUESTAS ─────────────────────────────────────────────────────
  async createFechasPropuestas(trabajoId, fechas) {
    for (const f of fechas) {
      await query(
        'INSERT INTO trabajo_fechas_propuestas (trabajo_id, fecha, hora) VALUES ($1, $2, $3)',
        [trabajoId, f.fecha, f.hora]
      )
    }
  },

  async getFechasPropuestas(trabajoId) {
    const r = await query(
      'SELECT fecha, hora FROM trabajo_fechas_propuestas WHERE trabajo_id=$1 ORDER BY fecha, hora',
      [trabajoId]
    )
    return r.rows.map(row => ({
      fecha: typeof row.fecha === 'string' ? row.fecha : row.fecha.toISOString().split('T')[0],
      hora: row.hora,
      label: `${formatFecha(typeof row.fecha === 'string' ? row.fecha : row.fecha.toISOString().split('T')[0])} ${row.hora}`
    }))
  },

  async buscarTecnicosPorFechas(categoria, comuna, fechas) {
    const duracion = DURACION[categoria] || 2
    const tecnicosMap = new Map()
    for (const fp of fechas) {
      const hora = fp.hora
      const [h] = hora.split(':').map(Number)
      const horaFin = `${String(h + duracion).padStart(2, '0')}:00`
      const r = await query(
        `SELECT DISTINCT t.id, t.nombre, t.rating, t.total_jobs
         FROM tecnicos t
         JOIN tecnico_categorias tc ON tc.tecnico_id=t.id AND tc.categoria=$1
         JOIN tecnico_comunas cm ON cm.tecnico_id=t.id AND cm.comuna=$2
         JOIN disponibilidad d ON d.tecnico_id=t.id
           AND d.fecha=$3
           AND d.hora_inicio::time <= $4::time
           AND d.hora_fin::time >= $5::time
         WHERE NOT EXISTS (
           SELECT 1 FROM bloques_ocupados bo
           WHERE bo.tecnico_id=t.id AND bo.fecha=$3
           AND bo.hora_inicio::time < $5::time
           AND bo.hora_fin::time > $4::time
         )`,
        [categoria, comuna, fp.fecha, hora, horaFin]
      )
      for (const row of r.rows) {
        if (!tecnicosMap.has(row.id)) tecnicosMap.set(row.id, row)
      }
    }
    return Array.from(tecnicosMap.values())
  },

  async getTrabajosPendientesNotificacion() {
    const r = await query(
      `SELECT * FROM trabajos
       WHERE estado='buscando'
       AND sin_tecnico_notificado=false
       AND created_at < NOW() - INTERVAL '2 hours'`
    )
    return r.rows
  },

  async marcarNotificado(id) {
    await query('UPDATE trabajos SET sin_tecnico_notificado=true WHERE id=$1', [id])
  },

  async bloquearHorario(tecnicoId, fecha, horaInicio, duracionHoras, trabajoId) {
    const [h, m] = horaInicio.split(':').map(Number)
    const fin = new Date(2000, 0, 1, h + duracionHoras, m)
    const horaFin = `${String(fin.getHours()).padStart(2,'0')}:${String(fin.getMinutes()).padStart(2,'0')}`
    await query(
      'INSERT INTO bloques_ocupados (tecnico_id,trabajo_id,fecha,hora_inicio,hora_fin) VALUES ($1,$2,$3,$4,$5)',
      [tecnicoId, trabajoId, fecha, horaInicio, horaFin]
    )
  },

  async buscarSlotsDisponibles(categoria, comuna, limite=5) {
    const r = await query(
      `SELECT t.id, t.nombre, t.rating, d.fecha, d.hora_inicio, d.hora_fin
       FROM tecnicos t
       JOIN tecnico_categorias tc ON tc.tecnico_id=t.id AND tc.categoria=$1
       JOIN tecnico_comunas cm ON cm.tecnico_id=t.id AND cm.comuna=$2
       JOIN disponibilidad d ON d.tecnico_id=t.id AND d.fecha>=CURRENT_DATE
       ORDER BY d.fecha, d.hora_inicio`,
      [categoria, comuna]
    )

    const duracion = DURACION[categoria] || 2
    const slots = []

    for (const row of r.rows) {
      const bloques = await query(
        'SELECT hora_inicio, hora_fin FROM bloques_ocupados WHERE tecnico_id=$1 AND fecha=$2',
        [row.id, row.fecha]
      )
      const [hIni] = row.hora_inicio.split(':').map(Number)
      const [hFin] = row.hora_fin.split(':').map(Number)

      for (let h = hIni; h <= hFin - duracion; h++) {
        const horaSlot = `${String(h).padStart(2,'0')}:00`
        const horaSlotFin = `${String(h + duracion).padStart(2,'0')}:00`
        const ocupado = bloques.rows.some(b => !(horaSlotFin <= b.hora_inicio || horaSlot >= b.hora_fin))
        if (!ocupado) {
          const fechaStr = typeof row.fecha === 'string' ? row.fecha : row.fecha.toISOString().split('T')[0]
          slots.push({
            tecnico_id: row.id,
            tecnico_nombre: row.nombre,
            tecnico_rating: row.rating,
            fecha: fechaStr,
            hora_inicio: horaSlot,
            hora_fin: horaSlotFin,
            label: `${formatFecha(fechaStr)} ${horaSlot} — ${row.nombre}`
          })
        }
      }
      if (slots.length >= limite) break
    }
    return slots.slice(0, limite)
  },
}

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS tecnicos (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      rut TEXT UNIQUE NOT NULL,
      telefono TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      foto_url TEXT,
      verificado BOOLEAN DEFAULT false,
      disponible BOOLEAN DEFAULT true,
      rating REAL DEFAULT 0,
      total_jobs INTEGER DEFAULT 0,
      total_reviews INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tecnico_comunas (
      id SERIAL PRIMARY KEY,
      tecnico_id INTEGER REFERENCES tecnicos(id) ON DELETE CASCADE,
      comuna TEXT NOT NULL,
      UNIQUE(tecnico_id, comuna)
    );
    CREATE TABLE IF NOT EXISTS tecnico_categorias (
      id SERIAL PRIMARY KEY,
      tecnico_id INTEGER REFERENCES tecnicos(id) ON DELETE CASCADE,
      categoria TEXT NOT NULL,
      UNIQUE(tecnico_id, categoria)
    );
    CREATE TABLE IF NOT EXISTS trabajos (
      id SERIAL PRIMARY KEY,
      cliente_nombre TEXT NOT NULL,
      cliente_wa TEXT NOT NULL,
      categoria TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      comuna TEXT NOT NULL,
      urgencia TEXT NOT NULL,
      fecha_agendada DATE,
      hora_agendada TEXT,
      estado TEXT DEFAULT 'buscando',
      tecnico_id INTEGER REFERENCES tecnicos(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      accepted_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS mensajes (
      id SERIAL PRIMARY KEY,
      trabajo_id INTEGER REFERENCES trabajos(id) ON DELETE CASCADE,
      origen TEXT NOT NULL,
      contenido TEXT NOT NULL,
      leido BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS calificaciones (
      id SERIAL PRIMARY KEY,
      trabajo_id INTEGER UNIQUE REFERENCES trabajos(id),
      tecnico_id INTEGER REFERENCES tecnicos(id),
      puntaje INTEGER NOT NULL,
      comentario TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sesiones_bot (
      id SERIAL PRIMARY KEY,
      cliente_wa TEXT UNIQUE NOT NULL,
      estado TEXT NOT NULL DEFAULT 'inicio',
      datos_temp TEXT,
      trabajo_id INTEGER REFERENCES trabajos(id),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS disponibilidad (
      id SERIAL PRIMARY KEY,
      tecnico_id INTEGER REFERENCES tecnicos(id) ON DELETE CASCADE,
      fecha DATE NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fin TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bloques_ocupados (
      id SERIAL PRIMARY KEY,
      tecnico_id INTEGER REFERENCES tecnicos(id) ON DELETE CASCADE,
      trabajo_id INTEGER REFERENCES trabajos(id),
      fecha DATE NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fin TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS trabajo_fechas_propuestas (
      id SERIAL PRIMARY KEY,
      trabajo_id INTEGER REFERENCES trabajos(id) ON DELETE CASCADE,
      fecha DATE NOT NULL,
      hora TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE trabajos ADD COLUMN IF NOT EXISTS sin_tecnico_notificado BOOLEAN DEFAULT false;
  `)
  console.log('✅ Base de datos PostgreSQL lista')
}

export function getDb() { return db }
