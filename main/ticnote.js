// TicNote 只读接入。中国正式环境，精确 ID 授权，不上传、不发起转写、不跟随重定向。
// 这个文件不读取钥匙串，也不发网络请求；调用方传入加密和 transport。

const CHINA_ORIGIN = 'https://voice-api.ticnote.cn';
const CHINA_HOST = 'voice-api.ticnote.cn';
const LOGIN_PATH = '/api/p1/appkey/login';
const PROJECTS_PATH = '/api/v2/file-index/chats';
const TREE_PATH = '/api/v1/file-index/file-tree';
const DETAIL_PREFIX = '/api/v2/file-index/file-detail/';
const GROK_MODEL = 'grok-4';
const GROK_HOST = 'api.x.ai';
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const KEY_RE = /^tncn_sk_[A-Za-z0-9_-]{8,200}$/;
const RECORDING_TYPES = new Set([
  'upload_recording', 'recording_file', 'mp3', 'wav', 'm4a', 'aac', 'caf', 'opus', 'mp4', 'mov',
]);

function emptyScope() {
  return { version: 1, projects: [], folders: [] };
}

function cleanId(value) {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return ID_RE.test(id) ? id : '';
}

function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function classifyAppKey(appkey) {
  const key = typeof appkey === 'string' ? appkey.trim() : '';
  if (!key) return { ok: false, reason: 'missing' };
  if (key.startsWith('tnovs_')) return { ok: false, reason: 'overseas_refused' };
  if (key.startsWith('tncn_sit_sk_') || key.includes('_sit_')) return { ok: false, reason: 'sit_refused' };
  if (!key.startsWith('tncn_sk_')) return { ok: false, reason: 'prefix_refused' };
  if (!KEY_RE.test(key)) return { ok: false, reason: 'malformed' };
  return { ok: true, key };
}

function redactSecrets(value, secrets = []) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  secrets.filter(Boolean).forEach((secret) => {
    text = text.split(secret).join('[redacted]');
  });
  text = text.replace(/tncn_(?:sit_)?sk_[A-Za-z0-9_-]+/g, '[redacted-key]');
  text = text.replace(/tnovs_(?:sit_)?sk_[A-Za-z0-9_-]+/g, '[redacted-key]');
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted-token]');
  text = text.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-token]');
  return text;
}

function normalizeScope(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const projects = [];
  (Array.isArray(source.projects) ? source.projects : []).forEach((item) => {
    const id = cleanId(item && (item.id || item.projectId));
    if (!id || projects.some((project) => project.id === id)) return;
    projects.push({ id, name: cleanName(item && item.name) || id });
  });
  const folders = [];
  (Array.isArray(source.folders) ? source.folders : []).forEach((item) => {
    const id = cleanId(item && item.id);
    const projectId = cleanId(item && item.projectId);
    if (!id || !projectId || !projects.some((project) => project.id === projectId)) return;
    if (folders.some((folder) => folder.id === id)) return;
    folders.push({
      id,
      projectId,
      name: cleanName(item && item.name) || id,
      parentId: cleanId(item && item.parentId) || null,
      includesChildren: false,
      covers: 'direct-recordings-only',
    });
  });
  return { version: 1, projects, folders };
}

function projectAllowed(scope, projectId) {
  const id = cleanId(projectId);
  return Boolean(id && normalizeScope(scope).projects.some((project) => project.id === id));
}

function folderAllowed(scope, folderId, projectId) {
  const id = cleanId(folderId);
  const parentProject = cleanId(projectId);
  return normalizeScope(scope).folders.some((folder) => (
    folder.id === id && (!parentProject || folder.projectId === parentProject)
  ));
}

function publicTicnoteStatus({ configured = false, scope = emptyScope(), verified = false } = {}) {
  const normalized = normalizeScope(scope);
  return {
    configured: configured === true,
    verified: verified === true,
    origin: CHINA_ORIGIN,
    key: null,
    token: null,
    projectCount: normalized.projects.length,
    folderCount: normalized.folders.length,
    projects: normalized.projects.map((project) => ({ id: project.id, name: project.name })),
    folders: normalized.folders.map((folder) => ({
      id: folder.id,
      projectId: folder.projectId,
      name: folder.name,
      includesChildren: false,
      covers: 'direct-recordings-only',
    })),
    contentEnabled: normalized.folders.length > 0,
    scheduleEnabled: false,
    dailyTasksEnabled: false,
    needsAcceptance: true,
  };
}

function parseJson(text) {
  if (text && typeof text === 'object') return text;
  try {
    return JSON.parse(String(text || ''));
  } catch (error) {
    return null;
  }
}

function normalizeProjects(payload) {
  const body = parseJson(payload) || {};
  const data = body.data && typeof body.data === 'object' ? body.data : body;
  const chats = Array.isArray(data.chats) ? data.chats : Array.isArray(data) ? data : Array.isArray(body.chats) ? body.chats : [];
  const projects = [];
  chats.forEach((chat) => {
    const info = chat && chat.projectInfo && typeof chat.projectInfo === 'object' ? chat.projectInfo : {};
    const id = cleanId(info.id || chat.project_id || chat.projectId);
    const name = cleanName(info.name || chat.project_name || chat.name);
    if (!id || !name || projects.some((project) => project.id === id)) return;
    const fileNum = Number(info.fileNum);
    projects.push({ id, name, fileNum: Number.isInteger(fileNum) && fileNum >= 0 ? fileNum : null });
  });
  return projects;
}

function parseRemark(value) {
  if (value && typeof value === 'object') return value;
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function isDirectory(node) {
  return Boolean(node && (node.type === 'directory' || node.type === 'dir' || node.fileType === 'folder'));
}

function isRecording(node) {
  if (!node || isDirectory(node)) return false;
  if (node.isVoice === true) return true;
  const kind = String(node.fileType || node.originSuffix || '').toLowerCase();
  return RECORDING_TYPES.has(kind);
}

function walkTree(nodes, projectId, parentId, depth, visit) {
  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    if (!node || typeof node !== 'object') return;
    const foreign = cleanId(node.projectId || node.project_id);
    if (foreign && foreign !== projectId) return;
    const id = cleanId(node.id);
    if (!id) return;
    const item = {
      id,
      projectId,
      parentId,
      depth,
      name: cleanName(node.name || node.fileName || node.title) || id,
      directory: isDirectory(node),
      recording: isRecording(node),
      listRevision: [
        node.updateTime || '',
        parseRemark(node.subRemark).transcribeId || node.transcribeId || '',
        node.dataVersion || '',
      ].join('|'),
    };
    visit(item);
    walkTree(node.children, projectId, id, depth + 1, visit);
  });
}

function normalizeTree(payload, projectId) {
  const root = cleanId(projectId);
  const body = parseJson(payload) || {};
  const data = body.data && typeof body.data === 'object' ? body.data : body;
  const nodes = Array.isArray(data.fileTree) ? data.fileTree : Array.isArray(body.fileTree) ? body.fileTree : [];
  const items = [];
  walkTree(nodes, root, root, 1, (item) => items.push(item));
  return items;
}

function detailRevision(detail) {
  const body = detail && detail.data && typeof detail.data === 'object' ? detail.data : detail || {};
  return [body.updateTime || '', body.transcribeId || '', body.dataVersion || ''].join('|');
}

function transcriptText(detail) {
  const body = detail && detail.data && typeof detail.data === 'object' ? detail.data : detail || {};
  const raw = body.transcribeJson;
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string' && /^https?:\/\//i.test(raw.trim())) return '';
  if (typeof raw === 'string') {
    const parsed = parseJson(raw);
    if (parsed && typeof parsed === 'object') return transcriptText({ transcribeJson: parsed });
    return raw.trim();
  }
  if (typeof raw === 'object') {
    const parts = [];
    const list = Array.isArray(raw.segments) ? raw.segments : Array.isArray(raw.result) ? raw.result : [];
    list.forEach((segment) => {
      const text = cleanName(segment && (segment.text || segment.transcript || segment.content));
      if (text) parts.push(text);
    });
    if (parts.length) return parts.join('\n');
    return cleanName(raw.text || raw.transcript || raw.content);
  }
  return '';
}

function assertReadRequest(request, token) {
  let url;
  try {
    url = new URL(request && request.url);
  } catch (error) {
    return { ok: false, reason: 'bad_url' };
  }
  if (url.origin !== CHINA_ORIGIN || url.username || url.password) return { ok: false, reason: 'host_refused' };
  const method = String(request.method || 'GET').toUpperCase();
  const path = url.pathname;
  if (method === 'POST' && path === LOGIN_PATH) {
    if (url.search) return { ok: false, reason: 'login_query_refused' };
    return { ok: true, url, method, auth: false };
  }
  if (method !== 'GET') return { ok: false, reason: 'method_refused' };
  if (path === PROJECTS_PATH) {
    if (url.search) return { ok: false, reason: 'name_query_refused' };
    return { ok: true, url, method, auth: true };
  }
  if (path === TREE_PATH) {
    const rootId = cleanId(url.searchParams.get('rootId'));
    if (!rootId || url.searchParams.size !== 1 || url.search !== `?rootId=${encodeURIComponent(rootId)}`) {
      return { ok: false, reason: 'tree_query_refused' };
    }
    return { ok: true, url, method, auth: true, rootId };
  }
  if (path.startsWith(DETAIL_PREFIX)) {
    const recordId = cleanId(path.slice(DETAIL_PREFIX.length));
    if (!recordId || path !== `${DETAIL_PREFIX}${recordId}` || url.search) return { ok: false, reason: 'detail_refused' };
    return { ok: true, url, method, auth: true, recordId };
  }
  return { ok: false, reason: 'path_refused', tokenUsed: Boolean(token) };
}

function buildRequest(path, { method = 'GET', token = '', body = null, rootId = '' } = {}) {
  const url = new URL(path, CHINA_ORIGIN);
  if (rootId) url.searchParams.set('rootId', rootId);
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return {
    url: url.toString(),
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  };
}

async function sendRead(request, transport, token) {
  const checked = assertReadRequest(request, token);
  if (!checked.ok) return { ok: false, reason: checked.reason, network: false };
  if (typeof transport !== 'function') return { ok: false, reason: 'no_transport', network: false };
  const response = await transport(request);
  const status = Number(response && response.status);
  const location = response && response.headers ? response.headers.location || response.headers.Location || '' : '';
  if (status >= 300 && status < 400) {
    return { ok: false, reason: 'redirect_refused', network: true, location: redactSecrets(String(location || '')) };
  }
  if (!response || status < 200 || status >= 300) {
    return { ok: false, reason: 'http_failed', network: true, status: status || 0 };
  }
  return { ok: true, network: true, body: response.body };
}

function recordingAt(detail) {
  const body = detail && detail.data && typeof detail.data === 'object' ? detail.data : detail || {};
  if (typeof body.recordTime === 'number' && Number.isFinite(body.recordTime)) return new Date(body.recordTime).toISOString();
  if (typeof body.updateTime === 'string') return body.updateTime.slice(0, 40);
  return null;
}

function createTicnoteSession({
  encrypt,
  decrypt,
  load,
  save,
  transport,
  log = () => {},
} = {}) {
  let token = '';
  let catalog = [];
  let trees = new Map();
  const writeLog = (message) => {
    log(redactSecrets(message, [token]));
  };

  function readState() {
    const stored = typeof load === 'function' ? load() : null;
    const source = stored && typeof stored === 'object' ? stored : {};
    return {
      encryptedAppKey: typeof source.encryptedAppKey === 'string' ? source.encryptedAppKey : '',
      verified: source.verified === true,
      scope: normalizeScope(source.scope),
      watermark: source.watermark && typeof source.watermark === 'object' ? source.watermark : {},
    };
  }

  function writeState(next) {
    const safe = {
      version: 1,
      encryptedAppKey: next.encryptedAppKey || '',
      verified: next.verified === true,
      scope: normalizeScope(next.scope),
      watermark: {},
    };
    Object.keys(next.watermark || {}).slice(0, 500).forEach((key) => {
      const id = cleanId(key);
      const mark = next.watermark[key] && typeof next.watermark[key] === 'object' ? next.watermark[key] : {};
      const revision = String(mark.revision || '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 160);
      const listRevision = String(mark.listRevision || '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 160);
      if (id && revision) safe.watermark[id] = { revision, listRevision };
    });
    if (typeof save === 'function') save(safe);
    return safe;
  }

  function currentKey(state) {
    if (!state.encryptedAppKey || typeof decrypt !== 'function') return '';
    const key = decrypt(state.encryptedAppKey);
    const classified = classifyAppKey(key);
    return classified.ok ? classified.key : '';
  }

  function status() {
    const state = readState();
    return publicTicnoteStatus({
      configured: Boolean(currentKey(state)),
      verified: state.verified === true,
      scope: state.scope,
    });
  }

  function saveKey(appkey) {
    const classified = classifyAppKey(appkey);
    if (!classified.ok) {
      writeLog(`拒绝保存 TicNote 密钥：${classified.reason}`);
      return { ok: false, reason: classified.reason, status: status() };
    }
    if (typeof encrypt !== 'function') return { ok: false, reason: 'secure_storage_unavailable', status: status() };
    const encrypted = encrypt(classified.key);
    if (!encrypted) return { ok: false, reason: 'secure_storage_unavailable', status: status() };
    const state = readState();
    token = '';
    writeState({ ...state, encryptedAppKey: encrypted, verified: false });
    writeLog('已加密保存 TicNote 国内正式密钥');
    return { ok: true, status: status() };
  }

  function clearKey() {
    token = '';
    catalog = [];
    trees = new Map();
    writeState({ encryptedAppKey: '', verified: false, scope: emptyScope(), watermark: {} });
    writeLog('已清除 TicNote 密钥和授权范围');
    return { ok: true, status: status() };
  }

  async function verify() {
    const state = readState();
    const key = currentKey(state);
    if (!key) {
      writeLog('没有 TicNote 密钥，未访问网络');
      return { ok: false, reason: 'no_key', network: false, projects: [], status: status() };
    }
    const login = buildRequest(LOGIN_PATH, { method: 'POST', body: { appkey: key } });
    const logged = await sendRead(login, transport, '');
    if (!logged.ok) return { ok: false, reason: logged.reason, network: logged.network === true, projects: [], status: status() };
    const loginBody = parseJson(logged.body) || {};
    if (loginBody.code !== 0 || !loginBody.data || typeof loginBody.data.token !== 'string' || !loginBody.data.token) {
      token = '';
      writeLog('TicNote 登录未返回可用令牌');
      return { ok: false, reason: 'login_rejected', network: true, projects: [], status: status() };
    }
    token = loginBody.data.token;
    const listed = await sendRead(buildRequest(PROJECTS_PATH, { token }), transport, token);
    if (!listed.ok) {
      token = '';
      return { ok: false, reason: listed.reason, network: true, projects: [], status: status() };
    }
    catalog = normalizeProjects(listed.body);
    writeState({ ...state, verified: true });
    writeLog(`已读取 ${catalog.length} 个项目名称`);
    return { ok: true, network: true, projects: catalog.map((item) => ({ ...item })), status: status() };
  }

  function saveScope(input) {
    const state = readState();
    const requested = normalizeScope(input);
    if (!catalog.length && requested.projects.length) {
      return { ok: false, reason: 'catalog_required', status: status() };
    }
    const unknownProject = requested.projects.find((project) => !catalog.some((item) => item.id === project.id));
    if (unknownProject) return { ok: false, reason: 'project_not_in_catalog', status: status() };
    requested.projects.forEach((project) => {
      const known = catalog.find((item) => item.id === project.id);
      if (known) project.name = known.name;
    });
    const folders = [];
    for (const folder of requested.folders) {
      if (!trees.has(folder.projectId)) return { ok: false, reason: 'folder_not_in_tree', status: status() };
      const tree = trees.get(folder.projectId) || [];
      const root = folder.id === folder.projectId
        ? { id: folder.id, name: '项目根目录', parentId: null, directory: true, projectId: folder.projectId }
        : null;
      const known = tree.find((item) => item.id === folder.id && item.directory && item.projectId === folder.projectId) || root;
      if (!known) return { ok: false, reason: 'folder_not_in_tree', status: status() };
      folders.push({ ...folder, name: known.name, parentId: known.parentId, includesChildren: false });
    }
    writeState({ ...state, scope: { version: 1, projects: requested.projects, folders } });
    writeLog('已保存 TicNote 授权范围，每日任务仍关闭');
    return { ok: true, scheduleEnabled: false, status: status() };
  }

  async function listFolders(projectId) {
    const state = readState();
    const id = cleanId(projectId);
    if (!currentKey(state)) return { ok: false, reason: 'no_key', network: false, folders: [] };
    if (!projectAllowed(state.scope, id)) return { ok: false, reason: 'project_not_allowed', network: false, folders: [] };
    if (!token) return { ok: false, reason: 'not_verified', network: false, folders: [] };
    const listed = await sendRead(buildRequest(TREE_PATH, { token, rootId: id }), transport, token);
    if (!listed.ok) return { ok: false, reason: listed.reason, network: listed.network === true, folders: [] };
    const items = normalizeTree(listed.body, id);
    trees.set(id, items);
    return {
      ok: true,
      network: true,
      folders: [{
        id,
        projectId: id,
        parentId: null,
        name: '项目根目录',
        depth: 0,
        includesChildren: false,
        covers: 'direct-recordings-only',
      }].concat(items.filter((item) => item.directory).map((item) => ({
        id: item.id,
        projectId: item.projectId,
        parentId: item.parentId,
        name: item.name,
        depth: item.depth,
        includesChildren: false,
        covers: 'direct-recordings-only',
      }))),
    };
  }

  function directRecordings(projectId) {
    const state = readState();
    const tree = trees.get(projectId) || [];
    const allowedParents = new Set(state.scope.folders.filter((folder) => folder.projectId === projectId).map((folder) => folder.id));
    return tree.filter((item) => (
      item.recording
      && item.projectId === projectId
      && allowedParents.has(item.parentId)
    ));
  }

  async function pullTranscripts() {
    const state = readState();
    if (!currentKey(state)) return { ok: false, reason: 'no_key', network: false, records: [] };
    if (!state.scope.folders.length) return { ok: false, reason: 'scope_empty', network: false, records: [] };
    if (!token) return { ok: false, reason: 'not_verified', network: false, records: [] };
    const records = [];
    let network = false;
    const watermark = { ...state.watermark };
    for (const project of state.scope.projects) {
      if (!trees.has(project.id)) {
        const listed = await listFolders(project.id);
        if (!listed.ok) return { ok: false, reason: listed.reason, network: listed.network === true, records };
        network = network || listed.network === true;
      }
      for (const item of directRecordings(project.id)) {
        const previous = watermark[item.id];
        const marker = item.listRevision === '||' ? '' : item.listRevision;
        if (previous && previous.revision && (!marker || marker === previous.listRevision || marker === previous.revision)) {
          records.push({ recordId: item.id, skipped: true, reason: 'unchanged', missing: false });
          continue;
        }
        const detail = await sendRead(buildRequest(`${DETAIL_PREFIX}${item.id}`, { token }), transport, token);
        network = true;
        if (!detail.ok) {
          records.push({ recordId: item.id, missing: true, reason: detail.reason });
          continue;
        }
        const body = parseJson(detail.body) || {};
        const text = transcriptText(body);
        const revision = detailRevision(body.data || body) || item.listRevision;
        watermark[item.id] = { revision, listRevision: item.listRevision };
        records.push({
          recordId: item.id,
          projectId: item.projectId,
          folderId: item.parentId,
          revision,
          sourceRef: `ticnote:${item.projectId}/${item.parentId}/${item.id}`,
          recordingAt: recordingAt(body.data || body),
          missing: !text,
          reason: text ? '' : 'transcript_missing',
          text: text.slice(0, 20000),
        });
      }
    }
    writeState({ ...readState(), watermark });
    return { ok: true, network, records };
  }

  return {
    status,
    saveKey,
    clearKey,
    verify,
    saveScope,
    listFolders,
    pullTranscripts,
    rememberCatalog(projects) {
      catalog = normalizeProjects({ chats: projects });
    },
    rememberTree(projectId, nodes) {
      trees.set(cleanId(projectId), normalizeTree({ fileTree: nodes }, projectId));
    },
  };
}

function publicGrokStatus({ configured = false, enabled = false } = {}) {
  return {
    configured: configured === true,
    enabled: false,
    requestedEnabled: configured === true && enabled === true,
    model: GROK_MODEL,
    endpointHost: GROK_HOST,
    callsEnabled: false,
    reason: 'calls_disabled',
    billing: '按 xAI 账户的 token 单价计费，与当前聊天订阅不是同一把密钥。',
  };
}

function createGrokConfig({ encrypt, decrypt, load, save, log = () => {} } = {}) {
  function read() {
    const stored = typeof load === 'function' ? load() : null;
    const source = stored && typeof stored === 'object' ? stored : {};
    return {
      encryptedApiKey: typeof source.encryptedApiKey === 'string' ? source.encryptedApiKey : '',
      requestedEnabled: source.requestedEnabled === true,
    };
  }
  function key() {
    const state = read();
    if (!state.encryptedApiKey || typeof decrypt !== 'function') return '';
    const value = String(decrypt(state.encryptedApiKey) || '').trim();
    return value ? value : '';
  }
  function status() {
    const state = read();
    return publicGrokStatus({ configured: Boolean(key()), enabled: state.requestedEnabled });
  }
  function saveKey(apiKey) {
    const value = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!value || value.length < 8 || value.length > 300) return { ok: false, reason: 'malformed', status: status() };
    if (typeof encrypt !== 'function') return { ok: false, reason: 'secure_storage_unavailable', status: status() };
    const encrypted = encrypt(value);
    if (!encrypted) return { ok: false, reason: 'secure_storage_unavailable', status: status() };
    if (typeof save === 'function') save({ version: 1, encryptedApiKey: encrypted, requestedEnabled: false });
    log('已加密保存 Grok API 密钥，请求仍关闭');
    return { ok: true, status: status() };
  }
  function setRequestedEnabled(enabled) {
    const state = read();
    if (!key()) return { ok: false, reason: 'no_key', status: status() };
    if (typeof save === 'function') save({ version: 1, encryptedApiKey: state.encryptedApiKey, requestedEnabled: enabled === true });
    return { ok: true, status: status() };
  }
  function clearKey() {
    if (typeof save === 'function') save({ version: 1, encryptedApiKey: '', requestedEnabled: false });
    return { ok: true, status: status() };
  }
  function execute() {
    return { ok: false, network: false, reason: 'calls_disabled', model: GROK_MODEL };
  }
  return { status, saveKey, setRequestedEnabled, clearKey, execute };
}

function planUnattendedPrep({ schedule = {}, ticnote = {}, grok = {} } = {}) {
  const gates = {
    scheduleAccepted: schedule.acceptedLocally === true,
    scheduleEnabled: schedule.enabled === true && schedule.acceptedLocally === true,
    ticnoteKey: ticnote.configured === true,
    ticnoteFolders: Number(ticnote.folderCount) > 0,
    grokKey: grok.configured === true,
    grokCalls: false,
  };
  let blockedReason = 'calls_disabled';
  if (!gates.ticnoteKey) blockedReason = 'ticnote_key_missing';
  else if (!gates.ticnoteFolders) blockedReason = 'ticnote_scope_empty';
  else if (!gates.grokKey) blockedReason = 'grok_key_missing';
  else if (!gates.scheduleAccepted) blockedReason = 'not_accepted';
  else if (!gates.scheduleEnabled) blockedReason = 'schedule_disabled';
  return {
    willGenerateTodos: false,
    willCallGrok: false,
    willUpload: false,
    gates,
    blockedReason,
  };
}

module.exports = {
  CHINA_ORIGIN,
  CHINA_HOST,
  GROK_MODEL,
  emptyScope,
  classifyAppKey,
  redactSecrets,
  normalizeScope,
  projectAllowed,
  folderAllowed,
  publicTicnoteStatus,
  normalizeProjects,
  normalizeTree,
  transcriptText,
  assertReadRequest,
  buildRequest,
  createTicnoteSession,
  createGrokConfig,
  planUnattendedPrep,
};
