const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const FILE_PATH = path.join(__dirname, 'RVOCA.ini');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_QUESTIONS = 15;

const hasCJK = (s) => /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(s);

function splitEnZh(line) {
  const tokens = line.split(/\s+/);
  const cjkIndex = tokens.findIndex((t) => hasCJK(t));

  if (cjkIndex > 0) {
    return {
      en: tokens.slice(0, cjkIndex).join(' '),
      zh: tokens.slice(cjkIndex).join(' '),
    };
  }

  const [en, ...zhParts] = tokens;
  return { en, zh: zhParts.join(' ') };
}

function loadWords() {
  const raw = fs
    .readFileSync(FILE_PATH, 'utf8')
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return raw.map((line, index) => ({ id: index, order: index, ...splitEnZh(line) }));
}

function saveWords(words) {
  const lines = words
    .sort((a, b) => a.order - b.order)
    .map((word) => `${word.en} ${word.zh}`);

  fs.writeFileSync(FILE_PATH, lines.join('\n'), 'utf8');
}

let wordList = loadWords();
let remaining = [...wordList];
let sessionAnswered = 0;
let lastWordId = null;

const getStats = () => ({
  total: wordList.length,
  remaining: remaining.length,
  answered: sessionAnswered,
  maxQuestions: MAX_QUESTIONS,
});

function getRandomWord() {
  if (!remaining.length) {
    return null;
  }

  if (remaining.length === 1) {
    lastWordId = remaining[0].id;
    return remaining[0];
  }

  let word = null;
  for (let i = 0; i < 5; i += 1) {
    const candidate = remaining[Math.floor(Math.random() * remaining.length)];
    if (candidate.id !== lastWordId) {
      word = candidate;
      break;
    }
  }

  if (!word) {
    word = remaining[Math.floor(Math.random() * remaining.length)];
  }

  lastWordId = word.id;
  return word;
}

function sessionFinished() {
  return sessionAnswered >= MAX_QUESTIONS || remaining.length === 0;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    sendJson(res, 200, { stats: getStats(), finished: sessionFinished() });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/word') {
    if (sessionFinished()) {
      sendJson(res, 200, { finished: true, stats: getStats() });
      return true;
    }

    const word = getRandomWord();
    if (!word) {
      sendJson(res, 200, { finished: true, stats: getStats() });
      return true;
    }

    sendJson(res, 200, { word, stats: getStats() });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/word/action') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const { id, action } = data;

        if (typeof id !== 'number' || !action) {
          sendJson(res, 400, { message: '缺少必要的資料。' });
          return;
        }

        const word = wordList.find((item) => item.id === id);
        if (!word) {
          sendJson(res, 404, { message: '找不到指定的單字。' });
          return;
        }

        if (action === 'delete') {
          wordList = wordList.filter((item) => item.id !== id);
          remaining = remaining.filter((item) => item.id !== id);
          saveWords(wordList);
        } else if (action === 'keep') {
          // Do nothing besides counting the answer.
        } else {
          sendJson(res, 400, { message: '未知的操作。' });
          return;
        }

        sessionAnswered += 1;

        if (sessionFinished()) {
          sendJson(res, 200, { finished: true, stats: getStats() });
          return;
        }

        sendJson(res, 200, { finished: false, stats: getStats() });
      } catch (error) {
        sendJson(res, 400, { message: '資料格式錯誤。' });
      }
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/session/reset') {
    wordList = loadWords();
    remaining = [...wordList];
    sessionAnswered = 0;
    lastWordId = null;

    sendJson(res, 200, { stats: getStats(), finished: false });
    return true;
  }

  return false;
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    const handled = handleApi(req, res, url);
    if (!handled) {
      sendJson(res, 404, { message: '未知的 API 路徑。' });
    }
    return;
  }

  let filePath = url.pathname;
  if (filePath === '/' || filePath === '') {
    filePath = '/index.html';
  }

  const resolvedPath = path.join(PUBLIC_DIR, filePath);
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    res.writeHead(200, { 'Content-Type': getContentType(resolvedPath) });
    fs.createReadStream(resolvedPath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Vocabulary web app ready on http://localhost:${PORT}`);
});
