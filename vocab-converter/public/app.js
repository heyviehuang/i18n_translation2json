const MAX_QUESTIONS = 15;
const STATIC_DATA_URL = 'data/words.json';
const STORAGE_KEYS = {
  deleted: 'vocab-trainer:deleted',
};

const statsEl = document.getElementById('stats');
const englishEl = document.getElementById('english');
const translationEl = document.getElementById('translation');
const revealBtn = document.getElementById('reveal');
const keepBtn = document.getElementById('keep');
const deleteBtn = document.getElementById('delete');
const resetBtn = document.getElementById('reset');
const startBtn = document.getElementById('start');
const messageEl = document.getElementById('message');
const speakBtn = document.getElementById('speak');
const questionCounter = document.getElementById('question-counter');
const modeIndicator = document.getElementById('mode-indicator');

const state = {
  mode: null,
  currentWord: null,
  finished: true,
};

const staticState = {
  words: [],
  queue: [],
  deleted: new Set(),
  answered: 0,
  sessionSize: 0,
};

function updateStats(stats = {}) {
  if (!stats || typeof stats.total !== 'number') {
    statsEl.textContent = '尚未載入檔案';
    questionCounter.textContent = '-- / --';
    return;
  }

  const total = stats.total ?? 0;
  const remaining = stats.remaining ?? 0;
  const answered = stats.answered ?? 0;
  const maxQuestions = stats.maxQuestions ?? 0;

  const answeredLabel = maxQuestions
    ? `${Math.min(answered, maxQuestions)} / ${maxQuestions}`
    : '-- / --';

  statsEl.innerHTML = `
    <span>總共：${total}</span>
    <span>剩餘：${remaining}</span>
    <span>本輪已答：${answeredLabel}</span>
  `;

  if (!maxQuestions) {
    questionCounter.textContent = '-- / --';
  } else {
    const currentIndex = Math.min(answered + 1, maxQuestions);
    questionCounter.textContent = `${currentIndex} / ${maxQuestions}`;
  }
}

function setMessage(text, type = 'info') {
  messageEl.textContent = text || '';
  messageEl.dataset.type = type;
}

function setModeIndicator(text, tone = 'info') {
  modeIndicator.textContent = text || '';
  modeIndicator.dataset.tone = tone;
}

function toggleControls(disabled) {
  revealBtn.disabled = disabled;
  keepBtn.disabled = disabled;
  deleteBtn.disabled = disabled;
  speakBtn.disabled = disabled;
}

function resetCard() {
  state.currentWord = null;
  englishEl.textContent = '請按「開始測驗」';
  translationEl.textContent = '';
  translationEl.classList.add('hidden');
  toggleControls(true);
}

async function fetchJsonOrThrow(url, options = {}, fallbackMessage = '操作失敗') {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      let message = fallbackMessage;
      try {
        const data = await res.json();
        if (data && data.message) {
          message = data.message;
        }
      } catch (error) {
        // ignore body parse errors
      }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } catch (error) {
    if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
      throw new Error('無法連線到伺服器。');
    }
    throw error;
  }
}

async function setupApiMode() {
  const data = await fetchJsonOrThrow('/api/state', {}, '無法取得狀態');
  state.mode = 'api';
  updateStats(data.stats);
  state.finished = data.finished;
  if (state.finished) {
    setMessage('目前沒有題目，請重新載入或增加單字。', 'warn');
  } else {
    setMessage('已連線至本機伺服器，可直接更新 RVOCA.ini。', 'info');
  }
  setModeIndicator('模式：本機伺服器（可更新 RVOCA.ini）', 'info');
}

async function loadWordApi() {
  if (state.finished) {
    setMessage('此回合已結束，請重新載入。', 'warn');
    startBtn.disabled = false;
    return;
  }

  try {
    const data = await fetchJsonOrThrow('/api/word', {}, '取得單字時發生錯誤');
    updateStats(data.stats);

    if (data.finished) {
      state.finished = true;
      toggleControls(true);
      startBtn.disabled = false;
      englishEl.textContent = '🎉 完成本回合';
      translationEl.textContent = '';
      translationEl.classList.add('hidden');
      setMessage('此回合結束，按「開始測驗」重新開始。', 'info');
      return;
    }

    state.currentWord = data.word;
    englishEl.textContent = state.currentWord.en;
    translationEl.textContent = state.currentWord.zh;
    translationEl.classList.add('hidden');
    toggleControls(false);
    revealBtn.focus();
    setMessage('');
  } catch (error) {
    setMessage(error.message, 'error');
    toggleControls(true);
    startBtn.disabled = false;
  }
}

async function sendActionApi(action) {
  if (!state.currentWord) {
    setMessage('請先載入單字', 'warn');
    return;
  }

  try {
    const data = await fetchJsonOrThrow(
      '/api/word/action',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: state.currentWord.id, action }),
      },
      '操作失敗'
    );

    updateStats(data.stats);

    if (data.finished) {
      state.finished = true;
      toggleControls(true);
      startBtn.disabled = false;
      englishEl.textContent = '🎉 完成本回合';
      translationEl.textContent = '';
      translationEl.classList.add('hidden');
      setMessage('本回合結束，按「開始測驗」重來。', 'info');
      return;
    }

    state.currentWord = null;
    await loadWordApi();
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

async function resetSessionApi() {
  try {
    const data = await fetchJsonOrThrow(
      '/api/session/reset',
      { method: 'POST' },
      '重設失敗'
    );
    state.finished = data.finished;
    updateStats(data.stats);
    resetCard();
    startBtn.disabled = false;
    setMessage('已重新載入檔案並重設回合。', 'info');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

async function loadStaticWords() {
  const res = await fetch(STATIC_DATA_URL, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('無法載入靜態單字資料。');
  }

  const words = await res.json();
  staticState.words = Array.isArray(words) ? words : [];

  staticState.deleted.clear();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.deleted);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const validIds = new Set(staticState.words.map((word) => word.id));
        parsed
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && validIds.has(value))
          .forEach((value) => staticState.deleted.add(value));
      }
    }
  } catch (error) {
    // ignore storage errors
  }
}

function saveDeletedToStorage() {
  try {
    const values = Array.from(staticState.deleted.values());
    localStorage.setItem(STORAGE_KEYS.deleted, JSON.stringify(values));
  } catch (error) {
    // ignore storage errors
  }
}

function getActiveStaticWords() {
  return staticState.words.filter((word) => !staticState.deleted.has(word.id));
}

function shuffle(array) {
  const items = [...array];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function prepareStaticSession() {
  const available = getActiveStaticWords();
  const sessionWords = shuffle(available).slice(0, Math.min(MAX_QUESTIONS, available.length));
  staticState.queue = sessionWords;
  staticState.sessionSize = sessionWords.length;
  staticState.answered = 0;
}

function getStaticStats(includeCurrent = false) {
  const available = getActiveStaticWords();
  const maxQuestions = staticState.sessionSize || Math.min(MAX_QUESTIONS, available.length) || 0;
  const remaining = staticState.queue.length + (includeCurrent && state.currentWord ? 1 : 0);

  return {
    total: available.length,
    remaining,
    answered: Math.min(staticState.answered, maxQuestions),
    maxQuestions,
  };
}

async function setupStaticMode(initialError) {
  state.mode = 'static';
  await loadStaticWords();
  prepareStaticSession();
  updateStats(getStaticStats());
  state.finished = true;
  setModeIndicator('模式：純前端練習（GitHub Pages / 無伺服器）', 'warn');
  const message = initialError
    ? '偵測到沒有後端伺服器，已改用純前端練習模式。刪除結果僅會保存在此裝置上。'
    : '目前為純前端練習模式。刪除結果僅會保存在此裝置上。';
  setMessage(message, 'warn');
  startBtn.disabled = false;
}

function beginStaticSession() {
  prepareStaticSession();
  if (!staticState.sessionSize) {
    state.finished = true;
    updateStats(getStaticStats());
    englishEl.textContent = '目前沒有可測驗的單字';
    translationEl.textContent = '';
    translationEl.classList.add('hidden');
    toggleControls(true);
    setMessage('請先在電腦端新增單字或清除瀏覽器刪除紀錄。', 'warn');
    startBtn.disabled = false;
    return false;
  }

  state.finished = false;
  return true;
}

function loadWordStatic() {
  if (!staticState.queue.length) {
    finishStaticRound();
    return;
  }

  state.currentWord = staticState.queue.shift();
  englishEl.textContent = state.currentWord.en;
  translationEl.textContent = state.currentWord.zh;
  translationEl.classList.add('hidden');
  toggleControls(false);
  revealBtn.focus();
  setMessage('');
  updateStats(getStaticStats(true));
}

function finishStaticRound() {
  staticState.answered = staticState.sessionSize;
  state.finished = true;
  toggleControls(true);
  englishEl.textContent = '🎉 完成本回合';
  translationEl.textContent = '';
  translationEl.classList.add('hidden');
  startBtn.disabled = false;
  setMessage('此回合結束，按「開始測驗」重新開始。', 'info');
  updateStats(getStaticStats());
}

function sendActionStatic(action) {
  if (!state.currentWord) {
    setMessage('請先載入單字', 'warn');
    return;
  }

  if (action === 'delete') {
    staticState.deleted.add(state.currentWord.id);
    saveDeletedToStorage();
  }

  staticState.answered += 1;
  state.currentWord = null;

  if (!staticState.queue.length || staticState.answered >= staticState.sessionSize) {
    finishStaticRound();
    return;
  }

  loadWordStatic();
}

function resetStaticSession() {
  staticState.deleted.clear();
  saveDeletedToStorage();
  prepareStaticSession();
  state.finished = true;
  resetCard();
  updateStats(getStaticStats());
  startBtn.disabled = false;
  setMessage('已清除瀏覽器中的刪除紀錄並重新載入所有單字。', 'info');
}

function revealTranslation() {
  translationEl.classList.remove('hidden');
}

function speakWord() {
  if (!state.currentWord || !('speechSynthesis' in window)) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(state.currentWord.en.replace(/["']/g, ''));
  utterance.lang = 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

async function startSession() {
  startBtn.disabled = true;
  setMessage('');

  if (state.mode === 'static') {
    const started = beginStaticSession();
    if (!started) {
      return;
    }
    loadWordStatic();
    return;
  }

  state.finished = false;
  await loadWordApi();
}

async function loadWord() {
  if (state.mode === 'static') {
    loadWordStatic();
  } else {
    await loadWordApi();
  }
}

async function sendAction(action) {
  if (state.mode === 'static') {
    sendActionStatic(action);
  } else {
    await sendActionApi(action);
  }
}

async function resetSession() {
  if (state.mode === 'static') {
    resetStaticSession();
  } else {
    await resetSessionApi();
  }
}

async function initialise() {
  resetCard();
  setModeIndicator('嘗試連線至本機伺服器…', 'info');
  try {
    await setupApiMode();
  } catch (error) {
    console.warn('Falling back to static mode', error);
    await setupStaticMode(error);
  }
}

startBtn.addEventListener('click', startSession);
revealBtn.addEventListener('click', revealTranslation);
keepBtn.addEventListener('click', () => sendAction('keep'));
deleteBtn.addEventListener('click', () => sendAction('delete'));
resetBtn.addEventListener('click', resetSession);
speakBtn.addEventListener('click', speakWord);

document.addEventListener('DOMContentLoaded', initialise);
