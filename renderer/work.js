// 工作视图。只操作 notch-work-tasks-v1，不改 notch-todo-data。
(function startWorkView() {
  const domain = window.NotchWorkDomain;
  if (!domain) return;
  const KEY = domain.WORK_STORAGE_KEY;
  const deadlineFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: domain.WORK_TIMEZONE,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  let state = loadState();

  function loadState() {
    try {
      return domain.normalizeWorkState(JSON.parse(localStorage.getItem(KEY) || 'null'));
    } catch (error) {
      return domain.createEmptyWorkState();
    }
  }

  function saveState(next) {
    const normalized = domain.normalizeWorkState(next);
    const text = JSON.stringify(normalized);
    try {
      localStorage.setItem(KEY, text);
    } catch (error) {
      return false;
    }
    if (localStorage.getItem(KEY) !== text) return false;
    state = normalized;
    return true;
  }

  function groupName(groupId) {
    return state.groups.find((group) => group.id === groupId)?.name || groupId;
  }

  function reportOf(result) {
    return {
      error: result.error || '',
      changed: result.changed === true,
      retry: result.retry === true,
      imported: (result.imported || []).map((item) => ({
        index: item.index,
        id: item.id,
        category: 'WORK',
        categoryName: groupName(item.groupId),
        text: item.text,
        deadline: item.deadline || '',
      })),
      skipped: result.skipped || [],
      warnings: result.warnings || [],
    };
  }

  function setNote(message) {
    const note = document.getElementById('work-settings-note');
    if (note && message) note.textContent = message;
  }

  function render() {
    const columns = document.getElementById('work-columns');
    const status = document.getElementById('work-status');
    if (!columns) return;
    columns.replaceChildren();
    const active = domain.activeWorkTasks(state);
    if (status) {
      const pending = state.schedule.pendingDate
        ? `${state.schedule.pendingDate} 的整理结果还没提交。应用关闭、关机或睡眠时不会生成待办。`
        : '把 grok-work/v1 JSON 放进本应用的 todo-inbox。没有依据的事项不会出现在这里。';
      status.textContent = active.length
        ? `工作待办 ${active.length} 条。${pending}`
        : pending;
    }
    state.groups.forEach((group) => {
      const column = document.createElement('section');
      column.className = 'work-column tile';
      column.dataset.group = group.id;
      const header = document.createElement('div');
      header.className = 'work-column-head';
      const name = document.createElement('input');
      name.className = 'work-group-name';
      name.value = group.name;
      name.maxLength = 24;
      name.setAttribute('aria-label', `修改${group.name}名称`);
      name.addEventListener('change', () => {
        const renamed = domain.renameWorkGroup(state, group.id, name.value);
        if (!renamed.ok || !saveState(renamed.state)) name.value = group.name;
        else render();
      });
      const count = document.createElement('span');
      count.className = 'count';
      const tasks = active.filter((task) => task.groupId === group.id);
      count.textContent = String(tasks.length);
      header.append(name, count);
      if (!group.system) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'work-group-remove';
        remove.textContent = '移除';
        remove.addEventListener('click', () => {
          const removed = domain.removeWorkGroup(state, group.id);
          if (!removed.ok) {
            setNote(removed.error === 'group_not_empty' ? '分组里还有待办，不能移除。' : '这个分组不能移除。');
            return;
          }
          if (saveState(removed.state)) render();
        });
        header.append(remove);
      }
      const list = document.createElement('div');
      list.className = 'work-task-list';
      tasks.forEach((task) => list.append(renderTask(task)));
      const add = document.createElement('input');
      add.className = 'work-add';
      add.type = 'text';
      add.maxLength = 200;
      add.placeholder = '添加一条，回车保存';
      add.setAttribute('aria-label', `在${group.name}添加待办`);
      add.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
        const created = domain.createManualWorkTask(state, { text: add.value, groupId: group.id }, Date.now());
        if (!created.ok || !saveState(created.state)) return;
        render();
      });
      column.append(header, list, add);
      columns.append(column);
    });
    syncSettingsForm();
  }

  function renderTask(task) {
    const card = document.createElement('article');
    card.className = 'work-task';
    card.dataset.sourceId = task.sourceId;
    if (task.groupId === 'today') card.dataset.emphasis = 'today';
    const row = document.createElement('div');
    row.className = 'work-task-row';
    const checkbox = document.createElement('button');
    checkbox.type = 'button';
    checkbox.className = 'checkbox';
    checkbox.setAttribute('aria-pressed', task.done ? 'true' : 'false');
    checkbox.setAttribute('aria-label', task.done ? `恢复未完成：${task.text}` : `标记完成：${task.text}`);
    checkbox.addEventListener('click', () => {
      const edited = domain.editWorkTask(state, task.id, { done: !task.done }, Date.now());
      if (edited.ok && saveState(edited.state)) render();
    });
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'work-task-title';
    title.textContent = task.text;
    if (task.done) title.classList.add('done');
    title.addEventListener('click', () => beginEdit(card, task, title));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `移除：${task.text}`);
    remove.addEventListener('click', () => {
      const dismissed = domain.dismissWorkTask(state, task.id, Date.now());
      if (dismissed.ok && saveState(dismissed.state)) render();
    });
    row.append(checkbox, title, remove);
    const meta = document.createElement('p');
    meta.className = 'work-meta';
    const when = task.evidence.recordingAt ? `录音 ${task.evidence.recordingAt}` : '无录音时间点';
    const due = task.deadline ? deadlineFormat.format(new Date(task.deadline)) : '未设置截止日期';
    const ref = task.evidence.sourceRef || (task.origin === 'manual' ? '手工添加' : '无来源');
    meta.textContent = `${ref} · ${when} · ${due}`;
    card.append(row, meta);
    if (task.evidence.excerpt) {
      const quote = document.createElement('blockquote');
      quote.className = 'work-evidence';
      quote.textContent = task.evidence.excerpt;
      card.append(quote);
    }
    if (task.revokeRequested) {
      const flag = document.createElement('p');
      flag.className = 'work-flag';
      flag.textContent = '外部请求撤回，但这条已手工修改或完成，所以仍保留。';
      card.append(flag);
    }
    return card;
  }

  function beginEdit(card, task, title) {
    const input = document.createElement('input');
    input.className = 'work-task-title';
    input.value = task.text;
    input.maxLength = 200;
    input.setAttribute('aria-label', '修改工作待办');
    title.replaceWith(input);
    input.focus();
    let closed = false;
    const finish = (commit) => {
      if (closed) return;
      closed = true;
      if (!commit) {
        render();
        return;
      }
      const edited = domain.editWorkTask(state, task.id, { text: input.value }, Date.now());
      if (!edited.ok || !saveState(edited.state)) {
        render();
        return;
      }
      render();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) finish(true);
      if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  function syncSettingsForm() {
    const enabled = document.getElementById('work-source-enabled');
    const path = document.getElementById('work-source-path');
    const time = document.getElementById('work-schedule-time');
    const weekdays = document.getElementById('work-schedule-weekdays');
    const scheduleEnabled = document.getElementById('work-schedule-enabled');
    if (enabled) enabled.checked = state.sources.enabled === true;
    if (path) path.textContent = state.sources.folders[0] || '未选择';
    if (time && document.activeElement !== time) time.value = state.schedule.time || '';
    if (weekdays) weekdays.checked = state.schedule.weekdaysOnly !== false;
    if (scheduleEnabled) {
      scheduleEnabled.checked = state.schedule.enabled === true;
      scheduleEnabled.disabled = !state.schedule.time;
    }
  }

  async function publishSchedule() {
    if (!window.notchAPI?.publishWorkSchedule) return;
    await window.notchAPI.publishWorkSchedule(domain.publicWorkSchedule(state.schedule)).catch(() => {});
  }

  function rememberSchedule(next) {
    const normalized = domain.normalizeWorkState(next);
    if (!saveState(normalized)) return false;
    publishSchedule();
    render();
    refreshCatchup();
    return true;
  }

  async function refreshTranscripts() {
    const count = document.getElementById('work-source-count');
    const folder = state.sources.folders[0];
    if (!state.sources.enabled || !folder || !window.notchAPI?.listTranscripts) {
      if (count) count.textContent = state.sources.enabled ? '尚未读取' : '采集关闭';
      return;
    }
    const listed = await window.notchAPI.listTranscripts(folder).catch(() => ({ ok: false }));
    if (!listed || listed.ok !== true) {
      if (count) count.textContent = '无法读取该文件夹';
      return;
    }
    if (count) count.textContent = `${listed.files.length} 个文本转写`;
  }

  function refreshCatchup() {
    const noted = domain.noteScheduleCatchup(state, Date.now());
    if (!noted.changed || !saveState(noted.state)) return;
    render();
  }

  async function applyImport(message) {
    const previous = loadState();
    const preview = domain.mergeWorkImport(previous, message.payload, {
      now: Date.now(),
      fileHash: typeof message.fileHash === 'string' ? message.fileHash : '',
    });
    if (preview.error || !preview.changed) return reportOf(preview);
    const backup = await window.notchAPI?.backupWorkState?.(JSON.stringify(previous));
    if (!backup || backup.ok !== true) return { retry: true };
    if (!saveState(preview.state)) return { retry: true };
    render();
    const created = preview.imported.filter((item) => item.op === 'create').length;
    const undoOpen = typeof statusToastActionHandler !== 'undefined' && statusToastActionHandler;
    if (typeof showStatusToast === 'function' && !undoOpen) {
      const skipped = preview.skipped.length ? `，跳过 ${preview.skipped.length} 条` : '';
      showStatusToast(created ? `已导入 ${created} 条工作待办${skipped}` : `已更新工作待办${skipped}`);
    }
    return reportOf(preview);
  }

  function bind() {
    const classic = document.getElementById('todo-view-classic');
    const work = document.getElementById('todo-view-work');
    const classicView = document.getElementById('todo-classic-view');
    const workView = document.getElementById('todo-work-view');
    function show(which) {
      const useWork = which === 'work';
      try { localStorage.setItem(domain.WORK_VIEW_KEY, useWork ? 'work' : 'classic'); } catch (error) {}
      if (classicView) classicView.hidden = useWork;
      if (workView) workView.hidden = !useWork;
      classic?.setAttribute('aria-selected', useWork ? 'false' : 'true');
      work?.setAttribute('aria-selected', useWork ? 'true' : 'false');
      if (useWork) render();
    }
    classic?.addEventListener('click', () => show('classic'));
    work?.addEventListener('click', () => show('work'));
    let saved = 'classic';
    try { saved = localStorage.getItem(domain.WORK_VIEW_KEY) || 'classic'; } catch (error) {}
    show(saved === 'work' ? 'work' : 'classic');

    document.getElementById('work-new-group')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      const added = domain.addWorkGroup(state, event.currentTarget.value);
      if (!added.ok || !saveState(added.state)) return;
      event.currentTarget.value = '';
      render();
    });
    document.getElementById('work-source-enabled')?.addEventListener('change', (event) => {
      if (event.currentTarget.checked && !state.sources.folders.length) {
        event.currentTarget.checked = false;
        setNote('先明确选择一个转写文件夹。默认不会扫描全盘、消息或凭证。');
        return;
      }
      state.sources.enabled = event.currentTarget.checked === true;
      if (!saveState(state)) event.currentTarget.checked = false;
      refreshTranscripts();
    });
    document.getElementById('work-source-choose')?.addEventListener('click', async () => {
      const selected = await window.notchAPI?.chooseTranscriptFolder?.();
      if (!selected?.ok) {
        if (selected?.error === 'official_data_dir') setNote('不能选择官方 TO-DO Panel 的数据目录。');
        else if (selected?.error === 'folder_too_broad') setNote('请选择专门存放转写文本的文件夹，不要选主目录或整块磁盘。');
        return;
      }
      state.sources.folders = [selected.path];
      state.sources.enabled = false;
      saveState(state);
      setNote('文件夹已记录，采集仍是关闭的。确认后可再打开开关。');
      render();
    });
    document.getElementById('work-source-refresh')?.addEventListener('click', () => refreshTranscripts());
    document.getElementById('work-schedule-time')?.addEventListener('change', (event) => {
      state.schedule.time = event.currentTarget.value || null;
      if (!state.schedule.time) state.schedule.enabled = false;
      rememberSchedule(state);
      if (!state.schedule.time) setNote('还没有确定上班时间，每日检查保持关闭。');
    });
    document.getElementById('work-schedule-weekdays')?.addEventListener('change', (event) => {
      state.schedule.weekdaysOnly = event.currentTarget.checked === true;
      rememberSchedule(state);
    });
    document.getElementById('work-schedule-enabled')?.addEventListener('change', (event) => {
      if (!state.schedule.time) {
        event.currentTarget.checked = false;
        setNote('先填写上班时间。时间未确定时不会自动启用。');
        return;
      }
      state.schedule.enabled = event.currentTarget.checked === true;
      rememberSchedule(state);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshCatchup();
    });
    window.addEventListener('focus', refreshCatchup);
    setInterval(refreshCatchup, 60000);
    refreshCatchup();
  }

  window.NotchWork = { applyImport, reload: () => { state = loadState(); render(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
