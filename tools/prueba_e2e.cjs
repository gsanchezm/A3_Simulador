/* Prueba integral del simulador en Chrome con PostgreSQL en memoria. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');
const { newDb } = require('pg-mem');
const request = require('supertest');
const { createApp } = require('../server/app');
const { initializeDatabase } = require('../server/database');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'reportes', 'pruebas');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data', 'exams.manifest.json'), 'utf8'));
const exams = manifest.map(file => JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8')));

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const db = new Pool();
  await initializeDatabase(db, 'admin@example.com', 'admin-password-12345');
  const server = http.createServer(createApp(db, 'test-signing-key-longer-than-32-characters'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const admin = request.agent(base.slice(0, -1));
  const teacher = request.agent(base.slice(0, -1));
  const password = 'strong-password-123';
  const registeredTeacher = await teacher.post('/api/auth/signup-teacher').send({
    name: 'Maestra de Prueba', email: 'teacher@example.com', password,
  });
  assert.equal(registeredTeacher.status, 201, JSON.stringify(registeredTeacher.body));
  const adminLogin = await admin.post('/api/auth/login').send({ email: 'admin@example.com', password: 'admin-password-12345' });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));
  const approved = await admin.patch(`/api/admin/teachers/${registeredTeacher.body.user.id}`).send({ approved: true });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const teacherLogin = await teacher.post('/api/auth/login').send({ email: 'teacher@example.com', password });
  assert.equal(teacherLogin.status, 200, JSON.stringify(teacherLogin.body));
  const createdGroup = await teacher.post('/api/teacher/groups').send({
    university: 'Universidad de Prueba', subject: 'Seguridad Avanzada', name: 'Grupo A3',
  });
  assert.equal(createdGroup.status, 201, JSON.stringify(createdGroup.body));
  const groupId = createdGroup.body.group.id;
  const invited = await teacher.post(`/api/teacher/groups/${groupId}/invitations`).send({});
  const invite = new URL(invited.body.link).searchParams.get('invite');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ locale: 'es-MX', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https:\/\/(fonts\.googleapis|fonts\.gstatic)\.com\//, route => route.abort());
  try {
    await page.goto(`${base}?invite=${invite}`);
    await page.locator('#view-auth.active').waitFor();
    await page.locator('#auth-in-name').fill('Prueba Automatizada A3');
    await page.locator('#auth-in-id').fill('student@example.com');
    await page.locator('#auth-in-student-id').fill('PRUEBA-A3');
    await page.locator('#auth-in-pass').fill(password);
    await page.locator('#btn-auth-submit').click();
    await page.locator('#view-dashboard.active').waitFor();

    let answered = 0;
    for (const chapter of exams) {
      await page.locator(`.domain-card[data-chap="${chapter.id}"]`).click();
      await page.locator('#view-exam.active').waitFor();
      for (let i = 0; i < chapter.questions.length; i++) {
        const q = chapter.questions[i];
        const shown = await page.locator('#exam-question-text').textContent();
        assert.ok(shown.startsWith(`${q.n}. `), `Capítulo ${chapter.id}, pregunta ${q.n}`);
        const answer = chapter.id === 1 && i === 0
          ? ['A', 'B', 'C', 'D'].find(letter => letter !== q.answer)
          : q.answer;
        await page.locator(`.option-button[data-letter="${answer}"]`).click();
        answered++;
        if (i < chapter.questions.length - 1) await page.locator('#btn-exam-next').click();
      }
      assert.equal(await page.locator('#exam-progress-counter').textContent(), `${chapter.questions.length} / ${chapter.questions.length}`);
      await page.locator('#btn-submit-exam').click();
      await page.locator('#modal-btn-ok').click();
      await page.locator('#view-report.active').waitFor();
      const expectedScore = chapter.questions.length - (chapter.id === 1 ? 1 : 0);
      assert.equal(await page.locator('.report-stat-box .val').first().textContent(), `${expectedScore} / ${chapter.questions.length}`);
      assert.equal(await page.locator('#view-report tr[data-qn]').count(), chapter.questions.length);
      const stored = await page.evaluate(async ({ groupId, chapterId }) => {
        const response = await fetch(`/api/student/state?groupId=${groupId}`);
        return (await response.json()).attempts[chapterId]?.at(-1);
      }, { groupId, chapterId: chapter.id });
      assert.equal(stored.score, expectedScore);
      assert.equal(stored.detail.length, chapter.questions.length);
      assert.match(stored.hash, /^[a-f0-9]{64}$/);
      console.log(`Capítulo ${chapter.id}: ${expectedScore}/${chapter.questions.length}; intento ${stored.id}`);

      if (chapter.id === 1) {
        await page.locator('tr[data-qn="1"]').click();
        assert.equal(await page.locator('tr[data-tray-for="1"]').isVisible(), true);
        await page.locator('tr[data-qn="1"]').click();
        await page.evaluate(() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; });
        await page.locator('#btn-print-report').click();
        assert.equal(await page.evaluate(() => window.__printCalled), true);
        await page.pdf({ path: path.join(output, 'Reporte_Capitulo_1_Prueba.pdf'), format: 'A4', printBackground: true });
        await page.reload();
        await page.locator('#view-dashboard.active').waitFor();
        const saved = await page.evaluate(async groupId => {
          const response = await fetch(`/api/student/state?groupId=${groupId}`);
          return (await response.json()).attempts['1'].length;
        }, groupId);
        assert.equal(saved, 1, 'El intento debe persistir tras recargar');
      } else {
        await page.locator('#btn-report-back-dash').click();
      }
    }

    assert.equal(answered, exams.reduce((n, chapter) => n + chapter.questions.length, 0));
    await page.locator('#nav-summary').click();
    await page.locator('#view-summary.active').waitFor();
    assert.equal(await page.locator('[data-summary-chap]').count(), 10);
    const summaryText = await page.locator('#view-summary').innerText();
    assert.ok(summaryText.includes('Prueba Automatizada A3'));
    assert.ok(summaryText.includes('99.7%'));
    await page.evaluate(() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; });
    await page.locator('#btn-print-summary').click();
    assert.equal(await page.evaluate(() => window.__printCalled), true);
    await page.pdf({ path: path.join(output, 'Dossier_Consolidado_Prueba.pdf'), format: 'A4', printBackground: true });
    for (const name of ['Reporte_Capitulo_1_Prueba.pdf', 'Dossier_Consolidado_Prueba.pdf']) {
      const pdf = fs.readFileSync(path.join(output, name));
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(pdf.length > 10000, `${name} debe contener contenido real`);
    }

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminPage.goto(base);
    await adminPage.locator('#auth-in-id').fill('admin@example.com');
    await adminPage.locator('#auth-in-pass').fill('admin-password-12345');
    await adminPage.locator('#btn-auth-submit').click();
    await adminPage.locator('#view-admin.active').waitFor();
    assert.ok((await adminPage.locator('#view-admin').innerText()).includes('Maestra de Prueba'));
    await adminContext.close();

    const teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto(base);
    await teacherPage.locator('#auth-in-id').fill('teacher@example.com');
    await teacherPage.locator('#auth-in-pass').fill(password);
    await teacherPage.locator('#btn-auth-submit').click();
    await teacherPage.locator('#view-teacher.active').waitFor();
    await teacherPage.locator(`[data-students-group="${groupId}"]`).click();
    await teacherPage.locator('#teacher-detail').getByText('Prueba Automatizada A3').waitFor();
    assert.ok((await teacherPage.locator('#teacher-detail').innerText()).includes('Prueba Automatizada A3'));
    assert.ok((await teacherPage.locator('#teacher-detail').innerText()).includes('Intentos: 10'));
    await teacherPage.locator('#teacher-group-form [name="university"]').fill('Universidad B');
    await teacherPage.locator('#teacher-group-form [name="subject"]').fill('Criptografía');
    await teacherPage.locator('#teacher-group-form [name="name"]').fill('Grupo B');
    await teacherPage.locator('#teacher-group-form button').click();
    await teacherPage.locator('#view-teacher').getByText('Universidad B · Criptografía').waitFor();
    const secondGroup = (await teacher.get('/api/teacher/groups')).body.groups.find(group => group.university === 'Universidad B');
    assert.ok(secondGroup);
    await teacherPage.locator(`[data-invite-group="${secondGroup.id}"]`).click();
    const secondInvite = await teacherPage.locator('#teacher-detail a').getAttribute('href');
    assert.ok(new URL(secondInvite).searchParams.get('invite'));
    await teacherContext.close();

    await page.locator('#btn-summary-back-dash').click();
    await page.locator('#student-join-token').fill(secondInvite);
    await page.locator('#btn-student-join').click();
    await page.locator(`#student-group-select option[value="${secondGroup.id}"]`).waitFor({ state: 'attached' });
    await page.locator('#student-group-select').selectOption(secondGroup.id);
    await page.waitForFunction(() => document.querySelector('#stat-completed-exams')?.textContent === '0 / 10');
    assert.equal(await page.locator('#stat-completed-exams').textContent(), '0 / 10');
    await page.locator('#student-group-select').selectOption(groupId);
    await page.waitForFunction(() => document.querySelector('#stat-completed-exams')?.textContent === '10 / 10');
    assert.equal(await page.locator('#stat-completed-exams').textContent(), '10 / 10');
    assert.deepEqual(errors, []);
    console.log(`OK: ${answered} preguntas respondidas, 10 reportes validados y 2 PDF generados en ${output}`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
