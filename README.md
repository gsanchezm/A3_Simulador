# A3 Simulador CISSP

Aplicación de práctica CISSP con 308 preguntas en 10 capítulos, reportes PDF, cuentas por rol y grupos separados por universidad, materia y nombre. El frontend se sirve desde Node.js y los datos persistentes viven en PostgreSQL.

Se desarrolló para la Actividad A3 de Seguridad Avanzada porque el material interactivo del libro *CISSP Practice Exams* (3.ª ed.) recomienda Adobe Flash Player, sin soporte desde el 31 de diciembre de 2020.

**Uso en cursos futuros.** La herramienta es genérica y puede reutilizarse: un docente crea su grupo, comparte un enlace de invitación y consulta los resultados; agregar un capítulo solo requiere un JSON y su registro en `data/exams.manifest.json`. Antes de usarla con otro curso, lee la sección [Derechos de autor del banco de preguntas](#derechos-de-autor-del-banco-de-preguntas) y la de [Seguridad](#seguridad-y-auditoría).

## Roles y flujo

| Rol | Alta | Funciones |
| --- | --- | --- |
| Administrador | Se crea al iniciar el servidor con `ADMIN_EMAIL` y `ADMIN_PASSWORD` | Aprueba o revoca cuentas de maestros. |
| Maestro | Registro público, pendiente de aprobación | Crea grupos, genera enlaces de invitación y consulta alumnos y resultados de sus grupos. |
| Alumno | Registro mediante enlace de invitación | Se une a uno o varios grupos, presenta exámenes sin límite de intentos y consulta sólo sus resultados por grupo. |

Un enlace de invitación dura siete días y permite 100 usos por defecto. El maestro puede generar otro cuando lo necesite. El enlace se muestra una vez al crearlo; en la base se almacena sólo su hash. Si el administrador revoca a un maestro, sus enlaces dejan de funcionar hasta que se le apruebe de nuevo. Los grupos de maestros distintos están aislados en la API.

Los intentos se califican y guardan en el servidor. Las contraseñas se derivan con `scrypt`; las sesiones usan cookies `HttpOnly`, `SameSite=Lax` y `Secure` en producción. El sello del reporte es un HMAC SHA-256 generado por el servidor. Los exámenes son de práctica: la clave de respuestas viaja al navegador como parte del banco de preguntas y no debe tratarse como evaluación supervisada.

## Almacenamiento

El esquema está en `db/schema.sql`:

- `users` y `sessions`: identidad y sesiones.
- `groups`, `memberships` e `invitations`: universidad, materia, grupo y acceso.
- `attempts`: una fila por intento, con respuestas y desglose en `jsonb`; los intentos no se sobrescriben.
- `progress`: un estado en curso por alumno y grupo.

Hay índices por alumno, grupo y fecha para las consultas principales. El banco de preguntas permanece como JSON versionado en `data/chapters/` y no ocupa espacio de la base. Para uso prolongado, exporta copias de seguridad de PostgreSQL y define una política de retención de datos personales.

## Desarrollo local

Requisitos: Node.js 20 o superior, PostgreSQL y Google Chrome para la prueba de navegador.

1. `npm ci`
2. Levanta una base PostgreSQL. Con Docker, por ejemplo: `docker run --name a3-pg -e POSTGRES_PASSWORD=cambia-esta-clave -p 5432:5432 -d postgres:16`
3. Copia `.env.example` a `.env` y configura `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `REPORT_SIGNING_KEY`. Usa claves únicas de al menos 12 y 32 caracteres, respectivamente. No subas `.env` a Git.
4. `npm run dev`
5. Abre `http://localhost:3000`.

El servidor crea las tablas ausentes y, si todavía no existe un administrador, crea la cuenta configurada. Los cambios futuros al esquema deben gestionarse con migraciones versionadas; `CREATE TABLE IF NOT EXISTS` sólo cubre el arranque inicial.

**Detrás de un proxy.** Por defecto la aplicación no confía en la cabecera `X-Forwarded-For`, de modo que el límite de intentos usa la IP real de la conexión. Si la publicas detrás de uno o más proxies, define `TRUST_PROXY` con el número de proxies de confianza (por ejemplo `TRUST_PROXY=1`); sin ese valor, un proxy que termina TLS hará que el servidor calcule mal el protocolo y rechace las solicitudes que modifican datos.

## Organización del proyecto

```text
server/                  API, autenticación y acceso a PostgreSQL
db/schema.sql            Esquema e índices
data/exams.manifest.json Lista de capítulos
data/chapters/           Un JSON por capítulo
data/img/                Ilustraciones de preguntas
app.js                   Interfaz de alumno, maestro y administrador
index.html, styles.css   Vistas y estilos
tests/api.test.cjs       Roles, grupos, invitaciones, intentos y calificación
tests/seguridad.test.cjs Regresión de las correcciones de seguridad
tools/prueba_e2e.cjs     Prueba completa en Chrome; genera PDF y capturas
tools/extract.py         Genera los capítulos desde el libro de referencia
```

Para añadir un capítulo, crea su JSON en `data/chapters/` y registra la ruta en `data/exams.manifest.json`; reinicia el servidor para que cargue la nueva clave de calificación.

## Pruebas

```bash
npm test
npm run test:e2e
```

`npm test` ejecuta las pruebas de API con PostgreSQL en memoria (`pg-mem`): roles, invitaciones, aislamiento entre maestros, intentos ilimitados, calificación en el servidor y las regresiones de seguridad descritas abajo. Cada prueba de contraseña usa `scrypt` (16 MB), así que en equipos con poca memoria conviene ejecutarlas en serie: `node --test --test-concurrency=1 tests/*.test.cjs`.

`npm run test:e2e` abre Chrome, registra un alumno con un enlace de invitación, responde las 308 preguntas, comprueba cada reporte, las vistas de administrador y de maestro y el aislamiento entre grupos, y deja la evidencia en `reportes/` (PDF, capturas y `resultados_e2e.json`). Esa carpeta se genera en local y no se versiona.

La prueba E2E usa la cuenta **«Alumno Demo (ejecución automatizada)»** y responde con la clave de calificación. Por eso obtiene 100 % en cada capítulo: **verifica que el sistema funciona y no representa el desempeño personal de ninguna persona.** Los resultados personales de un alumno se obtienen presentando los exámenes en el propio simulador: cada reporte se exporta a PDF con el botón *Exportar Reporte (PDF)*.

## Seguridad y auditoría

El código se auditó con el skill [`security-audit` de Cloudflare](https://github.com/cloudflare/security-audit-skill) (perfil `quick`, solo lectura de código, 18 agentes de IA). La corrida no produjo hallazgos confirmados (el skill no permite confirmar sin ejecutar en un sandbox, que el equipo de desarrollo no ofrece) y dejó cinco pistas, que se reprodujeron en local con datos ficticios y **ya están corregidas**, con una prueba de regresión cada una en `tests/seguridad.test.cjs`:

| Pista | Corrección |
| --- | --- |
| El regex de correo retrocedía de forma cuadrática antes del tope de longitud | `validEmail` comprueba la longitud (≤ 254) antes del regex. |
| El límite de intentos confiaba siempre en `X-Forwarded-For` (`trust proxy` fijo en 1) | `trust proxy` queda desactivado por defecto y se configura con `TRUST_PROXY`. |
| Revocar a un maestro no invalidaba sus invitaciones | La consulta, el registro y la unión por invitación exigen que el maestro dueño del grupo esté aprobado. |
| `GET /portal.js` devolvía el texto del error del sistema con la ruta del servidor | Sólo los mensajes escritos con `fail()` llegan al cliente; los errores de librerías devuelven un texto genérico y se eliminó la ruta muerta `/portal.js`. |
| El registro distinguía un correo existente (409) de uno nuevo (201) | El registro de maestros responde igual en ambos casos y no crea nada si el correo ya existe; el inicio de sesión verifica siempre un hash para no delatar correos por tiempo y rechaza con 401 las contraseñas que no son texto. |

**Pendiente y aceptado:** el registro de alumnos sigue respondiendo 409 con un correo existente, porque exige una invitación válida y el alumno necesita saber que debe iniciar sesión; el límite de intentos sigue siendo por IP y en memoria (no por cuenta ni compartido entre instancias); y la longitud mínima de contraseña es de 12 caracteres (NIST SP 800-63B-4 recomienda 15 para un solo factor).

> **Ninguna herramienta automatizada puede asegurar una seguridad del 100 %.** La auditoría fue una pasada parcial (siete unidades de cobertura quedaron diferidas): que no haya más hallazgos no demuestra que no existan. Conviene repetirla con un perfil más profundo y complementarla con revisión humana, `npm audit` y pruebas de penetración dirigidas.

## Derechos de autor del banco de preguntas

Las preguntas, claves y justificaciones de `data/` se extrajeron del libro *CISSP Practice Exams*, 3.ª ed., de Shon Harris (McGraw-Hill Education, 2015). El aviso de derechos del libro permite usar la obra para uso personal no comercial y prohíbe cualquier otro uso sin consentimiento previo de la editorial. Este repositorio se presenta con fines académicos; para redistribuirlo o usarlo en una institución, solicita autorización a la editorial o sustituye `data/` por un banco propio o licenciado. El código del servidor y de la interfaz no depende de ese contenido.
