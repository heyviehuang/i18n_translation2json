const fs = require('fs');
const readline = require('readline');
const say = require('say'); // 加入語音模組

/* ========= 讀取並解析 ========= */

const FILE_PATH = './RVOCA.ini';
let lines = fs.readFileSync(FILE_PATH, 'utf8')
    .replace(/^\uFEFF/, '')              // 去掉 BOM（如果有）
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

// 是否含中日韓文字（用來定位中文解釋起點）
const hasCJK = (s) => /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(s);

// 將一行拆成 { en, zh }，能處理片語（含空白 / 連字號等）
function splitEnZh(line) {
    const tokens = line.split(/\s+/);
    const cjkIndex = tokens.findIndex(t => hasCJK(t));

    if (cjkIndex > 0) {
        return {
            en: tokens.slice(0, cjkIndex).join(' '),
            zh: tokens.slice(cjkIndex).join(' ')
        };
    }

    // 找不到中文時，退回：第一個 token 視為英文，其餘為中文/補充
    const [en, ...zhParts] = tokens;
    return { en, zh: zhParts.join(' ') };
}

let wordList = lines.map(splitEnZh);
let total = wordList.length;

/* ========= 狀態 ========= */

let remaining = [...wordList];
let answered = 0;
const maxQuestions = 15;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

/* ========= I/O ========= */

function saveRemainingWords() {
    const updatedLines = remaining.map(w => `${w.en} ${w.zh}`);
    fs.writeFileSync(FILE_PATH, updatedLines.join('\n'), 'utf8');
}

function ask() {
    if (answered >= maxQuestions || remaining.length === 0) {
        console.log('\n📘 Ended');
        console.log(`${remaining.length} / ${total}`);
        rl.close();
        return;
    }

    const index = Math.floor(Math.random() * remaining.length);
    const word = remaining[index];

    console.clear();
    console.log(` ${answered + 1} / ${maxQuestions}`);
    console.log(`\n🔸 ${word.en}`);
    // 語音朗讀
    say.speak(word.en.replace(/["']/g, ''));

    rl.question('', () => {
        console.log(`💡 ${word.zh}`);
        rl.question('\n', (key) => {
            const input = String(key).trim().toUpperCase();
            if (input === 'D') {
                remaining.splice(index, 1); // 刪除該筆
                saveRemainingWords();       // 儲存更新
                console.log('✅ Deleted');
            } else {
                console.log('📌 Saved');
            }
            answered++;
            setTimeout(ask, 1000);
        });
    });
}

/* ========= 啟動 ========= */

console.clear();
console.log(`${remaining.length} / ${total}`);
setTimeout(ask, 1500);
