// sync.js – handles pulling and pushing to GAS backend

// Node 18+ has fetch built‑in. If using an older version, install node-fetch and uncomment the import.
// const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const API_URL = process.env.RVOCA_API;   // e.g. https://script.google.com/macros/s/ABCD/exec
const TOKEN = process.env.RVOCA_TOKEN; // your SECRET_TOKEN

async function pull(lastSync) {
    const qs = new URLSearchParams({ fn: 'pull', token: TOKEN });
    if (lastSync) qs.append('since', lastSync);
    const res = await fetch(`${API_URL}?${qs.toString()}`);
    const json = await res.json();
    return json;
}

async function push(ops) {
    const body = { fn: 'push', token: TOKEN, ops };
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return await res.json();
}

module.exports = { pull, push };
