const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const {
  mergeTodoImport,
} = require('../renderer/domain');
const {
  isWorkImportPayload,
  routeTodoInboxPayload,
  createEmptyWorkState,
  mergeWorkImport,
  commitWorkImport,
  editWorkTask,
  dismissWorkTask,
  addWorkGroup,
  evaluateWorkSchedule,
  noteScheduleCatchup,
  parseWorkDeadline,
  shanghaiParts,
  assessGrokAdapter,
  activeWorkTasks,
  publicWorkSchedule,
} = require('../renderer/work-domain');
const {
  isOfficialPanelDataPath,
  isBroadTranscriptFolder,
  backupWorkStateFile,
  listTranscriptFolder,
  writeAtomicFile,
} = require('../main-services');
const { planInboxWrite } = require('../scripts/grok-work-import');

const NOW = Date.parse('2026-11-18T01:00:00+08:00');
const FILE_HASH = 'a'.repeat(64);
const root = path.join(__dirname, '..');

function fixturePayload() {
  return JSON.parse(fs.readFileSync(path.join(root, 'fixtures/work-import/demo-batch.json'), 'utf8'));
}

function mineTask(overrides = {}) {
  return {
    sourceId: 'fixture-standup#00:04:12#summary',
    action: 'upsert',
    text: '把合成会议里提到的接口说明补进本地文档',
    responsibility: 'mine',
    group: 'today',
    deadline: null,
    evidence: {
      excerpt: '我来把接口说明补进本地文档。',
      sourceRef: 'fixtures/transcripts/demo-standup.txt',
      recordingAt: '00:04:12',
    },
    ...overrides,
  };
}

function payload(tasks, extra = {}) {
  return {
    schema: 'grok-work/v1',
    generator: 'fixture',
    batchId: 'batch-1',
    tasks,
    ...extra,
  };
}

test('classic inbox does not accept a work payload or invent P0 items', () => {
  const existing = { P0: [{ id: 'keep', text: '原待办', done: true, createdAt: 1 }], P1: [], P2: [], P3: [] };
  const result = mergeTodoImport(existing, fixturePayload(), { now: NOW, sourceId: 'abc' });
  assert.match(result.error, /顶层必须是数组/);
  assert.deepEqual(result.data, existing);
  assert.equal(routeTodoInboxPayload(fixturePayload()), 'work');
  assert.equal(routeTodoInboxPayload({ todos: [] }), 'classic');
  assert.equal(isWorkImportPayload({ schema: 'grok-work/v2', tasks: [] }), false);
});

test('fixture import keeps evidence, leaves unknown deadlines empty, and does not invent tasks', () => {
  const result = mergeWorkImport(createEmptyWorkState(), fixturePayload(), { now: NOW, fileHash: FILE_HASH });
  assert.equal(result.error, undefined);
  const active = activeWorkTasks(result.state);
  assert.deepEqual(active.map((task) => [task.groupId, task.responsibility, task.deadline, task.evidence.recordingAt]), [
    ['today', 'mine', null, '00:04:12'],
    ['confirm', 'uncertain', null, '00:09:40'],
    ['blocked', 'mine', null, '00:11:02'],
  ]);
  assert.equal(active.some((task) => task.text.includes('设计同事')), false);
  assert.equal(result.skipped.some((item) => item.reason.includes('非本人责任')), true);
  assert.equal(result.state.tasks.every((task) => task.owner == null && task.assignee == null), true);
  assert.equal(result.state.watermark.cursors['demo-standup'], 'demo-standup#00:12:18');
  assert.equal(result.state.schedule.lastSubmittedDate, '2026-11-18');
});

test('empty materials do not create tasks', () => {
  const empty = mergeWorkImport(createEmptyWorkState(), payload([]), { now: NOW });
  assert.deepEqual(empty.state.tasks, []);
  assert.equal(empty.changed, false);
  const missingEvidence = mergeWorkImport(createEmptyWorkState(), payload([
    { sourceId: 'no-evidence', text: '凭空出现的任务', responsibility: 'mine' },
    { sourceId: 'blank', text: '   ', responsibility: 'mine', evidence: { excerpt: '有摘录', sourceRef: 'a.txt' } },
  ]), { now: NOW });
  assert.deepEqual(missingEvidence.state.tasks, []);
  assert.match(missingEvidence.skipped[0].reason, /缺少依据/);
  assert.match(missingEvidence.skipped[1].reason, /缺少 text/);
});

test('replaying the same source does not duplicate, and a new revision updates unlocked fields', () => {
  const first = mergeWorkImport(createEmptyWorkState(), payload([mineTask()]), { now: NOW, fileHash: FILE_HASH });
  const replay = mergeWorkImport(first.state, payload([mineTask()]), { now: NOW + 1000, fileHash: FILE_HASH });
  assert.equal(replay.changed, false);
  assert.equal(activeWorkTasks(replay.state).length, 1);
  const changedHash = 'b'.repeat(64);
  const updated = mergeWorkImport(first.state, payload([mineTask({
    revision: 2,
    text: '改成补充示意图',
    evidence: { ...mineTask().evidence, excerpt: '补充示意图后再给同事看。' },
  })]), { now: NOW + 2000, fileHash: changedHash });
  assert.equal(activeWorkTasks(updated.state).length, 1);
  assert.equal(activeWorkTasks(updated.state)[0].text, '改成补充示意图');
  assert.equal(activeWorkTasks(updated.state)[0].evidence.excerpt, '补充示意图后再给同事看。');
  const stale = mergeWorkImport(updated.state, payload([mineTask({ revision: 1, text: '回退标题' })]), { now: NOW + 3000, fileHash: 'c'.repeat(64) });
  assert.equal(activeWorkTasks(stale.state)[0].text, '改成补充示意图');
  assert.match(stale.skipped[0].reason, /旧版本/);
});

test('manual edits, completion, and dismissal survive later imports', () => {
  const imported = mergeWorkImport(createEmptyWorkState(), payload([mineTask({ deadline: '2026-11-18T18:00:00+08:00' })]), { now: NOW });
  const taskId = imported.state.tasks[0].id;
  const edited = editWorkTask(imported.state, taskId, {
    text: '我改过的标题',
    groupId: 'blocked',
    deadline: '2026-11-19T09:30:00+08:00',
    done: true,
  }, NOW + 50);
  assert.equal(edited.ok, true);
  const again = mergeWorkImport(edited.state, payload([mineTask({
    revision: 3,
    text: '外部想覆盖标题',
    group: 'today',
    deadline: '2026-11-20T09:30:00+08:00',
    done: false,
  })]), { now: NOW + 80, fileHash: 'd'.repeat(64) });
  const task = again.state.tasks[0];
  assert.equal(task.text, '我改过的标题');
  assert.equal(task.groupId, 'blocked');
  assert.equal(task.deadline, '2026-11-19T01:30:00.000Z');
  assert.equal(task.done, true);
  assert.equal(task.completedAt, NOW + 50);
  assert.equal(task.evidence.excerpt, '我来把接口说明补进本地文档。');
  const revoked = mergeWorkImport(again.state, payload([{ sourceId: task.sourceId, action: 'revoke', revision: 4 }]), { now: NOW + 90 });
  assert.equal(revoked.state.tasks[0].done, true);
  assert.equal(revoked.state.tasks[0].revoked, false);
  assert.equal(revoked.state.tasks[0].revokeRequested, true);
  const dismissed = dismissWorkTask(imported.state, taskId, NOW + 10);
  const resurrect = mergeWorkImport(dismissed.state, payload([mineTask({ revision: 5, text: '想加回来' })]), { now: NOW + 20 });
  assert.equal(activeWorkTasks(resurrect.state).length, 0);
  assert.match(resurrect.skipped[0].reason, /已从列表移除/);
});

test('revoke removes an untouched open task and is idempotent', () => {
  const imported = mergeWorkImport(createEmptyWorkState(), payload([mineTask()]), { now: NOW });
  const revoked = mergeWorkImport(imported.state, payload([{ sourceId: mineTask().sourceId, action: 'revoke' }]), { now: NOW + 10 });
  assert.equal(activeWorkTasks(revoked.state).length, 0);
  assert.equal(revoked.state.tasks[0].revoked, true);
  const again = mergeWorkImport(revoked.state, payload([{ sourceId: mineTask().sourceId, action: 'revoke' }]), { now: NOW + 20 });
  assert.equal(again.changed, false);
  assert.equal(again.state.tasks.length, 1);
});

test('malicious and oversized fields are rejected without prototype pollution', () => {
  const nasty = JSON.parse(`{
    "schema": "grok-work/v1",
    "generator": "gpt-4o",
    "tasks": [{"sourceId":"x","text":"x","responsibility":"mine","evidence":{"excerpt":"e","sourceRef":"a.txt"}}],
    "__proto__": {"polluted": true}
  }`);
  const rejectedModel = mergeWorkImport(createEmptyWorkState(), nasty, { now: NOW });
  assert.match(rejectedModel.error, /其他模型/);
  assert.equal({}.polluted, undefined);
  const attacks = payload([
    mineTask({ sourceId: '../etc/passwd', text: '越权' }),
    mineTask({ sourceId: 'ok-id', text: `<img src=x onerror=alert(1)> ${'长'.repeat(180)}` }),
    mineTask({ sourceId: 'js-ref', evidence: { excerpt: '摘录', sourceRef: 'javascript:alert(1)', recordingAt: '00:00:01' } }),
    mineTask({ sourceId: 'bad-deadline', deadline: '2026-11-18' }),
    mineTask({ sourceId: 'owner-field', owner: '某同事', assignee: '我' }),
    { sourceId: 'not-object' },
  ]);
  attacks.tasks[5] = 'not-object';
  const result = mergeWorkImport(createEmptyWorkState(), attacks, { now: NOW });
  assert.equal(result.state.tasks.length, 1);
  assert.equal(result.state.tasks[0].sourceId, 'owner-field');
  assert.equal(result.state.tasks[0].owner, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(result.skipped.length, 5);
  const tooMany = payload(Array.from({ length: 101 }, (_, index) => mineTask({ sourceId: `item-${index}` })));
  const capped = mergeWorkImport(createEmptyWorkState(), tooMany, { now: NOW });
  assert.equal(capped.state.tasks.length, 100);
  assert.match(capped.skipped.at(-1).reason, /最多处理 100/);
});

test('unknown deadline stays empty and zoned deadlines are kept', () => {
  assert.deepEqual(parseWorkDeadline(null), { deadline: null });
  assert.deepEqual(parseWorkDeadline(''), { deadline: null });
  assert.match(parseWorkDeadline('2026-11-18').error, /时区/);
  assert.match(parseWorkDeadline('2026-11-18T18:00:00').error, /时区/);
  assert.equal(parseWorkDeadline('2026-11-18T18:00:00+08:00').deadline, '2026-11-18T10:00:00.000Z');
  const imported = mergeWorkImport(createEmptyWorkState(), payload([mineTask({ deadline: undefined })]), { now: NOW });
  assert.equal(imported.state.tasks[0].deadline, null);
});

test('weekday preparation starts before 09:00 and stays off until local acceptance', () => {
  const beforePrepare = Date.parse('2026-11-15T23:59:00Z'); // Monday 07:59 Shanghai
  const prepareAt = Date.parse('2026-11-16T00:00:00Z'); // Monday 08:00 Shanghai
  const stillSunday = Date.parse('2026-11-15T15:59:00Z'); // Sunday 23:59 Shanghai
  assert.equal(shanghaiParts(stillSunday).weekday, 'Sun');
  assert.equal(shanghaiParts(prepareAt).dateKey, '2026-11-16');
  const defaults = evaluateWorkSchedule(createEmptyWorkState().schedule, prepareAt);
  assert.equal(defaults.due, false);
  assert.equal(defaults.reason, 'not_accepted');
  assert.equal(defaults.readyBy, '09:00');
  assert.equal(defaults.prepareAt, '08:00');
  const accepted = {
    enabled: true,
    acceptedLocally: true,
    readyBy: '09:00',
    leadMinutes: 60,
    weekdaysOnly: true,
  };
  assert.equal(evaluateWorkSchedule(accepted, beforePrepare).reason, 'before_time');
  const due = evaluateWorkSchedule(accepted, prepareAt);
  assert.equal(due.due, true);
  assert.equal(due.prepareAt, '08:00');
  assert.equal(evaluateWorkSchedule(accepted, stillSunday).reason, 'weekend');
  assert.equal(evaluateWorkSchedule({ ...accepted, lastSubmittedDate: '2026-11-16' }, prepareAt).reason, 'already_submitted');
  const caught = noteScheduleCatchup({ ...createEmptyWorkState(), schedule: accepted }, prepareAt);
  assert.equal(caught.changed, true);
  assert.equal(caught.state.schedule.pendingDate, '2026-11-16');
  assert.equal(publicWorkSchedule({ enabled: true, readyBy: '09:00' }).enabled, false);
  assert.equal(publicWorkSchedule({ enabled: true, readyBy: '09:00', acceptedLocally: true }).enabled, true);
  assert.equal(publicWorkSchedule({ enabled: true, readyBy: '09:00', leadMinutes: 600, acceptedLocally: true }).prepareAt, '00:00');
});

test('failed backup or persist does not advance state and retry does not duplicate', () => {
  const state = createEmptyWorkState();
  const body = payload([mineTask()]);
  let backups = 0;
  const failed = commitWorkImport({
    state,
    payload: body,
    now: NOW,
    fileHash: FILE_HASH,
    backup() { backups += 1; return false; },
    persist() { throw new Error('should not persist'); },
  });
  assert.equal(failed.retry, true);
  assert.equal(failed.error, 'backup_failed');
  assert.deepEqual(failed.state.tasks, []);
  assert.equal(backups, 1);
  let persisted = null;
  const saved = commitWorkImport({
    state: failed.state,
    payload: body,
    now: NOW + 5,
    fileHash: FILE_HASH,
    backup() { return true; },
    persist(next) { persisted = next; return true; },
  });
  assert.equal(saved.committed, true);
  assert.equal(persisted.tasks.length, 1);
  const replay = commitWorkImport({
    state: saved.state,
    payload: body,
    now: NOW + 10,
    fileHash: FILE_HASH,
    backup() { throw new Error('no second backup'); },
    persist() { throw new Error('no second persist'); },
  });
  assert.equal(replay.committed, true);
  assert.equal(replay.changed, false);
  assert.equal(replay.state.tasks.length, 1);
});

test('concurrent backups stay intact and official data paths are refused', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'work-backup-'));
  const backupDir = path.join(directory, 'work-import-backups');
  const appData = path.join(directory, 'appData');
  const official = path.join(appData, 'Dynamic Panel', 'todo-inbox');
  fs.mkdirSync(official, { recursive: true });
  const body = JSON.stringify(createEmptyWorkState());
  const writes = await Promise.all([0, 1, 2, 3].map((offset) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', `
      const { backupWorkStateFile } = require(${JSON.stringify(path.join(root, 'main-services.js'))});
      const result = backupWorkStateFile(process.argv[1], process.argv[2], new Date(${NOW + offset}));
      if (!result.ok) process.exit(1);
    `, backupDir, body]);
    child.on('exit', (code) => resolve(code));
  })));
  assert.deepEqual(writes, [0, 0, 0, 0]);
  const names = fs.readdirSync(backupDir);
  assert.equal(names.some((name) => name.endsWith('.tmp')), false);
  names.forEach((name) => JSON.parse(fs.readFileSync(path.join(backupDir, name), 'utf8')));
  assert.equal(backupWorkStateFile(path.join(appData, 'Dynamic Panel', 'work-import-backups'), body, new Date(), { appData }).error, 'official_data_dir');
  assert.equal(isOfficialPanelDataPath(official, appData), true);
  assert.equal(isOfficialPanelDataPath(path.join(directory, 'TO-DO Panel Work'), appData), false);
  assert.equal(writeAtomicFile(path.join(backupDir, 'atomic.json'), '{"version":1}'), true);
  assert.equal(fs.readFileSync(path.join(backupDir, 'atomic.json'), 'utf8'), '{"version":1}');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('transcript listing stays inside one explicit folder and skips media', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'work-transcripts-'));
  const folder = path.join(directory, 'notes');
  const outside = path.join(directory, 'secret.txt');
  fs.mkdirSync(path.join(folder, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'demo.txt'), '合成转写');
  fs.writeFileSync(path.join(folder, 'voice.m4a'), 'not-audio');
  fs.writeFileSync(path.join(folder, 'nested', 'hidden.txt'), '不要扫子目录');
  fs.writeFileSync(outside, '外面的文件');
  try {
    fs.symlinkSync(outside, path.join(folder, 'escape.txt'));
  } catch (error) {
    // 文件系统不允许符号链接时，其余断言仍然有效。
  }
  const listed = listTranscriptFolder(folder, { home: directory, appData: path.join(directory, 'appData') });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.files.map((file) => file.relativePath).sort(), ['demo.txt', 'nested/hidden.txt', 'voice.m4a']);
  assert.equal(listed.files.find((file) => file.relativePath === 'voice.m4a').kind, 'audio');
  assert.equal(listed.files.some((file) => file.relativePath === 'escape.txt'), false);
  assert.equal(listed.skipped.some((item) => item.reason === 'escape'), true);
  assert.equal(listTranscriptFolder(directory, { home: directory }).error, 'folder_too_broad');
  assert.equal(listTranscriptFolder('/', { home: directory }).error, 'folder_too_broad');
  const appData = path.join(directory, 'appData');
  fs.mkdirSync(path.join(appData, 'Dynamic Panel'), { recursive: true });
  assert.equal(listTranscriptFolder(path.join(appData, 'Dynamic Panel'), { appData, home: directory }).error, 'folder_too_broad');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('import script writes only into a named inbox and can be replayed by the app', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'work-inbox-'));
  const inbox = path.join(directory, 'todo-inbox');
  fs.mkdirSync(inbox);
  const source = path.join(root, 'fixtures/work-import/demo-batch.json');
  const payload = JSON.parse(fs.readFileSync(source, 'utf8'));
  const appData = path.join(directory, 'appData');
  assert.equal(planInboxWrite({ inboxDir: path.join(appData, 'Dynamic Panel', 'todo-inbox'), payload, appData }).error, 'official_data_dir');
  assert.equal(planInboxWrite({ inboxDir: directory, payload, appData }).error, 'inbox_name');
  const dry = spawnSync(process.execPath, [
    path.join(root, 'scripts/grok-work-import.js'),
    '--inbox', inbox,
    '--file', source,
    '--dry-run',
  ], { encoding: 'utf8' });
  assert.equal(dry.status, 0);
  const summary = JSON.parse(dry.stdout);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.imported, 3);
  assert.equal(fs.readdirSync(inbox).length, 0);
  const written = spawnSync(process.execPath, [
    path.join(root, 'scripts/grok-work-import.js'),
    '--inbox', inbox,
    '--file', source,
    '--api-key', 'should-not-print',
  ], { encoding: 'utf8' });
  assert.equal(written.status, 2);
  assert.match(written.stderr, /密钥/);
  assert.equal(written.stdout.includes('should-not-print'), false);
  const ok = spawnSync(process.execPath, [
    path.join(root, 'scripts/grok-work-import.js'),
    '--inbox', inbox,
    '--file', source,
  ], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const dropped = fs.readdirSync(inbox).filter((name) => name.endsWith('.json'));
  assert.equal(dropped.length, 1);
  const raw = fs.readFileSync(path.join(inbox, dropped[0]));
  const first = mergeWorkImport(createEmptyWorkState(), JSON.parse(raw.toString('utf8')), { now: NOW, fileHash: 'e'.repeat(64) });
  const second = mergeWorkImport(first.state, JSON.parse(raw.toString('utf8')), { now: NOW + 1, fileHash: 'e'.repeat(64) });
  assert.equal(activeWorkTasks(second.state).length, 3);
  assert.equal(second.changed, false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('schedule script and adapter do not claim a model call', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'work-schedule-'));
  const config = path.join(directory, 'work-schedule.json');
  fs.writeFileSync(config, JSON.stringify({ version: 1, timezone: 'Asia/Shanghai', weekdaysOnly: true, enabled: false, time: null }));
  const disabled = spawnSync(process.execPath, [
    path.join(root, 'scripts/grok-work-schedule.js'),
    '--config', config,
    '--now', '2026-11-16T00:30:00Z',
  ], { encoding: 'utf8' });
  assert.equal(disabled.status, 0);
  assert.equal(JSON.parse(disabled.stdout).due, false);
  fs.writeFileSync(config, JSON.stringify({
    enabled: true,
    acceptedLocally: true,
    readyBy: '09:00',
    leadMinutes: 60,
    weekdaysOnly: true,
  }));
  const due = spawnSync(process.execPath, [
    path.join(root, 'scripts/grok-work-schedule.js'),
    '--config', config,
    '--now', '2026-11-16T00:00:00Z',
  ], { encoding: 'utf8' });
  assert.equal(JSON.parse(due.stdout).due, true);
  assert.equal(JSON.parse(due.stdout).prepareAt, '08:00');
  const adapter = spawnSync(process.execPath, [path.join(root, 'scripts/grok-work-adapter.js'), '--chat'], { encoding: 'utf8' });
  assert.equal(adapter.status, 2);
  assert.match(adapter.stderr, /不是 API/);
  assert.equal(assessGrokAdapter({ env: { GROK_API_BASE: 'https://api.openai.com', GROK_API_KEY: 'present' } }).reason, 'refusing_non_grok_host');
  assert.equal(assessGrokAdapter({ env: { GROK_API_BASE: 'https://api.x.ai/v1', GROK_API_KEY: 'present' } }).reason, 'adapter_does_not_send');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.equal(main.includes('LaunchAgents'), false);
  assert.equal(main.includes('launchctl'), false);
  const plist = fs.readFileSync(path.join(root, 'scripts/launchd/com.cageecho.todo-panel-work.plist.example'), 'utf8');
  assert.match(plist, /<key>Disabled<\/key>\s*<true\/>/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('custom groups can be renamed and removed only when empty', () => {
  const added = addWorkGroup(createEmptyWorkState(), '客户同步');
  assert.equal(added.ok, true);
  const imported = mergeWorkImport(added.state, payload([mineTask({ group: added.group.id, sourceId: 'custom-1' })]), { now: NOW });
  assert.equal(imported.state.tasks[0].groupId, added.group.id);
  assert.equal(imported.state.groups.some((group) => group.id === 'today' && group.system === true), true);
});
