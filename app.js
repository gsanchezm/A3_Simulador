/* ==========================================================
   CISSP Exam Suite - Interactive Dashboard & Exam Runner
   Author: Gilberto Sánchez Mares · Matrícula: 70215592620
   Asignatura: Seguridad Avanzada (Trimestre 4)
   ========================================================== */

(async () => {
  'use strict';

  async function loadExams() {
    const manifestResponse = await fetch('data/exams.manifest.json');
    if (!manifestResponse.ok) throw new Error(`No se pudo cargar el manifiesto (${manifestResponse.status})`);
    const files = await manifestResponse.json();
    if (!Array.isArray(files) || files.length === 0) throw new Error('El manifiesto de exámenes está vacío');
    const chapters = await Promise.all(files.map(async (file) => {
      const response = await fetch(new URL(file, manifestResponse.url));
      if (!response.ok) throw new Error(`No se pudo cargar ${file} (${response.status})`);
      return response.json();
    }));
    if (new Set(chapters.map(ch => ch.id)).size !== chapters.length) {
      throw new Error('Hay capítulos con identificadores duplicados');
    }
    return chapters.sort((a, b) => a.id - b.id);
  }

  const EXAMS = await loadExams();
  const PASSING_SCORE = 70; // 70% passing grade
  const LETTERS = ['A', 'B', 'C', 'D'];

  // Selectores y Funciones Utilitarias Críticas
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud');
    return data;
  }

  const escapeHtml = (text) =>
    String(text ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));

  const formatTimer = (secs) => {
    secs = Math.max(0, Math.round(secs));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  function saveCurrentUserState() {
    if (!currentUser || currentUser.role !== 'student' || !currentGroupId) return progressQueue;
    const groupId = currentGroupId;
    const snapshot = activeExam ? { ...activeExam, answers: { ...activeExam.answers }, flags: { ...activeExam.flags } } : null;
    progressQueue = progressQueue.catch(() => {}).then(() => api('/api/student/progress', {
      method: 'PUT', body: JSON.stringify({ groupId, progress: snapshot }),
    })).catch(error => showToast(error.message));
    return progressQueue;
  }

  // Estado activo en memoria
  let currentUser = null;
  let profile = { id: '', name: '', course: '' };
  let attempts = {};
  let activeExam = null;
  let groups = [];
  let currentGroupId = null;
  let progressQueue = Promise.resolve();
  let examTimer = null;
  let activeFilter = 'all';
  let isRegisterMode = false;

  const formatDate = (ts) =>
    new Date(ts).toLocaleString('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

  // Iconos temáticos SVG para los 10 dominios CISSP
  const DOMAIN_ICONS = {
    1: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><circle cx="12" cy="11" r="3"/></svg>`,
    2: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/></svg>`,
    3: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 21h18M3 7l9-4 9 4M4 7v14M20 7v14M8 11v6M12 11v6M16 11v6"/></svg>`,
    4: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3"/><path d="M12 10v6"/></svg>`,
    5: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    6: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="m21 2-2 2m-6 6 4-4m-6 6 2-2m-4 4 2-2"/></svg>`,
    7: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 12A10 10 0 0 0 12 2v10z"/><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
    8: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m14 2-4 4 4 4"/><path d="m3 14 4-4 4 4"/><circle cx="12" cy="12" r="9"/></svg>`,
    9: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    10: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  };

  const getChapter = (id) => EXAMS.find((c) => c.id === +id);
  const getLatestAttempt = (id) => (attempts[id] || []).slice(-1)[0];

  /* ---------------- Utilidades UI ---------------- */
  function showView(viewName) {
    if (!currentUser && viewName !== 'auth') {
      viewName = 'auth';
    }

    $$('.view-panel').forEach((p) => p.classList.toggle('active', p.id === `view-${viewName}`));
    $$('.nav-item').forEach((item) => item.classList.remove('active'));

    if (viewName === 'dashboard') $('#nav-dash')?.classList.add('active');
    if (viewName === 'summary') $('#nav-summary')?.classList.add('active');

    // Header y Sidebar visibles o limpios según auth
    const headerTitle = $('#page-heading');
    const headerSub = $('#page-subheading');
    const btnLogout = $('#btn-logout');
    const headerActions = $('.header-actions');

    if (viewName === 'auth') {
      if (headerTitle) headerTitle.textContent = 'Portal de Acceso';
      if (headerSub) headerSub.textContent = 'Inicia sesión o crea tu cuenta';
      if (btnLogout) btnLogout.style.display = 'none';
      if (headerActions) headerActions.style.display = 'none';
    } else {
      if (headerTitle) headerTitle.textContent = viewName === 'teacher' ? 'Panel del Maestro' : viewName === 'admin' ? 'Administración' : 'Panel Principal';
      if (headerSub) headerSub.textContent = 'Exámenes de Práctica CISSP (3.ª Ed.) · Actividad A3';
      if (btnLogout) btnLogout.style.display = 'flex';
      if (headerActions) headerActions.style.display = 'flex';
    }
    const searchBox = $('.search-box');
    if (searchBox) searchBox.style.display = currentUser?.role === 'student' ? '' : 'none';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showToast(msg) {
    const toast = $('#app-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._timeout);
    showToast._timeout = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function openModal(title, message, okText = 'Confirmar') {
    return new Promise((resolve) => {
      const modal = $('#app-modal');
      $('#modal-title').textContent = title;
      $('#modal-body').innerHTML = message;
      $('#modal-btn-ok').textContent = okText;
      modal.classList.add('open');

      const finish = (result) => {
        modal.classList.remove('open');
        $('#modal-btn-ok').onclick = null;
        $('#modal-btn-cancel').onclick = null;
        resolve(result);
      };

      $('#modal-btn-ok').onclick = () => finish(true);
      $('#modal-btn-cancel').onclick = () => finish(false);
    });
  }

  /* ==========================================================
     VISTA DASHBOARD PRINCIPAL
     ========================================================== */
  function renderDashboard() {
    updateProfileBadges();

    $('#stat-total-chapters').textContent = `${EXAMS.length} Capítulos de Examen`;
    $('#catalog-chapters-label').textContent = `${EXAMS.length} Capítulos`;
    $$('[data-filter]').forEach((button) => {
      if (button.dataset.filter === 'all') {
        button.textContent = `Todos (${EXAMS.length})`;
      } else {
        const group = EXAMS.filter(ch => String(ch.block) === button.dataset.filter);
        if (group.length) button.textContent = `Bloque ${button.dataset.filter} (${group[0].id}–${group.at(-1).id})`;
      }
    });

    const totalQuestions = EXAMS.reduce((sum, c) => sum + c.questions.length, 0);
    const completedChapters = EXAMS.filter((c) => getLatestAttempt(c.id));
    const coveragePct = Math.round((completedChapters.length / EXAMS.length) * 100);

    // Calcular promedio general
    let avgScore = 0;
    if (completedChapters.length > 0) {
      const sumScores = completedChapters.reduce((acc, c) => acc + getLatestAttempt(c.id).pct, 0);
      avgScore = sumScores / completedChapters.length;
    }

    // Hero metrics
    $('#stat-total-q').textContent = totalQuestions;
    $('#stat-completed-exams').textContent = `${completedChapters.length} / ${EXAMS.length}`;
    $('#stat-completed-sub').textContent = `${coveragePct}% cobertura`;
    $('#stat-avg-score').textContent = completedChapters.length > 0 ? `${avgScore.toFixed(1)}%` : '—';
    $('#hero-progress-pill').textContent = `${coveragePct}% Completado`;

    // Bloque 1 (Capítulos 1 a 5)
    const b1Exams = EXAMS.filter((c) => c.block === 1);
    const b1Done = b1Exams.filter((c) => getLatestAttempt(c.id));
    const b1Avg = b1Done.length ? (b1Done.reduce((acc, c) => acc + getLatestAttempt(c.id).pct, 0) / b1Done.length).toFixed(1) + '%' : '—';
    $('#b1-status-pill').textContent = `${b1Done.length}/${b1Exams.length} Listos`;
    $('#b1-stat-avg').textContent = b1Avg;

    // Bloque 2 (Capítulos 6 a 10)
    const b2Exams = EXAMS.filter((c) => c.block === 2);
    const b2Done = b2Exams.filter((c) => getLatestAttempt(c.id));
    const b2Avg = b2Done.length ? (b2Done.reduce((acc, c) => acc + getLatestAttempt(c.id).pct, 0) / b2Done.length).toFixed(1) + '%' : '—';
    $('#b2-status-pill').textContent = `${b2Done.length}/${b2Exams.length} Listos`;
    $('#b2-stat-avg').textContent = b2Avg;

    // Gauge de Readiness
    updateReadinessGauge(coveragePct, avgScore);

    // Recent attempts list
    renderRecentAttempts();

    // Render de tarjetas de dominios
    renderDomainCards();
  }

  function updateProfileBadges() {
    $('#badge-name').textContent = profile.name || 'Usuario';
    $('#badge-id').textContent = currentUser?.role === 'student'
      ? `Mat: ${profile.id || '—'} · ${profile.course || 'Sin grupo'}`
      : currentUser?.role === 'teacher' ? 'Maestro' : 'Administrador';

    const initials = (profile.name || 'GS')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
    $('#avatar-initials').textContent = initials || 'GS';
  }

  function updateReadinessGauge(coveragePct, avgScore) {
    const C = 2 * Math.PI * 56; // 351.8
    const readiness = Math.round((coveragePct * 0.4) + (avgScore * 0.6));
    const offset = C - (C * (readiness / 100));

    const gaugeCircle = $('#gauge-fill-circle');
    if (gaugeCircle) gaugeCircle.style.strokeDashoffset = offset;

    $('#gauge-pct-val').textContent = `${readiness}%`;

    let desc = 'Pendiente de Evaluaciones';
    if (readiness >= 75) desc = 'Listo para el Examen CISSP';
    else if (readiness >= 50) desc = 'Buen progreso · Continúa practicando';
    else if (readiness > 0) desc = 'En progreso · Etapa inicial';
    $('#gauge-status-desc').textContent = desc;
  }

  function renderDomainCards() {
    const grid = $('#domains-grid');
    if (!grid) return;

    const searchTerm = ($('#domain-search')?.value || '').toLowerCase().trim();

    const filtered = EXAMS.filter((c) => {
      const matchBlock = activeFilter === 'all' || String(c.block) === activeFilter;
      const matchSearch =
        !searchTerm ||
        c.title_en.toLowerCase().includes(searchTerm) ||
        c.title_es.toLowerCase().includes(searchTerm) ||
        `chapter ${c.id}`.includes(searchTerm) ||
        `capitulo ${c.id}`.includes(searchTerm) ||
        `bloque ${c.block}`.includes(searchTerm);
      return matchBlock && matchSearch;
    });

    grid.innerHTML = filtered
      .map((c) => {
        const attempt = getLatestAttempt(c.id);
        const inProgress = activeExam && activeExam.chapter === c.id;
        const icon = DOMAIN_ICONS[c.id] || DOMAIN_ICONS[1];

        let statusPill = `<span class="domain-status-pill">Pendiente</span>`;
        let barClass = '';
        let pctVal = 0;

        if (inProgress) {
          statusPill = `<span class="domain-status-pill" style="background:var(--color-warning-bg);color:#b58100;">En curso</span>`;
          pctVal = Math.round((Object.keys(activeExam.answers).length / c.questions.length) * 100);
        } else if (attempt) {
          pctVal = attempt.pct;
          const passed = attempt.pct >= PASSING_SCORE;
          statusPill = `<span class="domain-status-pill ${passed ? 'pass' : 'fail'}">${passed ? 'Aprobado ' : 'No aprobado '}${attempt.pct.toFixed(0)}%</span>`;
          barClass = passed ? 'success' : 'danger';
        }

        return `
          <div class="domain-card" data-chap="${c.id}" role="button" tabindex="0">
            <span class="cap-num">CAP ${c.id}</span>
            <div class="domain-icon-circle">${icon}</div>
            <h4 title="${escapeHtml(c.title_en)}">${escapeHtml(c.title_en)}</h4>
            <div class="sub-theme" title="${escapeHtml(c.title_es)}">${escapeHtml(c.title_es)}</div>

            <div class="domain-progress-section">
              <div class="domain-progress-labels">
                <span>${c.questions.length} preguntas</span>
                <b>${attempt ? `${attempt.score}/${attempt.total}` : (inProgress ? 'En curso' : '0%')}</b>
              </div>
              <div class="domain-bar">
                <div class="domain-bar-fill ${barClass}" style="width: ${pctVal}%"></div>
              </div>
            </div>

            <div class="domain-card-footer">
              ${statusPill}
              <span class="domain-action-link">
                ${attempt ? 'Revisar / Repetir' : 'Iniciar Examen'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px;"><polyline points="9 18 15 12 9 6"/></svg>
              </span>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderRecentAttempts() {
    const listEl = $('#recent-activity-box');
    if (!listEl) return;

    const allAttempts = [];
    Object.keys(attempts).forEach((chapId) => {
      (attempts[chapId] || []).forEach((att) => {
        allAttempts.push(att);
      });
    });

    allAttempts.sort((a, b) => b.end - a.end);

    if (allAttempts.length === 0) {
      listEl.innerHTML = `
        <div style="font-size:0.8rem; color:var(--text-muted); text-align:center; padding:18px 0;">
          Aún no hay intentos registrados. ¡Selecciona un dominio abajo para comenzar a practicar!
        </div>`;
      return;
    }

    listEl.innerHTML = allAttempts
      .slice(0, 5)
      .map((att) => {
        const ch = getChapter(att.chapter);
        const passed = att.pct >= PASSING_SCORE;
        return `
          <div class="activity-item" data-report-chap="${att.chapter}" data-report-id="${att.id}" style="cursor:pointer;" title="Clic para ver reporte de resultados">
            <div class="activity-left">
              <div class="activity-icon-badge">CAP ${att.chapter}</div>
              <div class="activity-info">
                <h5>${escapeHtml(ch?.title_es || ch?.title_en || `Dominio ${att.chapter}`)}</h5>
                <span>${formatDate(att.end)}</span>
              </div>
            </div>
            <div class="activity-score ${passed ? 'pass' : 'fail'}">${att.pct.toFixed(0)}%</div>
          </div>
        `;
      })
      .join('');
  }

  async function handleChapterClick(chapId) {
    chapId = +chapId;
    if (activeExam && activeExam.chapter === chapId) {
      return resumeExam();
    }

    const latest = getLatestAttempt(chapId);

    if (activeExam && activeExam.chapter !== chapId) {
      const confirmDiscard = await openModal(
        'Examen Activo en Curso',
        `Tienes el Capítulo ${activeExam.chapter} actualmente en progreso. ¿Deseas descartarlo e iniciar el Capítulo ${chapId}?`,
        'Descartar y Cambiar'
      );
      if (!confirmDiscard) return;
    }

    if (latest) {
      const choice = await openModal(
        `Capítulo ${chapId} Ya Evaluado`,
        `Calificación más reciente: <b>${latest.score}/${latest.total} (${latest.pct.toFixed(1)}%)</b> el ${formatDate(latest.end)}.<br><br>¿Deseas revisar el reporte de justificaciones o realizar un nuevo intento?`,
        'Ver Reporte'
      );
      if (choice) {
        return renderReport(chapId, latest.id);
      }
    }

    startNewExam(chapId);
  }

  /* ==========================================================
     VISTA DEL EXAMEN (PREGUNTAS EN INGLÉS ORIGINAL)
     ========================================================== */
  function startNewExam(chapId) {
    activeExam = {
      chapter: chapId,
      start: Date.now(),
      elapsed: 0,
      answers: {},
      flags: {},
      currentIndex: 0,
    };
    saveCurrentUserState();
    resumeExam();
  }

  function resumeExam() {
    const ch = getChapter(activeExam.chapter);
    if (!ch) return;

    $('#exam-tag-badge').textContent = `Bloque ${ch.block} · Capítulo ${ch.id} (${ch.questions.length} Preguntas · Inglés original)`;
    $('#exam-domain-title').textContent = `${ch.title_en} (${ch.title_es})`;

    showView('exam');
    renderExamQuestion();

    // Temporizador
    clearInterval(examTimer);
    let lastTick = Date.now();
    examTimer = setInterval(() => {
      const now = Date.now();
      activeExam.elapsed += (now - lastTick) / 1000;
      lastTick = now;
      $('#exam-timer-display').textContent = formatTimer(activeExam.elapsed);

      if (Math.round(activeExam.elapsed) % 5 === 0) {
        saveCurrentUserState();
      }
    }, 1000);
    $('#exam-timer-display').textContent = formatTimer(activeExam.elapsed);
  }

  function renderExamQuestion() {
    const ch = getChapter(activeExam.chapter);
    const qIndex = activeExam.currentIndex;
    const q = ch.questions[qIndex];
    const userSelected = activeExam.answers[q.n];
    const isFlagged = !!activeExam.flags[q.n];

    // Escenario compartido (si aplica, en inglés original)
    const scenarioBox = $('#exam-scenario-box');
    if (q.scenario) {
      scenarioBox.style.display = 'block';
      $('#exam-scenario-content').textContent = q.scenario;
    } else {
      scenarioBox.style.display = 'none';
    }

    // Texto de la pregunta (100% inglés original)
    $('#exam-question-text').textContent = `${q.n}. ${q.q}`;

    // Imagen / Gráfico de la pregunta
    const imgBox = $('#exam-image-box');
    if (q.images && q.images.length > 0) {
      imgBox.style.display = 'block';
      imgBox.innerHTML = q.images
        .map((src) => `<img src="${src}" alt="Question graphic illustration" loading="lazy">`)
        .join('');
    } else {
      imgBox.style.display = 'none';
      imgBox.innerHTML = '';
    }

    // Opciones A, B, C, D (100% inglés original)
    const optionsContainer = $('#exam-options-container');
    optionsContainer.innerHTML = q.options
      .map((optText, k) => {
        const letter = LETTERS[k];
        const isSelected = userSelected === letter;
        return `
          <button class="option-button ${isSelected ? 'selected' : ''}" data-letter="${letter}">
            <div class="option-letter-circle">${letter}</div>
            <div style="line-height:1.5;">${escapeHtml(optText)}</div>
          </button>
        `;
      })
      .join('');

    // Estado del botón Flag
    const flagBtn = $('#btn-exam-flag');
    flagBtn.classList.toggle('active', isFlagged);
    flagBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="${isFlagged ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" style="width:16px;height:16px;"><path d="M4 22V4m0 0h13l-2 4 2 4H4"/></svg>
      ${isFlagged ? 'Marcada para Revisión' : 'Marcar para Revisión'}
    `;

    // Botones Prev / Next
    $('#btn-exam-prev').disabled = qIndex === 0;
    const isLast = qIndex === ch.questions.length - 1;
    $('#btn-exam-next').innerHTML = isLast
      ? `Revisar y Finalizar <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px;"><polyline points="20 6 9 17 4 12"/></svg>`
      : `Siguiente <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:16px;height:16px;"><polyline points="9 18 15 12 9 6"/></svg>`;

    // Grid de navegación
    renderExamNavGrid();
  }

  function renderExamNavGrid() {
    const ch = getChapter(activeExam.chapter);
    const answeredCount = Object.keys(activeExam.answers).length;
    $('#exam-progress-counter').textContent = `${answeredCount} / ${ch.questions.length}`;

    const grid = $('#exam-nav-grid');
    grid.innerHTML = ch.questions
      .map((q, idx) => {
        const isAnswered = !!activeExam.answers[q.n];
        const isFlagged = !!activeExam.flags[q.n];
        const isCurrent = idx === activeExam.currentIndex;

        let classes = ['grid-q-btn'];
        if (isAnswered) classes.push('answered');
        if (isFlagged) classes.push('flagged');
        if (isCurrent) classes.push('current');

        return `<button class="${classes.join(' ')}" data-index="${idx}">${q.n}</button>`;
      })
      .join('');
  }

  function selectOption(letter) {
    const ch = getChapter(activeExam.chapter);
    const q = ch.questions[activeExam.currentIndex];
    activeExam.answers[q.n] = letter;
    saveCurrentUserState();

    $$('.option-button').forEach((b) => {
      b.classList.toggle('selected', b.dataset.letter === letter);
    });
    renderExamNavGrid();
  }

  function toggleFlagCurrentQuestion() {
    const ch = getChapter(activeExam.chapter);
    const q = ch.questions[activeExam.currentIndex];
    activeExam.flags[q.n] = !activeExam.flags[q.n];
    saveCurrentUserState();
    renderExamQuestion();
  }

  async function finishAndGradeExam() {
    const ch = getChapter(activeExam.chapter);
    const missing = ch.questions.filter((q) => !activeExam.answers[q.n]).map((q) => q.n);
    const flagged = ch.questions.filter((q) => activeExam.flags[q.n]).map((q) => q.n);

    let confirmMsg = `¿Listo para entregar y calificar el <b>Capítulo ${ch.id} (${escapeHtml(ch.title_es || ch.title_en)})</b>? Tus respuestas se evaluarán con la clave oficial de inmediato.`;
    if (missing.length > 0) {
      confirmMsg += `<br><br><span style="color:var(--color-danger); font-weight:700;">Preguntas sin responder (${missing.length}):</span> ${missing.join(', ')}`;
    }
    if (flagged.length > 0) {
      confirmMsg += `<br><span style="color:var(--color-warning); font-weight:700;">Preguntas marcadas para revisión (${flagged.length}):</span> ${flagged.join(', ')}`;
    }

    const ok = await openModal('Calificar Examen', confirmMsg, 'Calificar Ahora');
    if (!ok) return;

    await progressQueue;
    try {
      const { attempt } = await api('/api/student/attempts', {
        method: 'POST',
        body: JSON.stringify({ groupId: currentGroupId, chapter: ch.id,
          answers: activeExam.answers, start: activeExam.start, duration: Math.round(activeExam.elapsed) }),
      });
      clearInterval(examTimer);
      if (!attempts[ch.id]) attempts[ch.id] = [];
      attempts[ch.id].push(attempt);
      activeExam = null;
      renderReport(ch.id, attempt.id);
    } catch (error) { showToast(error.message); }
  }

  /* ==========================================================
     VISTA DEL REPORTE DE RESULTADOS
     ========================================================== */
  function renderReport(chapId, attemptId) {
    const ch = getChapter(chapId);
    const list = attempts[chapId] || [];
    const att = list.find((x) => x.id === attemptId) || list[list.length - 1];

    if (!att) {
      showToast('No se encontraron resultados para este capítulo');
      showView('dashboard');
      return;
    }

    const passed = att.pct >= PASSING_SCORE;
    const questionsByN = Object.fromEntries(ch.questions.map((q) => [q.n, q]));
    const wrongCount = att.detail.filter((d) => d.given !== d.correct).length;
    const unansCount = att.detail.filter((d) => !d.given).length;

    const reportView = $('#view-report');
    reportView.innerHTML = `
      <div class="report-container">

        <!-- HEADER HERO DEL REPORTE -->
        <div class="report-hero-card">
          <div>
            <span class="exam-tag-capsule">Reporte Oficial de Evaluación · Bloque ${ch.block}</span>
            <h2 style="font-size:1.6rem; font-weight:800; margin:10px 0 4px; color:var(--text-main);">
              Capítulo ${ch.id}: ${escapeHtml(ch.title_en)}
            </h2>
            <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:14px;">
              ${escapeHtml(ch.title_es)} — CISSP Practice Exams, 3rd Ed. (Shon Harris)
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:0.84rem; color:var(--text-main); margin-bottom:12px;">
              <span>Estudiante: <b>${escapeHtml(att.student.name || profile.name)}</b></span>
              <span>Matrícula: <b>${escapeHtml(att.student.id || profile.id)}</b></span>
              <span>Asignatura: <b>${escapeHtml(att.student.course || profile.course)}</b></span>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:0.8rem; color:var(--text-muted);">
              <span>Fecha de finalización: <b>${formatDate(att.end)}</b></span>
              <span>Tiempo total: <b>${formatTimer(att.duration)}</b></span>
              <span>Folio de intento: <b>${att.id}</b></span>
            </div>

            <div>
              <div class="verdict-tag ${passed ? 'pass' : 'fail'}">
                ${passed ? '✓ APROBADO (≥70%)' : '✗ NO APROBADO (<70%)'}
              </div>
            </div>
          </div>

          <!-- Score Circle Donut -->
          <div style="text-align:center;">
            <div class="readiness-gauge-circle" style="width:160px; height:160px; margin:0 auto;">
              <svg viewBox="0 0 140 140">
                <circle class="bg-circle" cx="70" cy="70" r="56" />
                <circle class="fill-circle" cx="70" cy="70" r="56"
                        stroke-dasharray="351.8"
                        stroke-dashoffset="${351.8 - (351.8 * (att.pct / 100))}"
                        style="stroke:${passed ? 'var(--color-success)' : 'var(--color-danger)'};" />
              </svg>
              <div class="readiness-center-text">
                <b style="font-size:2.2rem;">${att.pct.toFixed(0)}%</b>
                <span>Calificación</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 4 CAJAS DE MÉTRICAS -->
        <div class="report-stats-grid">
          <div class="report-stat-box">
            <span class="lbl">Respuestas Correctas</span>
            <div class="val" style="color:var(--color-success);">${att.score} / ${att.total}</div>
          </div>
          <div class="report-stat-box">
            <span class="lbl">Respuestas Incorrectas</span>
            <div class="val" style="color:var(--color-danger);">${wrongCount - unansCount}</div>
          </div>
          <div class="report-stat-box">
            <span class="lbl">Sin Responder</span>
            <div class="val">${unansCount}</div>
          </div>
          <div class="report-stat-box">
            <span class="lbl">Tiempo Transcurrido</span>
            <div class="val">${formatTimer(att.duration)}</div>
          </div>
        </div>

        <!-- BARRA DE ACCIONES DEL REPORTE -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div style="display:flex; gap:10px;">
            <button class="btn-primary" id="btn-print-report" style="background:var(--color-purple);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" style="width:18px;height:18px;"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg>
              Exportar Reporte (PDF)
            </button>
            <button class="btn-secondary" id="btn-report-back-dash">
              ← Volver al Panel Principal
            </button>
            <button class="btn-secondary" id="btn-report-retry">Nuevo intento</button>
          </div>

          <div style="font-size:0.75rem; color:var(--text-muted); font-family:monospace; overflow-wrap:anywhere;">
            Sello HMAC-SHA-256: ${att.hash}
          </div>
        </div>

        <!-- TABLA DETALLADA DE PREGUNTAS Y EXPLICACIONES -->
        <div class="table-card">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="font-size:1.15rem; font-weight:800;">Desglose Pregunta por Pregunta</h3>
              <p style="font-size:0.78rem; color:var(--text-muted);">Haz clic en cualquier fila para desplegar la justificación oficial del libro (inglés original).</p>
            </div>
            <div class="filter-capsules">
              <button class="filter-capsule active" data-qfilter="all">Todas</button>
              <button class="filter-capsule" data-qfilter="wrong">Incorrectas</button>
              <button class="filter-capsule" data-qfilter="correct">Correctas</button>
            </div>
          </div>

          <table class="results-table">
            <thead>
              <tr>
                <th style="width:50px;">#</th>
                <th>Pregunta (Inglés original)</th>
                <th style="width:90px; text-align:center;">Tu Resp.</th>
                <th style="width:90px; text-align:center;">Correcta</th>
                <th style="width:120px; text-align:center;">Resultado</th>
              </tr>
            </thead>
            <tbody>
              ${att.detail
                .map((d) => {
                  const q = questionsByN[d.n];
                  const isCorrect = d.given === d.correct;
                  return `
                    <tr class="clickable-row" data-qn="${d.n}" data-status="${isCorrect ? 'correct' : 'wrong'}">
                      <td><b>${d.n}</b></td>
                      <td>${escapeHtml(q.q)}</td>
                      <td style="text-align:center; font-weight:800;">${d.given || '—'}</td>
                      <td style="text-align:center; font-weight:800; color:var(--color-purple);">${d.correct}</td>
                      <td style="text-align:center;">
                        <span class="domain-status-pill ${isCorrect ? 'pass' : 'fail'}">
                          ${isCorrect ? '✓ Correcta' : (d.given ? '✗ Incorrecta' : '✗ En blanco')}
                        </span>
                      </td>
                    </tr>
                    <tr class="explanation-row" data-tray-for="${d.n}" style="display:none;">
                      <td></td>
                      <td colspan="4">
                        <div class="explanation-tray">
                          ${q.scenario ? `<div style="font-weight:700; margin-bottom:8px; color:var(--color-purple);">Escenario de Referencia: ${escapeHtml(q.scenario)}</div>` : ''}
                          <div style="margin-bottom:10px;">
                            ${q.options.map((opt, i) => {
                              const L = LETTERS[i];
                              const isCorr = L === d.correct;
                              const isGiv = L === d.given;
                              return `<div style="padding:3px 0; ${isCorr ? 'color:var(--color-success); font-weight:700;' : ''} ${isGiv && !isCorr ? 'color:var(--color-danger); text-decoration:line-through;' : ''}"><b>${L}.</b> ${escapeHtml(opt)}</div>`;
                            }).join('')}
                          </div>
                          <div style="font-weight:700; color:var(--text-main); margin-bottom:6px;">Justificación Oficial CISSP (Original):</div>
                          ${q.explanation.map((p) => `<p style="margin-bottom:6px;">${escapeHtml(p)}</p>`).join('')}
                          ${q.key_errata ? `<div style="font-size:0.75rem; color:#b58100; margin-top:6px;">⚠ Nota de errata: La clave rápida del libro listaba ${q.key_errata}; la justificación oficial del libro sustenta la opción ${q.answer}.</div>` : ''}
                        </div>
                      </td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>

      </div>
    `;

    showView('report');

    // Manejadores de eventos de la vista de reporte
    $('#btn-print-report').onclick = () => {
      window.print();
    };

    $('#btn-report-back-dash').onclick = () => {
      showView('dashboard');
      renderDashboard();
    };
    $('#btn-report-retry').onclick = () => startNewExam(ch.id);

    // Toggle para desplegar explicaciones
    $$('.clickable-row', reportView).forEach((tr) => {
      tr.onclick = () => {
        const qn = tr.dataset.qn;
        const tray = $(`tr.explanation-row[data-tray-for="${qn}"]`, reportView);
        if (tray) {
          tray.style.display = tray.style.display === 'none' ? 'table-row' : 'none';
        }
      };
    });

    // Filtros de la tabla (All / Incorrect / Correct)
    $$('.filter-capsule', reportView).forEach((btn) => {
      btn.onclick = () => {
        $$('.filter-capsule', reportView).forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.qfilter;

        $$('.clickable-row', reportView).forEach((row) => {
          const match = filter === 'all' || row.dataset.status === filter;
          row.style.display = match ? 'table-row' : 'none';
          const tray = $(`tr.explanation-row[data-tray-for="${row.dataset.qn}"]`, reportView);
          if (!match && tray) tray.style.display = 'none';
        });
      };
    });
  }

  /* ==========================================================
     VISTA DEL RESUMEN GLOBAL (DOSSIER COMPLETO ACTIVIDAD A3)
     ========================================================== */
  function renderGlobalSummary() {
    const summaryView = $('#view-summary');
    if (!summaryView) return;

    const completed = EXAMS.filter((c) => getLatestAttempt(c.id));
    const totalQ = completed.reduce((acc, c) => acc + getLatestAttempt(c.id).total, 0);
    const totalSc = completed.reduce((acc, c) => acc + getLatestAttempt(c.id).score, 0);
    const globalPct = totalQ ? ((totalSc / totalQ) * 100).toFixed(1) : '—';

    summaryView.innerHTML = `
      <div class="report-container">

        <div class="report-hero-card">
          <div>
            <span class="exam-tag-capsule">Dossier Ejecutivo · Actividad A3</span>
            <h2 style="font-size:1.6rem; font-weight:800; margin:10px 0 4px; color:var(--text-main);">
              Resultados Consolidados de Exámenes CISSP
            </h2>
            <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:14px;">
              Seguridad Avanzada · Trimestre 4 · Doctorado / Maestría
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:16px; font-size:0.84rem; color:var(--text-main);">
              <span>Estudiante: <b>${escapeHtml(profile.name)}</b></span>
              <span>Matrícula: <b>${escapeHtml(profile.id)}</b></span>
              <span>Asignatura: <b>${escapeHtml(profile.course)}</b></span>
            </div>
          </div>

          <div style="text-align:center;">
            <div class="readiness-gauge-circle" style="width:150px; height:150px; margin:0 auto;">
              <svg viewBox="0 0 140 140">
                <circle class="bg-circle" cx="70" cy="70" r="56" />
                <circle class="fill-circle" cx="70" cy="70" r="56"
                        stroke-dasharray="351.8"
                        stroke-dashoffset="${totalQ ? 351.8 - (351.8 * (totalSc / totalQ)) : 351.8}"
                        style="stroke:var(--color-purple);" />
              </svg>
              <div class="readiness-center-text">
                <b style="font-size:2rem;">${globalPct}%</b>
                <span>Promedio</span>
              </div>
            </div>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn-primary" id="btn-print-summary">
              Exportar Dossier (PDF)
            </button>
            <button class="btn-secondary" id="btn-export-backup-json">Descargar mis resultados (JSON)</button>
          </div>
          <button class="btn-secondary" id="btn-summary-back-dash">← Volver al Panel</button>
        </div>

        <!-- TABLA RESUMEN DE LOS 10 CAPÍTULOS -->
        <div class="table-card">
          <h3 style="font-size:1.15rem; font-weight:800; margin-bottom:12px;">Matriz de Rendimiento de los ${EXAMS.length} Dominios</h3>
          <table class="results-table">
            <thead>
              <tr>
                <th style="width:60px;">Cap.</th>
                <th>Dominio (Inglés original)</th>
                <th>Tema de Referencia en Español</th>
                <th style="text-align:center;">Aciertos</th>
                <th style="text-align:center;">%</th>
                <th style="text-align:center;">Estado</th>
                <th style="text-align:center;">Intentos</th>
              </tr>
            </thead>
            <tbody>
              ${EXAMS.map((c) => {
                const att = getLatestAttempt(c.id);
                const passed = att && att.pct >= PASSING_SCORE;
                const tries = (attempts[c.id] || []).length;
                return `
                  <tr class="clickable-row" data-summary-chap="${c.id}" title="Clic para ver reporte de dominio">
                    <td><b>CAP ${c.id}</b></td>
                    <td><b>${escapeHtml(c.title_en)}</b></td>
                    <td style="color:var(--text-muted); font-size:0.8rem;">${escapeHtml(c.title_es)}</td>
                    <td style="text-align:center; font-weight:700;">${att ? `${att.score}/${att.total}` : '—'}</td>
                    <td style="text-align:center; font-weight:800; color:${passed ? 'var(--color-success)' : (att ? 'var(--color-danger)' : 'var(--text-muted)')};">
                      ${att ? att.pct.toFixed(0) + '%' : '—'}
                    </td>
                    <td style="text-align:center;">
                      ${att ? `<span class="domain-status-pill ${passed ? 'pass' : 'fail'}">${passed ? 'Aprobado' : 'No Aprobado'}</span>` : '<span class="domain-status-pill">Pendiente</span>'}
                    </td>
                    <td style="text-align:center; font-weight:600;">${tries || '—'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

      </div>
    `;

    showView('summary');

    $('#btn-print-summary').onclick = () => window.print();
    $('#btn-summary-back-dash').onclick = () => {
      showView('dashboard');
      renderDashboard();
    };

    $('#btn-export-backup-json').onclick = () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify({ profile, groupId: currentGroupId, attempts }));
      const a = document.createElement('a');
      a.setAttribute('href', dataStr);
      a.setAttribute('download', `CISSP_Resultados_${profile.name.replace(/\s+/g, '_')}.json`);
      a.click();
    };

    $$('[data-summary-chap]', summaryView).forEach((tr) => {
      tr.onclick = () => {
        const chap = tr.dataset.summaryChap;
        const att = getLatestAttempt(chap);
        if (att) renderReport(chap, att.id);
        else handleChapterClick(chap);
      };
    });
  }

  /* ==========================================================
     EVENTOS GLOBALES Y BINDINGS
     ========================================================== */
  function setupEventListeners() {
    // Navegación Sidebar
    $('#nav-dash').onclick = () => renderHome();
    $('#btn-side-home').onclick = () => renderHome();
    $('#nav-exams-list').onclick = () => {
      if (currentUser?.role !== 'student') return;
      showView('dashboard');
      $('#domains-grid')?.scrollIntoView({ behavior: 'smooth' });
    };
    $('#nav-summary').onclick = () => {
      if (currentUser?.role === 'student') renderGlobalSummary();
    };
    $('#link-view-all-summary').onclick = () => {
      renderGlobalSummary();
    };

    // Filtros de Dominios (Todos / Bloque 1 / Bloque 2)
    $$('.filter-capsule[data-filter]').forEach((btn) => {
      btn.onclick = () => {
        $$('.filter-capsule[data-filter]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        renderDomainCards();
      };
    });

    // Buscador
    $('#domain-search').oninput = () => {
      renderDomainCards();
    };

    // Editar perfil al hacer clic en el widget superior
    const btnEditStudent = $('#btn-edit-student');
    if (btnEditStudent) {
      btnEditStudent.onclick = async () => {
        const modalHtml = `
          <div style="display:flex; flex-direction:column; gap:12px; margin-top:14px; text-align:left;">
            <div>
              <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted);">NOMBRE COMPLETO</label>
              <input class="student-input" id="modal-edit-name" value="${escapeHtml(profile.name)}" style="width:100%; margin-top:4px;" />
            </div>
            ${currentUser?.role === 'student' ? `<div>
              <label style="font-size:0.75rem; font-weight:700; color:var(--text-muted);">MATRÍCULA</label>
              <input class="student-input" id="modal-edit-id" value="${escapeHtml(currentUser.studentId || '')}" style="width:100%; margin-top:4px;" />
            </div>` : ''}
          </div>
        `;
        const ok = await openModal('Perfil del Estudiante', modalHtml, 'Guardar Cambios');
        if (ok) {
          const newName = $('#modal-edit-name')?.value.trim();
          const newId = $('#modal-edit-id')?.value.trim();
          try {
            const { user } = await api('/api/me', { method: 'PATCH',
              body: JSON.stringify({ name: newName, studentId: newId }) });
            currentUser = user;
            setProfile();
            updateProfileBadges();
            showToast('Perfil actualizado correctamente');
          } catch (error) { showToast(error.message); }
        }
      };
    }

    // ================= AUTENTICACIÓN / LOGIN LISTENERS =================
    const tabLogin = $('#tab-login');
    const tabRegister = $('#tab-register');
    const fieldAuthName = $('#field-auth-name');
    const fieldAuthRole = $('#field-auth-role');
    const fieldAuthInvite = $('#field-auth-invite');
    const fieldAuthStudentId = $('#field-auth-student-id');
    const roleInput = $('#auth-in-role');
    const btnAuthSubmit = $('#btn-auth-submit');
    const btnLogout = $('#btn-logout');
    $('#auth-form').onsubmit = event => event.preventDefault();

    const updateAuthFields = () => {
      fieldAuthName.style.display = isRegisterMode ? 'flex' : 'none';
      fieldAuthRole.style.display = isRegisterMode ? 'flex' : 'none';
      fieldAuthInvite.style.display = isRegisterMode && roleInput.value === 'student' ? 'flex' : 'none';
      fieldAuthStudentId.style.display = isRegisterMode && roleInput.value === 'student' ? 'flex' : 'none';
      btnAuthSubmit.textContent = isRegisterMode ? 'Crear Cuenta' : 'Iniciar Sesión';
      $('#auth-in-pass').autocomplete = isRegisterMode ? 'new-password' : 'current-password';
    };
    roleInput.onchange = updateAuthFields;

    if (tabLogin) {
      tabLogin.onclick = () => {
        isRegisterMode = false;
        tabLogin.classList.add('active');
        tabRegister?.classList.remove('active');
        updateAuthFields();
      };
    }

    if (tabRegister) {
      tabRegister.onclick = () => {
        isRegisterMode = true;
        tabRegister.classList.add('active');
        tabLogin?.classList.remove('active');
        updateAuthFields();
      };
    }

    if (btnAuthSubmit) {
      btnAuthSubmit.onclick = async () => {
        const email = $('#auth-in-id').value.trim();
        const password = $('#auth-in-pass').value;
        const name = $('#auth-in-name').value.trim();
        btnAuthSubmit.disabled = true;
        try {
          if (isRegisterMode) {
            const role = roleInput.value;
            const endpoint = role === 'teacher' ? '/api/auth/signup-teacher' : '/api/auth/signup-student';
            const invite = invitationCode($('#auth-in-invite').value);
            const { user } = await api(endpoint, { method: 'POST',
              body: JSON.stringify({ email, password, name, invite, studentId: $('#auth-in-student-id').value.trim() }) });
            if (role === 'teacher') {
              showToast('Cuenta creada. Espera la aprobación del administrador.');
              tabLogin.click();
            } else await activateUser(user);
          } else {
            const { user } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
            await activateUser(user);
          }
        } catch (error) { showToast(error.message); }
        finally { btnAuthSubmit.disabled = false; }
      };
    }

    if (btnLogout) {
      btnLogout.onclick = async () => {
        const ok = await openModal('Cerrar Sesión', '¿Deseas cerrar tu sesión actual? Tus resultados se mantendrán guardados.', 'Cerrar Sesión');
        if (ok) {
          await logoutUser();
        }
      };
    }

    $('#student-group-select').onchange = async (event) => {
      try { await selectGroup(event.target.value); } catch (error) { showToast(error.message); }
    };
    $('#btn-student-join').onclick = async () => {
      try {
        await api('/api/student/join', { method: 'POST',
          body: JSON.stringify({ invite: invitationCode($('#student-join-token').value) }) });
        $('#student-join-token').value = '';
        await loadStudentGroups();
        showToast('Te uniste al grupo');
      } catch (error) { showToast(error.message); }
    };

    // Eventos dentro de tarjetas de dominios
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.domain-card');
      if (card) {
        handleChapterClick(card.dataset.chap);
        return;
      }

      const recentItem = e.target.closest('.activity-item');
      if (recentItem) {
        renderReport(recentItem.dataset.reportChap, recentItem.dataset.reportId);
        return;
      }

      const optBtn = e.target.closest('.option-button');
      if (optBtn) {
        selectOption(optBtn.dataset.letter);
        return;
      }

      const gridBtn = e.target.closest('.grid-q-btn');
      if (gridBtn) {
        activeExam.currentIndex = +gridBtn.dataset.index;
        renderExamQuestion();
        return;
      }
    });

    // Controles de examen
    $('#btn-exam-prev').onclick = () => {
      if (activeExam && activeExam.currentIndex > 0) {
        activeExam.currentIndex--;
        renderExamQuestion();
      }
    };

    $('#btn-exam-next').onclick = () => {
      if (!activeExam) return;
      const ch = getChapter(activeExam.chapter);
      if (activeExam.currentIndex < ch.questions.length - 1) {
        activeExam.currentIndex++;
        renderExamQuestion();
      } else {
        finishAndGradeExam();
      }
    };

    $('#btn-exam-flag').onclick = () => {
      if (activeExam) toggleFlagCurrentQuestion();
    };

    $('#btn-submit-exam').onclick = () => {
      if (activeExam) finishAndGradeExam();
    };

    $('#btn-cancel-exam').onclick = async () => {
      if (!activeExam) return;
      const ok = await openModal(
        'Abandonar Examen',
        '¿Estás seguro de que deseas abandonar este examen en curso? Las respuestas no se registrarán.',
        'Abandonar'
      );
      if (ok) {
        clearInterval(examTimer);
        activeExam = null;
        saveCurrentUserState();
        showView('dashboard');
        renderDashboard();
      }
    };

    // Widgets rápidos de bloque
    $('#widget-block-1').onclick = () => {
      activeFilter = '1';
      $$('.filter-capsule[data-filter]').forEach((b) => b.classList.toggle('active', b.dataset.filter === '1'));
      renderDomainCards();
      $('#domains-grid')?.scrollIntoView({ behavior: 'smooth' });
    };

    $('#widget-block-2').onclick = () => {
      activeFilter = '2';
      $$('.filter-capsule[data-filter]').forEach((b) => b.classList.toggle('active', b.dataset.filter === '2'));
      renderDomainCards();
      $('#domains-grid')?.scrollIntoView({ behavior: 'smooth' });
    };

    // Ayuda
    $('#btn-help-modal').onclick = () => {
      openModal(
        'Simulador de Exámenes CISSP',
        `Esta plataforma evalúa los 10 dominios clave del Certified Information Systems Security Professional (CISSP) basados en el libro oficial <i>CISSP Practice Exams (3rd Edition, Shon Harris)</i>.<br><br>
        <b>Puntaje de aprobación:</b> 70% o superior.<br>
        <b>Idioma de evaluación:</b> Preguntas, opciones y justificaciones técnicas en inglés original del examen de certificación.<br>
        <b>Reportes:</b> Al finalizar cada examen se genera un reporte con calificación, desglose y justificación oficial de cada respuesta, listo para imprimir en PDF como evidencia para la Actividad A3.`
      );
    };

    // Atajos de teclado para el examen (A, B, C, D, Flechas)
    document.addEventListener('keydown', (e) => {
      if (!activeExam || !$('#view-exam').classList.contains('active')) return;
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      const key = e.key.toUpperCase();
      if (LETTERS.includes(key)) {
        selectOption(key);
      } else if (['1', '2', '3', '4'].includes(key)) {
        selectOption(LETTERS[+key - 1]);
      } else if (e.key === 'ArrowRight') {
        $('#btn-exam-next')?.click();
      } else if (e.key === 'ArrowLeft') {
        $('#btn-exam-prev')?.click();
      } else if (key === 'F') {
        toggleFlagCurrentQuestion();
      }
    });
  }

  /* ================= CUENTAS, GRUPOS Y ROLES ================= */
  function invitationCode(value) {
    const trimmed = String(value || '').trim();
    try { return new URL(trimmed).searchParams.get('invite') || trimmed; }
    catch { return trimmed; }
  }

  function setProfile() {
    const group = groups.find(item => item.id === currentGroupId);
    profile = { id: currentUser?.studentId || currentUser?.email || '',
      name: currentUser?.name || '', course: group?.subject || '' };
  }

  async function selectGroup(groupId) {
    if (activeExam) await saveCurrentUserState();
    clearInterval(examTimer);
    currentGroupId = groupId;
    const { attempts: savedAttempts, progress } = await api(`/api/student/state?groupId=${encodeURIComponent(groupId)}`);
    attempts = savedAttempts;
    activeExam = progress;
    $('#student-group-select').value = groupId;
    setProfile();
    renderDashboard();
    showView('dashboard');
    if (activeExam && getChapter(activeExam.chapter)) {
      setTimeout(async () => {
        const resume = await openModal('Reanudar Examen en Curso',
          `Tienes un examen en curso del capítulo ${activeExam.chapter}. ¿Deseas continuar?`, 'Reanudar');
        if (resume) resumeExam();
      }, 200);
    }
  }

  async function loadStudentGroups() {
    const result = await api('/api/student/groups');
    groups = result.groups;
    const select = $('#student-group-select');
    select.innerHTML = groups.map(group => `<option value="${group.id}">${escapeHtml(group.university)} · ${escapeHtml(group.subject)} · ${escapeHtml(group.name)}</option>`).join('');
    if (!groups.length) {
      attempts = {};
      activeExam = null;
      currentGroupId = null;
      showView('dashboard');
      renderDashboard();
      showToast('Necesitas una invitación de tu maestro');
      return;
    }
    await selectGroup(groups.some(group => group.id === currentGroupId) ? currentGroupId : groups[0].id);
  }

  async function activateUser(user) {
    currentUser = user;
    setProfile();
    updateProfileBadges();
    $('#nav-exams-list').style.display = user.role === 'student' ? '' : 'none';
    $('#nav-summary').style.display = user.role === 'student' ? '' : 'none';
    if (user.role === 'student') await loadStudentGroups();
    else await renderHome();
  }

  async function renderHome() {
    if (!currentUser) return showView('auth');
    if (currentUser.role === 'admin') return renderAdmin();
    if (currentUser.role === 'teacher') return renderTeacher();
    renderDashboard();
    showView('dashboard');
  }

  async function renderAdmin() {
    const { teachers } = await api('/api/admin/teachers');
    $('#view-admin').innerHTML = `<div class="report-container"><div class="report-hero-card"><div>
      <span class="exam-tag-capsule">Administración</span><h2>Maestros</h2>
      <p>Aprueba las cuentas antes de que puedan crear grupos e invitar alumnos.</p></div></div>
      <div class="table-card"><h3>${teachers.length} maestros registrados</h3><div class="management-list">
      ${teachers.map(teacher => `<div class="management-item"><b>${escapeHtml(teacher.name)}</b>
        <p>${escapeHtml(teacher.email)} · ${teacher.approved ? 'Activo' : 'Pendiente'}</p>
        <button class="btn-secondary" data-teacher="${teacher.id}" data-approved="${!teacher.approved}">
          ${teacher.approved ? 'Revocar acceso' : 'Aprobar maestro'}</button></div>`).join('') || '<p>Sin maestros registrados.</p>'}
      </div></div></div>`;
    showView('admin');
    $$('[data-teacher]', $('#view-admin')).forEach(button => button.onclick = async () => {
      try {
        await api(`/api/admin/teachers/${button.dataset.teacher}`, { method: 'PATCH',
          body: JSON.stringify({ approved: button.dataset.approved === 'true' }) });
        await renderAdmin();
      } catch (error) { showToast(error.message); }
    });
  }

  async function renderTeacher() {
    const { groups: ownGroups } = await api('/api/teacher/groups');
    $('#view-teacher').innerHTML = `<div class="report-container">
      <div class="report-hero-card"><div><span class="exam-tag-capsule">Panel del Maestro</span>
        <h2>Mis grupos</h2><p>Organiza alumnos por universidad, materia y grupo.</p></div></div>
      <div class="management-grid"><div class="table-card management-card"><h3>Crear grupo</h3>
        <form class="management-form" id="teacher-group-form">
          <input class="student-input" name="university" placeholder="Universidad" required maxlength="120">
          <input class="student-input" name="subject" placeholder="Materia" required maxlength="120">
          <input class="student-input" name="name" placeholder="Grupo o periodo" required maxlength="120">
          <button class="btn-primary" type="submit">Crear grupo</button></form></div>
      <div class="table-card management-card"><h3>Grupos (${ownGroups.length})</h3><div class="management-list">
      ${ownGroups.map(group => `<div class="management-item"><b>${escapeHtml(group.university)} · ${escapeHtml(group.subject)}</b>
        <p>${escapeHtml(group.name)} · ${group.students} alumnos</p>
        <button class="btn-secondary" data-invite-group="${group.id}">Crear invitación</button>
        <button class="btn-secondary" data-students-group="${group.id}">Ver alumnos</button></div>`).join('') || '<p>Aún no has creado grupos.</p>'}
      </div></div></div><div class="table-card" id="teacher-detail" style="display:none"></div></div>`;
    showView('teacher');
    $('#teacher-group-form').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.target);
      try {
        await api('/api/teacher/groups', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
        await renderTeacher();
      } catch (error) { showToast(error.message); }
    };
    $$('[data-invite-group]', $('#view-teacher')).forEach(button => button.onclick = async () => {
      try {
        const { link, expiresAt } = await api(`/api/teacher/groups/${button.dataset.inviteGroup}/invitations`,
          { method: 'POST', body: JSON.stringify({ expiresDays: 7, maxUses: 100 }) });
        const detail = $('#teacher-detail');
        detail.style.display = 'block';
        detail.innerHTML = `<h3>Invitación para alumnos</h3><p>Vence: ${escapeHtml(new Date(expiresAt).toLocaleString('es-MX'))}</p>
          <p class="invite-result"><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
          <button class="btn-secondary" id="copy-invite">Copiar enlace</button>`;
        $('#copy-invite').onclick = async () => {
          try { await navigator.clipboard.writeText(link); showToast('Enlace copiado'); }
          catch { showToast('Selecciona y copia el enlace'); }
        };
      } catch (error) { showToast(error.message); }
    });
    $$('[data-students-group]', $('#view-teacher')).forEach(button => button.onclick = async () => {
      try {
        const { group, students } = await api(`/api/teacher/groups/${button.dataset.studentsGroup}/students`);
        const detail = $('#teacher-detail');
        detail.style.display = 'block';
        detail.innerHTML = `<h3>${escapeHtml(group.university)} · ${escapeHtml(group.subject)} · ${escapeHtml(group.name)}</h3>
          <div class="management-list">${students.map(student => `<div class="management-item"><b>${escapeHtml(student.name)}</b>
          <p>${escapeHtml(student.email)} · Matrícula: ${escapeHtml(student.student_id || '—')}</p>
          <p>Intentos: ${student.attempts} · Aciertos: ${student.correct}/${student.questions}</p></div>`).join('') || '<p>No hay alumnos en este grupo.</p>'}</div>`;
      } catch (error) { showToast(error.message); }
    });
  }

  async function logoutUser() {
    if (activeExam) await saveCurrentUserState();
    clearInterval(examTimer);
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    currentUser = null;
    profile = { id: '', name: '', course: '' };
    attempts = {};
    activeExam = null;
    groups = [];
    currentGroupId = null;
    showView('auth');
  }

  // Inicialización
  setupEventListeners();
  const inviteFromLink = new URLSearchParams(location.search).get('invite');
  if (inviteFromLink) {
    $('#tab-register').click();
    $('#auth-in-role').value = 'student';
    $('#auth-in-invite').value = inviteFromLink;
    $('#auth-in-role').dispatchEvent(new Event('change'));
  }
  try {
    const { user } = await api('/api/me');
    await activateUser(user);
  } catch (error) {
    if (error.message !== 'Inicia sesión' && error.message !== 'Sesión vencida') showToast(error.message);
    showView('auth');
  }
})().catch((error) => {
  console.error('Error al cargar los exámenes:', error);
  const auth = document.getElementById('view-auth');
  if (auth) {
    auth.style.display = 'block';
    auth.innerHTML = `<div class="auth-wrapper"><div class="auth-card"><h2>No se pudieron cargar los exámenes</h2><p>Abre la aplicación desde un servidor local y revisa los archivos de data/chapters.</p><p id="load-error"></p></div></div>`;
    document.getElementById('load-error').textContent = error.message;
  }
});
