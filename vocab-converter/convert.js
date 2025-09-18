const fs = require('fs');
const xlsx = require('xlsx');

// 檔案路徑
const inputFile = 'vocab.xlsx';
const outputFile = 'i18n_translation.json';

// 讀取 Excel
const workbook = xlsx.readFile(inputFile);
const sheetNames = workbook.SheetNames;

let result = {};

// 處理每一個分頁
sheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    const headers = Object.keys(data[0]);

    for (let i = 0; i < headers.length; i += 2) {
        const categoryHeader = headers[i];
        const categoryName = categoryHeader.trim();

        if (!categoryName) continue;

        // 用「分頁名 + 分類名」來避免不同分頁重名衝突
        const finalCategoryName = `${sheetName}-${categoryName}`;

        result[finalCategoryName] = {};

        data.forEach(row => {
            const en = (row[headers[i]] || '').trim();
            const zh = (row[headers[i + 1]] || '').trim();

            if (en) {
                result[finalCategoryName][en] = {
                    en: en,
                    zh: zh
                }
            }
        });
    }
});

// 寫入 JSON
fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf8');
console.log('✅ 所有分頁轉換完成！');
