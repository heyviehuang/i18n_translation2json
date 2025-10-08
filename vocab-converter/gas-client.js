const DEFAULT_API_URL =
  process.env.RVOCA_API ||
  'https://script.google.com/macros/s/AKfycbyZ83PSWFhIEljAScXy3jTOsS2t1FYwK9V6UlNIwNHRs4j7TjfiBwMyk9f5-ir_tjww/exec';
const DEFAULT_TOKEN = process.env.RVOCA_TOKEN || 'rvo-2025-chiuchiou';

const API_URL = DEFAULT_API_URL?.trim();
const TOKEN = DEFAULT_TOKEN?.trim();

function isConfigured() {
  return Boolean(API_URL && TOKEN);
}

function ensureConfigured() {
  if (!isConfigured()) {
    throw new Error('GAS backend is not configured.');
  }
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const message = `GAS request failed with status ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function normaliseListResponse(json) {
  if (!json || typeof json !== 'object') {
    return null;
  }

  if (Array.isArray(json.data)) {
    return json.data;
  }
  if (Array.isArray(json.records)) {
    return json.records;
  }
  if (Array.isArray(json.words)) {
    return json.words;
  }
  if (Array.isArray(json.items)) {
    return json.items;
  }

  return null;
}

function normaliseWord(record, index) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const id =
    record.id ??
    record.wordId ??
    record.key ??
    record.word ??
    `row-${index}`;
  const en = record.en ?? record.word ?? record.english ?? '';
  const zh = record.zh ?? record.translation ?? record.zhTw ?? record.zhHant ?? '';

  return {
    id,
    order: typeof record.order === 'number' ? record.order : index,
    en: String(en).trim(),
    zh: String(zh).trim(),
  };
}

async function fetchWords() {
  ensureConfigured();

  const attempts = [
    `${API_URL}?fn=pull&token=${encodeURIComponent(TOKEN)}`,
    `${API_URL}?t=${encodeURIComponent(TOKEN)}`,
  ];

  let lastError = null;

  for (const url of attempts) {
    try {
      const json = await requestJson(url);
      const records = normaliseListResponse(json);
      if (!records) {
        throw new Error('Unexpected GAS response structure.');
      }
      return records.map(normaliseWord).filter(Boolean);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('Unable to fetch words from GAS.');
}

function isSuccessResponse(json) {
  if (!json || typeof json !== 'object') {
    return false;
  }
  if (json.ok === true || json.success === true) {
    return true;
  }
  if (typeof json.status === 'string' && json.status.toLowerCase() === 'ok') {
    return true;
  }
  return false;
}

async function deleteWord(id) {
  ensureConfigured();

  const payloads = [
    {
      body: { t: TOKEN, action: 'delete', payload: { id } },
    },
    {
      body: { token: TOKEN, fn: 'push', ops: [{ type: 'delete', id }] },
    },
  ];

  let lastError = null;

  for (const { body } of payloads) {
    try {
      const json = await requestJson(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!isSuccessResponse(json)) {
        throw new Error('GAS delete operation was not acknowledged.');
      }
      return json;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('Unable to delete word on GAS.');
}

module.exports = {
  isConfigured,
  fetchWords,
  deleteWord,
  normaliseWord,
};
