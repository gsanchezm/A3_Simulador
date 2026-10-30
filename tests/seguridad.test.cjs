const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { newDb } = require('pg-mem');
const { createApp, parseTrustProxy } = require('../server/app');
const { initializeDatabase } = require('../server/database');
const { validEmail } = require('../server/security');

const ADMIN = { email: 'admin@example.com', password: 'admin-password-12345' };
const PASSWORD = 'strong-password-123';
const KEY = 'test-signing-key-longer-than-32-characters';

async function fresh(options) {
  const { Pool } = newDb().adapters.createPg();
  const db = new Pool();
  await initializeDatabase(db, ADMIN.email, ADMIN.password);
  return { db, app: createApp(db, KEY, options) };
}

// Maestro aprobado con un grupo y una invitación; devuelve los agentes y el código de invitación.
async function classroom(app) {
  const admin = request.agent(app);
  const teacher = request.agent(app);
  await admin.post('/api/auth/login').send(ADMIN);
  const signup = await teacher.post('/api/auth/signup-teacher').send({ name: 'Maestra', email: 'maestra@example.com', password: PASSWORD });
  await admin.patch(`/api/admin/teachers/${signup.body.user.id}`).send({ approved: true });
  await teacher.post('/api/auth/login').send({ email: 'maestra@example.com', password: PASSWORD });
  const group = (await teacher.post('/api/teacher/groups').send({ university: 'U', subject: 'S', name: 'G' })).body.group;
  const invite = async () => new URL((await teacher.post(`/api/teacher/groups/${group.id}/invitations`).send({})).body.link).searchParams.get('invite');
  return { admin, teacher, teacherId: signup.body.user.id, group, invite };
}

test('validEmail rechaza correos largos sin retroceso cuadrático', () => {
  const hostile = 'a@' + '.'.repeat(150000) + '@';
  const started = process.hrtime.bigint();
  assert.equal(validEmail(hostile), false);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 50, 'debe resolverse en menos de 50 ms');
  const exact = `${'a'.repeat(64)}@${'b'.repeat(186)}.co`;
  assert.equal(exact.length, 254);
  assert.equal(validEmail(exact), true);
  assert.equal(validEmail(`a${exact}`), false); // 255 caracteres
});

test('parseTrustProxy acepta sólo un número de saltos', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('0'), false);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy(' 2 '), 2);
  for (const bad of ['true', '-1', '1.5', 'loopback', '1000']) assert.throws(() => parseTrustProxy(bad), /TRUST_PROXY/);
});

test('el límite de intentos ignora X-Forwarded-For salvo que se declare un proxy de confianza', async () => {
  const attempts = async (app, headerFor) => {
    const statuses = [];
    for (let i = 0; i < 21; i++) {
      let req = request(app).post('/api/auth/login');
      const header = headerFor(i);
      if (header) req = req.set('X-Forwarded-For', header);
      statuses.push((await req.send({ email: ADMIN.email, password: 'incorrecta-12345' })).status);
    }
    return statuses;
  };
  const closed = await fresh();
  const rotating = await attempts(closed.app, i => `203.0.113.${i + 1}`);
  assert.equal(rotating[20], 429, 'sin proxy de confianza, rotar X-Forwarded-For no evade el límite');
  await closed.db.end();
  const behindProxy = await fresh({ trustProxy: 1 });
  const perClient = await attempts(behindProxy.app, i => `203.0.113.${i + 1}`);
  assert.ok(!perClient.includes(429), 'con un proxy declarado, cada IP de cliente tiene su propia cuota');
  await behindProxy.db.end();
});

test('revocar a un maestro invalida sus invitaciones y reaprobarlo las restaura', async () => {
  const { db, app } = await fresh();
  const { admin, teacherId, invite } = await classroom(app);
  const [forSignup, forJoin] = [await invite(), await invite()];
  const existing = request.agent(app);
  await existing.post('/api/auth/signup-student').send({ name: 'Alumno Uno', email: 'uno@example.com', password: PASSWORD, invite: await invite() });
  assert.equal((await request(app).get(`/api/invitations/${forSignup}`)).status, 200);

  assert.equal((await admin.patch(`/api/admin/teachers/${teacherId}`).send({ approved: false })).status, 200);
  assert.equal((await request(app).get(`/api/invitations/${forSignup}`)).status, 404);
  const signup = await request(app).post('/api/auth/signup-student').send({ name: 'Alumno Dos', email: 'dos@example.com', password: PASSWORD, invite: forSignup });
  assert.equal(signup.status, 400);
  assert.equal((await existing.post('/api/student/join').send({ invite: forJoin })).status, 400);
  const members = await db.query('SELECT count(*)::integer AS n FROM memberships');
  assert.equal(members.rows[0].n, 1, 'no se crean membresías mientras el maestro está revocado');
  const uses = await db.query('SELECT sum(uses)::integer AS n FROM invitations');
  assert.equal(uses.rows[0].n, 1, 'los intentos rechazados no consumen usos');

  await admin.patch(`/api/admin/teachers/${teacherId}`).send({ approved: true });
  assert.equal((await request(app).get(`/api/invitations/${forSignup}`)).status, 200);
  await db.end();
});

test('los errores de librerías no revelan rutas ni texto interno', async () => {
  const { db, app } = await fresh();
  const missing = await request(app).get('/portal.js');
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: 'Ruta no encontrada' });
  assert.doesNotMatch(JSON.stringify(missing.body), /ENOENT|stat|[A-Za-z]:\\|\/Users\//);
  assert.equal((await request(app).get('/app.js')).status, 200);
  const malformed = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.body, { error: 'Solicitud inválida' });
  const noBody = await request(app).post('/api/auth/login');
  assert.equal(noBody.status, 401, 'sin cuerpo ya no produce un 500');
  await db.end();
});

test('el registro y el inicio de sesión no revelan qué correos existen', async () => {
  const { db, app } = await fresh();
  const first = await request(app).post('/api/auth/signup-teacher').send({ name: 'Nuevo', email: 'nuevo@example.com', password: PASSWORD });
  const repeated = await request(app).post('/api/auth/signup-teacher').send({ name: 'Otro', email: 'nuevo@example.com', password: PASSWORD });
  const onAdmin = await request(app).post('/api/auth/signup-teacher').send({ name: 'Intruso', email: ADMIN.email, password: PASSWORD });
  for (const response of [first, repeated, onAdmin]) assert.equal(response.status, 201);
  assert.equal(repeated.body.message, first.body.message);
  assert.deepEqual(Object.keys(repeated.body.user).sort(), Object.keys(first.body.user).sort());
  const counts = await db.query(`SELECT count(*)::integer AS n FROM users WHERE email IN ('nuevo@example.com', $1)`, [ADMIN.email]);
  assert.equal(counts.rows[0].n, 2, 'el correo repetido y el del administrador no crean otra cuenta');
  const admin = await db.query('SELECT role, name FROM users WHERE email=$1', [ADMIN.email]);
  assert.deepEqual(admin.rows[0], { role: 'admin', name: 'Administrador' });

  const unknown = await request(app).post('/api/auth/login').send({ email: 'nadie@example.com', password: PASSWORD });
  const wrong = await request(app).post('/api/auth/login').send({ email: ADMIN.email, password: 'incorrecta-12345' });
  assert.equal(unknown.status, 401);
  assert.deepEqual(unknown.body, wrong.body);
  for (const password of [{ $gt: '' }, 12345678, 'x'.repeat(5000), null]) {
    const response = await request(app).post('/api/auth/login').send({ email: ADMIN.email, password });
    assert.equal(response.status, 401, `contraseña no válida (${typeof password}) debe dar 401, no 500`);
  }
  await db.end();
});
