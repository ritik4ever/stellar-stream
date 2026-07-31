# StellarStream

[![English](https://img.shields.io/badge/lang-en-red.svg)](../README.md)
[![Español](https://img.shields.io/badge/lang-es-green.svg)](README.es.md)
[![Português](https://img.shields.io/badge/lang-pt-br-blue.svg)](README.pt.md)

> **Nota sobre traducciones:** Estas traducciones pueden estar desactualizadas con respecto a la versión en inglés. Consulta el archivo [`README.md`](../README.md) en inglés para obtener la información más reciente.

---

# StellarStream

StellarStream es un MVP (producto mínimo viable) de streaming de pagos básico para el ecosistema Stellar.
Incluye:
* Un panel de control en React para crear y monitorear streams
* Una API en Node.js/Express para operaciones del ciclo de vida de streams
* Un scaffold de contrato inteligente Soroban para la lógica de streams en cadena
* Una carpeta de backlog con borradores de tareas de implementación

Este repositorio es intencionalmente liviano y fácil de extender.
Para preguntas comunes y solución de problemas, consulta [`FAQ.md`](../FAQ.md).
Para configuración de producción y operaciones, consulta [`DEPLOYMENT.md`](../DEPLOYMENT.md) y [`RUNBOOK.md`](../RUNBOOK.md).
Para la política de seguridad y reporte de vulnerabilidades, consulta [`SECURITY.md`](../SECURITY.md).
Estamos comprometidos con un ambiente acogedor; consulta [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md).

## 1) Qué Hace El Proyecto

StellarStream modela un stream de pagos donde un remitente asigna un monto total durante una duración fija.
A medida que pasa el tiempo, el destinatario "adquiere" (vest) valor de forma continua.

**Comportamiento actual del MVP:**
* Crear stream
* Listar streams con progreso en vivo
* Cancelar stream
* Mostrar métricas calculadas (activos/completados/adquiridos)
* Rastrear y mostrar historial de eventos para acciones del ciclo de vida del stream

## 2) Arquitectura Actual

### Frontend (`frontend`, puerto 3000)
* Aplicación React + Vite
* Usa el proxy `/api` para llamar al backend
* Consulta la lista de streams cada 5 segundos

### Backend (`backend`, puerto 3001)
* API REST Express
* Base de datos SQLite para almacenamiento persistente
* Worker indexador de eventos para rastrear el ciclo de vida del stream
* Calcula el progreso en tiempo real a partir de marcas de tiempo
* Firma criptográficamente webhooks salientes usando HMAC-SHA256 para notificaciones seguras del ciclo de vida

### Contrato (`contracts`)
* Scaffold de contrato Soroban en Rust
* Soporta `create_stream`, `claimable`, `claim` y `cancel`
* Aún no integrado con el backend en este MVP

## 3) Modelo Matemático del Stream

Para cada stream definido por un monto total ($A_{total}$), una marca de tiempo de inicio ($t_{start}$) y una duración en segundos ($d$), la marca de tiempo de finalización ($t_{end}$) se calcula como:

$$t_{end} = t_{start} + d$$

En cualquier momento actual $t$, el tiempo transcurrido ($\Delta t$), la proporción de adquisición ($R$), el monto adquirido ($A_{vested}$) y el monto restante ($A_{remaining}$) se calculan usando una función de clamp para restringir los valores a la ventana válida del stream:

$$\Delta t = \max(0, \min(t - t_{start}, d))$$

$$R = \frac{\Delta t}{d}$$

$$A_{vested} = A_{total} \times R$$

$$A_{remaining} = A_{total} - A_{vested}$$

**Reglas de Estado**

- `scheduled`: cuando $t < t_{start}$
- `active`: cuando $t_{start} \le t < t_{end}$
- `completed`: cuando $t \ge t_{end}$
- `canceled`: cuando el stream fue terminado anticipadamente de forma explícita

## 4) Referencia de la API

La documentación interactiva de la API está disponible a través de Swagger UI en:

- **Swagger UI:** `/api/docs`
- **Especificación OpenAPI sin procesar:** `/api/docs/openapi.json`

**URL Base:**

- Local: `http://localhost:3001`
- Proxy del frontend: `/api`

### `GET /api/health`
**Propósito:** Verificación de estado del servicio

**Respuesta:** `service`, `status`, `timestamp`

### `GET /api/streams`
**Propósito:** Listar streams ordenados del más reciente al más antiguo, con filtrado y paginación opcionales

**Parámetros de consulta (opcionales):**
- `status`: `scheduled` | `active` | `completed` | `canceled`
- `sender`: string (coincidencia exacta de remitente)
- `recipient`: string (coincidencia exacta de destinatario)
- `asset`: string (coincidencia exacta de código de activo)
- `q`: string (término de búsqueda general — busca en ID del stream, remitente, destinatario y código de activo, sin distinción de mayúsculas)
- `page`: number (entero >= 1)
- `limit`: number (entero 1..100)

**Respuesta:**
```json
{
  "data": "Stream[]",
  "total": "number",
  "page": "number",
  "limit": "number"
}
```

### `GET /api/streams/:id`
**Propósito:** Obtener un stream individual por ID

**Respuesta:** `{ "data": Stream }` | **Error:** 404 si el stream no existe

### `GET /api/recipients/:accountId/streams`
**Propósito:** Obtener todos los streams para un destinatario específico

**Respuesta:** `{ "data": Stream[] }` (incluye progreso calculado para cada stream)

### `GET /api/assets`
**Propósito:** Obtener la lista blanca de activos permitidos

**Respuesta:** `{ "data": string[] }` (códigos de activos normalizados)

### `POST /api/streams`
**Propósito:** Crear un nuevo stream

**Cuerpo de la solicitud:**
```json
{
  "sender": "string",
  "recipient": "string",
  "assetCode": "string",
  "totalAmount": "number",
  "durationSeconds": "number",
  "startAt": "number (opcional, segundos Unix)"
}
```

**Respuesta:** 201 Created con `{ "data": Stream }`

### `POST /api/streams/:id/cancel`
**Propósito:** Cancelar un stream existente

**Respuesta:** `{ "data": Stream }` con estado `canceled` | **Error:** 404 si el stream no existe

### `GET /api/open-issues`
**Propósito:** Devuelve los elementos del backlog de implementación mostrados en la UI

**Respuesta:** `{ "data": OpenIssue[] }`

### `GET /api/streams/:id/history`
**Propósito:** Obtener la línea de tiempo del historial de eventos de un stream específico

**Respuesta:** `{ "data": StreamEvent[] }` (ordenados por marca de tiempo ascendente)

**Tipos de eventos:** `created`, `claimed`, `canceled`, `start_time_updated`

## 5) Ejecutar Localmente

### Prerrequisitos

- Node.js 18+
- npm 9+
- Opcional para trabajo con contratos: Rust + toolchain Soroban

### Opción A: npm directo (Recomendado para Desarrollo)

Desde la raíz del repositorio:

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
```

Alternativa manual:

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001

### Opción B: Docker Compose con Hot-Reload

Para desarrollo local con Docker, usa el archivo `docker-compose.override.yml` que monta automáticamente los directorios fuente y habilita la recarga en caliente:

```bash
docker-compose up
```

- **Recarga en caliente del backend:** Los cambios en `backend/src/` activan el reinicio automático via `ts-node-dev`.
- **Recarga en caliente del frontend:** Los cambios en `frontend/src/` activan Vite HMR.
- **Volumen de base de datos:** Persiste entre reinicios.

### Compilación

```bash
npm run build
```

## 6) Licencia

MIT