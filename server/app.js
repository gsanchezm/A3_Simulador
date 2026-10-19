const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const { randomUUID, createHmac } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { transaction } = require('./database');
const { hashPassword, verifyPassword, token, hashToken, cleanEmail, cleanText, validEmail, validPassword } = require('./security');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data', 'exams.manifest.json'), 'utf8'));
const chapters = manifest.map(file => JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8')));
const byChapter = new Map(chapters.map(chapter => [chapter.id, chapter]));
const cookieName = 'a3_session';
const sessionMillis = 7 * 24 * 60 * 60 * 1000;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role,
    approved: user.approved, studentId: user.student_id || '' };
}

function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: sessionMillis };
}

function createApp(db, signingKey) {
  if (!signingKey || signingKey.length < 32) throw new Error('REPORT_SIGNING_KEY debe tener al menos 32 caracteres');
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  } }));
  app.use(express.json({ limit: '150kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.get('origin')) return next();
    if (req.get('origin') !== `${req.protocol}://${req.get('host')}`) return next(fail(403, 'Origen no permitido'));
    next();
  });
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

  async function authenticate(req, _res, next) {
    try {
      const value = req.cookies[cookieName];
      if (!value) fail(401, 'Inicia sesión');
      const result = await db.query(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=$1 AND s.expires_at>now()`, [hashToken(value)]);
      if (!result.rows.length) fail(401, 'Sesión vencida');
      req.user = result.rows[0];
      next();
    } catch (error) { next(error); }
  }

  const role = wanted => (req, _res, next) => {
    if (req.user.role !== wanted) return next(fail(403, 'Acceso no autorizado'));
    if (wanted === 'teacher' && !req.user.approved) return next(fail(403, 'Cuenta de maestro pendiente de aprobación'));
    next();
  };

  async function ownGroup(req, groupId) {
    const result = await db.query('SELECT * FROM groups WHERE id=$1 AND teacher_id=$2', [groupId, req.user.id]);
    if (!result.rows.length) fail(404, 'Grupo no encontrado');
    return result.rows[0];
  }

  async function memberGroup(req, groupId) {
    const result = await db.query(`SELECT g.* FROM groups g JOIN memberships m ON m.group_id=g.id
      WHERE g.id=$1 AND m.student_id=$2`, [groupId, req.user.id]);
    if (!result.rows.length) fail(403, 'No perteneces a este grupo');
    return result.rows[0];
  }

  async function createSession(res, user) {
    const value = token();
    await db.query('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)',
      [hashToken(value), user.id, new Date(Date.now() + sessionMillis)]);
    res.cookie(cookieName, value, cookieOptions());
  }

  app.get('/api/health', async (_req, res, next) => {
    try { await db.query('SELECT 1'); res.json({ ok: true }); } catch (error) { next(error); }
  });

  app.get('/api/invitations/:token', async (req, res, next) => {
    try {
      const result = await db.query(`SELECT g.university,g.subject,g.name,i.expires_at
        FROM invitations i JOIN groups g ON g.id=i.group_id
        WHERE i.token_hash=$1 AND i.expires_at>now() AND i.uses<i.max_uses`, [hashToken(req.params.token)]);
      if (!result.rows.length) fail(404, 'Invitación inválida o vencida');
      res.json(result.rows[0]);
    } catch (error) { next(error); }
  });

  app.post('/api/auth/signup-teacher', authLimit, async (req, res, next) => {
    try {
      const email = cleanEmail(req.body.email);
      const name = cleanText(req.body.name);
      if (!validEmail(email) || !name || !validPassword(req.body.password)) fail(400, 'Nombre, correo y contraseña de 12 a 128 caracteres son obligatorios');
      const user = { id: randomUUID(), name, email, role: 'teacher', approved: false };
      await db.query('INSERT INTO users (id,name,email,password_hash,role,approved) VALUES ($1,$2,$3,$4,$5,false)',
        [user.id, name, email, await hashPassword(req.body.password), user.role]);
      res.status(201).json({ user, message: 'Cuenta creada. Espera la aprobación del administrador.' });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/signup-student', authLimit, async (req, res, next) => {
    try {
      const email = cleanEmail(req.body.email);
      const name = cleanText(req.body.name);
      const studentId = cleanText(req.body.studentId, 60);
      const invite = String(req.body.invite || '');
      if (!validEmail(email) || !name || !validPassword(req.body.password) || !invite) fail(400, 'Completa nombre, correo, contraseña e invitación');
      const user = { id: randomUUID(), name, email, role: 'student', approved: true, studentId };
      await transaction(db, async client => {
        const claimed = await client.query(`UPDATE invitations SET uses=uses+1
          WHERE token_hash=$1 AND expires_at>now() AND uses<max_uses RETURNING group_id`, [hashToken(invite)]);
        if (!claimed.rows.length) fail(400, 'Invitación inválida o vencida');
        await client.query(`INSERT INTO users (id,name,email,password_hash,role,approved,student_id)
          VALUES ($1,$2,$3,$4,'student',true,$5)`, [user.id, name, email, await hashPassword(req.body.password), studentId]);
        await client.query('INSERT INTO memberships (group_id,student_id) VALUES ($1,$2)', [claimed.rows[0].group_id, user.id]);
      });
      await createSession(res, user);
      res.status(201).json({ user });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/login', authLimit, async (req, res, next) => {
    try {
      const email = cleanEmail(req.body.email);
      const result = await db.query('SELECT * FROM users WHERE email=$1', [email]);
      const user = result.rows[0];
      if (!user || !await verifyPassword(req.body.password, user.password_hash)) fail(401, 'Credenciales incorrectas');
      if (user.role === 'teacher' && !user.approved) fail(403, 'Cuenta de maestro pendiente de aprobación');
      await createSession(res, user);
      res.json({ user: publicUser(user) });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/logout', authenticate, async (req, res, next) => {
    try {
      await db.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(req.cookies[cookieName])]);
      res.clearCookie(cookieName, { path: '/' });
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.get('/api/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));
  app.patch('/api/me', authenticate, async (req, res, next) => {
    try {
      const name = cleanText(req.body.name);
      const studentId = cleanText(req.body.studentId, 60);
      if (!name) fail(400, 'El nombre es obligatorio');
      const result = await db.query(`UPDATE users SET name=$1, student_id=CASE WHEN role='student' THEN $2 ELSE student_id END
        WHERE id=$3 RETURNING *`, [name, studentId, req.user.id]);
      res.json({ user: publicUser(result.rows[0]) });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/teachers', authenticate, role('admin'), async (_req, res, next) => {
    try {
      const result = await db.query("SELECT id,name,email,approved,created_at FROM users WHERE role='teacher' ORDER BY created_at DESC");
      res.json({ teachers: result.rows });
    } catch (error) { next(error); }
  });
  app.patch('/api/admin/teachers/:id', authenticate, role('admin'), async (req, res, next) => {
    try {
      if (typeof req.body.approved !== 'boolean') fail(400, 'Indica approved como booleano');
      const result = await db.query("UPDATE users SET approved=$1 WHERE id=$2 AND role='teacher' RETURNING id,name,email,approved",
        [req.body.approved, req.params.id]);
      if (!result.rows.length) fail(404, 'Maestro no encontrado');
      if (!req.body.approved) await db.query('DELETE FROM sessions WHERE user_id=$1', [req.params.id]);
      res.json({ teacher: result.rows[0] });
    } catch (error) { next(error); }
  });

  app.get('/api/teacher/groups', authenticate, role('teacher'), async (req, res, next) => {
    try {
      const result = await db.query('SELECT * FROM groups WHERE teacher_id=$1 ORDER BY created_at DESC', [req.user.id]);
      const counts = await db.query(`SELECT m.group_id,count(*)::integer AS students
        FROM memberships m JOIN groups g ON g.id=m.group_id WHERE g.teacher_id=$1 GROUP BY m.group_id`, [req.user.id]);
      const byGroup = new Map(counts.rows.map(row => [row.group_id, row.students]));
      const groups = result.rows.map(group => ({ ...group, students: byGroup.get(group.id) || 0 }));
      res.json({ groups });
    } catch (error) { next(error); }
  });
  app.post('/api/teacher/groups', authenticate, role('teacher'), async (req, res, next) => {
    try {
      const university = cleanText(req.body.university);
      const subject = cleanText(req.body.subject);
      const name = cleanText(req.body.name);
      if (!university || !subject || !name) fail(400, 'Universidad, materia y grupo son obligatorios');
      const result = await db.query(`INSERT INTO groups (id,teacher_id,university,subject,name)
        VALUES ($1,$2,$3,$4,$5) RETURNING *`, [randomUUID(), req.user.id, university, subject, name]);
      res.status(201).json({ group: result.rows[0] });
    } catch (error) { next(error); }
  });
  app.post('/api/teacher/groups/:id/invitations', authenticate, role('teacher'), async (req, res, next) => {
    try {
      await ownGroup(req, req.params.id);
      const maxUses = Number(req.body.maxUses || 100);
      const expiresDays = Number(req.body.expiresDays || 7);
      if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000 || !Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 90) fail(400, 'Límites inválidos');
      const value = token();
      const expires = new Date(Date.now() + expiresDays * 86400000);
      await db.query(`INSERT INTO invitations (id,group_id,token_hash,expires_at,max_uses)
        VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), req.params.id, hashToken(value), expires, maxUses]);
      const origin = `${req.protocol}://${req.get('host')}`;
      res.status(201).json({ link: `${origin}/?invite=${encodeURIComponent(value)}`, expiresAt: expires, maxUses });
    } catch (error) { next(error); }
  });
  app.get('/api/teacher/groups/:id/students', authenticate, role('teacher'), async (req, res, next) => {
    try {
      const group = await ownGroup(req, req.params.id);
      const [members, scores] = await Promise.all([
        db.query(`SELECT u.id,u.name,u.email,u.student_id,m.joined_at
          FROM memberships m JOIN users u ON u.id=m.student_id
          WHERE m.group_id=$1 ORDER BY u.name`, [group.id]),
        db.query(`SELECT student_id,count(*)::integer AS attempts,
          sum(score)::integer AS correct,sum(total)::integer AS questions
          FROM attempts WHERE group_id=$1 GROUP BY student_id`, [group.id]),
      ]);
      const byStudent = new Map(scores.rows.map(row => [row.student_id, row]));
      const students = members.rows.map(member => ({ ...member,
        attempts: byStudent.get(member.id)?.attempts || 0,
        correct: byStudent.get(member.id)?.correct || 0,
        questions: byStudent.get(member.id)?.questions || 0 }));
      res.json({ group, students });
    } catch (error) { next(error); }
  });

  app.get('/api/student/groups', authenticate, role('student'), async (req, res, next) => {
    try {
      const result = await db.query(`SELECT g.* FROM groups g JOIN memberships m ON m.group_id=g.id
        WHERE m.student_id=$1 ORDER BY g.university,g.subject,g.name`, [req.user.id]);
      res.json({ groups: result.rows });
    } catch (error) { next(error); }
  });
  app.post('/api/student/join', authenticate, role('student'), async (req, res, next) => {
    try {
      const invite = String(req.body.invite || '');
      if (!invite) fail(400, 'La invitación es obligatoria');
      await transaction(db, async client => {
        const result = await client.query(`SELECT i.group_id FROM invitations i
          WHERE i.token_hash=$1 AND i.expires_at>now() AND i.uses<i.max_uses`, [hashToken(invite)]);
        if (!result.rows.length) fail(400, 'Invitación inválida o vencida');
        const existing = await client.query('SELECT 1 FROM memberships WHERE group_id=$1 AND student_id=$2', [result.rows[0].group_id, req.user.id]);
        if (existing.rows.length) fail(409, 'Ya perteneces a este grupo');
        const claimed = await client.query(`UPDATE invitations SET uses=uses+1
          WHERE token_hash=$1 AND expires_at>now() AND uses<max_uses RETURNING group_id`, [hashToken(invite)]);
        if (!claimed.rows.length) fail(400, 'Invitación agotada');
        await client.query('INSERT INTO memberships (group_id,student_id) VALUES ($1,$2)', [claimed.rows[0].group_id, req.user.id]);
      });
      res.status(201).json({ ok: true });
    } catch (error) { next(error); }
  });
  app.get('/api/student/state', authenticate, role('student'), async (req, res, next) => {
    try {
      const groupId = String(req.query.groupId || '');
      await memberGroup(req, groupId);
      const [attemptResult, progressResult] = await Promise.all([
        db.query('SELECT * FROM attempts WHERE student_id=$1 AND group_id=$2 ORDER BY finished_at', [req.user.id, groupId]),
        db.query('SELECT state FROM progress WHERE student_id=$1 AND group_id=$2', [req.user.id, groupId]),
      ]);
      const attempts = {};
      for (const row of attemptResult.rows) {
        (attempts[row.chapter] ||= []).push({ id: row.id, chapter: row.chapter,
          start: +new Date(row.started_at), end: +new Date(row.finished_at), duration: row.duration,
          student: { id: req.user.student_id || req.user.email, name: req.user.name, course: '' },
          detail: row.detail, score: row.score, total: row.total, pct: Number(row.pct), hash: row.hash });
      }
      res.json({ attempts, progress: progressResult.rows[0]?.state || null });
    } catch (error) { next(error); }
  });
  app.put('/api/student/progress', authenticate, role('student'), async (req, res, next) => {
    try {
      const groupId = String(req.body.groupId || '');
      await memberGroup(req, groupId);
      const state = req.body.progress;
      if (state === null) {
        await db.query('DELETE FROM progress WHERE student_id=$1 AND group_id=$2', [req.user.id, groupId]);
        return res.json({ ok: true });
      }
      const chapter = byChapter.get(Number(state?.chapter));
      if (!chapter || !Number.isInteger(state.currentIndex) || state.currentIndex < 0 || state.currentIndex >= chapter.questions.length ||
        !state.answers || typeof state.answers !== 'object' || Object.keys(state.answers).length > chapter.questions.length ||
        Object.values(state.answers).some(value => !['A','B','C','D'].includes(value))) fail(400, 'Progreso inválido');
      await db.query(`INSERT INTO progress (student_id,group_id,chapter,state) VALUES ($1,$2,$3,$4)
        ON CONFLICT (student_id,group_id) DO UPDATE SET chapter=$3,state=$4,updated_at=now()`,
      [req.user.id, groupId, chapter.id, JSON.stringify(state)]);
      res.json({ ok: true });
    } catch (error) { next(error); }
  });
  app.post('/api/student/attempts', authenticate, role('student'), async (req, res, next) => {
    try {
      const groupId = String(req.body.groupId || '');
      await memberGroup(req, groupId);
      const chapter = byChapter.get(Number(req.body.chapter));
      const answers = req.body.answers;
      if (!chapter || !answers || typeof answers !== 'object' || Array.isArray(answers) ||
        Object.keys(answers).some(key => !chapter.questions.some(q => String(q.n) === key)) ||
        Object.values(answers).some(value => !['A','B','C','D'].includes(value))) fail(400, 'Respuestas inválidas');
      const duration = Math.max(0, Math.min(86400, Number(req.body.duration) || 0));
      const startedAt = new Date(Number(req.body.start) || Date.now());
      if (Number.isNaN(+startedAt) || +startedAt > Date.now()) fail(400, 'Inicio inválido');
      const detail = chapter.questions.map(q => ({ n: q.n, given: answers[q.n] || null, correct: q.answer }));
      const score = detail.filter(item => item.given === item.correct).length;
      const id = `ATT-${randomUUID()}`;
      const pct = score / detail.length * 100;
      const signature = createHmac('sha256', signingKey).update(JSON.stringify([id, req.user.id, groupId, chapter.id, score, detail])).digest('hex');
      const result = await transaction(db, async client => {
        const inserted = await client.query(`INSERT INTO attempts
          (id,student_id,group_id,chapter,started_at,duration,answers,detail,score,total,pct,hash)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING finished_at`,
        [id, req.user.id, groupId, chapter.id, startedAt, Math.round(duration), JSON.stringify(answers), JSON.stringify(detail), score, detail.length, pct, signature]);
        await client.query('DELETE FROM progress WHERE student_id=$1 AND group_id=$2', [req.user.id, groupId]);
        return inserted.rows[0];
      });
      res.status(201).json({ attempt: { id, chapter: chapter.id, start: +startedAt,
        end: +new Date(result.finished_at), duration: Math.round(duration),
        student: { id: req.user.student_id || req.user.email, name: req.user.name, course: '' },
        detail, score, total: detail.length, pct, hash: signature } });
    } catch (error) { next(error); }
  });

  app.get('/', (_req, res) => res.sendFile(path.join(root, 'index.html')));
  for (const filename of ['app.js', 'portal.js', 'styles.css']) {
    app.get(`/${filename}`, (_req, res) => res.sendFile(path.join(root, filename)));
  }
  app.use('/data', express.static(path.join(root, 'data'), { dotfiles: 'deny', index: false }));
  app.use((req, _res, next) => next(fail(404, 'Ruta no encontrada')));
  app.use((error, _req, res, _next) => {
    if (error.code === '23505') return res.status(409).json({ error: 'El correo o registro ya existe' });
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: 'Error interno del servidor' });
  });
  return app;
}

module.exports = { createApp };
