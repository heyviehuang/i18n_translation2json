const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(ROOT_DIR, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const DATA_DIR = path.join(DOCS_DIR, 'data');
const SOURCE_FILE = path.join(ROOT_DIR, 'RVOCA.ini');

const hasCJK = (value) => /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(value);

function splitEnZh(line) {
  const tokens = line.split(/\s+/);
  const cjkIndex = tokens.findIndex((token) => hasCJK(token));

  if (cjkIndex > 0) {
    return {
      en: tokens.slice(0, cjkIndex).join(' '),
      zh: tokens.slice(cjkIndex).join(' '),
    };
  }

  const [en, ...rest] = tokens;
  return { en, zh: rest.join(' ') };
}

function loadWordsFromIni(filePath) {
  const raw = fs
    .readFileSync(filePath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return raw.map((line, index) => ({ id: index, ...splitEnZh(line) }));
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function copyAsset(fileName) {
  const source = path.join(PUBLIC_DIR, fileName);
  const target = path.join(DOCS_DIR, fileName);
  await fs.promises.copyFile(source, target);
}

async function buildStaticSite() {
  await fs.promises.rm(DOCS_DIR, { recursive: true, force: true });
  await ensureDir(DOCS_DIR);
  await ensureDir(DATA_DIR);

  const words = loadWordsFromIni(SOURCE_FILE);
  await fs.promises.writeFile(
    path.join(DATA_DIR, 'words.json'),
    JSON.stringify(words, null, 2),
    'utf8'
  );

  await copyAsset('index.html');
  await copyAsset('app.js');
  await copyAsset('styles.css');

  console.log('Static site exported to docs/.');
  console.log(`包含 ${words.length} 筆單字資料。`);
}

buildStaticSite().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
