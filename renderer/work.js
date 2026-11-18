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
  const PANE_KEY = 'notch-work-board-pane-v1';
  let pane = 'today';
  let drawerGroup = '';
  const drafts = new Map();
  let calendar = null;
  try { pane = localStorage.getItem(PANE_KEY) === 'weekly' ? 'weekly' : 'today'; } catch (error) {}

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

  function pendingCount(groupId) {
    return domain.activeWorkTasks(state).filter((task) => task.groupId === groupId && !task.done).length;
  }

  function tasksIn(groupId) {
    return domain.activeWorkTasks(state).filter((task) => task.groupId === groupId);
  }

  function formatDue(iso) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: domain.WORK_TIMEZONE,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(iso));
    const read = (type) => parts.find((part) => part.type === type)?.value || '';
    const hour = read('hour') === '24' ? '00' : read('hour');
    return `${read('month')}/${read('day')} ${hour}:${read('minute')}`;
  }

  function composerLabel(groupId) {
    const deadline = drafts.get(groupId);
    if (!deadline) return '未设置';
    return new Intl.DateTimeFormat('zh-CN', {
      day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(deadline));
  }

  function ensureDraft(groupId) {
    if (drafts.has(groupId)) return drafts.get(groupId);
    const deadline = window.NotchDomain && window.NotchDomain.defaultTodoDeadline
      ? window.NotchDomain.defaultTodoDeadline(new Date())
      : null;
    drafts.set(groupId, deadline);
    return deadline;
  }

  function renameGroup(group, input) {
    const renamed = domain.renameWorkGroup(state, group.id, input.value);
    if (!renamed.ok || !saveState(renamed.state)) input.value = group.name;
    else render();
  }

  function render() {
    const board = document.getElementById('work-board');
    const status = document.getElementById('work-status');
    const rail = document.getElementById('work-review-actions');
    if (!board) return;
    const layout = domain.workBoardLayout(state);
    const active = domain.activeWorkTasks(state);
    if (status) {
      const gap = state.schedule.pendingDate
        ? `${state.schedule.pendingDate} 的整理还没做。应用当时没开着，不能补到当天 09:00。`
        : '';
      status.textContent = active.length
        ? `可以直接改、勾选或删除。上方可以打开待确认和阻塞。${gap}`
        : `还没有工作待办。在卡片下方输入，回车就会留下。${gap}`;
    }
    if (rail) {
      rail.replaceChildren();
      [...layout.review, ...layout.custom].forEach((group) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'work-review-chip';
        button.setAttribute('aria-pressed', drawerGroup === group.id ? 'true' : 'false');
        button.textContent = `${group.name} ${pendingCount(group.id)}`;
        button.addEventListener('click', () => {
          drawerGroup = drawerGroup === group.id ? '' : group.id;
          render();
        });
        rail.append(button);
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
            if (drawerGroup === group.id) drawerGroup = '';
            if (saveState(removed.state)) render();
          });
          rail.append(remove);
        }
      });
    }
    board.replaceChildren();
    layout.slots.forEach((slot) => board.append(renderCard(slot)));
    renderDrawer(layout);
    renderHomeColumns();
    syncSettingsForm();
  }

  function renderHomeColumns() {
    const host = document.getElementById('home-work-columns');
    if (!host || typeof domain.workHomeLayout !== 'function') return;
    host.replaceChildren();
    domain.workHomeLayout(state).forEach((group) => {
      const column = document.createElement('section');
      column.className = 'work-column tile';
      column.dataset.group = group.id;
      const header = document.createElement('div');
      header.className = 'work-column-head';
      const name = document.createElement('input');
      name.className = 'todo-category-name';
      name.value = group.name;
      name.maxLength = 24;
      name.setAttribute('aria-label', `修改${group.name}名称`);
      name.addEventListener('change', () => renameGroup(group, name));
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(pendingCount(group.id));
      header.append(name, count);
      const list = document.createElement('ul');
      list.className = 'todo-list';
      const tasks = tasksIn(group.id);
      if (!tasks.length) {
        const empty = document.createElement('li');
        empty.className = 'work-empty';
        empty.textContent = '在下方输入，回车保存';
        list.append(empty);
      }
      tasks.forEach((task) => list.append(renderTask(task)));
      column.append(header, list, renderComposer(group));
      host.append(column);
    });
  }

  function renderCard(slot) {
    const section = document.createElement('section');
    section.className = 'quadrant tile work-card';
    section.dataset.workSlot = slot.slot;
    const header = document.createElement('div');
    header.className = 'quadrant-header';
    let group = slot.panes[0];
    if (slot.slot === 'cadence') {
      const switcher = document.createElement('div');
      switcher.className = 'work-cadence';
      switcher.setAttribute('role', 'tablist');
      slot.panes.forEach((item) => {
        const tab = document.createElement('div');
        tab.className = 'work-cadence-tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', item.id === pane ? 'true' : 'false');
        const name = document.createElement('input');
        name.className = 'todo-category-name';
        name.value = item.name;
        name.maxLength = 24;
        name.setAttribute('aria-label', `修改${item.name}名称`);
        name.addEventListener('change', () => renameGroup(item, name));
        name.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        });
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = String(pendingCount(item.id));
        tab.append(name, count);
        tab.addEventListener('click', (event) => {
          if (event.target === name || pane === item.id) return;
          pane = item.id;
          try { localStorage.setItem(PANE_KEY, pane); } catch (error) {}
          render();
        });
        switcher.append(tab);
      });
      header.append(switcher);
      group = slot.panes.find((item) => item.id === pane) || group;
    } else if (group) {
      const dot = document.createElement('span');
      dot.className = `dot dot-${slot.dot}`;
      const name = document.createElement('input');
      name.className = 'todo-category-name';
      name.value = group.name;
      name.maxLength = 24;
      name.setAttribute('aria-label', `修改${group.name}名称`);
      name.addEventListener('change', () => renameGroup(group, name));
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(pendingCount(group.id));
      header.append(dot, name, count);
    }
    const list = document.createElement('ul');
    list.className = 'todo-list';
    const tasks = group ? tasksIn(group.id) : [];
    if (!tasks.length && group) {
      const empty = document.createElement('li');
      empty.className = 'work-empty';
      empty.textContent = group.id === 'weekly' ? '本周还没有周报' : '在下方输入，回车保存';
      list.append(empty);
    }
    tasks.forEach((task) => list.append(renderTask(task)));
    section.append(header, list);
    if (group) section.append(renderComposer(group));
    return section;
  }

  function renderComposer(group) {
    const row = document.createElement('div');
    row.className = 'add-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 200;
    input.placeholder = '添加待办，回车保存…';
    input.setAttribute('aria-label', `在${group.name}添加待办`);
    input.addEventListener('focus', () => ensureDraft(group.id));
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
      const deadline = drafts.has(group.id) ? drafts.get(group.id) : ensureDraft(group.id);
      const created = domain.createManualWorkTask(state, {
        text: input.value,
        groupId: group.id,
        deadline,
      }, Date.now());
      if (!created.ok || !saveState(created.state)) return;
      drafts.delete(group.id);
      render();
    });
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'todo-deadline-trigger';
    trigger.setAttribute('aria-label', `选择${group.name}的截止时间`);
    const label = document.createElement('span');
    if (!drafts.has(group.id)) ensureDraft(group.id);
    label.textContent = composerLabel(group.id);
    trigger.dataset.workGroup = group.id;
    trigger.append(label);
    trigger.addEventListener('click', () => openWorkCalendar(group.id, trigger));
    row.append(input, trigger);
    return row;
  }

  function renderTask(task) {
    const card = document.createElement('li');
    card.className = `todo-item${task.done ? ' done' : ''}`;
    card.dataset.sourceId = task.sourceId;
    const checkbox = document.createElement('button');
    checkbox.type = 'button';
    checkbox.className = 'checkbox';
    checkbox.innerHTML = '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    checkbox.setAttribute('aria-pressed', task.done ? 'true' : 'false');
    checkbox.setAttribute('aria-label', task.done ? `恢复未完成：${task.text}` : `标记完成：${task.text}`);
    checkbox.addEventListener('click', () => {
      const edited = domain.editWorkTask(state, task.id, { done: !task.done }, Date.now());
      if (edited.ok && saveState(edited.state)) render();
    });
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'todo-copy';
    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = task.text;
    title.append(text);
    const presentation = domain.workDeadlinePresentation(task, Date.now());
    if (presentation.known) {
      const pill = document.createElement('span');
      pill.className = 'work-remaining';
      pill.dataset.tone = presentation.tone;
      pill.textContent = presentation.label;
      const time = document.createElement('time');
      time.className = 'todo-ddl';
      time.dateTime = presentation.deadline;
      time.textContent = formatDue(presentation.deadline);
      title.append(pill, time);
    } else {
      const unknown = document.createElement('span');
      unknown.className = 'todo-ddl';
      unknown.textContent = '未设置';
      title.append(unknown);
    }
    if (task.origin === 'manual') {
      const origin = document.createElement('span');
      origin.className = 'work-origin';
      origin.textContent = '手动';
      title.append(origin);
    }
    if (task.responsibility !== 'mine') {
      const tag = document.createElement('span');
      tag.className = 'work-responsibility';
      tag.textContent = '待确认';
      title.append(tag);
    }
    title.addEventListener('click', (event) => {
      if (event.target.closest('.work-source')) return;
      beginEdit(card, task, text);
    });
    if (task.evidence && (task.evidence.excerpt || task.evidence.sourceRef || task.evidence.recordingAt)) {
      const source = document.createElement('button');
      source.type = 'button';
      source.className = 'work-source';
      source.textContent = '依据';
      source.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = card.querySelector('.work-evidence');
        if (open) { open.remove(); return; }
        const quote = document.createElement('blockquote');
        quote.className = 'work-evidence';
        const when = task.evidence.recordingAt ? `录音 ${task.evidence.recordingAt}` : '无录音时间点';
        quote.textContent = `${task.evidence.sourceRef || '无来源'} · ${when}${task.evidence.excerpt ? `\n${task.evidence.excerpt}` : ''}`;
        card.append(quote);
      });
      title.append(source);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `移除：${task.text}`);
    remove.addEventListener('click', () => {
      const dismissed = domain.dismissWorkTask(state, task.id, Date.now());
      if (dismissed.ok && saveState(dismissed.state)) render();
    });
    card.append(checkbox, title, remove);
    if (task.revokeRequested) {
      const flag = document.createElement('p');
      flag.className = 'work-flag';
      flag.textContent = '外部请求撤回，但这条已手工修改或完成，所以仍保留。';
      card.append(flag);
    }
    return card;
  }

  function renderDrawer(layout) {
    const drawer = document.getElementById('work-drawer');
    if (!drawer) return;
    const group = [...layout.review, ...layout.custom].find((item) => item.id === drawerGroup);
    if (!group) {
      drawer.hidden = true;
      drawer.replaceChildren();
      return;
    }
    drawer.hidden = false;
    drawer.replaceChildren();
    const card = document.createElement('section');
    card.className = 'quadrant tile work-drawer-card';
    const header = document.createElement('div');
    header.className = 'quadrant-header';
    const title = document.createElement('strong');
    title.textContent = group.name;
    const note = document.createElement('span');
    note.className = 'work-drawer-note';
    note.textContent = '移到四宫格只会改分组，不会把待确认改成我的责任。';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'delete';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', () => { drawerGroup = ''; render(); });
    header.append(title, note, close);
    const list = document.createElement('ul');
    list.className = 'todo-list';
    tasksIn(group.id).forEach((task) => {
      const row = renderTask(task);
      const move = document.createElement('select');
      move.className = 'work-move';
      move.setAttribute('aria-label', `移动${task.text}`);
      const stay = document.createElement('option');
      stay.value = '';
      stay.textContent = '移动到…';
      move.append(stay);
      layout.slots.forEach((slot) => slot.panes.forEach((target) => {
        const option = document.createElement('option');
        option.value = target.id;
        option.textContent = target.name;
        move.append(option);
      }));
      move.addEventListener('change', () => {
        if (!move.value) return;
        const edited = domain.editWorkTask(state, task.id, { groupId: move.value }, Date.now());
        if (edited.ok && saveState(edited.state)) {
          if (edited.task.responsibility !== task.responsibility) setNote('责任字段被意外改动，已停止。');
          render();
        }
      });
      row.append(move);
      list.append(row);
    });
    card.append(header, list, renderComposer(group));
    drawer.append(card);
  }

  function openWorkCalendar(groupId, anchor) {
    const popover = document.getElementById('work-date-popover');
    const grid = document.getElementById('work-calendar-grid');
    const month = document.getElementById('work-calendar-month');
    const hour = document.getElementById('work-calendar-hour');
    const minute = document.getElementById('work-calendar-minute');
    if (!popover || !grid || !window.NotchDomain) return;
    const current = drafts.get(groupId) ? new Date(drafts.get(groupId)) : new Date();
    calendar = {
      groupId,
      year: current.getFullYear(),
      month: current.getMonth(),
      day: current.getDate(),
    };
    if (!hour.options.length) {
      for (let value = 0; value < 24; value += 1) hour.add(new Option(String(value).padStart(2, '0'), String(value)));
      for (let value = 0; value < 60; value += 5) minute.add(new Option(String(value).padStart(2, '0'), String(value)));
    }
    hour.value = String(current.getHours());
    minute.value = String(Math.floor(current.getMinutes() / 5) * 5);
    const paint = () => {
      month.textContent = `${calendar.year}年 ${calendar.month + 1}月`;
      grid.replaceChildren();
      const first = (new Date(calendar.year, calendar.month, 1).getDay() + 6) % 7;
      const days = new Date(calendar.year, calendar.month + 1, 0).getDate();
      for (let index = 0; index < first; index += 1) grid.append(document.createElement('span'));
      for (let day = 1; day <= days; day += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = String(day);
        button.dataset.day = String(day);
        if (day === calendar.day) button.className = 'selected';
        grid.append(button);
      }
    };
    paint();
    grid.onclick = (event) => {
      const button = event.target.closest('[data-day]');
      if (!button) return;
      calendar.day = Number(button.dataset.day);
      commitCalendar();
      paint();
    };
    hour.onchange = commitCalendar;
    minute.onchange = commitCalendar;
    document.getElementById('work-calendar-previous').onclick = () => {
      const shifted = window.NotchDomain.shiftCalendarMonth(calendar, -1);
      if (!shifted) return;
      calendar.year = shifted.year;
      calendar.month = shifted.month;
      paint();
    };
    document.getElementById('work-calendar-next').onclick = () => {
      const shifted = window.NotchDomain.shiftCalendarMonth(calendar, 1);
      if (!shifted) return;
      calendar.year = shifted.year;
      calendar.month = shifted.month;
      paint();
    };
    document.getElementById('work-calendar-clear').onclick = () => {
      drafts.set(groupId, null);
      popover.hidden = true;
      render();
    };
    const card = anchor.closest('.work-card, .work-drawer-card') || document.getElementById('work-board');
    card.append(popover);
    popover.hidden = false;
  }

  function commitCalendar() {
    if (!calendar) return;
    const hour = document.getElementById('work-calendar-hour');
    const minute = document.getElementById('work-calendar-minute');
    const deadline = window.NotchDomain.calendarDeadline({
      year: calendar.year,
      month: calendar.month,
      day: calendar.day,
      hour: hour.value,
      minute: minute.value,
    });
    if (!deadline) return;
    drafts.set(calendar.groupId, deadline);
    const trigger = document.querySelector(`.todo-deadline-trigger[data-work-group="${CSS.escape(calendar.groupId)}"]`);
    if (trigger) trigger.querySelector('span').textContent = composerLabel(calendar.groupId);
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
    const lead = document.getElementById('work-schedule-lead');
    const accepted = document.getElementById('work-schedule-accepted');
    const prepare = document.getElementById('work-schedule-prepare');
    if (time && document.activeElement !== time) time.value = state.schedule.readyBy || '09:00';
    if (lead && document.activeElement !== lead) lead.value = String(state.schedule.leadMinutes ?? 60);
    if (prepare) prepare.textContent = `提前 ${state.schedule.leadMinutes ?? 60} 分钟，${state.schedule.prepareAt || '08:00'} 开始`;
    if (weekdays) weekdays.checked = state.schedule.weekdaysOnly !== false;
    if (accepted) accepted.checked = state.schedule.acceptedLocally === true;
    if (scheduleEnabled) {
      scheduleEnabled.checked = state.schedule.enabled === true;
      scheduleEnabled.disabled = state.schedule.acceptedLocally !== true;
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
    const texts = listed.files.filter((file) => file.kind === 'text').length;
    const audio = listed.files.filter((file) => file.kind === 'audio').length;
    if (count) count.textContent = `${texts} 个文本，${audio} 个录音`;
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
      const useWork = domain.resolveTodoSubview(which) === 'work';
      if (classicView) classicView.hidden = useWork;
      if (workView) workView.hidden = !useWork;
      classic?.setAttribute('aria-selected', useWork ? 'false' : 'true');
      work?.setAttribute('aria-selected', useWork ? 'true' : 'false');
      if (useWork) render();
    }
    classic?.addEventListener('click', () => show('classic'));
    work?.addEventListener('click', () => show('work'));
    document.addEventListener('notch:tabchange', (event) => {
      if (event.detail?.tab === 'todo') show('enter-todo');
      if (event.detail?.tab === 'home') renderHomeColumns();
    });
    const dashboard = document.getElementById('home-bento');
    const homeWork = document.getElementById('home-work-view');
    const dashboardButton = document.getElementById('home-view-dashboard');
    const homeWorkButton = document.getElementById('home-view-work');
    function showHome(which) {
      const useWork = which === 'work';
      if (dashboard) dashboard.hidden = useWork;
      if (homeWork) homeWork.hidden = !useWork;
      dashboardButton?.setAttribute('aria-selected', useWork ? 'false' : 'true');
      homeWorkButton?.setAttribute('aria-selected', useWork ? 'true' : 'false');
      if (useWork) render();
    }
    dashboardButton?.addEventListener('click', () => showHome('dashboard'));
    homeWorkButton?.addEventListener('click', () => showHome('work'));
    show('startup');

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
      state.schedule.readyBy = event.currentTarget.value || '09:00';
      rememberSchedule(state);
    });
    document.getElementById('work-schedule-lead')?.addEventListener('change', (event) => {
      const leadMinutes = Number(event.currentTarget.value);
      state.schedule.leadMinutes = Number.isInteger(leadMinutes) ? leadMinutes : 60;
      rememberSchedule(state);
    });
    document.getElementById('work-schedule-weekdays')?.addEventListener('change', (event) => {
      state.schedule.weekdaysOnly = event.currentTarget.checked === true;
      rememberSchedule(state);
    });
    document.getElementById('work-schedule-accepted')?.addEventListener('change', (event) => {
      state.schedule.acceptedLocally = event.currentTarget.checked === true;
      if (!state.schedule.acceptedLocally) state.schedule.enabled = false;
      rememberSchedule(state);
      if (!state.schedule.acceptedLocally) setNote('还没有完成本机端到端验收，每日检查保持关闭。');
    });
    document.getElementById('work-schedule-enabled')?.addEventListener('change', (event) => {
      if (state.schedule.acceptedLocally !== true) {
        event.currentTarget.checked = false;
        setNote('先在这台电脑完成一次端到端验收，再打开每日检查。');
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
    bindTicnote();
  }

  function bindTicnote() {
    const keyInput = document.getElementById('ticnote-appkey');
    const grokInput = document.getElementById('grok-api-key');
    const refresh = async () => {
      const tic = await window.notchAPI?.ticnoteStatus?.();
      const grok = await window.notchAPI?.grokStatus?.();
      const label = document.getElementById('ticnote-status-label');
      const connection = document.getElementById('ticnote-connection');
      const grokStatus = document.getElementById('grok-call-status');
      const model = document.getElementById('grok-model-label');
      if (tic?.status && label) {
        label.textContent = tic.status.configured ? '密钥已保存' : '未连接';
        if (connection) {
          connection.textContent = !tic.status.configured
            ? '尚未验证'
            : tic.status.folderCount
              ? `已选 ${tic.status.folderCount} 个文件夹，每日任务仍关闭`
              : '已保存密钥，还没有指定文件夹';
        }
      }
      const grokEnabled = document.getElementById('grok-enabled');
      const grokLabel = document.getElementById('grok-enabled-label');
      if (grok?.status) {
        if (model) {
          model.textContent = grok.status.model
            ? `当前填写的模型是 ${grok.status.model}`
            : '未填写，不假定某个模型可用';
        }
        if (grokStatus) {
          grokStatus.textContent = grok.status.enabled
            ? '已启用。整理时会把获准转写发送到 api.x.ai，并按 token 计费。每日自动仍关闭。'
            : '未启用，不会访问 api.x.ai';
        }
        if (grokEnabled && document.activeElement !== grokEnabled) grokEnabled.checked = grok.status.enabled === true;
        if (grokLabel) grokLabel.textContent = grok.status.enabled ? '已启用' : '默认关闭';
      }
    };
    document.getElementById('ticnote-save')?.addEventListener('click', async () => {
      const saved = await window.notchAPI?.ticnoteSaveKey?.(keyInput?.value || '');
      if (keyInput) keyInput.value = '';
      if (!saved?.ok) setNote(saved?.reason === 'overseas_refused' ? '海外密钥已拒绝，请使用国内正式 tncn_sk_ 密钥。' : '密钥没有保存。');
      refresh();
    });
    document.getElementById('ticnote-clear')?.addEventListener('click', async () => {
      await window.notchAPI?.ticnoteClearKey?.();
      if (keyInput) keyInput.value = '';
      document.getElementById('ticnote-projects')?.replaceChildren();
      document.getElementById('ticnote-folders')?.replaceChildren();
      refresh();
    });
    document.getElementById('ticnote-verify')?.addEventListener('click', async () => {
      const verified = await window.notchAPI?.ticnoteVerify?.();
      const list = document.getElementById('ticnote-projects');
      if (!verified?.ok) {
        setNote(verified?.reason === 'no_key' ? '先保存国内正式 AppKey。没有密钥时不会访问 TicNote。' : '验证没有完成，没有读取录音内容。');
        refresh();
        return;
      }
      if (list) {
        list.replaceChildren();
        verified.projects.forEach((project) => {
          const label = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.value = project.id;
          input.addEventListener('change', () => saveTicnoteProjects());
          label.append(input, document.createTextNode(` ${project.name}（${project.fileNum == null ? '文件数未知' : `${project.fileNum} 个文件`}）`));
          list.append(label);
        });
      }
      refresh();
    });
    document.getElementById('grok-save')?.addEventListener('click', async () => {
      if (grokInput?.value) {
        const saved = await window.notchAPI?.grokSaveKey?.(grokInput.value);
        grokInput.value = '';
        if (!saved?.ok) setNote(saved?.reason === 'secure_storage_unavailable' ? '这台系统不能加密保存密钥，没有写入。' : 'Grok 密钥没有保存。');
      }
      const modelValue = document.getElementById('grok-model')?.value || '';
      if (modelValue) {
        const savedModel = await window.notchAPI?.grokSaveModel?.(modelValue);
        if (!savedModel?.ok) setNote('模型 ID 只能是字母、数字、点、下划线、冒号或连字符。');
      }
      refresh();
    });
    document.getElementById('grok-enabled')?.addEventListener('change', async (event) => {
      const saved = await window.notchAPI?.grokSetEnabled?.(event.currentTarget.checked === true);
      if (!saved?.ok) {
        event.currentTarget.checked = false;
        setNote(saved?.reason === 'no_model' ? '先填写模型 ID。启用后转写会发送到 xAI 并按量计费。' : '先保存密钥。没有密钥时不会出网。');
      } else if (event.currentTarget.checked) {
        setNote('已启用提取。获准转写会发送到 api.x.ai，按 token 计费。每日自动整理仍关闭。');
      }
      refresh();
    });
    document.getElementById('grok-extract')?.addEventListener('click', async () => {
      const result = await window.notchAPI?.grokExtract?.();
      if (!result?.ok) {
        const reasons = {
          not_enabled: '还没有启用。不会访问 api.x.ai。',
          no_key: '没有密钥，不会出网。',
          no_model: '没有模型 ID，不会出网。',
          ticnote_scope_empty: '还没有指定 TicNote 文件夹，不会读取正文。',
          scope_empty: '还没有指定 TicNote 文件夹，不会读取正文。',
          no_transcript: '授权文件夹里没有可发送的转写，没有向 xAI 发请求。',
          bad_output: '模型输出不能核对到来源摘录，没有写入待办。',
          timeout: '模型超时，没有写入待办，也不会把材料标成已处理。',
          rate_limited: '模型限流，没有写入待办，也不会把材料标成已处理。',
        };
        setNote(reasons[result?.reason] || '这次没有写入待办。');
      } else {
        setNote(result.imported ? `已放入收件箱 ${result.imported} 条。每日自动仍关闭。` : '没有新的待办。每日自动仍关闭。');
      }
      refresh();
    });
    document.getElementById('grok-clear')?.addEventListener('click', async () => {
      await window.notchAPI?.grokClearKey?.();
      if (grokInput) grokInput.value = '';
      refresh();
    });
    refresh();
  }

  async function saveTicnoteProjects() {
    const ids = [...document.querySelectorAll('#ticnote-projects input:checked')].map((input) => input.value);
    const saved = await window.notchAPI?.ticnoteSaveScope?.({
      projects: ids.map((id) => ({ id })),
      folders: [],
    });
    if (!saved?.ok) {
      setNote('项目范围没有保存。');
      return;
    }
    const folders = document.getElementById('ticnote-folders');
    if (!folders) return;
    folders.replaceChildren();
    const note = document.createElement('p');
    note.className = 'work-drawer-note';
    note.textContent = '下面每一项只授权自己这一层。勾选父文件夹不会带上子文件夹，同名项也不会一起选中。';
    folders.append(note);
    for (const id of ids) {
      const listed = await window.notchAPI?.ticnoteListFolders?.(id);
      (listed?.folders || []).forEach((folder) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = folder.id;
        input.dataset.projectId = folder.projectId;
        input.addEventListener('change', () => saveTicnoteFolders());
        const depth = folder.depth ? `第 ${folder.depth} 层` : '项目根目录';
        label.append(input, document.createTextNode(` ${folder.name}（${depth}，不含子文件夹）`));
        folders.append(label);
      });
    }
  }

  async function saveTicnoteFolders() {
    const projects = [...document.querySelectorAll('#ticnote-projects input:checked')].map((input) => ({ id: input.value }));
    const folders = [...document.querySelectorAll('#ticnote-folders input:checked')].map((input) => ({
      id: input.value,
      projectId: input.dataset.projectId,
    }));
    const saved = await window.notchAPI?.ticnoteSaveScope?.({ projects, folders });
    if (!saved?.ok) setNote('文件夹范围没有保存。每日任务仍然关闭。');
    else setNote('授权范围已保存。每日任务仍然关闭，需要本机端到端验收后才能启用。');
  }

  window.NotchWork = { applyImport, reload: () => { state = loadState(); render(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
