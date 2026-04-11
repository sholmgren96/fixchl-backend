# TecnicosYa — Backend

## Descripción del proyecto
TecnicosYa es una plataforma chilena que conecta clientes con técnicos de hogar (electricista, gasfiter, pintor, servicio de aseo, maestro general) en Santiago. El cliente interactúa via WhatsApp con un chatbot automatizado. El técnico gestiona sus trabajos desde una PWA (app web progresiva).

## Infraestructura
- **Backend**: Node.js + Express, desplegado en Railway
- **URL producción**: https://fixchl-backend-production-bda3.up.railway.app
- **Base de datos**: PostgreSQL en Supabase (proyecto ID: wjvdmnbbjsqgfgczlfvc)
- **Conexión DB**: Usar SIEMPRE el pooler URL, NUNCA la conexión directa (Railway no tiene IPv6)
- **PWA técnico**: React en Vercel — https://tecnicosya.vercel.app
- **WhatsApp**: Twilio, número +15559319840 (TecnicosYa), sandbox +14155238886
- **GitHub backend**: sholmgren96/fixchl-backend
- **GitHub PWA**: sholmgren96/fixchl-tecnico

## Variables de entorno en Railway
Configuradas directamente en Railway dashboard. No modificar sin coordinación.
- DATABASE_URL — conexión a Supabase via pooler (aws-1-sa-east-1.pooler.supabase.com:6543)
- JWT_SECRET — clave para firmar tokens JWT
- NODE_ENV — production
- PORT — 3000
- PUBLIC_URL — https://fixchl-backend-production-bda3.up.railway.app
- PWA_URL — https://tecnicosya.vercel.app
- TWILIO_ACCOUNT_SID — ver en Twilio dashboard
- TWILIO_AUTH_TOKEN — ver en Twilio dashboard
- TWILIO_WHATSAPP_NUMBER — ver en Twilio dashboard
- ADMIN_EMAIL — email del administrador (auto-crea cuenta en initDb si no existe)
- ADMIN_PASSWORD — contraseña del administrador

## Estructura de archivos
src/
├── config.js                    — variables de entorno
├── index.js                     — servidor Express, registra todas las rutas
├── db/
│   └── database.js              — TODAS las funciones de DB (PostgreSQL, async/await)
├── middleware/
│   └── auth.js                  — JWT middleware (tecnicoAuthMiddleware + adminAuthMiddleware)
├── routes/
│   ├── auth.js                  — /api/auth/* (registro, login, OTP, recuperar contraseña)
│   ├── admin.js                 — /api/admin/* (login admin, gestión técnicos, stats, trabajos)
│   ├── tecnico.js               — /api/tecnico/* (perfil, disponible, comunas, categorias, rendimiento)
│   ├── trabajos.js              — /api/trabajos/* (listar, aceptar, rechazar, completar)
│   ├── chat.js                  — /api/chat/* (resumen, mensajes por trabajo)
│   ├── disponibilidad.js        — /api/disponibilidad (bloques semanales y por fecha)
│   └── webhook.js               — POST /webhook/whatsapp (recibe mensajes de Twilio)
└── services/
    ├── chatbot.js               — lógica completa del flujo del chatbot
    └── whatsapp.js              — envío de mensajes via Twilio (texto, listas, botones)

## Base de datos — tablas PostgreSQL
- **tecnicos**: id, nombre, rut, telefono, password, disponible, rating, total_jobs, total_reviews, estado ('pendiente'|'activo'|'rechazado'|'suspendido'), cedula_foto (base64), razon_rechazo
- **tecnico_comunas**: tecnico_id, comuna
- **tecnico_categorias**: tecnico_id, categoria
- **trabajos**: id, cliente_wa, categoria, descripcion, comuna, urgencia, fecha_agendada, hora_agendada, estado, tecnico_id, created_at, accepted_at
- **mensajes**: id, trabajo_id, origen (cliente/tecnico/sistema), contenido, leido, created_at
- **calificaciones**: id, trabajo_id, tecnico_id, puntaje
- **sesiones_bot**: id, cliente_wa, estado, datos_temp (JSON), trabajo_id
- **disponibilidad**: id, tecnico_id, fecha, hora_inicio, hora_fin
- **bloques_ocupados**: id, tecnico_id, trabajo_id, fecha, hora_inicio, hora_fin
- **otp_verificaciones**: id, telefono, codigo, expires_at, verificado, created_at
- **admins**: id, nombre, email, password, created_at

## Estados del trabajo
buscando → activo → esperando_calificacion → completado

## Flujo del chatbot WhatsApp
1. Cliente escribe → webhook recibe → chatbot.js procesa
2. Estados: inicio → esperando_categoria → esperando_descripcion → esperando_comuna → esperando_urgencia → esperando_eleccion (o esperando_slot si no hay disponibles) → chat_activo → esperando_calificacion
3. Si no hay técnicos disponibles ahora: busca slots de agenda, los muestra, cliente elige
4. Si no hay slots: ofrece aviso cuando haya disponibilidad
5. El técnico acepta desde la PWA, el slot queda bloqueado en bloques_ocupados
6. Solo técnicos con estado='activo' aparecen en búsquedas

## API Auth — /api/auth/*
- POST /registro — requiere nombre, rut (validado módulo 11), telefono, password, categorias[], comunas[], cedula_foto (base64). El teléfono debe haber sido verificado por OTP en los últimos 10 min. Crea técnico con estado='pendiente'.
- POST /login — login con telefono + password
- POST /otp/enviar — envía código de 6 dígitos por WhatsApp (rate-limited)
- POST /otp/verificar — verifica el código recibido
- POST /recuperar — cambia contraseña si el teléfono fue verificado recientemente

## API Admin — /api/admin/*
- POST /auth/login — login con email + password, devuelve JWT con role:'admin'
- GET /tecnicos/pendientes — técnicos con estado='pendiente'
- GET /tecnicos — todos los técnicos
- GET /tecnicos/:id/cedula — foto de cédula en base64
- POST /tecnicos/:id/aprobar — cambia estado a 'activo'
- POST /tecnicos/:id/rechazar — cambia estado a 'rechazado', acepta { razon }
- POST /tecnicos/:id/suspender — cambia estado a 'suspendido'
- POST /tecnicos/:id/reactivar — cambia estado a 'activo'
- GET /stats — KPIs, embudo, gráfico semanal, por categoría/comuna, distribución ratings, top técnicos, técnicos por estado
- GET /trabajos — lista paginada con filtros: estado, categoria, desde, hasta, limit, offset
- GET /trabajos/:id — detalle del trabajo con mensajes y calificación

## Reglas críticas de desarrollo
1. **SIEMPRE usar await** al llamar funciones de db — son todas async (PostgreSQL)
2. **NUNCA cambiar DATABASE_URL** — usar el pooler, no la URL directa
3. **El webhook responde XML vacío** `<Response></Response>` — nunca texto plano (Twilio lo enviaría como mensaje)
4. **nixpacks.toml** usa `npm install` (no `npm ci`) — necesario para Railway
5. **Después de cada cambio**: commit en GitHub → Railway redespliega automáticamente en 2 min
6. **CORS**: origin está en '*' — no restringir o la PWA no puede conectarse
7. **Técnicos existentes antes de agregar columna estado**: tienen DEFAULT 'activo', solo nuevos registros quedan como 'pendiente'

## Comunas disponibles
Las Condes, Vitacura, Lo Barnechea, Chicureo

## Categorías de servicio
Electricista, Gasfiter, Servicio de aseo, Pintor, Maestro general, Otro

## Urgencias
Hoy mismo, Esta semana, Elegir fecha

## Duración estimada por categoría (para bloquear agenda)
Gasfiter: 2h, Electricista: 2h, Pintor: 4h, Servicio de aseo: 3h, Maestro general: 3h, Otro: 2h

## Mensajes interactivos Twilio
- enviarMensajeWA(numero, texto) — mensaje simple
- enviarLista(numero, cuerpo, boton, secciones) — menú desplegable, máx 10 items
- enviarBotones(numero, cuerpo, botones) — botones quick-reply, máx 3
- Todas tienen fallback a texto si falla la API de contenido

## Twilio / WhatsApp — estado actual
- Número de producción +15559319840 pendiente de aprobación en Meta Business
- Sandbox disponible: +14155238886 (para pruebas manuales)
- Ticket Twilio #25970584 abierto por problema de registro
- Meta Business Verification está en proceso — sin empresa formal, usar sociedad existente o persona natural

## Pendiente por desarrollar
- Pantalla de agenda en la PWA del técnico (calendario para configurar disponibilidad semanal)
- La pantalla debe consumir GET/POST /api/disponibilidad y POST /api/disponibilidad/fecha

## Contexto de negocio
- Fase inicial sin monetización — primero construir base de técnicos y calificaciones
- Mercado objetivo: comunas oriente de Santiago (Las Condes, Vitacura, Lo Barnechea, Chicureo)
- Nombre de la empresa: TecnicosYa
- El nombre antiguo FixChl aparece en algunos archivos — se está migrando gradualmente
- Dominio tecnicosya.cl pendiente de comprar (se comprará al lanzar)
