const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyAppKey,
  redactSecrets,
  normalizeScope,
  folderAllowed,
  createTicnoteSession,
  createGrokConfig,
  planUnattendedPrep,
  assertReadRequest,
  CHINA_ORIGIN,
} = require('../main/ticnote');

const KEY = 'tncn_sk_examplekeyvalue';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signaturevalue';

function memoryStore(initial = {}) {
  let state = initial;
  return {
    load: () => state,
    save: (next) => { state = next; },
    read: () => state,
  };
}

function session(store, transport, log = () => {}) {
  const secrets = new Map();
  let serial = 0;
  return createTicnoteSession({
    load: store.load,
    save: store.save,
    encrypt: (value) => {
      serial += 1;
      const id = `enc-${serial}`;
      secrets.set(id, value);
      return id;
    },
    decrypt: (id) => secrets.get(id) || '',
    transport,
    log,
  });
}

test('only a China production app key is accepted', () => {
  assert.equal(classifyAppKey(KEY).ok, true);
  assert.equal(classifyAppKey('tnovs_sk_examplekeyvalue').reason, 'overseas_refused');
  assert.equal(classifyAppKey('tncn_sit_sk_examplekeyvalue').reason, 'sit_refused');
  assert.equal(classifyAppKey('sk-other').reason, 'prefix_refused');
  assert.equal(classifyAppKey('').reason, 'missing');
});

test('status, logs, and saved scope never contain the key or token', () => {
  const store = memoryStore();
  const logs = [];
  const calls = [];
  const api = session(store, (request) => {
    calls.push(request);
    if (request.url.endsWith('/api/p1/appkey/login')) {
      return { status: 200, body: JSON.stringify({ code: 0, data: { token: TOKEN, tokenType: 'Bearer' } }) };
    }
    return { status: 200, body: JSON.stringify({ chats: [] }) };
  }, (line) => logs.push(line));
  const saved = api.saveKey(KEY);
  assert.equal(saved.ok, true);
  assert.equal(JSON.stringify(saved).includes(KEY), false);
  assert.equal(JSON.stringify(store.read()).includes(KEY), false);
  assert.equal(logs.join('\n').includes(KEY), false);
  return api.verify().then((verified) => {
    assert.equal(verified.ok, true);
    const packed = JSON.stringify({ verified, status: api.status(), logs, stored: store.read() });
    assert.equal(packed.includes(KEY), false);
    assert.equal(packed.includes(TOKEN), false);
    assert.equal(calls[0].url, `${CHINA_ORIGIN}/api/p1/appkey/login`);
    assert.equal(calls[1].url, `${CHINA_ORIGIN}/api/v2/file-index/chats`);
    assert.equal(calls[1].url.includes('query='), false);
  });
});

test('missing key does not touch the network', async () => {
  let called = false;
  const api = session(memoryStore(), () => { called = true; return { status: 500, body: '' }; });
  const verified = await api.verify();
  const pulled = await api.pullTranscripts();
  assert.equal(verified.reason, 'no_key');
  assert.equal(verified.network, false);
  assert.equal(pulled.reason, 'no_key');
  assert.equal(pulled.network, false);
  assert.equal(called, false);
});

test('redirects are refused and the token is not sent to another host', async () => {
  const calls = [];
  const api = session(memoryStore(), (request) => {
    calls.push({ url: request.url, authorization: request.headers.Authorization || '' });
    if (request.url.endsWith('/login')) {
      return { status: 302, headers: { location: 'https://evil.example/steal' }, body: '' };
    }
    return { status: 200, body: '{}' };
  });
  api.saveKey(KEY);
  const verified = await api.verify();
  assert.equal(verified.reason, 'redirect_refused');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.startsWith(CHINA_ORIGIN), true);
  assert.equal(calls[0].authorization.includes(TOKEN), false);
  assert.equal(assertReadRequest({ url: 'https://cdn.ticnote.cn/file.mp3', method: 'GET' }).reason, 'host_refused');
  assert.equal(assertReadRequest({ url: `${CHINA_ORIGIN}/api/v1/task/transcribe/commit`, method: 'POST' }).reason, 'method_refused');
});

test('empty scope lists project names only and does not fetch transcripts or other projects', async () => {
  const calls = [];
  const api = session(memoryStore(), (request) => {
    calls.push(request.url);
    if (request.url.endsWith('/login')) {
      return { status: 200, body: JSON.stringify({ code: 0, data: { token: TOKEN } }) };
    }
    if (request.url.endsWith('/chats')) {
      return {
        status: 200,
        body: JSON.stringify({
          chats: [
            { project_id: '100', projectInfo: { id: '100', name: '获准工作', fileNum: 2 } },
            { project_id: '200', projectInfo: { id: '200', name: '其他项目', fileNum: 9 } },
          ],
        }),
      };
    }
    return { status: 500, body: 'should-not-fetch' };
  });
  api.saveKey(KEY);
  const verified = await api.verify();
  assert.deepEqual(verified.projects, [
    { id: '100', name: '获准工作', fileNum: 2 },
    { id: '200', name: '其他项目', fileNum: 9 },
  ]);
  const pulled = await api.pullTranscripts();
  assert.equal(pulled.reason, 'scope_empty');
  assert.equal(pulled.network, false);
  assert.equal(calls.some((url) => url.includes('file-detail') || url.includes('file-tree')), false);
  const outside = await api.listFolders('200');
  assert.equal(outside.reason, 'project_not_allowed');
  assert.equal(outside.network, false);
});

test('folder allowlist is exact, does not cross parent or sibling boundaries, and ignores names', async () => {
  const calls = [];
  const api = session(memoryStore(), (request) => {
    calls.push(request.url);
    if (request.url.endsWith('/login')) return { status: 200, body: JSON.stringify({ code: 0, data: { token: TOKEN } }) };
    if (request.url.endsWith('/chats')) {
      return { status: 200, body: JSON.stringify({ chats: [{ projectInfo: { id: '100', name: '获准工作', fileNum: 3 } }, { projectInfo: { id: '200', name: '获准工作', fileNum: 1 } }] }) };
    }
    if (request.url.includes('/file-detail/')) {
      const id = request.url.split('/').pop();
      return { status: 200, body: JSON.stringify({ code: 0, data: { recordId: id, transcribeJson: id === '31' ? '' : '只属于文件夹 30 的转写', updateTime: '2026-11-18T01:00:00Z', transcribeId: 7, dataVersion: 'v2' } }) };
    }
    return { status: 500, body: 'unexpected' };
  });
  api.saveKey(KEY);
  await api.verify();
  api.saveScope({ projects: [{ id: '100', name: '别的名字' }] });
  api.rememberTree('100', [
    { id: '30', name: '周会', type: 'directory', children: [
      { id: '31', name: '根上的子录音', type: 'file', fileType: 'recording_file' },
      { id: '40', name: '周会', type: 'directory', children: [
        { id: '41', name: '子文件夹录音', type: 'file', fileType: 'recording_file' },
      ] },
    ] },
    { id: '50', name: '周会', type: 'directory', children: [
      { id: '51', name: '同名兄弟文件夹', type: 'file', fileType: 'recording_file' },
    ] },
  ]);
  const saved = api.saveScope({
    projects: [{ id: '100' }],
    folders: [{ id: '30', projectId: '100' }, { id: '40', projectId: '200', name: '周会' }],
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.scheduleEnabled, false);
  assert.deepEqual(saved.status.folders.map((folder) => folder.id), ['30']);
  assert.equal(saved.status.folders[0].includesChildren, false);
  assert.equal(folderAllowed(saved.status, '40', '100'), false);
  const pulled = await api.pullTranscripts();
  assert.deepEqual(pulled.records.map((record) => record.recordId), ['31']);
  assert.equal(pulled.records[0].missing, true);
  assert.equal(pulled.records[0].reason, 'transcript_missing');
  assert.equal(calls.some((url) => url.includes('/file-detail/41') || url.includes('/file-detail/51')), false);
  assert.equal(calls.some((url) => url.includes('transcribe/commit') || url.includes('cdn.ticnote')), false);
  const again = await api.pullTranscripts();
  assert.equal(again.records[0].reason, 'unchanged');
  assert.equal(calls.filter((url) => url.includes('/file-detail/31')).length, 1);
});

test('scope cannot be chosen by a similar folder name', () => {
  const scope = normalizeScope({
    projects: [{ id: '100', name: '工作' }],
    folders: [{ id: '30', projectId: '100', name: '周会' }],
  });
  assert.equal(folderAllowed(scope, '30', '100'), true);
  assert.equal(folderAllowed(scope, '31', '100'), false);
  assert.equal(scope.folders[0].includesChildren, false);
});

test('grok stays off until a model is saved and the user enables it', async () => {
  const store = memoryStore();
  let calls = 0;
  const grok = createGrokConfig({
    load: store.load,
    save: store.save,
    encrypt: (value) => `enc:${value}`,
    decrypt: (value) => String(value || '').replace(/^enc:/, ''),
  });
  const saved = grok.saveKey('xai-test-key-value');
  assert.equal(saved.status.enabled, false);
  assert.equal(JSON.stringify(saved).includes('xai-test-key-value'), false);
  const blocked = await grok.extract({
    materials: [{ sourceRef: 'ticnote:1/2/3', text: '我来跟进这件事。' }],
    transport: () => { calls += 1; return { status: 200, body: '{}' }; },
  });
  assert.equal(blocked.reason, 'not_enabled');
  assert.equal(calls, 0);
  assert.equal(grok.setEnabled(true).reason, 'no_model');
  grok.saveModel('account-chosen-model');
  grok.setEnabled(true);
  assert.equal(grok.status().enabled, true);
  assert.equal(grok.status().model, 'account-chosen-model');
  const plan = planUnattendedPrep({
    schedule: { acceptedLocally: false, enabled: false },
    ticnote: { configured: true, folderCount: 1 },
    grok: grok.status(),
  });
  assert.equal(plan.willCallGrok, false);
  assert.equal(plan.blockedReason, 'not_accepted');
  assert.match(plan.gap.message, /关闭、睡眠或离线/);
});
