const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { newDb } = require('pg-mem');
const { createApp } = require('../server/app');
const { initializeDatabase } = require('../server/database');

test('roles, invitación, aislamiento por grupo e intentos ilimitados', async () => {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const db = new Pool();
  await initializeDatabase(db, 'admin@example.com', 'admin-password-12345');
  const app = createApp(db, 'test-signing-key-longer-than-32-characters');
  const admin = request.agent(app);
  const teacher = request.agent(app);
  const student = request.agent(app);
  const otherTeacher = request.agent(app);
  const password = 'strong-password-123';

  const signup = await teacher.post('/api/auth/signup-teacher').send({
    name: 'Maestra Uno', email: 'teacher@example.com', password,
  });
  assert.equal(signup.status, 201);
  assert.equal((await teacher.post('/api/auth/login').send({ email: 'teacher@example.com', password })).status, 403);
  assert.equal((await admin.post('/api/auth/login').send({ email: 'admin@example.com', password: 'admin-password-12345' })).status, 200);
  assert.equal((await admin.patch(`/api/admin/teachers/${signup.body.user.id}`).send({ approved: true })).status, 200);
  assert.equal((await teacher.post('/api/auth/login').send({ email: 'teacher@example.com', password })).status, 200);

  const groupResponse = await teacher.post('/api/teacher/groups').send({ university: 'Universidad A', subject: 'Seguridad Avanzada', name: 'Grupo 1' });
  assert.equal(groupResponse.status, 201);
  const groupId = groupResponse.body.group.id;
  const groups = await teacher.get('/api/teacher/groups');
  assert.equal(groups.status, 200);
  assert.equal(groups.body.groups[0].students, 0);
  const invite = await teacher.post(`/api/teacher/groups/${groupId}/invitations`).send({ maxUses: 2, expiresDays: 7 });
  assert.equal(invite.status, 201);
  const code = new URL(invite.body.link).searchParams.get('invite');
  assert.ok(code);
  assert.equal((await request(app).get(`/api/invitations/${code}`)).status, 200);

  const registered = await student.post('/api/auth/signup-student').send({
    name: 'Alumna Uno', email: 'student@example.com', password, studentId: 'S001', invite: code,
  });
  assert.equal(registered.status, 201);
  assert.equal((await student.get('/api/student/groups')).body.groups.length, 1);
  assert.equal((await student.post('/api/teacher/groups').send({ university: 'X', subject: 'Y', name: 'Z' })).status, 403);
  assert.equal((await teacher.get(`/api/student/state?groupId=${groupId}`)).status, 403);
  assert.equal((await student.get(`/api/student/state?groupId=${randomUUID()}`)).status, 403);
  assert.equal((await student.post('/api/student/attempts').send({ groupId: randomUUID(), chapter: 1, answers: {} })).status, 403);

  const q = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'chapters', 'cap01.json'), 'utf8')).questions;
  const answers = Object.fromEntries(q.map(question => [question.n, question.answer]));
  for (let i = 0; i < 10; i++) {
    const attempt = await student.post('/api/student/attempts').send({ groupId, chapter: 1, answers,
      score: 999, duration: 30, start: Date.now() - 30000 });
    assert.equal(attempt.status, 201);
    assert.equal(attempt.body.attempt.score, q.length);
    assert.match(attempt.body.attempt.hash, /^[a-f0-9]{64}$/);
  }
  const state = await student.get(`/api/student/state?groupId=${groupId}`);
  assert.equal(state.body.attempts['1'].length, 10);
  const roster = await teacher.get(`/api/teacher/groups/${groupId}/students`);
  assert.equal(roster.body.students[0].attempts, 10);

  const other = await otherTeacher.post('/api/auth/signup-teacher').send({ name: 'Maestro Dos', email: 'other@example.com', password });
  await admin.patch(`/api/admin/teachers/${other.body.user.id}`).send({ approved: true });
  await otherTeacher.post('/api/auth/login').send({ email: 'other@example.com', password });
  assert.equal((await otherTeacher.get(`/api/teacher/groups/${groupId}/students`)).status, 404);
  assert.equal((await otherTeacher.post(`/api/teacher/groups/${groupId}/invitations`).send({})).status, 404);
  assert.equal((await request(app).post('/api/auth/signup-student').send({
    name: 'Sin Invitación', email: 'invalid@example.com', password,
  })).status, 400);
  await db.end();
});

test('una respuesta incorrecta y una omitida bajan la calificación en el servidor', async () => {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const db = new Pool();
  await initializeDatabase(db, 'admin@example.com', 'admin-password-12345');
  const app = createApp(db, 'test-signing-key-longer-than-32-characters');
  const admin = request.agent(app);
  const teacher = request.agent(app);
  const student = request.agent(app);
  const password = 'strong-password-123';
  const signup = await teacher.post('/api/auth/signup-teacher').send({ name: 'Maestra', email: 'm@example.com', password });
  await admin.post('/api/auth/login').send({ email: 'admin@example.com', password: 'admin-password-12345' });
  await admin.patch(`/api/admin/teachers/${signup.body.user.id}`).send({ approved: true });
  await teacher.post('/api/auth/login').send({ email: 'm@example.com', password });
  const groupId = (await teacher.post('/api/teacher/groups').send({ university: 'U', subject: 'S', name: 'G' })).body.group.id;
  const invite = (await teacher.post(`/api/teacher/groups/${groupId}/invitations`).send({})).body.link;
  await student.post('/api/auth/signup-student').send({
    name: 'Alumno', email: 'a@example.com', password, invite: new URL(invite).searchParams.get('invite'),
  });

  const questions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'chapters', 'cap01.json'), 'utf8')).questions;
  const answers = Object.fromEntries(questions.map(question => [question.n, question.answer]));
  const wrong = ['A', 'B', 'C', 'D'].find(letter => letter !== questions[0].answer);
  answers[questions[0].n] = wrong;
  delete answers[questions[1].n];
  const attempt = await student.post('/api/student/attempts').send({ groupId, chapter: 1, answers, duration: 10, start: Date.now() - 10000 });
  assert.equal(attempt.status, 201);
  assert.equal(attempt.body.attempt.score, questions.length - 2);
  assert.equal(attempt.body.attempt.detail[0].given, wrong);
  assert.equal(attempt.body.attempt.detail[1].given, null);
  assert.equal(attempt.body.attempt.pct, (questions.length - 2) / questions.length * 100);
  assert.equal((await student.post('/api/student/attempts').send({ groupId, chapter: 1, answers: { 1: 'Z' } })).status, 400);
  await db.end();
});
