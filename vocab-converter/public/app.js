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

let currentWord = null;
let finished = false;

function updateStats(stats = {}) {
  if (!stats.total && stats.total !== 0) {
    statsEl.textContent = '尚未載入檔案';
    questionCounter.textContent = '-- / --';
    return;
  }

  statsEl.innerHTML = `
    <span>總共：${stats.total}</span>
    <span>剩餘：${stats.remaining}</span>
    <span>本輪已答：${stats.answered} / ${stats.maxQuestions}</span>
  `;
  questionCounter.textContent = `${Math.min(stats.answered + 1, stats.maxQuestions)} / ${stats.maxQuestions}`;
}

function setMessage(text, type = 'info') {
  messageEl.textContent = text || '';
  messageEl.dataset.type = type;
}

function toggleControls(disabled) {
  revealBtn.disabled = disabled;
  keepBtn.disabled = disabled;
  deleteBtn.disabled = disabled;
  speakBtn.disabled = disabled;
}

function resetCard() {
  currentWord = null;
  englishEl.textContent = '請按「開始測驗」';
  translationEl.textContent = '';
  translationEl.classList.add('hidden');
  toggleControls(true);
}

async function fetchState() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) {
      throw new Error('無法取得狀態');
    }
    const data = await res.json();
    updateStats(data.stats);
    finished = data.finished;
    if (finished) {
      setMessage('目前沒有題目，請重新載入或增加單字。', 'warn');
    }
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

async function loadWord() {
  if (finished) {
    setMessage('此回合已結束，請重新載入。', 'warn');
    return;
  }

  try {
    const res = await fetch('/api/word');
    if (!res.ok) {
      throw new Error('取得單字時發生錯誤');
    }
    const data = await res.json();

    updateStats(data.stats);

    if (data.finished) {
      finished = true;
      toggleControls(true);
      startBtn.disabled = false;
      setMessage('此回合結束！按「開始測驗」重新開始。', 'info');
      englishEl.textContent = '🎉 完成本回合';
      translationEl.textContent = '';
      translationEl.classList.add('hidden');
      return;
    }

    currentWord = data.word;
    englishEl.textContent = currentWord.en;
    translationEl.textContent = currentWord.zh;
    translationEl.classList.add('hidden');
    toggleControls(false);
    revealBtn.focus();
    setMessage('');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

async function sendAction(action) {
  if (!currentWord) {
    setMessage('請先載入單字', 'warn');
    return;
  }

  try {
    const res = await fetch('/api/word/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentWord.id, action }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || '操作失敗');
    }

    const data = await res.json();
    updateStats(data.stats);

    if (data.finished) {
      finished = true;
      toggleControls(true);
      startBtn.disabled = false;
      englishEl.textContent = '🎉 完成本回合';
      translationEl.textContent = '';
      translationEl.classList.add('hidden');
      setMessage('本回合結束，按「開始測驗」重來。', 'info');
      return;
    }

    currentWord = null;
    loadWord();
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

async function resetSession() {
  try {
    const res = await fetch('/api/session/reset', { method: 'POST' });
    if (!res.ok) {
      throw new Error('重設失敗');
    }
    const data = await res.json();
    finished = data.finished;
    updateStats(data.stats);
    resetCard();
    startBtn.disabled = false;
    setMessage('已重新載入檔案並重設回合。', 'info');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

function revealTranslation() {
  translationEl.classList.remove('hidden');
}

function speakWord() {
  if (!currentWord || !('speechSynthesis' in window)) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(currentWord.en.replace(/["']/g, ''));
  utterance.lang = 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

startBtn.addEventListener('click', () => {
  finished = false;
  startBtn.disabled = true;
  loadWord();
});

revealBtn.addEventListener('click', revealTranslation);
keepBtn.addEventListener('click', () => sendAction('keep'));
deleteBtn.addEventListener('click', () => sendAction('delete'));
resetBtn.addEventListener('click', resetSession);
speakBtn.addEventListener('click', speakWord);

fetchState();
resetCard();

