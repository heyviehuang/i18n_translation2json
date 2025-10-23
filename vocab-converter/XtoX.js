// XtoX.js — Robust 版：自動偵測起始列與欄位對，分頁=unit
import * as XLSX from "xlsx/xlsx.mjs";
import fs from "fs";
XLSX.set_fs(fs);

const INPUT_FILE = "source.xlsx";
const OUTPUT_FILE = "rvoca_unitvc_db.xlsx";

// ---------- helpers ----------
const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

// 取 unit：優先取分頁名前綴數字；若沒有，直接用整個分頁名（避免空 unit 導致 0 筆）
const unitFromSheetName = (name) => {
    const s = clean(name);
    const m = s.match(/^(\d{1,4})/);
    return m ? m[1] : s;
};

// 判斷看起來像英文單字（允許空白、-、'）
const looksEnglish = (s) =>
    /^[A-Za-z][A-Za-z\s\-']*$/.test(s);

// 判斷比較像中文（有非 ASCII 字元）
const looksChinese = (s) =>
    /[^\x00-\x7F]/.test(s);

// 嘗試找出資料起始列：尋找第一個「看起來像英文」的列
const detectStartRow = (rows) => {
    const maxCols = rows.reduce((m, r) => Math.max(m, (r || []).length), 0);
    for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < maxCols; c++) {
            const v = clean((rows[r] || [])[c] || "");
            if (v && looksEnglish(v)) return r; // 第一個像英文的列
        }
    }
    // 找不到就從第 0 列開始
    return 0;
};

// 從整個工作表偵測「英/中」對欄（以兩欄一組）
// 策略：掃描 (c, c+1) 成對欄，計算符合度分數
const detectColumnPairs = (rows, startRow) => {
    const pairs = [];
    const maxCols = rows.reduce((m, r) => Math.max(m, (r || []).length), 0);

    for (let c = 0; c < maxCols - 1; c++) {
        let enScore = 0, zhScore = 0, nonEmpty = 0;
        for (let r = startRow; r < rows.length; r++) {
            const en = clean((rows[r] || [])[c] || "");
            const zh = clean((rows[r] || [])[c + 1] || "");
            if (en || zh) nonEmpty++;
            if (en && looksEnglish(en)) enScore++;
            if (zh && (looksChinese(zh) || !looksEnglish(zh))) zhScore++;
        }
        // 需要有一定數量非空樣本，且英/中各自得分 > 0
        if (nonEmpty >= 3 && enScore > 0) {
            pairs.push({ enCol: c, zhCol: c + 1, score: enScore + zhScore, nonEmpty });
        }
    }

    // 以分數排序，濾掉極少量資料的 pair
    pairs.sort((a, b) => b.score - a.score);
    return pairs;
};

// ---------- main ----------
const wb = XLSX.readFile(INPUT_FILE);
const out = [["id", "word", "zh", "unit", "status", "updatedAt"]];
let nextId = 1;

let total = 0;
for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (!rows.length) {
        console.warn(`⚠️ 分頁「${sheetName}」是空的，跳過`);
        continue;
    }

    const unit = unitFromSheetName(sheetName);

    // 1) 偵測起始列
    const startRow = detectStartRow(rows);

    // 2) 偵測欄位對（英/中成對）
    let pairs = detectColumnPairs(rows, startRow);

    // 若偵測不到，fallback：假設 (0,1) 就是英/中
    if (pairs.length === 0) {
        pairs = [{ enCol: 0, zhCol: 1, score: 0, nonEmpty: 0 }];
        console.warn(`⚠️ 分頁「${sheetName}」偵測不到欄位對，改用預設 (col 0, col 1)。`);
    }

    let countThisSheet = 0;

    for (const { enCol, zhCol } of pairs) {
        for (let r = startRow; r < rows.length; r++) {
            const word = clean((rows[r] || [])[enCol] || "");
            const zh = clean((rows[r] || [])[zhCol] || "");
            if (!word) continue; // 沒英文就不收
            out.push([nextId++, word, zh, unit, "", ""]); // status/updatedAt 留空
            countThisSheet++;
        }
    }

    total += countThisSheet;
    console.log(`📄 ${sheetName} ⇒ unit=${unit}，擷取 ${countThisSheet} 筆`);
}

const outSheet = XLSX.utils.aoa_to_sheet(out);
const outWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(outWb, outSheet, "整理後");
XLSX.writeFile(outWb, OUTPUT_FILE);

console.log(`\n✅ 轉換完成：共 ${total} 筆，輸出 ${OUTPUT_FILE}`);
if (total === 0) {
    console.warn("❗仍為 0 筆，請截圖任一分頁前 10~15 列給我，我幫你對應實際欄位。");
}
