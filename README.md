# FixChl Backend

Servidor Node.js que maneja la API de la PWA, el chatbot de WhatsApp y el relay de mensajes.

---

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar el archivo de variables de entorno
cp .env.example .env

# 3. Inicializar la base de datos (crea las tablas)
npm run db:init

# 4. Correr el servidor en desarrollo
npm run dev
```

El servidor corre en http://localhost:3000

---

## Estructura

```
src/
├── config.js              ← Variables de entorno
├── index.js               ← Servidor Express principal
├── db/
│   ├── database.js        ← Conexión y creación de tablas SQLite
│   └── init.js            ← Script para inicializar la DB
├── middleware/
│   └── auth.js            ← Verificación de JWT
├── routes/
│   ├── auth.js            ← Registro y login de técnicos
│   ├── tecnico.js         ← Perfil, comunas, categorías
│   ├── trabajos.js        ← Solicitudes, aceptar, completar
│   ├── chat.js            ← Mensajes del relay
│   └── webhook.js         ← Recibe mensajes de WhatsApp (Twilio)
└── services/
    ├── chatbot.js         ← Máquina de estados del chatbot
    └── whatsapp.js        ← Envío de mensajes por Twilio
```

---

## API — Endpoints principales

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /api/auth/registro | Registra un técnico nuevo |
| POST | /api/auth/login | Inicia sesión, devuelve token |

### Técnico (requiere token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/tecnico/perfil | Obtiene datos del técnico |
| PATCH | /api/tecnico/disponible | Activa/desactiva disponibilidad |
| POST | /api/tecnico/comunas | Agrega una comuna |
| DELETE | /api/tecnico/comunas/:nombre | Elimina una comuna |
| POST | /api/tecnico/categorias | Agrega una categoría |
| GET | /api/tecnico/estadisticas | Calificaciones e historial |

### Trabajos (requiere token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/trabajos/disponibles | Trabajos en comunas del técnico |
| GET | /api/trabajos/mis-trabajos | Trabajos activos del técnico |
| POST | /api/trabajos/:id/aceptar | Acepta un trabajo |
| POST | /api/trabajos/:id/rechazar | Rechaza un trabajo |
| POST | /api/trabajos/:id/completar | Marca como completado |

### Chat (requiere token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/chat | Lista todos los chats del técnico |
| GET | /api/chat/:trabajoId/mensajes | Mensajes de un chat |
| POST | /api/chat/:trabajoId/enviar | Envía mensaje al cliente |

### Webhook
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /webhook/whatsapp | Recibe mensajes de Twilio |

---

## Configurar WhatsApp con Twilio (cuando estés listo)

1. Crea una cuenta en twilio.com
2. Activa el sandbox de WhatsApp en la consola
3. Copia el Account SID y Auth Token al archivo .env
4. Instala ngrok para exponer el servidor local:
   ```bash
   npm install -g ngrok
   ngrok http 3000
   ```
5. En la consola de Twilio, pega la URL de ngrok como webhook:
   `https://tu-url.ngrok.io/webhook/whatsapp`

---

## Conectar con la PWA

En la PWA (fixchl-tecnico), edita `src/context/AppContext.jsx` y reemplaza el primer bloque por:

```js
const API = 'http://localhost:3000/api'
const token = localStorage.getItem('token')

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
}

// Ejemplo: cargar solicitudes
const res = await fetch(`${API}/trabajos/disponibles`, { headers })
const { trabajos } = await res.json()
```
