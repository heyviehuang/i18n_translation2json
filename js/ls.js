import { jsonpListen, speak } from './common.js';

const ROUND_SIZE = 15;
let batch = [], ix = -1, revealed = false, remaining = 0, roundId = 0;

/* 產生終端風格畫面（你可直接複製 index.html 的 TEMPLATES 與 buildCode 來共用） */
function buildCode(word, zh, showZh, q, total, remain) {
    const start = 10, L = n => String(n).padStart(2, ' ');
    const lines = [
        `<span class="cm">// rvoca listening – runtime</span>`,
        `<span class="kw">const</span> <span class="var">ROUND_SIZE</span> <span class="op">=</span> <span class="num">${ROUND_SIZE}</span>`,
        ``,
        `<span class="kw">try</span> {`,
        `  <span class="var">speak</span>(<span class="str">'${(word || '').replace(/</g, '&lt;').replace(/&/g, '&amp;')}'</span>)`,
        `} <span class="kw">catch</span> (e) {}`,
        ``,
        `<span class="cm">// remain:</span> <span class="num">${remain}</span> <span class="cm">// progress:</span> <span class="num">${q}</span>/<span class="num">${total}</span>`,
        `<span class="cm">// press Space to reveal, then next</span><span class="cursor"></span>`
    ];
    return lines.map((t, i) => `<span class="gutter">${L(start + i)}</span>${t}`).join('\n');
}

function render() {
    const code = document.getElementById('code');
    if (ix < 0 || ix >= batch.length) {
        code.innerHTML = buildCode("RVOCA.reload()", "新回合", false, 0, ROUND_SIZE, remaining);
        return;
    }
    const q = ix + 1;
    const { word, zh } = batch[ix];
    const text = revealed
        ? `${buildCode(word, zh, true, q, ROUND_SIZE, remaining)}\n<span class="cm"># ${zh || '（未填中文）'}</span>`
        : buildCode(word, zh, false, q, ROUND_SIZE, remaining);
    code.innerHTML = text;
}

async function startRound(series = null) {
    const res = await jsonpListen({ action: "nextListeningBatch", count: ROUND_SIZE, ...(series ? { series } : {}) });
    // 後端請把 en 映射成 word 回傳：{id, word: en, zh}
    batch = res.items || [];
    remaining = (typeof res.remaining === 'number') ? res.remaining : 0;
    ix = 0; revealed = false;
    render();
    if (batch.length) speak(batch[ix].word);
}

function advance() {
    if (!batch.length) { startRound(); return; }
    if (!revealed) {
        revealed = true; render();
    } else {
        ix++; revealed = false;
        if (ix >= batch.length) { startRound(); return; }
        render(); speak(batch[ix].word);
    }
}

/* copy 按鈕（沿用你現有 UI 手感） */
function copy(txt) { navigator.clipboard?.writeText(txt) }
document.getElementById('copyEn')?.addEventListener('click', e => { e.stopPropagation(); if (ix >= 0) copy(batch[ix]?.word || ''); });
document.getElementById('copyZh')?.addEventListener('click', e => { e.stopPropagation(); if (ix >= 0) copy(batch[ix]?.zh || ''); });

/* key / click 行為：跟舊頁一致 */
document.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); advance(); }
});
document.body.addEventListener('click', advance);

/* 啟動 */
startRound();
