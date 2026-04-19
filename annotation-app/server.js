const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const DATA_DIR = path.join(__dirname, 'data');
const TEXTS_FILE = path.join(DATA_DIR, 'texts.json');
const ANN_FILE = path.join(DATA_DIR, 'annotations.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure annotations file exists
if (!fs.existsSync(ANN_FILE)) fs.writeFileSync(ANN_FILE, '{}', 'utf8');

function readAnn() {
  try { return JSON.parse(fs.readFileSync(ANN_FILE, 'utf8')); }
  catch { return {}; }
}
function writeAnn(data) {
  fs.writeFileSync(ANN_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── GET /api/texts ───────────────────────────────────────
app.get('/api/texts', (req, res) => {
  try {
    const texts = JSON.parse(fs.readFileSync(TEXTS_FILE, 'utf8'));
    res.json(texts);
  } catch {
    res.status(500).json({ error: 'Texte konnten nicht geladen werden.' });
  }
});

// ── GET /api/annotations ─────────────────────────────────
app.get('/api/annotations', (req, res) => {
  res.json(readAnn());
});

// ── POST /api/annotations  (neuen Span speichern) ────────
// Body: { textId, text, span, start, end, narratives }
app.post('/api/annotations', (req, res) => {
  const { textId, text, span, start, end, narratives } = req.body;
  if (textId === undefined || !span) return res.status(400).json({ error: 'Fehlende Felder.' });

  const data = readAnn();
  if (!data[textId]) data[textId] = { text, spans: [] };
  data[textId].spans.push({ span, start, end, narratives: narratives ?? [] });
  writeAnn(data);
  res.json({ success: true, spanIndex: data[textId].spans.length - 1 });
});

// ── DELETE /api/annotations/:textId/spans/:spanIndex ─────
app.delete('/api/annotations/:textId/spans/:spanIndex', (req, res) => {
  const textId = req.params.textId;
  const spanIndex = parseInt(req.params.spanIndex, 10);

  const data = readAnn();
  if (!data[textId]?.spans?.[spanIndex]) {
    return res.status(404).json({ error: 'Span nicht gefunden.' });
  }
  data[textId].spans.splice(spanIndex, 1);
  writeAnn(data);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n🚀  NarrativLabel läuft auf http://localhost:${PORT}\n`);
});
