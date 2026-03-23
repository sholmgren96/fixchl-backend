import fs from 'fs'

const DB_FILE = './fixchl-data.json'

const EMPTY_DB = {
  tecnicos: [], tecnico_comunas: [], tecnico_categorias: [],
  trabajos: [], mensajes: [], calificaciones: [], sesiones_bot: [],
  disponibilidad: [], bloques_ocupados: [],
  _counters: { tecnicos: 0, trabajos: 0, mensajes: 0, calificaciones: 0, sesiones_bot: 0, disponibilidad: 0, bloques: 0 }
}

function loadDb() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2))
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  // Migrar si faltan tablas nuevas
  if (!data.disponibilidad) data.disponibilidad = []
  if (!data.bloques_ocupados) data.bloques_ocupados = []
  if (!data._counters.disponibilidad) data._counters.disponibilidad = 0
  if (!data._counters.bloques) data._counters.bloques = 0
  return data
}

function saveDb(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)) }

function nextId(data, table) {
  data._counters[table] = (data._counters[table] || 0) + 1
  return data._counters[table]
}

function now() { return new Date().toISOString() }

// Duración estimada en horas por categoría
const DURACION_POR_CATEGORIA = {
  'Gasfiter': 2,
  'Electricista': 2,
  'Pintor': 4,
  'Servicio de aseo': 3,
  'Maestro general': 3,
  'Otro': 2,
}

export const db = {
  getTecnico: (id) => loadDb().tecnicos.find(t => t.id === id) || null,
  getTecnicoByTelefono: (tel) => loadDb().tecnicos.find(t => t.telefono === tel) || null,
  getTecnicoByRutOrTelefono: (rut, tel) => loadDb().tecnicos.find(t => t.rut === rut || t.telefono === tel) || null,

  createTecnico({ nombre, rut, telefono, password }) {
    const data = loadDb()
    const id = nextId(data, 'tecnicos')
    const tecnico = { id, nombre, rut, telefono, password, foto_url: null, verificado: 0, disponible: 1, rating: 0, total_jobs: 0, total_reviews: 0, created_at: now() }
    data.tecnicos.push(tecnico)
    saveDb(data)
    return tecnico
  },

  updateTecnicoDisponible(id, disponible) {
    const data = loadDb()
    const t = data.tecnicos.find(t => t.id === id)
    if (t) { t.disponible = disponible ? 1 : 0; saveDb(data) }
  },

  updateTecnicoRating(id, rating, totalReviews) {
    const data = loadDb()
    const t = data.tecnicos.find(t => t.id === id)
    if (t) { t.rating = rating; t.total_reviews = totalReviews; saveDb(data) }
  },

  getComunas: (id) => loadDb().tecnico_comunas.filter(c => c.tecnico_id === id).map(c => c.comuna),

  addComuna(tecnicoId, comuna) {
    const data = loadDb()
    if (data.tecnico_comunas.find(c => c.tecnico_id === tecnicoId && c.comuna === comuna)) throw new Error('Duplicado')
    data.tecnico_comunas.push({ tecnico_id: tecnicoId, comuna })
    saveDb(data)
  },

  deleteComuna(tecnicoId, comuna) {
    const data = loadDb()
    data.tecnico_comunas = data.tecnico_comunas.filter(c => !(c.tecnico_id === tecnicoId && c.comuna === comuna))
    saveDb(data)
  },

  getCategorias: (id) => loadDb().tecnico_categorias.filter(c => c.tecnico_id === id).map(c => c.categoria),

  addCategoria(tecnicoId, categoria) {
    const data = loadDb()
    if (data.tecnico_categorias.find(c => c.tecnico_id === tecnicoId && c.categoria === categoria)) throw new Error('Duplicado')
    data.tecnico_categorias.push({ tecnico_id: tecnicoId, categoria })
    saveDb(data)
  },

  deleteCategoria(tecnicoId, categoria) {
    const data = loadDb()
    data.tecnico_categorias = data.tecnico_categorias.filter(c => !(c.tecnico_id === tecnicoId && c.categoria === categoria))
    saveDb(data)
  },

  getTrabajo: (id) => loadDb().trabajos.find(t => t.id === id) || null,

  createTrabajo({ cliente_nombre, cliente_wa, categoria, descripcion, comuna, urgencia, fecha_agendada = null, hora_agendada = null }) {
    const data = loadDb()
    const id = nextId(data, 'trabajos')
    const trabajo = { id, cliente_nombre, cliente_wa, categoria, descripcion, comuna, urgencia, fecha_agendada, hora_agendada, estado: 'buscando', tecnico_id: null, created_at: now(), accepted_at: null, completed_at: null }
    data.trabajos.push(trabajo)
    saveDb(data)
    return trabajo
  },

  getTrabajosdisponibles(comunas) {
    return loadDb().trabajos
      .filter(t => t.estado === 'buscando' && comunas.includes(t.comuna))
      .sort((a, b) => (a.urgencia === 'Hoy mismo' ? -1 : 1))
  },

  getMisTrabajos: (tecnicoId) => loadDb().trabajos.filter(t => t.tecnico_id === tecnicoId && ['activo','esperando_calificacion'].includes(t.estado)),

  aceptarTrabajo(id, tecnicoId) {
    const data = loadDb()
    const t = data.trabajos.find(t => t.id === id && t.estado === 'buscando')
    if (!t) return false
    t.estado = 'activo'; t.tecnico_id = tecnicoId; t.accepted_at = now()
    saveDb(data)
    // Bloquear el horario si tiene fecha agendada
    if (t.fecha_agendada && t.hora_agendada) {
      const duracion = DURACION_POR_CATEGORIA[t.categoria] || 2
      this.bloquearHorario(tecnicoId, t.fecha_agendada, t.hora_agendada, duracion, id)
    }
    return true
  },

  completarTrabajo(id, tecnicoId) {
    const data = loadDb()
    const t = data.trabajos.find(t => t.id === id && t.tecnico_id === tecnicoId && t.estado === 'activo')
    if (!t) return false
    t.estado = 'esperando_calificacion'; t.completed_at = now()
    saveDb(data); return true
  },

  updateTrabajoEstado(id, estado) {
    const data = loadDb()
    const t = data.trabajos.find(t => t.id === id)
    if (t) { t.estado = estado; saveDb(data) }
  },

  updateTrabajoTecnico(id, tecnicoId) {
    const data = loadDb()
    const t = data.trabajos.find(t => t.id === id)
    if (t) { t.tecnico_id = tecnicoId; t.accepted_at = now(); saveDb(data) }
  },

  getMensajes: (trabajoId) => loadDb().mensajes.filter(m => m.trabajo_id === trabajoId).sort((a,b) => new Date(a.created_at) - new Date(b.created_at)),

  createMensaje(trabajoId, origen, contenido) {
    const data = loadDb()
    const id = nextId(data, 'mensajes')
    const msg = { id, trabajo_id: trabajoId, origen, contenido, leido: 0, created_at: now() }
    data.mensajes.push(msg); saveDb(data); return msg
  },

  marcarLeidos(trabajoId) {
    const data = loadDb()
    data.mensajes.forEach(m => { if (m.trabajo_id === trabajoId && m.origen === 'cliente') m.leido = 1 })
    saveDb(data)
  },

  countNoLeidos: (trabajoId) => loadDb().mensajes.filter(m => m.trabajo_id === trabajoId && m.origen === 'cliente' && m.leido === 0).length,

  createCalificacion(trabajoId, tecnicoId, puntaje, comentario = null) {
    const data = loadDb()
    if (data.calificaciones.find(c => c.trabajo_id === trabajoId)) return false
    data.calificaciones.push({ trabajo_id: trabajoId, tecnico_id: tecnicoId, puntaje, comentario, created_at: now() })
    saveDb(data); return true
  },

  getCalificacionesTecnico(tecnicoId) {
    const data = loadDb()
    return data.calificaciones.filter(c => c.tecnico_id === tecnicoId)
      .map(c => { const t = data.trabajos.find(t => t.id === c.trabajo_id); return { ...c, cliente_nombre: t?.cliente_nombre, categoria: t?.categoria, comuna: t?.comuna } })
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20)
  },

  getRatingStats(tecnicoId) {
    const cals = loadDb().calificaciones.filter(c => c.tecnico_id === tecnicoId)
    if (!cals.length) return { avg: 0, total: 0 }
    return { avg: Math.round(cals.reduce((s,c) => s + c.puntaje, 0) / cals.length * 10) / 10, total: cals.length }
  },

  getSesion: (wa) => loadDb().sesiones_bot.find(s => s.cliente_wa === wa) || null,

  upsertSesion(clienteWa, estado, datos, trabajoId = null) {
    const data = loadDb()
    let s = data.sesiones_bot.find(s => s.cliente_wa === clienteWa)
    if (s) {
      s.estado = estado; s.datos_temp = JSON.stringify(datos)
      if (trabajoId !== null) s.trabajo_id = trabajoId
      s.updated_at = now()
    } else {
      data.sesiones_bot.push({ id: nextId(data, 'sesiones_bot'), cliente_wa: clienteWa, estado, datos_temp: JSON.stringify(datos), trabajo_id: trabajoId, updated_at: now() })
    }
    saveDb(data)
  },

  buscarTecnicos(categoria, comuna) {
    const data = loadDb()
    return data.tecnicos.filter(t => {
      if (!t.disponible) return false
      return data.tecnico_categorias.some(c => c.tecnico_id === t.id && c.categoria === categoria)
          && data.tecnico_comunas.some(c => c.tecnico_id === t.id && c.comuna === comuna)
    }).sort((a,b) => b.rating - a.rating).slice(0, 3)
  },

  // ── DISPONIBILIDAD ────────────────────────────────────────────────────────

  // Guarda bloques de disponibilidad semanal: [{fecha, hora_inicio, hora_fin}]
  setDisponibilidadSemana(tecnicoId, bloques) {
    const data = loadDb()
    // Elimina disponibilidad futura del técnico
    const hoy = new Date().toISOString().split('T')[0]
    data.disponibilidad = data.disponibilidad.filter(d => d.tecnico_id !== tecnicoId || d.fecha < hoy)
    // Agrega nuevos bloques
    bloques.forEach(b => {
      data.disponibilidad.push({
        id: nextId(data, 'disponibilidad'),
        tecnico_id: tecnicoId,
        fecha: b.fecha,
        hora_inicio: b.hora_inicio,
        hora_fin: b.hora_fin,
        created_at: now()
      })
    })
    saveDb(data)
  },

  getDisponibilidadTecnico(tecnicoId) {
    const hoy = new Date().toISOString().split('T')[0]
    return loadDb().disponibilidad
      .filter(d => d.tecnico_id === tecnicoId && d.fecha >= hoy)
      .sort((a,b) => a.fecha.localeCompare(b.fecha) || a.hora_inicio.localeCompare(b.hora_inicio))
  },

  // Bloquea un horario cuando se acepta un trabajo
  bloquearHorario(tecnicoId, fecha, horaInicio, duracionHoras, trabajoId) {
    const data = loadDb()
    const [h, m] = horaInicio.split(':').map(Number)
    const fin = new Date(2000, 0, 1, h + duracionHoras, m)
    const horaFin = `${String(fin.getHours()).padStart(2,'0')}:${String(fin.getMinutes()).padStart(2,'0')}`
    data.bloques_ocupados.push({
      id: nextId(data, 'bloques'),
      tecnico_id: tecnicoId,
      trabajo_id: trabajoId,
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      created_at: now()
    })
    saveDb(data)
  },

  // Busca slots disponibles en los próximos 7 días para una categoría y comuna
  buscarSlotsDisponibles(categoria, comuna, limite = 5) {
    const data = loadDb()
    const hoy = new Date()
    const horaActual = `${String(hoy.getHours()).padStart(2,'0')}:${String(hoy.getMinutes()).padStart(2,'0')}`
    const fechaHoy = hoy.toISOString().split('T')[0]
    const duracion = DURACION_POR_CATEGORIA[categoria] || 2

    // Técnicos que tienen esa categoría y comuna
    const tecnicos = data.tecnicos.filter(t =>
      data.tecnico_categorias.some(c => c.tecnico_id === t.id && c.categoria === categoria) &&
      data.tecnico_comunas.some(c => c.tecnico_id === t.id && c.comuna === comuna)
    )

    const slots = []

    tecnicos.forEach(tecnico => {
      // Disponibilidad declarada del técnico
      const disponibilidad = data.disponibilidad.filter(d =>
        d.tecnico_id === tecnico.id && d.fecha >= fechaHoy
      )

      disponibilidad.forEach(disp => {
        // Bloques ya ocupados ese día
        const bloques = data.bloques_ocupados.filter(b =>
          b.tecnico_id === tecnico.id && b.fecha === disp.fecha
        )

        // Generar slots de 1 hora dentro del bloque disponible
        const [hIni] = disp.hora_inicio.split(':').map(Number)
        const [hFin] = disp.hora_fin.split(':').map(Number)

        for (let h = hIni; h <= hFin - duracion; h++) {
          const horaSlot = `${String(h).padStart(2,'0')}:00`
          const horaSlotFin = `${String(h + duracion).padStart(2,'0')}:00`

          // Saltar slots pasados de hoy
          if (disp.fecha === fechaHoy && horaSlot <= horaActual) continue

          // Verificar que no esté ocupado
          const ocupado = bloques.some(b => !(horaSlotFin <= b.hora_inicio || horaSlot >= b.hora_fin))
          if (!ocupado) {
            slots.push({
              tecnico_id: tecnico.id,
              tecnico_nombre: tecnico.nombre,
              tecnico_rating: tecnico.rating,
              fecha: disp.fecha,
              hora_inicio: horaSlot,
              hora_fin: horaSlotFin,
              label: `${formatFecha(disp.fecha)} ${horaSlot} — ${tecnico.nombre}`
            })
          }
        }
      })
    })

    // Ordenar por fecha y hora, limitar resultados
    return slots
      .sort((a,b) => a.fecha.localeCompare(b.fecha) || a.hora_inicio.localeCompare(b.hora_inicio))
      .slice(0, limite)
  },
}

function formatFecha(fecha) {
  const d = new Date(fecha + 'T12:00:00')
  const dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  return `${dias[d.getDay()]} ${d.getDate()} ${meses[d.getMonth()]}`
}

export function initDb() { loadDb(); console.log('✅ Base de datos lista en fixchl-data.json') }
export function getDb() { return db }
