// ─────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────
const HL_COLORS = ['var(--hl0)', 'var(--hl1)', 'var(--hl2)', 'var(--hl3)', 'var(--hl4)'];

let texts             = [];
let annotations       = {};
let narrativePool     = [];
let currentIdx        = 0;
let pendingSel        = null;
let isPaused          = false;
let spanPopoverTarget = null;   // { cardIdx, spanIdx }

// ─────────────────────────────────────────────────────────
// Helpers: Text-ID (String) ↔ Array-Index
// ─────────────────────────────────────────────────────────
function textId(idx)   { return String(texts[idx]?.id ?? idx); }
function getSpans(idx) { return annotations[textId(idx)]?.spans ?? []; }

// ─────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────
async function boot() {
  [texts, annotations] = await Promise.all([
    fetch('/api/texts').then(r => r.json()),
    fetch('/api/annotations').then(r => r.json()),
  ]);
  narrativePool = collectNarratives(annotations);
  buildTextList();
  bindListeners();
  redraw();
  updateProgress();
  buildSidebar();
}

function collectNarratives(ann) {
  const s = new Set();
  Object.values(ann).forEach(e =>
    (e.spans ?? []).forEach(sp =>
      (sp.narratives ?? []).forEach(n => s.add(n))
    )
  );
  return [...s];
}

// ─────────────────────────────────────────────────────────
// Card Rendering
// ─────────────────────────────────────────────────────────
function redraw() {
  const stack = document.getElementById('cardStack');
  stack.innerHTML = '';
  for (let offset = -2; offset <= 2; offset++) {
    const idx = currentIdx + offset;
    if (idx < 0 || idx >= texts.length) continue;
    stack.appendChild(buildCard(texts[idx], idx, offset));
  }
}

function posClass(offset) {
  return { '-2': 'pos-n2', '-1': 'pos-n1', '0': 'active', '1': 'pos-p1', '2': 'pos-p2' }[offset] ?? '';
}

function buildCard(t, idx, offset) {
  const el = document.createElement('div');
  el.className = `card ${posClass(offset)}`;
  el.id = `card-${idx}`;

  // ── Header
  const header = document.createElement('div');
  header.className = 'card-header';

  const label = document.createElement('span');
  label.className = 'card-label';
  label.textContent = `Text ${idx + 1} / ${texts.length}`;

  const sourceParts = [];
  if (t.source) sourceParts.push(t.source);
  if (t.date)   sourceParts.push(t.date);
  const sourceEl = document.createElement('span');
  sourceEl.className = 'card-source';
  sourceEl.textContent = sourceParts.join(' · ');

  header.append(label, sourceEl);

  // ── Text-Body
  const body = document.createElement('div');
  body.className = 'card-body';
  body.id = `body-${idx}`;

  // ── Chips
  const chips = document.createElement('div');
  chips.className = 'card-chips';
  chips.id = `chips-${idx}`;

  // ── Footer
  const footer = document.createElement('div');
  footer.className = 'card-footer';

  const status = document.createElement('span');
  status.className = 'card-status';
  status.id = `status-${idx}`;

  const footerBtns = document.createElement('div');
  footerBtns.className = 'card-footer-btns';

  const btnBack = document.createElement('button');
  btnBack.className = 'btn-ghost';
  btnBack.textContent = '← Zurück';
  btnBack.addEventListener('click', back);

  const btnStop = document.createElement('button');
  btnStop.className = 'btn-stop';
  btnStop.textContent = '⏹ Stopp';
  btnStop.addEventListener('click', togglePause);

  const btnNext = document.createElement('button');
  btnNext.className = 'btn-primary';
  btnNext.textContent = 'Nächster Text →';
  btnNext.addEventListener('click', advance);

  footerBtns.append(btnBack, btnStop, btnNext);
  footer.append(status, footerBtns);

  el.append(header, body, chips, footer);

  // Direkt rendern (noch nicht im DOM)
  _applyHighlights(body, t.text, getSpans(idx), idx);
  _renderChips(chips, idx, getSpans(idx));
  _updateStatus(status, getSpans(idx).length);

  return el;
}

// ── Kern-Render: arbeitet direkt auf DOM-Elementen ──────

function _applyHighlights(el, text, spans, cardIdx) {
  el.innerHTML = '';
  const sorted = [...spans]
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => a.start - b.start);

  let cursor = 0;
  sorted.forEach(({ start, end, narratives, i }) => {
    const s = Math.max(0, start);
    const e = Math.min(text.length, end);
    if (s < cursor) return;

    if (s > cursor) el.appendChild(document.createTextNode(text.slice(cursor, s)));

    const mark = document.createElement('mark');
    mark.textContent = text.slice(s, e);
    mark.className = `hl-${i % 5}`;
    mark.title = (narratives ?? []).join(' · ');
    mark.dataset.spanIdx = i;
    mark.dataset.cardIdx = cardIdx;
    mark.style.cursor = 'pointer';
    mark.addEventListener('click', evt => {
      evt.stopPropagation();
      showSpanPopover(cardIdx, i, mark);
    });
    el.appendChild(mark);
    cursor = e;
  });

  if (cursor < text.length) el.appendChild(document.createTextNode(text.slice(cursor)));
}

function _renderChips(el, idx, spans) {
  el.innerHTML = '';
  spans.forEach((sp, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip';

    const dot = document.createElement('div');
    dot.className = 'chip-dot';
    dot.style.background = HL_COLORS[i % 5];

    const label = document.createElement('span');
    let txt = `„${truncate(sp.span, 38)}" → ${(sp.narratives ?? []).join(', ') || '—'}`;
    if (sp.comment) txt += '  💬';
    label.textContent = txt;

    const del = document.createElement('span');
    del.className = 'chip-del';
    del.textContent = '✕';
    del.title = 'Annotation löschen';
    del.addEventListener('click', () => deleteSpan(idx, i));

    chip.append(dot, label, del);
    el.appendChild(chip);
  });
}

function _updateStatus(el, n) {
  el.textContent = n === 0
    ? 'Noch keine Annotationen'
    : `${n} Annotation${n !== 1 ? 'en' : ''} gespeichert`;
}

// ── ID-basierte Wrapper für Updates nach dem Mount ──────

function applyHighlights(idx) {
  const el = document.getElementById(`body-${idx}`);
  if (!el) return;
  _applyHighlights(el, texts[idx].text, getSpans(idx), idx);
}

function renderChips(idx) {
  const el = document.getElementById(`chips-${idx}`);
  if (!el) return;
  _renderChips(el, idx, getSpans(idx));
}

function updateStatus(idx) {
  const el = document.getElementById(`status-${idx}`);
  if (!el) return;
  _updateStatus(el, getSpans(idx).length);
}

function updateProgress() {
  const total = texts.length;
  const pct   = total ? (currentIdx / total) * 100 : 0;
  document.getElementById('progressFill').style.width = `${pct}%`;
  document.getElementById('progressText').textContent  = `${currentIdx} / ${total}`;
}

// ─────────────────────────────────────────────────────────
// Text-List Panel
// ─────────────────────────────────────────────────────────
function buildTextList() {
  const body = document.getElementById('tlBody');
  body.innerHTML = '';
  texts.forEach((t, idx) => {
    const item = document.createElement('div');
    item.className = 'tl-item';
    item.id = `tl-${idx}`;
    item.dataset.idx = idx;

    const meta = document.createElement('div');
    meta.className = 'tl-meta';

    const idEl = document.createElement('span');
    idEl.className = 'tl-id';
    idEl.textContent = t.id;
    meta.appendChild(idEl);

    if (t.source) {
      const src = document.createElement('span');
      src.className = 'tl-source';
      src.textContent = t.source;
      meta.appendChild(src);
    }

    const preview = document.createElement('div');
    preview.className = 'tl-preview';
    preview.textContent = truncate(t.text, 72);

    item.append(meta, preview);
    item.addEventListener('click', () => navigate(idx));
    body.appendChild(item);
  });

  updateTextListActive();
  updateTextListBadges();
}

function updateTextListActive() {
  document.querySelectorAll('.tl-item').forEach(el => {
    el.classList.toggle('tl-active', parseInt(el.dataset.idx) === currentIdx);
  });
  const activeEl = document.getElementById(`tl-${currentIdx}`);
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function updateTextListBadges() {
  texts.forEach((t, idx) => {
    const item = document.getElementById(`tl-${idx}`);
    if (!item) return;
    const n = getSpans(idx).length;
    let badge = item.querySelector('.tl-badge');
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'tl-badge';
        item.querySelector('.tl-meta').appendChild(badge);
      }
      badge.textContent = n;
    } else if (badge) {
      badge.remove();
    }
  });
}

function filterTextList() {
  const q = document.getElementById('tlSearch').value.toLowerCase().trim();
  document.querySelectorAll('.tl-item').forEach(el => {
    const idx = parseInt(el.dataset.idx);
    const t   = texts[idx];
    const match = !q
      || String(t.id).toLowerCase().includes(q)
      || (t.source ?? '').toLowerCase().includes(q)
      || (t.date   ?? '').toLowerCase().includes(q)
      || t.text.toLowerCase().includes(q);
    el.style.display = match ? '' : 'none';
  });
}

// ─────────────────────────────────────────────────────────
// Span Popover
// ─────────────────────────────────────────────────────────
function showSpanPopover(cardIdx, spanIdx, markEl) {
  const sp = getSpans(cardIdx)[spanIdx];
  if (!sp) return;

  spanPopoverTarget = { cardIdx, spanIdx };

  document.getElementById('spSpanText').textContent   = `„${sp.span}"`;
  document.getElementById('spNarratives').textContent = (sp.narratives ?? []).join(' · ') || '—';

  const commentEl = document.getElementById('spComment');
  if (sp.comment) {
    commentEl.textContent   = sp.comment;
    commentEl.style.display = 'block';
  } else {
    commentEl.style.display = 'none';
  }

  const popover = document.getElementById('spanPopover');
  const rect    = markEl.getBoundingClientRect();

  // Initial position below the mark
  popover.style.left    = `${Math.round(rect.left)}px`;
  popover.style.top     = `${Math.round(rect.bottom + 8)}px`;
  popover.style.display = 'block';

  // Clamp to viewport after render
  requestAnimationFrame(() => {
    const pr = popover.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) {
      popover.style.left = `${window.innerWidth - pr.width - 8}px`;
    }
    if (pr.bottom > window.innerHeight - 8) {
      popover.style.top = `${Math.round(rect.top - pr.height - 8)}px`;
    }
  });
}

function hideSpanPopover() {
  document.getElementById('spanPopover').style.display = 'none';
  spanPopoverTarget = null;
}

// ─────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────
function navigate(idx) {
  if (idx < 0 || idx >= texts.length) return;
  currentIdx = idx;
  hideSpanPopover();
  redraw();
  updateProgress();
  updateTextListActive();
}

function advance() {
  if (currentIdx >= texts.length - 1) {
    showToast('Alle Texte bearbeitet! JSON exportieren nicht vergessen.');
    return;
  }
  navigate(currentIdx + 1);
}

function back() {
  if (currentIdx <= 0) {
    showToast('Erster Text bereits erreicht.');
    return;
  }
  navigate(currentIdx - 1);
}

// ─────────────────────────────────────────────────────────
// Sidebar (Narrative-Übersicht)
// ─────────────────────────────────────────────────────────
function buildSidebar() {
  const body    = document.getElementById('sidebarBody');
  const summary = document.getElementById('sidebarSummary');

  const scrollTop = body.scrollTop;

  const narMap = new Map();
  Object.entries(annotations).forEach(([id, entry]) => {
    const textObj = texts.find(t => String(t.id) === id);
    (entry.spans ?? []).forEach(sp => {
      (sp.narratives ?? []).forEach(n => {
        if (!narMap.has(n)) narMap.set(n, []);
        narMap.get(n).push({
          span:   sp.span,
          textId: id,
          source: textObj?.source ?? '',
          date:   textObj?.date   ?? '',
        });
      });
    });
  });

  body.innerHTML = '';

  if (narMap.size === 0) {
    body.innerHTML = '<p class="sidebar-empty">Noch keine Annotationen vorhanden.</p>';
    summary.textContent = '';
    return;
  }

  const totalSnippets = [...narMap.values()].reduce((s, v) => s + v.length, 0);
  summary.textContent = `${narMap.size} Narrative · ${totalSnippets} Snippets`;

  [...narMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([narrative, snippets]) => {
      body.appendChild(buildNarrativeSection(narrative, snippets));
    });

  body.scrollTop = scrollTop;
}

function buildNarrativeSection(narrative, snippets) {
  const avgLen = Math.round(
    snippets.reduce((s, sp) => s + sp.span.length, 0) / snippets.length
  );

  const section = document.createElement('div');
  section.className = 'nar-section';

  const header = document.createElement('div');
  header.className = 'nar-header';

  const nameEl = document.createElement('span');
  nameEl.className = 'nar-name';
  nameEl.textContent = narrative;
  nameEl.title = 'Doppelklick zum Umbenennen';
  nameEl.addEventListener('dblclick', () => startRename(nameEl, narrative));

  const hint = document.createElement('span');
  hint.className = 'nar-rename-hint';
  hint.textContent = 'Doppelklick = umbenennen';

  header.append(nameEl, hint);

  const stats = document.createElement('div');
  stats.className = 'nar-stats';

  const badgeCount = document.createElement('span');
  badgeCount.className = 'nar-stat-badge';
  badgeCount.textContent = `${snippets.length} Snippet${snippets.length !== 1 ? 's' : ''}`;

  const badgeLen = document.createElement('span');
  badgeLen.className = 'nar-stat-badge';
  badgeLen.textContent = `Ø ${avgLen} Zeichen`;

  stats.append(badgeCount, badgeLen);

  const list = document.createElement('div');
  list.className = 'nar-snippets';

  snippets.forEach(({ span, textId, source, date }) => {
    const item = document.createElement('div');
    item.className = 'nar-snippet';

    const textEl = document.createElement('div');
    textEl.className = 'nar-snippet-text';
    textEl.textContent = `„${truncate(span, 100)}"`;

    const metaParts = [`ID ${textId}`];
    if (source) metaParts.push(source);
    if (date)   metaParts.push(date);

    const metaEl = document.createElement('div');
    metaEl.className = 'nar-snippet-meta';
    metaEl.textContent = metaParts.join(' · ');

    item.append(textEl, metaEl);
    list.appendChild(item);
  });

  section.append(header, stats, list);
  return section;
}

// ── Rename ────────────────────────────────────────────────

function startRename(nameEl, oldName) {
  const input = document.createElement('input');
  input.className = 'nar-rename-input';
  input.value = oldName;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;

  const commit = async () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      await renameNarrative(oldName, newName);
    } else {
      input.replaceWith(nameEl);
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = oldName; input.blur(); }
  });
}

async function renameNarrative(oldName, newName) {
  const res = await fetch('/api/rename-narrative', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ oldName, newName }),
  });
  if (!res.ok) { showToast('Fehler beim Umbenennen.'); return; }

  annotations   = await fetch('/api/annotations').then(r => r.json());
  narrativePool = narrativePool.map(n => n === oldName ? newName : n);

  for (let off = -2; off <= 2; off++) {
    const i = currentIdx + off;
    if (i >= 0 && i < texts.length) renderChips(i);
  }
  buildSidebar();
  showToast(`Umbenannt: „${oldName}" → „${newName}"`);
}

// ─────────────────────────────────────────────────────────
// Pause / Resume
// ─────────────────────────────────────────────────────────
function togglePause() {
  isPaused = true;
  document.getElementById('pauseOverlay').style.display = 'flex';
}

function resumeAnnotation() {
  isPaused = false;
  document.getElementById('pauseOverlay').style.display = 'none';
}

// ─────────────────────────────────────────────────────────
// Text-Selektion → Span-Offsets
// ─────────────────────────────────────────────────────────
function onMouseUp() {
  if (isPaused) return;
  if (!document.getElementById('popup').hidden) return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;

  const rawText = sel.toString();
  const trimmed = rawText.trim();
  if (!trimmed) return;

  const body = document.getElementById(`body-${currentIdx}`);
  if (!body || !body.contains(sel.anchorNode)) return;

  const range = sel.getRangeAt(0);
  const pre   = document.createRange();
  pre.selectNodeContents(body);
  pre.setEnd(range.startContainer, range.startOffset);

  const leadingSpaces = rawText.length - rawText.trimStart().length;
  const start = pre.toString().length + leadingSpaces;
  const end   = start + trimmed.length;

  pendingSel = { text: trimmed, start, end };
  openPopup();
}

// ─────────────────────────────────────────────────────────
// Popup
// ─────────────────────────────────────────────────────────
function openPopup() {
  document.getElementById('selectedPreview').textContent = `„${pendingSel.text}"`;
  fillNarrativeList();
  document.getElementById('commentInput').value = '';
  document.getElementById('overlay').hidden = false;
  document.getElementById('popup').hidden   = false;
  document.getElementById('newNarrativeInput').focus();
}

function closePopup() {
  pendingSel = null;
  document.getElementById('overlay').hidden = true;
  document.getElementById('popup').hidden   = true;
  document.getElementById('newNarrativeInput').value = '';
  document.getElementById('commentInput').value      = '';
  window.getSelection()?.removeAllRanges();
}

function fillNarrativeList() {
  const list = document.getElementById('narrativeList');
  list.innerHTML = '';
  narrativePool.forEach(n => list.appendChild(makeNarrativeItem(n, false)));
}

function makeNarrativeItem(narrative, checked = false) {
  const label = document.createElement('label');
  label.className = 'narrative-item';

  const cb = document.createElement('input');
  cb.type    = 'checkbox';
  cb.value   = narrative;
  cb.checked = checked;

  const span = document.createElement('span');
  span.textContent = narrative;

  label.append(cb, span);
  return label;
}

function addNarrative() {
  const inp = document.getElementById('newNarrativeInput');
  const val = inp.value.trim();
  if (!val) return;

  if (!narrativePool.includes(val)) {
    narrativePool.unshift(val);
    const list = document.getElementById('narrativeList');
    list.prepend(makeNarrativeItem(val, true));
  } else {
    document.querySelectorAll('#narrativeList input[type="checkbox"]')
      .forEach(cb => { if (cb.value === val) cb.checked = true; });
  }

  inp.value = '';
  inp.focus();
}

// ─────────────────────────────────────────────────────────
// Speichern & Löschen
// ─────────────────────────────────────────────────────────
async function saveSpan() {
  if (!pendingSel) return;

  const inp = document.getElementById('newNarrativeInput');
  if (inp.value.trim()) addNarrative();

  const checked = [...document.querySelectorAll('#narrativeList input:checked')].map(c => c.value);
  if (checked.length === 0) {
    showToast('Bitte mindestens ein Narrativ auswählen oder eingeben.');
    return;
  }

  const comment = document.getElementById('commentInput').value.trim();
  const t = texts[currentIdx];
  const payload = {
    textId:     textId(currentIdx),
    text:       t.text,
    span:       pendingSel.text,
    start:      pendingSel.start,
    end:        pendingSel.end,
    narratives: checked,
    comment,
  };

  const res = await fetch('/api/annotations', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (res.ok) {
    annotations   = await fetch('/api/annotations').then(r => r.json());
    narrativePool = collectNarratives(annotations);
    applyHighlights(currentIdx);
    renderChips(currentIdx);
    updateStatus(currentIdx);
    updateTextListBadges();
    buildSidebar();
    closePopup();
    showToast('Annotation gespeichert');
  } else {
    showToast('Fehler beim Speichern.');
  }
}

async function deleteSpan(textIdx, spanIdx) {
  hideSpanPopover();
  const tid = encodeURIComponent(textId(textIdx));
  const res = await fetch(`/api/annotations/${tid}/spans/${spanIdx}`, { method: 'DELETE' });
  if (res.ok) {
    annotations = await fetch('/api/annotations').then(r => r.json());
    applyHighlights(textIdx);
    renderChips(textIdx);
    updateStatus(textIdx);
    updateTextListBadges();
    buildSidebar();
    showToast('Annotation gelöscht');
  }
}

// ─────────────────────────────────────────────────────────
// JSON Export
// ─────────────────────────────────────────────────────────
function doExport() {
  const blob = new Blob([JSON.stringify(annotations, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `annotations_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('JSON exportiert');
}

// ─────────────────────────────────────────────────────────
// Event-Binding
// ─────────────────────────────────────────────────────────
function bindListeners() {
  document.addEventListener('mouseup', onMouseUp);

  // Popover schließen beim Klick außerhalb
  document.addEventListener('click', e => {
    if (!e.target.closest('#spanPopover') && !e.target.closest('mark')) {
      hideSpanPopover();
    }
  });

  // Text-Panel Suche
  document.getElementById('tlSearch').addEventListener('input', filterTextList);

  // Popup
  document.getElementById('btnAddNarrative').addEventListener('click', addNarrative);
  document.getElementById('newNarrativeInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addNarrative();
  });
  document.getElementById('btnSave').addEventListener('click', saveSpan);
  document.getElementById('btnCancelPopup').addEventListener('click', closePopup);
  document.getElementById('btnClosePopup').addEventListener('click', closePopup);
  document.getElementById('overlay').addEventListener('click', closePopup);

  // Span-Popover Löschen
  document.getElementById('spDeleteBtn').addEventListener('click', () => {
    if (spanPopoverTarget) {
      deleteSpan(spanPopoverTarget.cardIdx, spanPopoverTarget.spanIdx);
    }
  });

  // Header
  document.getElementById('btnExport').addEventListener('click', doExport);
  document.getElementById('btnResume').addEventListener('click', resumeAnnotation);

  // Tastatur
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePopup(); hideSpanPopover(); }
    if (e.key === 'Enter' && e.ctrlKey) saveSpan();
  });
}

// ─────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ─────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────
function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

// ─────────────────────────────────────────────────────────
boot();
