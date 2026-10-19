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

**Despliegue recomendado:** Vercel Hobby para la aplicación y Neon Free para PostgreSQL, instalado desde Vercel Marketplace. Así se administra el proyecto desde Vercel y usuarios, grupos e intentos permanecen en Neon entre despliegues. El plan gratuito de Neon ofrece 1 GB por proyecto (octubre de 2026). Los archivos del banco de preguntas se sirven desde el despliegue de Vercel; no ocupan espacio en PostgreSQL. Revisa las cuotas de ambos servicios antes de ponerlo en uso con una clase grande.

El esquema está en `db/schema.sql`:

- `users` y `sessions`: identidad y sesiones.
- `groups`, `memberships` e `invitations`: universidad, materia, grupo y acceso.
- `attempts`: una fila por intento, con respuestas y desglose en `jsonb`; los intentos no se sobrescriben.
- `progress`: un estado en curso por alumno y grupo.

Hay índices por alumno, grupo y fecha para las consultas principales. El banco de preguntas permanece como JSON versionado en `data/chapters/` y no ocupa espacio de la base. Para uso prolongado, exporta copias de seguridad de PostgreSQL y define una política de retención de datos personales.

## Desarrollo local

Requisitos: Node.js 20 o superior, PostgreSQL y Google Chrome para la prueba de navegador.

1. `npm ci`
2. Copia `.env.example` a `.env` y configura `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `REPORT_SIGNING_KEY`. Usa claves únicas de al menos 12 y 32 caracteres, respectivamente. No subas `.env` a Git.
3. `npm run dev`
4. Abre `http://localhost:3000`.

El servidor crea las tablas ausentes y, si todavía no existe un administrador, crea la cuenta configurada. Los cambios futuros al esquema deben gestionarse con migraciones versionadas antes de desplegar; `CREATE TABLE IF NOT EXISTS` sólo cubre el arranque inicial.

## Despliegue en Vercel con Neon

1. Sube este repositorio a GitHub e impórtalo como proyecto de Vercel con la raíz en `A3_Simulador` si el repositorio incluye otras carpetas. Usa el preset **Express** y Node.js 20 o superior. El comando de compilación es `npm run build`; `vercel.json` ya lo configura.
2. En **Storage / Marketplace**, instala **Neon** en el plan Free y conecta la base al proyecto. Selecciona una región cercana a la función de Vercel. Usa la URL de conexión *pooled* con TLS.
3. Confirma que Vercel haya inyectado `DATABASE_URL` o `POSTGRES_URL` en **Environment Variables**. Si no, añade `DATABASE_URL` con la URL de Neon como secreto. Configura también `ADMIN_EMAIL`, `ADMIN_PASSWORD` (al menos 12 caracteres) y `REPORT_SIGNING_KEY` (al menos 32 caracteres aleatorios) para Production. Mantén la misma clave de firma entre despliegues.
4. Despliega de nuevo después de conectar Neon y revisa `/api/health`, que debe responder `{ "ok": true }`. El primer acceso crea las tablas y la cuenta administradora.
5. Entra como administrador, aprueba al maestro registrado y permite que éste cree un grupo y comparta su invitación.

El plan Hobby es para proyectos personales sin uso comercial. Vercel ejecuta la API como función y sirve `public/` como archivos estáticos. `npm run build` genera esa carpeta desde los archivos fuente. No guardes información persistente en `public/` ni en el sistema de archivos de la función. La base debe vivir en Neon.

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
index.js                 Entrada de la función Express de Vercel
vercel.json              Configuración de Vercel
tools/build-public.cjs   Prepara archivos estáticos para Vercel
```

Para añadir un capítulo, crea su JSON en `data/chapters/` y registra la ruta en `data/exams.manifest.json`; reinicia o despliega el servidor para que cargue la nueva clave de calificación. `tools/extract.py` genera los capítulos desde el libro de referencia.

## Pruebas

```bash
npm test
npm run test:e2e
```

La prueba de API usa PostgreSQL en memoria. La prueba de navegador crea cuentas y grupos temporales, responde las 308 preguntas, comprueba los roles y produce dos PDF de evidencia en `reportes/pruebas/`. Estos archivos se ignoran en Git. El resultado es automatizado, no una evaluación personal.
