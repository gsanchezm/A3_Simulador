# A3 Simulador CISSP

Aplicación de práctica CISSP con 308 preguntas, reportes PDF, cuentas por rol y grupos separados por universidad, materia y nombre. El frontend se sirve desde Node.js y los datos persistentes viven en PostgreSQL.

## Roles y flujo

| Rol | Alta | Funciones |
| --- | --- | --- |
| Administrador | Se crea al iniciar el servidor con `ADMIN_EMAIL` y `ADMIN_PASSWORD` | Aprueba o revoca cuentas de maestros. |
| Maestro | Registro público, pendiente de aprobación | Crea grupos, genera enlaces de invitación y consulta alumnos y resultados de sus grupos. |
| Alumno | Registro mediante enlace de invitación | Se une a uno o varios grupos, presenta exámenes sin límite de intentos y consulta sólo sus resultados por grupo. |

Un enlace de invitación dura siete días y permite 100 usos por defecto. El maestro puede generar otro cuando lo necesite. El enlace se muestra una vez al crearlo; en la base se almacena sólo su hash. Los grupos de maestros distintos están aislados en la API.

Los intentos se califican y guardan en el servidor. Las contraseñas se derivan con `scrypt`; las sesiones usan cookies `HttpOnly`, `SameSite=Lax` y `Secure` en producción. El sello del reporte es un HMAC SHA-256 generado por el servidor. Los exámenes son de práctica: la clave de respuestas viaja al navegador como parte del banco de preguntas y no debe tratarse como evaluación supervisada.

## Almacenamiento

**Recomendación para Render Free:** un Web Service gratuito en Render y PostgreSQL externo, por ejemplo Neon Free. Render pierde los archivos locales al reiniciar o desplegar; SQLite dentro del Web Service perdería usuarios e intentos. El PostgreSQL gratuito de Render caduca a los 30 días, así que sirve sólo para una demostración temporal. Supabase PostgreSQL también es una opción, considerando sus límites y pausas por inactividad. Verifica las cuotas actuales antes de desplegar.

El esquema está en `db/schema.sql`:

- `users` y `sessions`: identidad y sesiones.
- `groups`, `memberships` e `invitations`: universidad, materia, grupo y acceso.
- `attempts`: una fila por intento, con respuestas y desglose en `jsonb`; los intentos no se sobrescriben.
- `progress`: un estado en curso por alumno y grupo.

Hay índices por alumno, grupo y fecha para las consultas principales. El banco de preguntas permanece como JSON versionado en `data/chapters/` y no ocupa espacio de la base. Para uso prolongado, programa copias de seguridad de PostgreSQL fuera de Render y define una política de retención de datos personales.

## Desarrollo local

Requisitos: Node.js 20 o superior, PostgreSQL y Google Chrome para la prueba de navegador.

1. `npm ci`
2. Copia `.env.example` a `.env` y configura `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `REPORT_SIGNING_KEY`. Usa claves únicas de al menos 12 y 32 caracteres, respectivamente. No subas `.env` a Git.
3. `npm run dev`
4. Abre `http://localhost:3000`.

El servidor crea las tablas ausentes y, si todavía no existe un administrador, crea la cuenta configurada. Los cambios futuros al esquema deben gestionarse con migraciones versionadas antes de desplegar; `CREATE TABLE IF NOT EXISTS` sólo cubre el arranque inicial.

## Despliegue en Render

1. Crea un proyecto PostgreSQL externo y copia su URL de conexión con TLS.
2. Sube este repositorio a GitHub.
3. En Render, crea el servicio a partir de `render.yaml` o un **Web Service** Node con `npm ci --omit=dev` y `npm start`.
4. Configura como secretos `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `REPORT_SIGNING_KEY`.
5. Espera a que `/api/health` responda `{ "ok": true }`.
6. Entra como administrador, aprueba al maestro registrado y permite que éste cree un grupo y comparta su invitación.

No uses **Static Site**: el registro, los roles y la persistencia necesitan el servidor API. El servicio gratuito puede tardar en responder después de estar inactivo.

## Organización del proyecto

```text
server/                  API, autenticación y acceso a PostgreSQL
db/schema.sql            Esquema e índices
data/exams.manifest.json Lista de capítulos
data/chapters/           Un JSON por capítulo
data/img/                Ilustraciones de preguntas
app.js                   Interfaz de alumno, maestro y administrador
index.html, styles.css   Vistas y estilos
tests/api.test.cjs       Prueba de roles, grupos, invitaciones e intentos
tools/prueba_e2e.cjs     Prueba completa en Chrome y PDF
render.yaml              Despliegue del Web Service
```

Para añadir un capítulo, crea su JSON en `data/chapters/` y registra la ruta en `data/exams.manifest.json`; reinicia o despliega el servidor para que cargue la nueva clave de calificación. `tools/extract.py` genera los capítulos desde el libro de referencia.

## Pruebas

```bash
npm test
npm run test:e2e
```

La prueba de API usa PostgreSQL en memoria. La prueba de navegador crea cuentas y grupos temporales, responde las 308 preguntas, comprueba los roles y produce dos PDF de evidencia en `reportes/pruebas/`. Estos archivos se ignoran en Git. El resultado es automatizado, no una evaluación personal.
