import { describe, it, expect, beforeAll } from 'vitest';
import md5 from 'blueimp-md5';

const BASE = process.env.EMLOG_BASE_URL?.replace(/\/$/, '') || '';
const API_KEY = process.env.EMLOG_API_KEY || '';
const RUN = process.env.RUN_EMLOG_TESTS === '1';

function makeUrls(endpoint: string, query: Record<string, string> = {}) {
  const usp = new URLSearchParams(query).toString();
  return [
    `${BASE}/?rest-api=${endpoint}${usp ? `&${usp}` : ''}`,
    `${BASE}/index.php?rest-api=${endpoint}${usp ? `&${usp}` : ''}`,
  ];
}

async function getJson(url: string) {
  const resp = await fetch(url, { method: 'GET' });
  const text = await resp.text();
  return JSON.parse(text);
}

async function postForm(endpoint: string, form: Record<string, string>) {
  const req_time = Math.floor(Date.now() / 1000).toString();
  const body = new URLSearchParams({ ...form });
  if (API_KEY) {
    body.append('req_time', req_time);
    body.append('req_sign', md5(req_time + API_KEY));
  }
  const urls = [
    `${BASE}/?rest-api=${endpoint}`,
    `${BASE}/index.php?rest-api=${endpoint}`,
  ];
  let lastErr: any = null;
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const text = await resp.text();
      const json = JSON.parse(text);
      if (json.code !== 0) throw new Error(json.msg || 'api error');
      return json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('post failed');
}

(RUN ? describe : describe.skip)('EMLOG integration', () => {
  beforeAll(() => {
    expect(BASE).toBeTruthy();
  });

  it('sort_list should return list', async () => {
    const urls = makeUrls('sort_list');
    let ok = false; let data: any = null; let lastErr: any = null;
    for (const url of urls) {
      try {
        const json = await getJson(url);
        expect(json.code).toBe(0);
        data = json.data;
        ok = true; break;
      } catch (e) { lastErr = e; }
    }
    if (!ok) throw lastErr ?? new Error('sort_list failed');
    expect(Array.isArray(data?.sorts)).toBe(true);
  });

  it('note_post should create a note', async () => {
    const json = await postForm('note_post', { t: `[test] ${new Date().toISOString()}` });
    expect(json.code).toBe(0);
    expect(json.data?.note_id).toBeTruthy();
  });
});
