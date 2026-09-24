const API_BASE_URL = ('https://personal-notebook-lxwz.onrender.com').replace(/\/$/, '');
const state = { token: localStorage.getItem('papertrail_token'), notes: [], currentId: null, configured: false, syncDirty: false };
const $ = (id) => document.getElementById(id);
const DEFAULT_TITLE = 'Untitled note';
const eyeOpenIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>';
const eyeClosedIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 3 18 18"></path><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17.7 17.7 0 0 1-3.1 3.8"></path><path d="M6.2 6.7C3.9 8.3 2.5 12 2.5 12S6 18 12 18c1.1 0 2.1-.2 3-.5"></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></svg>';
const savedTheme = localStorage.getItem('papertrail_theme');

function applyTheme(theme) { const dark = theme === 'dark'; document.body.classList.toggle('dark-theme', dark); document.querySelectorAll('#themeToggle, #themeToggleAuth').forEach(button => { button.innerHTML = dark ? '&#9728;' : '&#9790;'; button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode'); button.title = dark ? 'Switch to light mode' : 'Switch to dark mode'; }); localStorage.setItem('papertrail_theme', dark ? 'dark' : 'light'); }

function setSyncStatus(status, message) {
  const statusEl = $('syncStatus');
  const icon = $('syncIcon');
  const label = $('syncLabel');
  if (!statusEl || !icon || !label) return;
  const styles = { syncing: 'text-moss', synced: 'text-stone-500', offline: 'text-clay', error: 'text-clay' };
  statusEl.className = `flex items-center gap-2 text-xs ${styles[status] || styles.synced}`;
  icon.className = status === 'syncing' ? 'animate-pulse' : '';
  label.textContent = message;
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || 'Something went wrong');
  return data;
}

function authShell(title, subtitle, form) { $('authCard').innerHTML = `<div class="text-sm text-stone-500 mb-3">${subtitle}</div><h2 class="font-display text-5xl mb-10">${title}</h2>${form}`; }
function formField(label, id, type = 'text', placeholder = '') { const secret = type === 'password'; const input = `<input id="${id}" type="${type}" placeholder="${placeholder}" class="mt-2 w-full border-b border-stone-300 bg-transparent py-3 ${secret ? 'pr-10' : ''} outline-none focus:border-moss">`; return `<label class="block text-sm text-stone-600 mb-5">${label}<span class="relative block">${input}${secret ? `<button type="button" class="password-toggle absolute right-0 top-2 px-2 py-2 text-stone-400 hover:text-ink" data-target="${id}" aria-label="Show ${label.toLowerCase()}" title="Show password">${eyeOpenIcon}</button>` : ''}</span></label>`; }
function authButton(label) { return `<button class="w-full rounded-full bg-ink text-white py-3.5 font-medium hover:bg-moss transition">${label}</button>`; }
function showMessage(message) { const el = $('authMessage'); if (el) { el.textContent = message; el.className = 'text-sm text-clay mt-4'; } }

async function renderAuth() {
  $('authView').classList.remove('hidden'); $('appView').classList.add('hidden');
  let status;
  try {
    status = await api('/api/setup-status');
  } catch (error) {
    authShell('Notebook unavailable', 'The app could not reach its database.', '<div class="text-sm text-clay leading-6">Start MongoDB, then reload this page.</div>');
    return;
  }
  state.configured = status.configured;
  if (!status.configured) {
    authShell('Set up your notebook', 'A private space for your thoughts.', `<form id="setupForm">${formField('Create a password (8+ characters)', 'password', 'password')}${formField('Security question', 'question', 'text', 'For example: What was my first pet?')}${formField('Your answer', 'answer', 'password', 'Keep this somewhere safe')}${authButton('Create secure notebook')}<div id="authMessage"></div></form>`);
    $('setupForm').onsubmit = async (event) => { event.preventDefault(); try { const data = await api('/api/setup', { method: 'POST', body: JSON.stringify({ password: $('password').value, security_question: $('question').value, security_answer: $('answer').value }) }); enter(data.token); } catch (error) { showMessage(error.message); } };
    return;
  }
  authShell('Welcome back', 'Your notes are waiting.', `<form id="loginForm">${formField('Password', 'password', 'password')}${authButton('Unlock notebook')}<div class="flex justify-between mt-5 text-sm"><button type="button" id="forgotBtn" class="text-moss hover:text-clay">Forgot password?</button><div id="authMessage"></div></div></form>`);
  $('loginForm').onsubmit = async (event) => { event.preventDefault(); try { const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) }); enter(data.token); } catch (error) { showMessage(error.message); } };
  $('forgotBtn').onclick = recovery;
}

async function recovery() {
  const data = await api('/api/recovery/question');
  authShell('Reset password', 'Answer your security question.', `<form id="recoveryForm"><p class="font-display text-xl mb-8">${data.question}</p>${formField('Answer', 'answer', 'password')}${formField('New password (8+ characters)', 'newPassword', 'password')}${authButton('Set new password')}<button type="button" id="backBtn" class="w-full mt-4 text-sm text-stone-500">Back to login</button><div id="authMessage"></div></form>`);
  $('backBtn').onclick = renderAuth;
  $('recoveryForm').onsubmit = async (event) => { event.preventDefault(); try { const result = await api('/api/recovery/reset', { method: 'POST', body: JSON.stringify({ security_answer: $('answer').value, new_password: $('newPassword').value }) }); enter(result.token); } catch (error) { showMessage(error.message); } };
}

function enter(token) { state.token = token; localStorage.setItem('papertrail_token', token); $('authView').classList.add('hidden'); $('appView').classList.remove('hidden'); loadNotes(); }
function logout() { state.token = null; localStorage.removeItem('papertrail_token'); renderAuth(); }
function renderPreview() { $('preview').innerHTML = DOMPurify.sanitize(marked.parse($('contentInput').value || '*Nothing written yet.*', { breaks: true })); }
function renderList() { $('noteList').innerHTML = state.notes.length ? state.notes.map(note => `<div class="note-item flex items-start gap-2 p-2 rounded-lg ${note.id === state.currentId ? 'bg-white shadow-sm' : 'hover:bg-white/60'}"><button data-id="${note.id}" class="note-open text-left min-w-0 flex-1 p-1"><div class="font-medium truncate">${escapeHtml(note.title || DEFAULT_TITLE)}</div><div class="text-xs text-stone-500 truncate mt-1">${escapeHtml(note.preview || 'Empty note')}</div></button><div class="note-actions relative shrink-0"><button class="note-menu-toggle text-lg leading-none text-stone-400 hover:text-ink px-2 py-1" title="Note actions" aria-label="Actions for ${escapeHtml(note.title || DEFAULT_TITLE)}">&#8942;</button><div class="note-menu hidden absolute right-0 top-8 z-20 w-32 rounded-lg border border-stone-200 bg-white p-1 shadow-lg"><button data-id="${note.id}" class="note-delete w-full rounded px-3 py-2 text-left text-sm text-clay hover:bg-[#f7f3ea]">Delete note</button></div></div></div>`).join('') : '<p class="text-sm text-stone-500 leading-6">No notes yet.<br>Start with a blank page.</p>'; document.querySelectorAll('.note-open').forEach(button => button.onclick = () => { closeMobilePanels(); openNote(button.dataset.id); }); document.querySelectorAll('.note-menu-toggle').forEach(button => button.onclick = event => { event.stopPropagation(); document.querySelectorAll('.note-menu').forEach(menu => menu.classList.add('hidden')); button.nextElementSibling.classList.toggle('hidden'); }); document.querySelectorAll('.note-delete').forEach(button => button.onclick = event => { event.stopPropagation(); button.closest('.note-menu').classList.add('hidden'); requestDelete(button.dataset.id); }); }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
async function loadNotes() { try { state.notes = await api('/api/notes'); renderList(); if (state.notes.length) openNote(state.currentId || state.notes[0].id); else newNote(); setSyncStatus('synced', 'Saved to cloud'); } catch (error) { setSyncStatus('error', 'Sync failed'); logout(); } }
async function openNote(id) { const note = await api(`/api/notes/${id}`); state.currentId = id; $('titleInput').value = note.title; $('contentInput').value = note.content; $('deleteBtn').classList.remove('hidden'); $('saveStatus').textContent = `Saved ${new Date(note.updated_at).toLocaleString()}`; renderPreview(); renderList(); }
function newNote() { state.currentId = null; $('titleInput').value = ''; $('contentInput').value = ''; $('deleteBtn').classList.add('hidden'); $('saveStatus').textContent = 'New note'; renderPreview(); renderList(); $('titleInput').focus(); }
let saveTimer;
function queueSave() { state.syncDirty = true; renderPreview(); $('saveStatus').textContent = 'Saving...'; if (!navigator.onLine) { setSyncStatus('offline', 'Offline'); return; } clearTimeout(saveTimer); saveTimer = setTimeout(saveNote, 650); }
async function saveNote() { if (!state.syncDirty || !navigator.onLine) return; setSyncStatus('syncing', 'Saving to cloud...'); const payload = { title: $('titleInput').value.trim(), content: $('contentInput').value }; try { const note = await api(state.currentId ? `/api/notes/${state.currentId}` : '/api/notes', { method: state.currentId ? 'PUT' : 'POST', body: JSON.stringify(payload) }); state.currentId = note.id; state.syncDirty = false; $('deleteBtn').classList.remove('hidden'); $('saveStatus').textContent = `Saved ${new Date(note.updated_at).toLocaleString()}`; state.notes = await api('/api/notes'); renderList(); setSyncStatus('synced', 'Saved to cloud'); } catch (error) { setSyncStatus('error', 'Sync failed'); $('saveStatus').textContent = 'Cloud sync failed'; } }
let pendingDeleteId = null;
function requestDelete(noteId = state.currentId) { const note = state.notes.find(item => item.id === noteId); if (!noteId) return; pendingDeleteId = noteId; $('deletePromptMessage').textContent = `Delete "${note?.title || 'this note'}"? This action cannot be undone.`; $('deletePrompt').classList.remove('hidden'); $('cancelDeleteBtn').focus(); }
function closeDeletePrompt() { pendingDeleteId = null; $('deletePrompt').classList.add('hidden'); }
async function deleteNote(noteId) { if (!noteId) return; closeDeletePrompt(); setSyncStatus('syncing', 'Saving to cloud...'); try { await api(`/api/notes/${noteId}`, { method: 'DELETE' }); if (noteId === state.currentId) { state.currentId = null; await loadNotes(); return; } state.notes = await api('/api/notes'); renderList(); setSyncStatus('synced', 'Saved to cloud'); } catch (error) { setSyncStatus('error', 'Sync failed'); } }

function closeMobilePanels() { document.body.classList.remove('mobile-drawer-open', 'mobile-preview-open'); }
function toggleMobilePanel(panel) { const className = panel === 'drawer' ? 'mobile-drawer-open' : 'mobile-preview-open'; const otherClassName = panel === 'drawer' ? 'mobile-preview-open' : 'mobile-drawer-open'; document.body.classList.remove(otherClassName); document.body.classList.toggle(className); }

function setupResizing() {
  const layout = $('notebookLayout');
  const savedSidebarWidth = localStorage.getItem('papertrail_sidebar_width');
  const savedEditorWidth = localStorage.getItem('papertrail_editor_width');
  if (savedSidebarWidth) layout.style.setProperty('--sidebar-width', `${savedSidebarWidth}px`);
  if (savedEditorWidth) layout.style.setProperty('--editor-width', `${savedEditorWidth}px`);

  function resizePair(handle, primaryPanel, secondaryPanel, primaryVariable, secondaryVariable, minimumPrimary, minimumSecondary, primaryStorageKey, secondaryStorageKey) {
    let startX;
    let startPrimaryWidth;
    let startSecondaryWidth;
    let frame;
    let currentPrimaryWidth;
    let currentSecondaryWidth;

    function finishResize(event) {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      if (currentPrimaryWidth && currentSecondaryWidth) {
        layout.style.setProperty(primaryVariable, `${currentPrimaryWidth}px`);
        layout.style.setProperty(secondaryVariable, `${currentSecondaryWidth}px`);
        localStorage.setItem(primaryStorageKey, currentPrimaryWidth);
        if (secondaryStorageKey) localStorage.setItem(secondaryStorageKey, currentSecondaryWidth);
      }
      handle.releasePointerCapture(event.pointerId);
      handle.classList.remove('is-resizing');
      document.body.classList.remove('is-resizing-column');
    }

    handle.addEventListener('pointerdown', (event) => {
      startX = event.clientX;
      startPrimaryWidth = primaryPanel.getBoundingClientRect().width;
      startSecondaryWidth = secondaryPanel.getBoundingClientRect().width;
      currentPrimaryWidth = startPrimaryWidth;
      currentSecondaryWidth = startSecondaryWidth;
      handle.classList.add('is-resizing');
      document.body.classList.add('is-resizing-column');
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const delta = event.clientX - startX;
      const limitedDelta = Math.max(minimumPrimary - startPrimaryWidth, Math.min(startSecondaryWidth - minimumSecondary, delta));
      currentPrimaryWidth = startPrimaryWidth + limitedDelta;
      currentSecondaryWidth = startSecondaryWidth - limitedDelta;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          layout.style.setProperty(primaryVariable, `${currentPrimaryWidth}px`);
          layout.style.setProperty(secondaryVariable, `${currentSecondaryWidth}px`);
          frame = null;
        });
      }
    });
    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);
    handle.addEventListener('lostpointercapture', () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      handle.classList.remove('is-resizing');
      document.body.classList.remove('is-resizing-column');
    });
  }

  resizePair($('sidebarResize'), layout.querySelector('aside'), $('notebookEditor'), '--sidebar-width', '--editor-width', 220, 320, 'papertrail_sidebar_width', 'papertrail_editor_width');
  resizePair($('editorResize'), $('notebookEditor'), $('notebookPreview'), '--editor-width', '--preview-width', 320, 280, 'papertrail_editor_width');
}

$('logoutBtn').onclick = logout; $('newBtn').onclick = () => { closeMobilePanels(); newNote(); }; $('deleteBtn').onclick = () => requestDelete(); $('cancelDeleteBtn').onclick = closeDeletePrompt; $('confirmDeleteBtn').onclick = () => deleteNote(pendingDeleteId); $('titleInput').oninput = queueSave; $('contentInput').oninput = queueSave;
document.querySelectorAll('#themeToggle, #themeToggleAuth').forEach(button => button.onclick = () => applyTheme(document.body.classList.contains('dark-theme') ? 'light' : 'dark'));
document.addEventListener('click', () => document.querySelectorAll('.note-menu').forEach(menu => menu.classList.add('hidden')));
document.addEventListener('click', event => { const toggle = event.target.closest('.password-toggle'); if (!toggle) return; const input = $(toggle.dataset.target); const showing = input.type === 'password'; input.type = showing ? 'text' : 'password'; toggle.innerHTML = showing ? eyeClosedIcon : eyeOpenIcon; toggle.setAttribute('aria-label', `${showing ? 'Hide' : 'Show'} ${input.id}`); toggle.setAttribute('aria-pressed', String(showing)); toggle.title = `${showing ? 'Hide' : 'Show'} password`; });
$('mobileMenuBtn').onclick = () => toggleMobilePanel('drawer');
$('mobilePreviewBtn').onclick = () => toggleMobilePanel('preview');
$('notebookLayout').addEventListener('click', event => { if (event.target === $('notebookLayout')) closeMobilePanels(); });
let touchStartX = 0;
$('appView').addEventListener('touchstart', event => { touchStartX = event.touches[0].clientX; }, { passive: true });
$('appView').addEventListener('touchend', event => { const endX = event.changedTouches[0].clientX; const delta = endX - touchStartX; const drawerOpen = document.body.classList.contains('mobile-drawer-open'); const previewOpen = document.body.classList.contains('mobile-preview-open'); if (drawerOpen && delta < -70) closeMobilePanels(); else if (previewOpen && delta > 70) closeMobilePanels(); else if (!drawerOpen && !previewOpen && touchStartX < 36 && delta > 70) toggleMobilePanel('drawer'); else if (!drawerOpen && !previewOpen && touchStartX > window.innerWidth - 36 && delta < -70) toggleMobilePanel('preview'); }, { passive: true });
window.addEventListener('offline', () => setSyncStatus('offline', 'Offline'));
window.addEventListener('online', () => { setSyncStatus('syncing', 'Reconnecting...'); if (state.syncDirty) queueSave(); else setSyncStatus('synced', 'Saved to cloud'); });
setupResizing();
applyTheme(savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
if (state.token) { $('authView').classList.add('hidden'); $('appView').classList.remove('hidden'); loadNotes(); } else renderAuth();
