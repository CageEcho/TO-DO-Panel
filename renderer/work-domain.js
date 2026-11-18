// 工作待办的纯函数。浏览器与 Node 测试共用。
// 不读取文件、不联网、不生成缺少依据的任务。
(function exposeWorkDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchWorkDomain = api;
})(typeof window !== 'undefined' ? window : globalThis, function createWorkDomain() {
  const WORK_IMPORT_SCHEMA = 'grok-work/v1';
  const WORK_STORAGE_KEY = 'notch-work-tasks-v1';
  const WORK_VIEW_KEY = 'notch-todo-view-v1';
  const WORK_TIMEZONE = 'Asia/Shanghai';
  const WORK_TEXT_LIMIT = 200;
  const WORK_EXCERPT_LIMIT = 500;
  const WORK_SOURCE_LIMIT = 240;
  const WORK_MAX_TASKS = 100;
  const WORK_MAX_STORED = 2000;
  const WORK_BATCH_LIMIT = 50;
  const WORK_LOCKS = ['text', 'group', 'deadline', 'done', 'dismissed', 'responsibility'];
  const WORK_GENERATORS = new Set(['fixture', 'grok-assistant', 'manual-file']);
  const WORK_DEFAULT_GROUPS = [
    { id: 'today', name: '每日工作', system: true },
    { id: 'weekly', name: '每周工作', system: true },
    { id: 'media', name: '自媒体&写作', system: true },
    { id: 'vibe', name: 'Vibe coding', system: true },
    { id: 'desk', name: '工作', system: true },
    { id: 'confirm', name: '待确认', system: true },
    { id: 'blocked', name: '阻塞跟进', system: true },
  ];
  const WORK_LEGACY_NAMES = { today: '今日工作' };
  const WORK_BOARD = [
    { slot: 'cadence', panes: ['today', 'weekly'] },
    { slot: 'media', panes: ['media'], dot: 'p1' },
    { slot: 'vibe', panes: ['vibe'], dot: 'p2' },
    { slot: 'desk', panes: ['desk'], dot: 'p3' },
  ];

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function cleanLine(value, limit) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function cleanExcerpt(value, limit) {
    if (typeof value !== 'string') return '';
    return value
      .replace(/\u0000/g, '')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
      .slice(0, limit);
  }

  function cleanSourceId(value) {
    if (typeof value !== 'string') return '';
    const id = value.trim();
    if (!/^[A-Za-z0-9._:@#/-]{1,160}$/.test(id)) return '';
    if (id.startsWith('/') || id.includes('..') || id.includes('\\') || id.includes('//')) return '';
    return id;
  }

  function cleanSourceRef(value) {
    const ref = cleanLine(value, WORK_SOURCE_LIMIT);
    if (!ref) return '';
    if (/^javascript:/i.test(ref) || /^data:/i.test(ref)) return '';
    return ref;
  }

  function cleanRecordingAt(value) {
    if (value == null || value === '') return { recordingAt: null };
    if (typeof value !== 'string') return { error: 'recordingAt 必须是时间点字符串或留空' };
    const text = value.trim();
    if (!/^(?:\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2}))$/.test(text)) {
      return { error: 'recordingAt 无法识别，已忽略' };
    }
    return { recordingAt: text.slice(0, 40) };
  }

  function isWorkImportPayload(payload) {
    return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && payload.schema === WORK_IMPORT_SCHEMA);
  }

  function routeTodoInboxPayload(payload) {
    return isWorkImportPayload(payload) ? 'work' : 'classic';
  }

  function createEmptyWorkState() {
    return {
      version: 1,
      groups: WORK_DEFAULT_GROUPS.map((group) => ({ ...group })),
      tasks: [],
      watermark: { cursors: {}, batches: [] },
      sources: { enabled: false, folders: [] },
      schedule: {
        timezone: WORK_TIMEZONE,
        weekdaysOnly: true,
        readyBy: '09:00',
        leadMinutes: 60,
        prepareAt: '08:00',
        time: '08:00',
        enabled: false,
        acceptedLocally: false,
        lastSubmittedDate: null,
        pendingDate: null,
      },
    };
  }

  function normalizeGroups(groups) {
    const source = Array.isArray(groups) ? groups : [];
    const system = WORK_DEFAULT_GROUPS.map((item) => {
      const found = source.find((group) => group && group.id === item.id);
      const foundName = cleanLine(found && found.name, 24);
      const name = !foundName || foundName === WORK_LEGACY_NAMES[item.id] ? item.name : foundName;
      return { id: item.id, name, system: true };
    });
    const custom = [];
    source.forEach((group) => {
      if (!group || typeof group.id !== 'string' || system.some((item) => item.id === group.id)) return;
      if (!/^g[a-z0-9]{2,20}$/.test(group.id) || custom.some((item) => item.id === group.id)) return;
      const name = cleanLine(group.name, 24);
      if (!name || custom.length >= 5) return;
      custom.push({ id: group.id, name, system: false });
    });
    return [...system, ...custom];
  }

  function normalizeTime(value) {
    if (typeof value !== 'string') return null;
    const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value);
    return match ? `${match[1]}:${match[2]}` : null;
  }

  function normalizeDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    return value;
  }

  function normalizeFolder(value) {
    if (typeof value !== 'string') return '';
    const folder = value.replace(/\u0000/g, '').trim();
    if (!folder || folder.length > 1024) return '';
    if (folder.includes('..')) return '';
    if (/^[A-Za-z]:[\\/]/.test(folder) || folder.startsWith('/')) return folder;
    return '';
  }

  function normalizeSources(sources) {
    const raw = sources && typeof sources === 'object' && !Array.isArray(sources) ? sources : {};
    const folders = [];
    (Array.isArray(raw.folders) ? raw.folders : []).forEach((folder) => {
      const clean = normalizeFolder(folder);
      if (clean && !folders.includes(clean) && folders.length < 4) folders.push(clean);
    });
    return { enabled: raw.enabled === true && folders.length > 0, folders };
  }

  function clockMinus(time, leadMinutes) {
    const [hour, minute] = time.split(':').map(Number);
    const total = (hour * 60 + minute - leadMinutes + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function normalizeSchedule(schedule) {
    const raw = schedule && typeof schedule === 'object' && !Array.isArray(schedule) ? schedule : {};
    const readyBy = normalizeTime(raw.readyBy) || normalizeTime(raw.time) || '09:00';
    const requestedLead = Number.isInteger(raw.leadMinutes) && raw.leadMinutes >= 0 && raw.leadMinutes <= 720
      ? raw.leadMinutes
      : 60;
    const readyMinutes = Number(readyBy.slice(0, 2)) * 60 + Number(readyBy.slice(3));
    const leadMinutes = Math.min(requestedLead, readyMinutes);
    const prepareAt = clockMinus(readyBy, leadMinutes);
    const acceptedLocally = raw.acceptedLocally === true;
    return {
      timezone: WORK_TIMEZONE,
      weekdaysOnly: raw.weekdaysOnly !== false,
      readyBy,
      leadMinutes,
      prepareAt,
      time: prepareAt,
      acceptedLocally,
      enabled: raw.enabled === true && acceptedLocally,
      lastSubmittedDate: normalizeDateKey(raw.lastSubmittedDate),
      pendingDate: normalizeDateKey(raw.pendingDate),
    };
  }

  function normalizeTask(task, groups) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return null;
    const sourceId = cleanSourceId(task.sourceId || task.id);
    const text = cleanLine(task.text, WORK_TEXT_LIMIT);
    if (!sourceId || !text) return null;
    const groupId = groups.some((group) => group.id === task.groupId) ? task.groupId : 'confirm';
    const evidence = task.evidence && typeof task.evidence === 'object' ? task.evidence : {};
    const locks = Array.isArray(task.locks)
      ? [...new Set(task.locks.filter((lock) => WORK_LOCKS.includes(lock)))]
      : [];
    const deadline = typeof task.deadline === 'string' && Number.isFinite(Date.parse(task.deadline))
      ? new Date(task.deadline).toISOString()
      : null;
    return {
      id: sourceId,
      sourceId,
      origin: task.origin === 'manual' ? 'manual' : 'import',
      text,
      groupId,
      responsibility: task.responsibility === 'mine' || task.responsibility === 'other' ? task.responsibility : 'uncertain',
      deadline,
      evidence: {
        excerpt: cleanExcerpt(evidence.excerpt || '', WORK_EXCERPT_LIMIT),
        sourceRef: cleanSourceRef(evidence.sourceRef || ''),
        recordingAt: cleanRecordingAt(evidence.recordingAt).recordingAt || null,
      },
      done: task.done === true,
      completedAt: Number.isFinite(task.completedAt) ? task.completedAt : null,
      createdAt: Number.isFinite(task.createdAt) ? task.createdAt : 0,
      updatedAt: Number.isFinite(task.updatedAt) ? task.updatedAt : 0,
      revision: Number.isInteger(task.revision) && task.revision > 0 ? task.revision : 1,
      locks,
      revoked: task.revoked === true,
      dismissed: task.dismissed === true,
      revokeRequested: task.revokeRequested === true,
    };
  }

  function normalizeWorkState(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const groups = normalizeGroups(source.groups);
    const tasks = [];
    const seen = new Set();
    (Array.isArray(source.tasks) ? source.tasks : []).forEach((task) => {
      const normalized = normalizeTask(task, groups);
      if (!normalized || seen.has(normalized.id) || tasks.length >= WORK_MAX_STORED) return;
      seen.add(normalized.id);
      tasks.push(normalized);
    });
    const watermark = source.watermark && typeof source.watermark === 'object' ? source.watermark : {};
    const cursors = {};
    if (watermark.cursors && typeof watermark.cursors === 'object' && !Array.isArray(watermark.cursors)) {
      Object.keys(watermark.cursors).slice(0, 20).forEach((key) => {
        const cleanKey = cleanLine(key, 40);
        const cursor = cleanLine(watermark.cursors[key], 200);
        if (cleanKey && cursor && !cleanKey.includes('__proto__')) cursors[cleanKey] = cursor;
      });
    }
    const batches = (Array.isArray(watermark.batches) ? watermark.batches : [])
      .filter((batch) => batch && typeof batch.fileHash === 'string' && /^[a-f0-9]{64}$/.test(batch.fileHash))
      .slice(-WORK_BATCH_LIMIT)
      .map((batch) => ({
        fileHash: batch.fileHash,
        batchId: cleanLine(batch.batchId || '', 128),
        appliedAt: Number.isFinite(batch.appliedAt) ? batch.appliedAt : 0,
      }));
    return {
      version: 1,
      groups,
      tasks,
      watermark: { cursors, batches },
      sources: normalizeSources(source.sources),
      schedule: normalizeSchedule(source.schedule),
    };
  }

  function parseWorkDeadline(value) {
    if (value == null || value === '') return { deadline: null };
    if (typeof value === 'number') return { error: 'deadline 请使用带时区的 ISO 8601，未知则留空' };
    if (typeof value !== 'string') return { error: 'deadline 必须是带时区的 ISO 8601 或留空' };
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/i.exec(value.trim());
    if (!match) return { error: 'deadline 必须带时区（例如 2026-11-18T18:00:00+08:00），未知请留空' };
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText || 0);
    const millis = Number(String(fraction || '0').padEnd(3, '0').slice(0, 3));
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
      return { error: `deadline 日期不存在：${yearText}-${monthText}-${dayText}` };
    }
    if (hour > 23 || minute > 59 || second > 59) return { error: 'deadline 时间不存在' };
    let offsetMinutes = 0;
    if (zone.toUpperCase() !== 'Z') {
      const digits = zone.slice(1).replace(':', '');
      const offsetHours = Number(digits.slice(0, 2));
      const offsetRest = Number(digits.slice(2) || 0);
      if (offsetHours > 14 || offsetRest > 59) return { error: `deadline 时区偏移无效：${zone}` };
      offsetMinutes = (offsetHours * 60 + offsetRest) * (zone[0] === '-' ? -1 : 1);
    }
    const ms = Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMinutes * 60 * 1000;
    if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1) || ms > Date.UTC(9999, 11, 31, 23, 59, 59, 999)) {
      return { error: 'deadline 超出可用范围' };
    }
    return { deadline: new Date(ms).toISOString() };
  }

  function shanghaiParts(now) {
    const date = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: WORK_TIMEZONE,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const read = (type) => parts.find((part) => part.type === type)?.value || '';
    let hour = Number(read('hour'));
    if (hour === 24) hour = 0;
    const weekday = read('weekday');
    const dateKey = `${read('year')}-${read('month')}-${read('day')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isInteger(hour) || hour > 23) return null;
    return { weekday, dateKey, hour, minute: Number(read('minute')) };
  }

  function evaluateWorkSchedule(schedule, now = Date.now()) {
    const normalized = normalizeSchedule(schedule);
    const parts = shanghaiParts(now) || { weekday: '', dateKey: '', hour: 0, minute: 0 };
    const result = {
      timezone: WORK_TIMEZONE,
      due: false,
      reason: 'schedule_disabled',
      dateKey: parts.dateKey,
      weekday: parts.weekday,
      readyBy: normalized.readyBy,
      leadMinutes: normalized.leadMinutes,
      prepareAt: normalized.prepareAt,
      time: normalized.prepareAt,
      acceptedLocally: normalized.acceptedLocally,
    };
    if (!normalized.acceptedLocally) return { ...result, reason: 'not_accepted' };
    if (normalized.enabled !== true) return result;
    const weekend = parts.weekday === 'Sat' || parts.weekday === 'Sun';
    if (normalized.weekdaysOnly && weekend) return { ...result, reason: 'weekend' };
    const [hour, minute] = normalized.time.split(':').map(Number);
    if (parts.hour * 60 + parts.minute < hour * 60 + minute) return { ...result, reason: 'before_time' };
    if (normalized.lastSubmittedDate === parts.dateKey) return { ...result, reason: 'already_submitted' };
    return { ...result, due: true, reason: 'due' };
  }

  function noteScheduleCatchup(state, now = Date.now()) {
    const current = normalizeWorkState(state);
    const decision = evaluateWorkSchedule(current.schedule, now);
    if (!decision.due || current.schedule.pendingDate === decision.dateKey) {
      return { state: current, decision, changed: false };
    }
    const next = cloneState(current);
    next.schedule.pendingDate = decision.dateKey;
    return { state: next, decision, changed: true };
  }

  function publicWorkSchedule(schedule) {
    const normalized = normalizeSchedule(schedule);
    return {
      version: 1,
      timezone: normalized.timezone,
      weekdaysOnly: normalized.weekdaysOnly,
      readyBy: normalized.readyBy,
      leadMinutes: normalized.leadMinutes,
      prepareAt: normalized.prepareAt,
      time: normalized.prepareAt,
      acceptedLocally: normalized.acceptedLocally,
      enabled: normalized.enabled,
    };
  }

  function routeResponsibility(entry, groups) {
    const responsibility = entry && entry.responsibility;
    if (responsibility == null || responsibility === '') return { responsibility: 'uncertain', groupId: 'confirm', routed: 'missing' };
    if (responsibility === 'other') return { skip: '非本人责任，未列入待办' };
    if (responsibility === 'uncertain') return { responsibility: 'uncertain', groupId: 'confirm', routed: 'uncertain' };
    if (responsibility !== 'mine') return { skip: 'responsibility 只能是 mine、uncertain 或 other' };
    const requested = typeof entry.group === 'string' ? cleanLine(entry.group, 32) : '';
    if (!requested || requested === 'today') return { responsibility: 'mine', groupId: 'today' };
    const byId = groups.find((group) => group.id === requested);
    if (byId) return { responsibility: 'mine', groupId: byId.id, routed: byId.id === 'confirm' ? 'explicit-confirm' : '' };
    const byName = groups.filter((group) => group.name === requested);
    if (byName.length === 1) return { responsibility: 'mine', groupId: byName[0].id };
    const todayName = (groups.find((group) => group.id === 'today') || {}).name || '每日工作';
    return { responsibility: 'mine', groupId: 'today', warning: `未知分组「${requested}」，已放入${todayName}` };
  }

  function readEvidence(entry) {
    const evidence = entry && entry.evidence;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
      return { error: '缺少依据，未造任务' };
    }
    const excerpt = cleanExcerpt(evidence.excerpt, 10000);
    const sourceRef = cleanLine(evidence.sourceRef, 10000);
    if (!excerpt) return { error: '缺少依据摘录，未造任务' };
    if (excerpt.length > WORK_EXCERPT_LIMIT) return { error: `依据摘录超过 ${WORK_EXCERPT_LIMIT} 个字符` };
    if (!sourceRef || /^javascript:/i.test(sourceRef) || /^data:/i.test(sourceRef)) return { error: '缺少来源引用，未造任务' };
    if (sourceRef.length > WORK_SOURCE_LIMIT) return { error: `来源引用超过 ${WORK_SOURCE_LIMIT} 个字符` };
    const recording = cleanRecordingAt(evidence.recordingAt);
    return {
      evidence: { excerpt, sourceRef: cleanSourceRef(sourceRef), recordingAt: recording.recordingAt || null },
      warning: recording.error || '',
    };
  }

  function taskSnapshot(task) {
    return JSON.stringify({
      text: task.text,
      groupId: task.groupId,
      responsibility: task.responsibility,
      deadline: task.deadline,
      evidence: task.evidence,
      revision: task.revision,
      revoked: task.revoked === true,
      dismissed: task.dismissed === true,
    });
  }

  function applyScheduleMark(state, payload, warnings) {
    const workDate = payload.workDate == null || payload.workDate === ''
      ? null
      : normalizeDateKey(payload.workDate);
    if (payload.workDate != null && payload.workDate !== '' && !workDate) {
      warnings.push({ index: null, message: 'workDate 不是有效日期，未标记这一天已提交' });
      return;
    }
    let dateKey = workDate;
    if (!dateKey && typeof payload.generatedAt === 'string') {
      const parts = shanghaiParts(payload.generatedAt);
      dateKey = parts && parts.dateKey;
      if (!dateKey) warnings.push({ index: null, message: 'generatedAt 无法换算到 Asia/Shanghai，未标记提交日' });
    }
    if (!dateKey) return;
    state.schedule.lastSubmittedDate = dateKey;
    if (state.schedule.pendingDate === dateKey) state.schedule.pendingDate = null;
  }

  function rememberCursor(state, payload) {
    if (typeof payload.sourceCursor !== 'string') return;
    const cursor = cleanLine(payload.sourceCursor, 200);
    if (!cursor) return;
    const key = cleanLine(payload.sourceKey || 'default', 40) || 'default';
    if (key.includes('__proto__') || key.includes('constructor')) return;
    state.watermark.cursors[key] = cursor;
  }

  function mergeWorkImport(state, payload, options = {}) {
    const base = normalizeWorkState(state);
    const blank = {
      state: base,
      changed: false,
      imported: [],
      skipped: [],
      warnings: [],
    };
    if (!isWorkImportPayload(payload)) {
      return { ...blank, error: '工作导入的 schema 必须是 grok-work/v1' };
    }
    if (payload.generator != null && !WORK_GENERATORS.has(payload.generator)) {
      return { ...blank, error: 'generator 只能是 fixture、grok-assistant 或 manual-file，不会把其他模型当成 Grok' };
    }
    if (!Array.isArray(payload.tasks)) {
      return { ...blank, error: 'tasks 必须是数组；没有材料时请传空数组，不要省略' };
    }
    const fileHash = typeof options.fileHash === 'string' && /^[a-f0-9]{64}$/.test(options.fileHash) ? options.fileHash : '';
    if (fileHash && base.watermark.batches.some((batch) => batch.fileHash === fileHash)) {
      return {
        ...blank,
        skipped: [{ index: 0, reason: '相同文件已处理，未重复导入' }],
      };
    }
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const next = cloneState(base);
    const result = { state: next, changed: false, imported: [], skipped: [], warnings: [] };
    if (payload.owner != null || payload.assignee != null) {
      result.warnings.push({ index: null, message: '已忽略文件中的负责人字段，不会写入负责人' });
    }
    const entries = payload.tasks;
    entries.slice(0, WORK_MAX_TASKS).forEach((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        result.skipped.push({ index, reason: '条目必须是对象' });
        return;
      }
      if (entry.owner != null || entry.assignee != null) {
        result.warnings.push({ index, message: '已忽略负责人字段，不会写入负责人' });
      }
      if (Object.prototype.hasOwnProperty.call(entry, 'done')) {
        result.warnings.push({ index, message: '导入不能修改完成状态' });
      }
      const sourceId = cleanSourceId(entry.sourceId);
      if (!sourceId) {
        result.skipped.push({ index, reason: '缺少稳定 sourceId，未造任务' });
        return;
      }
      const action = entry.action == null || entry.action === '' ? 'upsert' : entry.action;
      if (action !== 'upsert' && action !== 'revoke') {
        result.skipped.push({ index, id: sourceId, reason: 'action 只能是 upsert 或 revoke' });
        return;
      }
      const revision = entry.revision == null ? 1 : entry.revision;
      if (!Number.isInteger(revision) || revision < 1 || revision > 1000000000) {
        result.skipped.push({ index, id: sourceId, reason: 'revision 必须是 1 到 1000000000 的整数' });
        return;
      }
      const existing = next.tasks.find((task) => task.sourceId === sourceId);
      if (existing && existing.origin === 'manual') {
        result.skipped.push({ index, id: sourceId, reason: '手工任务保持原样，同步不能覆盖或撤回' });
        return;
      }
      if (existing && revision < existing.revision) {
        result.skipped.push({ index, id: sourceId, reason: '旧版本，未覆盖' });
        return;
      }
      if (existing && existing.dismissed && existing.locks.includes('dismissed')) {
        result.skipped.push({ index, id: sourceId, reason: '已从列表移除，未重新加入' });
        return;
      }
      if (action === 'revoke') {
        if (!existing) {
          result.skipped.push({ index, id: sourceId, reason: '没有可撤回的任务' });
          return;
        }
        const protectedTask = existing.done === true || existing.locks.some((lock) => lock !== 'responsibility');
        if (protectedTask) {
          if (existing.revokeRequested === true) {
            result.skipped.push({ index, id: sourceId, reason: '已记录撤回请求，完成状态和手工修改保持不变' });
            return;
          }
          existing.revokeRequested = true;
          existing.updatedAt = now;
          result.changed = true;
          result.warnings.push({ index, id: sourceId, message: '已手工修改或已完成，未撤回' });
          result.imported.push({ index, id: sourceId, op: 'revoke-kept', groupId: existing.groupId, text: existing.text, deadline: existing.deadline });
          return;
        }
        if (existing.revoked === true) {
          result.skipped.push({ index, id: sourceId, reason: '已经撤回' });
          return;
        }
        existing.revoked = true;
        existing.updatedAt = now;
        existing.revision = revision;
        result.changed = true;
        result.imported.push({ index, id: sourceId, op: 'revoke', groupId: existing.groupId, text: existing.text, deadline: existing.deadline });
        return;
      }
      const text = cleanLine(entry.text, WORK_TEXT_LIMIT);
      if (!text) {
        result.skipped.push({ index, id: sourceId, reason: typeof entry.text === 'string' ? '缺少 text' : 'text 必须是字符串' });
        return;
      }
      if (typeof entry.text === 'string' && cleanLine(entry.text, 10000).length > WORK_TEXT_LIMIT) {
        result.skipped.push({ index, id: sourceId, reason: `text 超过 ${WORK_TEXT_LIMIT} 个字符` });
        return;
      }
      const evidence = readEvidence(entry);
      if (evidence.error) {
        result.skipped.push({ index, id: sourceId, reason: evidence.error });
        return;
      }
      const routed = routeResponsibility(entry, next.groups);
      if (routed.skip) {
        result.skipped.push({ index, id: sourceId, reason: routed.skip });
        return;
      }
      const deadline = parseWorkDeadline(entry.deadline);
      if (deadline.error) {
        result.skipped.push({ index, id: sourceId, reason: deadline.error });
        return;
      }
      if (evidence.warning) result.warnings.push({ index, id: sourceId, message: evidence.warning });
      if (routed.warning) result.warnings.push({ index, id: sourceId, message: routed.warning });
      if (routed.routed === 'uncertain' || routed.routed === 'missing') {
        result.warnings.push({ index, id: sourceId, message: '责任未明确，已放入待确认' });
      }
      const incoming = {
        id: sourceId,
        sourceId,
        origin: 'import',
        text,
        groupId: routed.groupId,
        responsibility: routed.responsibility,
        deadline: deadline.deadline,
        evidence: evidence.evidence,
        done: existing ? existing.done === true : false,
        completedAt: existing ? existing.completedAt : null,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        revision,
        locks: existing ? existing.locks.slice() : [],
        revoked: false,
        dismissed: false,
        revokeRequested: existing ? existing.revokeRequested === true : false,
      };
      if (!existing) {
        if (next.tasks.length >= WORK_MAX_STORED) {
          result.skipped.push({ index, id: sourceId, reason: `工作待办已达 ${WORK_MAX_STORED} 条上限` });
          return;
        }
        next.tasks.push(incoming);
        result.changed = true;
        result.imported.push({ index, id: sourceId, op: 'create', groupId: incoming.groupId, text: incoming.text, deadline: incoming.deadline });
        return;
      }
      const locks = new Set(existing.locks);
      const updated = { ...existing, evidence: { ...existing.evidence }, locks: existing.locks.slice() };
      if (!locks.has('text')) updated.text = incoming.text;
      else if (existing.text !== incoming.text) result.warnings.push({ index, id: sourceId, message: '标题已手工修改，保持原标题' });
      if (!locks.has('group')) updated.groupId = incoming.groupId;
      else if (existing.groupId !== incoming.groupId) result.warnings.push({ index, id: sourceId, message: '分组已手工修改，保持原分组' });
      if (!locks.has('deadline')) updated.deadline = incoming.deadline;
      else if (existing.deadline !== incoming.deadline) result.warnings.push({ index, id: sourceId, message: '截止日期已手工修改，保持原值' });
      if (!locks.has('responsibility')) updated.responsibility = incoming.responsibility;
      updated.evidence = incoming.evidence;
      updated.revision = revision;
      updated.revoked = false;
      updated.updatedAt = existing.updatedAt;
      if (taskSnapshot(updated) === taskSnapshot(existing)) {
        result.skipped.push({ index, id: sourceId, reason: '内容未变化' });
        return;
      }
      updated.updatedAt = now;
      const position = next.tasks.findIndex((task) => task.sourceId === sourceId);
      next.tasks[position] = updated;
      result.changed = true;
      result.imported.push({ index, id: sourceId, op: 'update', groupId: updated.groupId, text: updated.text, deadline: updated.deadline });
    });
    if (entries.length > WORK_MAX_TASKS) {
      result.skipped.push({
        index: WORK_MAX_TASKS,
        reason: `单个文件最多处理 ${WORK_MAX_TASKS} 条，第 ${WORK_MAX_TASKS + 1}–${entries.length} 条未处理`,
      });
    }
    applyScheduleMark(next, payload, result.warnings);
    rememberCursor(next, payload);
    if (fileHash) {
      next.watermark.batches = next.watermark.batches
        .filter((batch) => batch.fileHash !== fileHash)
        .concat([{ fileHash, batchId: cleanLine(payload.batchId || '', 128), appliedAt: now }])
        .slice(-WORK_BATCH_LIMIT);
      result.changed = true;
    } else if (JSON.stringify(next.schedule) !== JSON.stringify(base.schedule) || JSON.stringify(next.watermark.cursors) !== JSON.stringify(base.watermark.cursors)) {
      result.changed = true;
    }
    return result;
  }

  function commitWorkImport({ state, payload, now, fileHash, backup, persist } = {}) {
    const preview = mergeWorkImport(state, payload, { now, fileHash });
    const previous = normalizeWorkState(state);
    if (preview.error) return { ...preview, state: previous, retry: false, committed: false };
    if (!preview.changed) return { ...preview, retry: false, committed: true };
    if (typeof backup === 'function' && backup(previous) !== true) {
      return {
        state: previous,
        changed: false,
        retry: true,
        error: 'backup_failed',
        imported: [],
        skipped: [],
        warnings: [],
      };
    }
    if (typeof persist === 'function' && persist(preview.state) !== true) {
      return {
        state: previous,
        changed: false,
        retry: true,
        error: 'persist_failed',
        imported: [],
        skipped: [],
        warnings: [],
      };
    }
    return { ...preview, retry: false, committed: true };
  }

  function editWorkTask(state, taskId, patch, now = Date.now()) {
    const current = normalizeWorkState(state);
    const next = cloneState(current);
    const task = next.tasks.find((item) => item.id === taskId && !item.revoked && !item.dismissed);
    if (!task || !patch || typeof patch !== 'object') return { ok: false, error: 'missing', state: current };
    const locks = new Set(task.locks);
    if (Object.prototype.hasOwnProperty.call(patch, 'text')) {
      const text = cleanLine(patch.text, WORK_TEXT_LIMIT);
      if (!text) return { ok: false, error: 'empty_text', state: current };
      task.text = text;
      locks.add('text');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'groupId')) {
      if (!next.groups.some((group) => group.id === patch.groupId)) return { ok: false, error: 'group', state: current };
      task.groupId = patch.groupId;
      locks.add('group');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'deadline')) {
      if (patch.deadline == null || patch.deadline === '') task.deadline = null;
      else {
        const parsed = parseWorkDeadline(patch.deadline);
        if (parsed.error) return { ok: false, error: parsed.error, state: current };
        task.deadline = parsed.deadline;
      }
      locks.add('deadline');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'done')) {
      task.done = patch.done === true;
      task.completedAt = task.done ? (Number.isFinite(task.completedAt) ? task.completedAt : now) : null;
      locks.add('done');
    }
    task.locks = [...locks];
    task.updatedAt = now;
    return { ok: true, state: next, task };
  }

  function dismissWorkTask(state, taskId, now = Date.now()) {
    const current = normalizeWorkState(state);
    const next = cloneState(current);
    const index = next.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) return { ok: false, error: 'missing', state: current };
    const task = next.tasks[index];
    if (task.origin === 'manual') {
      next.tasks.splice(index, 1);
      return { ok: true, state: next };
    }
    task.dismissed = true;
    task.locks = [...new Set([...task.locks, 'text', 'group', 'deadline', 'done', 'dismissed'])];
    task.updatedAt = now;
    return { ok: true, state: next };
  }

  function addWorkGroup(state, name) {
    const current = normalizeWorkState(state);
    const label = cleanLine(name, 24);
    if (!label) return { ok: false, error: 'empty', state: current };
    if (current.groups.filter((group) => !group.system).length >= 5) return { ok: false, error: 'limit', state: current };
    let serial = current.groups.length + 1;
    let id = `g${serial.toString(36)}${label.length.toString(36)}`.replace(/[^a-z0-9]/g, '').slice(0, 12);
    if (!/^g[a-z0-9]{2,20}$/.test(id)) id = `g${serial}x`;
    while (current.groups.some((group) => group.id === id)) {
      serial += 1;
      id = `g${serial.toString(36)}${label.length.toString(36)}`.slice(0, 12);
    }
    const next = cloneState(current);
    next.groups.push({ id, name: label, system: false });
    return { ok: true, state: next, group: next.groups[next.groups.length - 1] };
  }

  function renameWorkGroup(state, groupId, name) {
    const current = normalizeWorkState(state);
    const label = cleanLine(name, 24);
    if (!label) return { ok: false, error: 'empty', state: current };
    const next = cloneState(current);
    const group = next.groups.find((item) => item.id === groupId);
    if (!group) return { ok: false, error: 'missing', state: current };
    group.name = label;
    return { ok: true, state: next };
  }

  function removeWorkGroup(state, groupId) {
    const current = normalizeWorkState(state);
    const group = current.groups.find((item) => item.id === groupId);
    if (!group) return { ok: false, error: 'missing', state: current };
    if (group.system) return { ok: false, error: 'system_group', state: current };
    if (current.tasks.some((task) => task.groupId === groupId && !task.revoked && !task.dismissed)) {
      return { ok: false, error: 'group_not_empty', state: current };
    }
    const next = cloneState(current);
    next.groups = next.groups.filter((item) => item.id !== groupId);
    return { ok: true, state: next };
  }

  function createManualWorkTask(state, patch, now = Date.now()) {
    const current = normalizeWorkState(state);
    const text = cleanLine(patch && patch.text, WORK_TEXT_LIMIT);
    if (!text) return { ok: false, error: 'empty_text', state: current };
    const groupId = current.groups.some((group) => group.id === patch.groupId) ? patch.groupId : 'today';
    let deadline = null;
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'deadline') && patch.deadline != null && patch.deadline !== '') {
      const parsed = parseWorkDeadline(patch.deadline);
      if (parsed.error) return { ok: false, error: parsed.error, state: current };
      deadline = parsed.deadline;
    }
    const sourceId = cleanSourceId(`manual:${now.toString(36)}${current.tasks.length.toString(36)}`);
    const next = cloneState(current);
    next.tasks.push({
      id: sourceId,
      sourceId,
      origin: 'manual',
      text,
      groupId,
      responsibility: 'mine',
      deadline,
      evidence: { excerpt: '', sourceRef: '', recordingAt: null },
      done: false,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      locks: ['text', 'group', 'deadline', 'done'],
      revoked: false,
      dismissed: false,
      revokeRequested: false,
    });
    return { ok: true, state: next };
  }

  function resolveTodoSubview(event) {
    if (event === 'classic') return 'classic';
    return 'work';
  }

  function workTaskSourceLabel(task) {
    return task && task.origin === 'manual' ? '手动' : '导入';
  }

  function activeWorkTasks(state) {
    return normalizeWorkState(state).tasks.filter((task) => !task.revoked && !task.dismissed);
  }

  function workBoardLayout(state) {
    const groups = normalizeWorkState(state).groups;
    const byId = Object.fromEntries(groups.map((group) => [group.id, group]));
    return {
      slots: WORK_BOARD.map((slot) => ({
        slot: slot.slot,
        dot: slot.dot || '',
        panes: slot.panes.map((id) => byId[id]).filter(Boolean),
      })),
      review: ['confirm', 'blocked'].map((id) => byId[id]).filter(Boolean),
      custom: groups.filter((group) => !group.system),
    };
  }

  function shanghaiDayNumber(parts) {
    if (!parts || !/^\d{4}-\d{2}-\d{2}$/.test(parts.dateKey)) return null;
    const [year, month, day] = parts.dateKey.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86400000;
  }

  function workDeadlinePresentation(task, now = Date.now()) {
    const current = Number(now);
    if (!task || task.deadline == null || task.deadline === '' || !Number.isFinite(current)) {
      return { known: false, deadline: null, label: '', tone: '', days: null };
    }
    const deadline = Date.parse(task.deadline);
    if (!Number.isFinite(deadline)) return { known: false, deadline: null, label: '', tone: '', days: null };
    const start = shanghaiDayNumber(shanghaiParts(current));
    const end = shanghaiDayNumber(shanghaiParts(deadline));
    if (start == null || end == null) return { known: false, deadline: null, label: '', tone: '', days: null };
    const days = end - start;
    if (current >= deadline) return { known: true, deadline: new Date(deadline).toISOString(), label: '逾期', tone: 'red', days: 0, overdue: true };
    if (days <= 0) return { known: true, deadline: new Date(deadline).toISOString(), label: '今天', tone: 'red', days: 0, overdue: false };
    if (days === 1) return { known: true, deadline: new Date(deadline).toISOString(), label: '1天', tone: 'red', days, overdue: false };
    if (days <= 7) return { known: true, deadline: new Date(deadline).toISOString(), label: `${days}天`, tone: 'orange', days, overdue: false };
    return { known: true, deadline: new Date(deadline).toISOString(), label: `${days}天`, tone: 'yellow', days, overdue: false };
  }

  function assessGrokAdapter({ env = {}, argv = [] } = {}) {
    const args = Array.isArray(argv) ? argv.map((item) => String(item)) : [];
    if (args.includes('--chat') || args.includes('--from-chat')) {
      return { ok: false, reason: 'chat_is_not_api' };
    }
    if (args.some((arg) => /^--?(api[-_]?key|token|secret|password)\b/i.test(arg))) {
      return { ok: false, reason: 'secret_on_argv' };
    }
    const base = typeof env.GROK_API_BASE === 'string' ? env.GROK_API_BASE : '';
    const key = typeof env.GROK_API_KEY === 'string' ? env.GROK_API_KEY : '';
    if (!base || !key) return { ok: false, reason: 'not_configured' };
    let host = '';
    try {
      host = new URL(base).host;
    } catch (error) {
      return { ok: false, reason: 'bad_base_url' };
    }
    if (host !== 'api.x.ai') return { ok: false, reason: 'refusing_non_grok_host' };
    return {
      ok: false,
      reason: 'adapter_does_not_send',
      detail: '本版本不代发模型请求。请把整理结果写成 grok-work/v1 JSON，再用本地收件箱导入。',
    };
  }

  return {
    WORK_IMPORT_SCHEMA,
    WORK_STORAGE_KEY,
    WORK_VIEW_KEY,
    WORK_TIMEZONE,
    WORK_DEFAULT_GROUPS,
    isWorkImportPayload,
    routeTodoInboxPayload,
    createEmptyWorkState,
    normalizeWorkState,
    parseWorkDeadline,
    shanghaiParts,
    evaluateWorkSchedule,
    noteScheduleCatchup,
    publicWorkSchedule,
    mergeWorkImport,
    commitWorkImport,
    editWorkTask,
    dismissWorkTask,
    addWorkGroup,
    renameWorkGroup,
    removeWorkGroup,
    createManualWorkTask,
    resolveTodoSubview,
    workTaskSourceLabel,
    activeWorkTasks,
    workBoardLayout,
    workDeadlinePresentation,
    assessGrokAdapter,
  };
});
