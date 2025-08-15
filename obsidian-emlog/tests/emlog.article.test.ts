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

function buildSignedForm(form: Record<string, string>) {
  const req_time = Math.floor(Date.now() / 1000).toString();
  const body = new URLSearchParams({ ...form });
  if (API_KEY) {
    body.append('req_time', req_time);
    body.append('req_sign', md5(req_time + API_KEY));
  }
  return body;
}

async function postForm(endpoint: string, form: Record<string, string>) {
  const body = buildSignedForm(form);
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

async function postMultipart(endpoint: string, fd: FormData) {
  // append sign
  if (API_KEY) {
    const req_time = Math.floor(Date.now() / 1000).toString();
    fd.append('req_time', req_time);
    fd.append('req_sign', md5(req_time + API_KEY));
  }
  const urls = [
    `${BASE}/?rest-api=${endpoint}`,
    `${BASE}/index.php?rest-api=${endpoint}`,
  ];
  let lastErr: any = null;
  for (const url of urls) {
    try {
      const resp = await fetch(url, { method: 'POST', body: fd });
      const text = await resp.text();
      const json = JSON.parse(text);
      if (json.code !== 0) throw new Error(json.msg || 'api error');
      return json;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('multipart post failed');
}

(RUN ? describe : describe.skip)('EMLOG article + upload integration', () => {
  beforeAll(() => {
    expect(BASE).toBeTruthy();
  });

  it('upload should accept a tiny png and return url', async () => {
    // 1x1 PNG (base64)
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/aqsMpcAAAAASUVORK5CYII=';
    const bin = Buffer.from(b64, 'base64');
    const blob = new Blob([bin], { type: 'image/png' });
    const fd = new FormData();
    fd.append('file', blob, 'tiny.png');
    const json = await postMultipart('upload', fd);
    expect(json.code).toBe(0);
    expect(json.data?.url).toMatch(/^https?:\/\//);
  });

  it('article_post then article_update should succeed', async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const title = `[itest] ${stamp}`;
    const content = `# Hello\n\nThis is an integration test ${stamp}`;

    const post = await postForm('article_post', {
      title,
      content,
      excerpt: 'integration test',
      tags: 'it,emlog',
      draft: 'n',
      allow_remark: 'y',
      auto_cover: 'n',
    });
    expect(post.code).toBe(0);
    const id: number = post.data?.article_id;
    expect(id).toBeTruthy();

    // verify detail
    const [detailUrl] = makeUrls('article_detail', { id: String(id) });
    const detail = await getJson(detailUrl);
    expect(detail.code).toBe(0);

    // update
    const newTitle = `${title} [updated]`;
    const upd = await postForm('article_update', {
      id: String(id),
      title: newTitle,
      excerpt: 'updated excerpt',
      draft: 'n',
    });
    expect(upd.code).toBe(0);
  });
});
