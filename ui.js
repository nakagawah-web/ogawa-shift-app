/*
 * おがわ歯科 シフト管理 — 画面の表示と操作
 * データはこのPCのブラウザ（localStorage）に保存する。
 */
(function () {
  'use strict';

  const C = window.ShiftCore;
  const STORAGE_KEY = 'ogawa-shift-v1';
  const ADMIN_TIMEOUT_MS = 20 * 60 * 1000; // 管理者画面は20分操作がなければロック
  const INPUT_TIMEOUT_MS = 5 * 60 * 1000; // 入力画面は5分操作がなければ名前選択に戻す
  const BACKUP_REMIND_DAYS = 14;

  const TYPE_LABELS = {
    full: '〇 終日', am: 'AM 午前のみ', pm: 'PM 午後のみ', time: '時間指定',
    off: '× 休み', paid: '有給', event: '研修・不在（出勤扱い）', na: 'ー 勤務なし',
  };
  const REQUEST_LABELS = {
    off: '休み希望', paid: '有給', full: '出勤（終日）', am: '午前のみ', pm: '午後のみ', time: '時間指定',
  };
  const PATTERN_LABELS = {
    full: '〇 終日', am: 'AM 午前のみ', pm: 'PM 午後のみ', time: '時間指定', off: '× 固定休', na: 'ー 勤務なし',
  };
  const SRC_LABELS = {
    request: '本人の申請', pattern: '基本パターン', auto: '自動で割り振った休み',
    manual: '管理者が修正', closed: '休診日', out: '在籍外',
  };

  let db = null;
  let storageError = '';
  const state = {
    tab: 'view',
    viewYm: null,
    input: { staffId: null, ym: null },
    admin: { unlocked: false, tab: 'build', ym: null },
    lastActive: Date.now(),
    flash: null,
    modalSave: null,
  };

  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal-root');

  // ---------------------------------------------------------------
  // 共通
  // ---------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function todayStr() {
    const t = new Date();
    return C.ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    const t = new Date(iso);
    return `${t.getMonth() + 1}月${t.getDate()}日 ${t.getHours()}:${C.pad(t.getMinutes())}`;
  }
  function fmtNum(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  function staffById(id) {
    return db.staff.find((s) => s.id === id);
  }
  function roleText(s) {
    return s.roles.join('・');
  }
  function flash(text, kind) {
    state.flash = { text, kind: kind || 'ok' };
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  }

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      storageError = 'このブラウザではデータを保存できません。Chrome か Edge で開いてください。';
      db = C.defaultData();
      return;
    }
    try {
      db = raw ? C.normalizeData(JSON.parse(raw)) : C.defaultData();
    } catch (e) {
      // 壊れたデータは消さずに別名で残す
      try { localStorage.setItem(`${STORAGE_KEY}-broken-${Date.now()}`, raw); } catch (e2) { /* 何もしない */ }
      storageError = '保存データを読み込めませんでした。管理者の「バックアップ」から復元してください。';
      db = C.defaultData();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
      storageError = '保存に失敗しました。ブラウザの容量がいっぱいか、保存が禁止されています。';
    }
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // 在籍中（退職前）のスタッフを職種ごとにまとめる
  function groupByRole(list) {
    const groups = [];
    for (const s of C.sortStaff(list)) {
      const r = C.primaryRole(s);
      const g = groups[groups.length - 1];
      if (g && g.role === r) g.list.push(s);
      else groups.push({ role: r, list: [s] });
    }
    return groups;
  }

  function monthNav(ym, action, extra) {
    return `<div class="month-nav">
      <button type="button" class="btn" data-action="${action}" data-delta="-1">‹ 前の月</button>
      <h2>${C.formatMonthJa(ym)}</h2>
      <button type="button" class="btn" data-action="${action}" data-delta="1">次の月 ›</button>
      <div class="spacer"></div>${extra || ''}
    </div>`;
  }

  function emptyState() {
    return `<section class="panel"><div class="notice">
      スタッフがまだ登録されていません。<br>
      「管理者」タブの「スタッフ」から登録するか、「バックアップ」から初期データのファイルを読み込んでください。
    </div></section>`;
  }

  // ---------------------------------------------------------------
  // モーダル（小窓）
  // ---------------------------------------------------------------
  function openModal(title, body, opts) {
    const o = opts || {};
    state.modalSave = o.onSave || null;
    $modal.innerHTML = `<div class="modal-backdrop" data-action="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        <form class="modal-body" data-form="modal">${body}</form>
        <div class="modal-actions">
          ${o.extra || ''}
          <div class="spacer"></div>
          <button type="button" class="btn" data-action="modal-close">${o.onSave ? 'キャンセル' : '閉じる'}</button>
          ${o.onSave ? `<button type="button" class="btn primary" data-action="modal-save">${esc(o.saveLabel || '保存')}</button>` : ''}
        </div>
      </div>
    </div>`;
    const first = $modal.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea');
    if (first && !o.noFocus) first.focus();
    syncTimeInputs();
  }

  // 「時間指定」を選んだときだけ時刻を入力できるようにする
  function syncTimeInputs() {
    $modal.querySelectorAll('.time-row').forEach((row) => {
      const t = row.closest('form').querySelector('input[name=type]:checked');
      row.querySelectorAll('input[type=time]').forEach((i) => { i.disabled = !t || t.value !== 'time'; });
    });
    $modal.querySelectorAll('.pattern-table tr').forEach((tr) => {
      const sel = tr.querySelector('select');
      tr.querySelectorAll('input[type=time]').forEach((i) => { i.disabled = sel.value !== 'time'; });
    });
  }
  function closeModal() {
    $modal.innerHTML = '';
    state.modalSave = null;
  }
  function modalForm() {
    return $modal.querySelector('form[data-form="modal"]');
  }
  function confirmModal(title, message, okLabel, onOk, danger) {
    openModal(title, `<p>${message}</p>`, { onSave: onOk, saveLabel: okLabel, noFocus: true });
    if (danger) $modal.querySelector('[data-action="modal-save"]').classList.add('danger');
  }

  // ---------------------------------------------------------------
  // シフト表（表の描画）
  // ---------------------------------------------------------------
  function cellTitle(s, d, day, c, req) {
    const lines = [`${s.name} ${C.formatDateJa(d)}`, `${C.cellLabel(c, day) || '（空欄）'}（${SRC_LABELS[c.src] || ''}）`];
    if (req) {
      lines.push(`申請: ${requestLabel(req, day)}${req.comment ? `「${req.comment}」` : ''}`);
    }
    return lines.join('\n');
  }

  function countCell(half, min) {
    if (!half.open) return '<td class="c-count closed-half">—</td>';
    const parts = C.countsText(half, min).map((x) =>
      `<span class="${x.short ? 'short' : ''}">${esc(x.label)}</span>`);
    return `<td class="c-count">${parts.join(' ')}</td>`;
  }

  function gridHtml(ym, editable) {
    const m = db.months[ym];
    const sched = m.schedule;
    const st = C.computeStats(db, ym, sched);
    const min = db.settings.minStaff;
    const groups = groupByRole(st.staff);
    const roleCls = (r) => `g-${C.ROLES.indexOf(r)}`;

    let h = `<div class="grid-wrap"><table class="shift-grid${editable ? ' editable' : ''}"><thead><tr>
      <th rowspan="2" class="c-date">日</th><th rowspan="2" class="c-dow">曜</th><th rowspan="2" class="c-note">特記事項</th>`;
    for (const g of groups) {
      h += `<th colspan="${g.list.length}" class="grp ${roleCls(g.role)}">${esc(C.ROLE_NAMES[g.role])}</th>`;
    }
    h += '<th rowspan="2" class="c-count">午前の人数</th><th rowspan="2" class="c-count">午後の人数</th></tr><tr class="names">';
    for (const g of groups) {
      for (const s of g.list) {
        h += `<th class="c-name ${roleCls(g.role)}" title="${esc(`${s.name}（${roleText(s)}・${s.employment === 'full' ? '常勤' : 'パート'}）`)}">` +
          `${esc(s.name)}${s.employment === 'full' ? '' : '<small>パ</small>'}</th>`;
      }
    }
    h += '</tr></thead><tbody>';

    for (const d of st.dates) {
      const day = st.days[d];
      const cls = [day.dow === 0 ? 'sun' : day.dow === 6 ? 'sat' : '', day.holiday ? 'holiday' : '',
        day.kind === 'closed' ? 'closed' : '', day.kind === 'limited' ? 'limited' : ''].join(' ');
      const note = [day.holiday, day.note].filter(Boolean).join(' ');
      const dayAttr = editable ? ` data-action="edit-day" data-date="${d}" title="クリックで診療日の設定"` : '';
      h += `<tr class="${cls}"><td class="c-date"${dayAttr}>${C.parseYmd(d).d}</td>` +
        `<td class="c-dow">${C.WEEKDAYS[day.dow]}</td><td class="c-note"${dayAttr}>${esc(note)}</td>`;
      for (const g of groups) {
        for (const s of g.list) {
          const c = sched[s.id][d];
          const req = m.requests && m.requests[s.id] && m.requests[s.id][d];
          const canEdit = editable && c.src !== 'out';
          h += `<td class="cell t-${c.type} s-${c.src}${req && req.comment ? ' has-comment' : ''}"` +
            `${canEdit ? ` data-action="edit-cell" data-sid="${s.id}" data-date="${d}"` : ''}` +
            ` title="${esc(cellTitle(s, d, day, c, req))}">${esc(C.cellLabel(c, day))}</td>`;
        }
      }
      h += countCell(st.perDay[d].am, min) + countCell(st.perDay[d].pm, min) + '</tr>';
    }

    const foot = (label, fn) => {
      let r = `<tr><th colspan="3" class="foot-label">${label}</th>`;
      for (const g of groups) for (const s of g.list) r += fn(st.perStaff[s.id], s);
      return r + '<td colspan="2"></td></tr>';
    };
    h += '</tbody><tfoot>';
    h += foot('出勤日数', (p) => `<td class="sum">${fmtNum(p.work)}</td>`);
    h += foot('休み（常勤: 実績/目安）', (p) => (p.target === null ? '<td class="sum muted">—</td>' :
      `<td class="sum ${p.off === p.target ? 'good' : 'bad'}">${fmtNum(p.off)}/${fmtNum(p.target)}</td>`));
    h += foot('有給', (p) => `<td class="sum">${p.paid || ''}</td>`);
    h += '</tfoot></table></div>';
    return h;
  }

  function legendHtml() {
    return `<div class="legend no-print">
      <span><i class="lg s-request"></i>本人の申請</span>
      <span><i class="lg s-auto">×</i>自動で割り振った休み</span>
      <span><i class="lg s-manual"></i>管理者が修正</span>
      <span><i class="lg has-comment"></i>申請にコメントあり（マスにマウスを乗せると表示）</span>
      <span><i class="lg short">DH1</i>最少人数より少ない</span>
    </div>`;
  }

  // ---------------------------------------------------------------
  // タブ1: シフト表（閲覧）
  // ---------------------------------------------------------------
  function renderView() {
    const ym = state.viewYm;
    const m = db.months[ym];
    if (!db.staff.length) return emptyState();
    const fixed = m && m.status === 'fixed' && m.schedule;
    const extra = fixed ? '<button type="button" class="btn" data-action="print">印刷</button>' : '';
    let body;
    if (fixed) {
      body = `<p class="meta no-print">確定日: ${fmtDateTime(m.fixedAt)}</p>` + gridHtml(ym, false);
    } else if (m && m.status === 'draft') {
      body = '<div class="notice">この月のシフトは管理者が作成中です。確定までお待ちください。</div>';
    } else {
      body = '<div class="notice">この月のシフトはまだ作成されていません。</div>';
    }
    return `<section class="panel">
      <h2 class="print-only">おがわ歯科 シフト表 ${C.formatMonthJa(ym)}</h2>
      <div class="no-print">${monthNav(ym, 'view-month', extra)}</div>${body}
    </section>`;
  }

  // ---------------------------------------------------------------
  // タブ2: 希望休・有給の入力
  // ---------------------------------------------------------------
  function requestLabel(req, day) {
    if (req.type === 'time') return C.formatTimeRange(req.start, req.end, day.hours);
    return REQUEST_LABELS[req.type] || req.type;
  }

  function patternLabel(p, day) {
    if (!p) return '';
    if (p.type === 'time') return C.formatTimeRange(p.start, p.end, day.hours);
    return { full: '〇', am: 'AM', pm: 'PM', off: '×', na: 'ー' }[p.type] || '';
  }

  function inputMonths() {
    const today = todayStr();
    const first = C.firstOpenMonth(db.settings, today);
    const list = [C.shiftYm(first, -1), first, C.shiftYm(first, 1), C.shiftYm(first, 2)];
    return list;
  }

  function canEditRequests(ym) {
    const m = db.months[ym];
    if (m && m.status === 'fixed') return false;
    return state.admin.unlocked || C.isInputOpen(db.settings, ym, todayStr());
  }

  function renderInput() {
    if (!db.staff.length) return emptyState();
    const s = state.input.staffId && staffById(state.input.staffId);
    if (!s) return renderNamePicker();

    const ym = state.input.ym;
    const today = todayStr();
    const deadline = C.deadlineOf(db.settings, ym);
    const m = db.months[ym];
    const editable = canEditRequests(ym);
    const reqs = (m && m.requests && m.requests[s.id]) || {};

    const tabs = inputMonths().map((k) => {
      const open = C.isInputOpen(db.settings, k, today);
      return `<button type="button" class="btn month-tab${k === ym ? ' active' : ''}" data-action="input-month" data-ym="${k}">
        ${C.formatMonthJa(k)}<small>${open ? `締切 ${C.formatDateJa(C.deadlineOf(db.settings, k), false)}` : '締切済み'}</small></button>`;
    }).join('');

    let status;
    if (m && m.status === 'fixed') {
      status = '<div class="banner info">この月のシフトは確定済みです。変更したい場合は管理者に伝えてください。</div>';
    } else if (!C.isInputOpen(db.settings, ym, today)) {
      status = state.admin.unlocked
        ? '<div class="banner warn">締切を過ぎていますが、管理者として入力できます。</div>'
        : `<div class="banner warn">締切（${C.formatDateJa(deadline)}）を過ぎたため入力できません。変更したい場合は管理者に伝えてください。</div>`;
    } else {
      status = `<div class="banner info">入力締切: <b>${C.formatDateJa(deadline)}</b>（あと${daysBetween(today, deadline)}日）。日付を押して入力します。</div>`;
    }

    const count = (t) => Object.values(reqs).filter((r) => r.type === t).length;
    const target = C.targetOffUnits(db, s, ym);
    const summary = s.employment === 'full'
      ? `<p>休み希望 <b>${count('off')}日</b>、有給 <b>${count('paid')}日</b>。</p>
         <p class="hint">常勤の休みは、祝日を除いて月${fmtNum(target)}日です（休診日・半日勤務の半日分を含みます）。
         希望休を入れた残りは、アプリが自動で割り振ります。</p>`
      : `<p>休み希望 <b>${count('off')}日</b>、有給 <b>${count('paid')}日</b>、出勤の変更 <b>${Object.keys(reqs).length - count('off') - count('paid')}日</b>。</p>
         <p class="hint">基本の出勤パターン（「いつも」の欄）と違う日だけ入力してください。</p>`;

    return `<section class="panel">
      <div class="input-head">
        <h2>${esc(s.name)} さん <small>${esc(roleText(s))}・${s.employment === 'full' ? '常勤' : 'パート・非常勤'}</small></h2>
        <button type="button" class="btn" data-action="input-done">入力を終える（名前の選択に戻る）</button>
      </div>
      <div class="month-tabs">${tabs}</div>
      ${status}
      ${calendarHtml(ym, s, reqs, editable)}
      <div class="summary">${summary}</div>
    </section>`;
  }

  function renderNamePicker() {
    const today = todayStr();
    const list = db.staff.filter((s) => !s.leaveDate || s.leaveDate >= today);
    const groups = groupByRole(list);
    return `<section class="panel">
      <h2>名前を選んでください</h2>
      <p class="lead">自分の名前を押します。代表者がまとめて入力する場合は、入力する人の名前を押してください。</p>
      ${groups.map((g) => `<div class="name-group"><h3>${esc(C.ROLE_NAMES[g.role])}</h3><div class="name-buttons">
        ${g.list.map((s) => `<button type="button" class="btn name" data-action="pick-staff" data-sid="${s.id}">${esc(s.name)}</button>`).join('')}
      </div></div>`).join('')}
    </section>`;
  }

  function calendarHtml(ym, s, reqs, editable) {
    const dates = C.monthDates(ym);
    const m = db.months[ym];
    const cells = [];
    for (let i = 0; i < C.dowOfDate(dates[0]); i++) cells.push('<td class="cal-empty"></td>');
    for (const d of dates) {
      const day = C.dayInfo(db, ym, d);
      const req = reqs[d];
      const st = C.staffStateOn(s, d);
      let base;
      if (!st.active) base = st.label;
      else if (day.kind === 'closed') base = '休診';
      else if (day.kind === 'limited') base = day.note || '特別診療';
      else base = `いつも ${patternLabel(s.pattern[day.dow], day)}`;
      // 同じ職種で同じ日に休み・有給を希望している人数
      let others = 0;
      if (m && m.requests) {
        for (const o of db.staff) {
          if (o.id === s.id || !o.roles.some((r) => s.roles.includes(r))) continue;
          const r = m.requests[o.id] && m.requests[o.id][d];
          if (r && (r.type === 'off' || r.type === 'paid')) others++;
        }
      }
      const clickable = editable && st.active && day.kind !== 'closed';
      const cls = ['cal-day', day.dow === 0 || day.holiday ? 'sun' : day.dow === 6 ? 'sat' : '',
        day.kind === 'closed' || !st.active ? 'closed' : '', clickable ? 'clickable' : ''].join(' ');
      cells.push(`<td class="${cls}"${clickable ? ` data-action="edit-request" data-date="${d}"` : ''}>
        <div class="cal-top"><span class="cal-d">${C.parseYmd(d).d}</span>${day.holiday ? `<span class="cal-hol">${esc(day.holiday)}</span>` : ''}</div>
        <div class="cal-base">${esc(base)}</div>
        ${req ? `<div class="chip req-${req.type}">${esc(requestLabel(req, day))}</div>` : ''}
        ${req && req.comment ? `<div class="cal-comment">${esc(req.comment)}</div>` : ''}
        ${others ? `<div class="cal-others">同じ職種の休み希望 ${others}人</div>` : ''}
      </td>`);
    }
    while (cells.length % 7) cells.push('<td class="cal-empty"></td>');
    let rows = '';
    for (let i = 0; i < cells.length; i += 7) rows += `<tr>${cells.slice(i, i + 7).join('')}</tr>`;
    return `<table class="cal"><thead><tr>${C.WEEKDAYS.map((w, i) =>
      `<th class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function openRequestModal(date) {
    const s = staffById(state.input.staffId);
    const ym = state.input.ym;
    const day = C.dayInfo(db, ym, date);
    const m = C.getMonth(db, ym);
    const req = (m.requests[s.id] || {})[date];
    const cur = req ? req.type : 'off';
    const types = day.kind === 'limited' ? ['full', 'am', 'pm', 'time'] : ['off', 'paid', 'full', 'am', 'pm', 'time'];
    const body = `
      <p class="hint">いつもの出勤: ${esc(patternLabel(s.pattern[day.dow], day))}${day.kind === 'limited' ? `（この日は${esc(day.note || '特別診療')}です）` : ''}</p>
      <div class="choices">${types.map((t) => `<label class="choice"><input type="radio" name="type" value="${t}"${t === cur ? ' checked' : ''}><span>${REQUEST_LABELS[t]}</span></label>`).join('')}</div>
      <div class="time-row"><label>時間指定のとき:
        <input type="time" name="start" value="${esc((req && req.start) || day.hours.amStart)}" step="900"> 〜
        <input type="time" name="end" value="${esc((req && req.end) || day.hours.pmEnd)}" step="900"></label></div>
      <label class="block">コメント（任意・管理者に伝えたいこと）
        <input type="text" name="comment" maxlength="60" value="${esc((req && req.comment) || '')}" placeholder="例: 子どもの行事"></label>`;
    openModal(`${C.formatDateJa(date)} の入力`, body, {
      noFocus: true,
      extra: req ? '<button type="button" class="btn danger" data-action="delete-request">この日の入力を取り消す</button>' : '',
      onSave: () => {
        const f = modalForm();
        const type = f.type.value;
        if (type === 'time' && (!f.start.value || !f.end.value || f.start.value >= f.end.value)) {
          alert('時間指定は「開始 < 終了」になるように入れてください。');
          return false;
        }
        m.requests[s.id] = m.requests[s.id] || {};
        const r = { type, comment: f.comment.value.trim(), updatedAt: new Date().toISOString() };
        if (type === 'time') { r.start = f.start.value; r.end = f.end.value; }
        m.requests[s.id][date] = r;
        save();
        return true;
      },
    });
    state.modalDate = date;
  }

  // ---------------------------------------------------------------
  // タブ3: 管理者
  // ---------------------------------------------------------------
  function renderAdmin() {
    if (!state.admin.unlocked) return renderLogin();
    const tabs = [['build', 'シフト作成'], ['staff', 'スタッフ'], ['settings', '設定'], ['backup', 'バックアップ']];
    let reminder = '';
    const last = db.settings.lastBackupAt;
    const age = last ? daysBetween(last.slice(0, 10), todayStr()) : null;
    if (db.staff.length && (age === null || age >= BACKUP_REMIND_DAYS)) {
      reminder = `<div class="banner warn no-print">${age === null ? 'まだバックアップを保存していません。' : `最後のバックアップから${age}日たっています。`}
        PCの故障に備えて「バックアップ」タブから保存してください。</div>`;
    }
    const sub = `<nav class="subtabs no-print">${tabs.map(([k, l]) =>
      `<button type="button" class="${state.admin.tab === k ? 'active' : ''}" data-action="admin-tab" data-tab="${k}">${l}</button>`).join('')}
      <div class="spacer"></div><button type="button" class="btn small" data-action="admin-lock">ロックする</button></nav>`;
    let body = '';
    if (state.admin.tab === 'build') body = renderAdminBuild();
    else if (state.admin.tab === 'staff') body = renderAdminStaff();
    else if (state.admin.tab === 'settings') body = renderAdminSettings();
    else body = renderAdminBackup();
    return reminder + sub + body;
  }

  function renderLogin() {
    if (!db.settings.adminHash) {
      return `<section class="panel narrow"><h2>管理者パスワードの設定</h2>
        <p class="lead">初回だけ、管理者用のパスワードを決めます。スタッフの登録・シフトの作成と確定はこのパスワードで行います。</p>
        <form data-form="set-password" class="stack">
          <label>パスワード（4文字以上）<input type="password" name="pw1" autocomplete="new-password" required minlength="4"></label>
          <label>もう一度<input type="password" name="pw2" autocomplete="new-password" required minlength="4"></label>
          <button type="submit" class="btn primary">設定する</button>
        </form></section>`;
    }
    return `<section class="panel narrow"><h2>管理者ログイン</h2>
      <form data-form="login" class="stack">
        <label>パスワード<input type="password" name="pw" autocomplete="current-password" required autofocus></label>
        <button type="submit" class="btn primary">ログイン</button>
      </form>
      <p class="hint">パスワードを忘れた場合は、README の「パスワードを忘れたとき」を見てください。</p></section>`;
  }

  // --- シフト作成 ---
  function monthStatus(m) {
    if (!m || !m.schedule) return { label: '未作成', cls: 'none' };
    if (m.status === 'fixed') return { label: '確定', cls: 'fixed' };
    return { label: '下書き', cls: 'draft' };
  }

  function renderAdminBuild() {
    const ym = state.admin.ym;
    const m = db.months[ym];
    const today = todayStr();
    const deadline = C.deadlineOf(db.settings, ym);
    const due = C.fixDueOf(ym);
    const st = monthStatus(m);
    if (!db.staff.length) return emptyState();

    if (m && m.schedule && m.status !== 'fixed' && C.fillMissingRows(db, ym)) save();

    const staff = C.staffInMonth(db, ym);
    const reqs = (m && m.requests) || {};
    const newer = m && m.generatedAt ? staff.filter((s) =>
      Object.values(reqs[s.id] || {}).some((r) => r.updatedAt && r.updatedAt > m.generatedAt)) : [];

    const info = `<div class="info-row">
      <span class="status ${st.cls}">${st.label}</span>
      <span>入力締切: ${C.formatDateJa(deadline)}${today > deadline ? '（締切済み）' : `（あと${daysBetween(today, deadline)}日）`}</span>
      <span>確定の期限: ${C.formatDateJa(due)}${st.cls !== 'fixed' && today >= due ? ' <b class="bad">期限を過ぎています</b>' : ''}</span>
      ${m && m.generatedAt ? `<span>下書き作成: ${fmtDateTime(m.generatedAt)}</span>` : ''}
    </div>`;

    let actions = '';
    if (st.cls !== 'fixed') {
      actions += `<button type="button" class="btn primary" data-action="generate">${m && m.schedule ? '下書きを作り直す' : '下書きを自動作成'}</button>`;
      if (m && m.schedule) actions += '<button type="button" class="btn primary" data-action="fix">確定する</button>';
    } else {
      actions += '<button type="button" class="btn" data-action="unfix">確定を解除して修正する</button>';
    }
    if (m && m.schedule) {
      actions += '<button type="button" class="btn" data-action="print">印刷</button>';
      actions += '<button type="button" class="btn" data-action="csv">Excel用に書き出す（CSV）</button>';
    }

    const reqRows = staff.map((s) => {
      const r = reqs[s.id] || {};
      const items = Object.keys(r).sort().map((d) => {
        const day = C.dayInfo(db, ym, d);
        return `<span class="chip req-${r[d].type}" title="${esc(r[d].comment || '')}">${C.parseYmd(d).d}日 ${esc(requestLabel(r[d], day))}${r[d].comment ? '*' : ''}</span>`;
      }).join(' ');
      return `<tr><th>${esc(s.name)}</th><td>${items || '<span class="muted">入力なし</span>'}</td></tr>`;
    }).join('');

    let notes = '';
    if (newer.length && st.cls === 'draft') {
      notes += `<div class="banner warn">下書きを作った後に申請が変わった人がいます（${newer.map((s) => esc(s.name)).join('、')}）。「下書きを作り直す」で反映されます。</div>`;
    }
    if (m && m.notes && m.notes.length && st.cls === 'draft') {
      notes += `<div class="banner warn">${m.notes.map(esc).join('<br>')}</div>`;
    }
    let warnings = '';
    if (m && m.schedule) {
      const w = C.computeStats(db, ym, m.schedule).warnings;
      warnings = w.length
        ? `<details class="warnings" open><summary>確認が必要な点（${w.length}件）</summary><ul>${w.slice(0, 60).map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul></details>`
        : '<div class="banner ok">最少人数・休みの日数・連続勤務の上限はすべて満たしています。</div>';
    }

    const grid = m && m.schedule
      ? `${legendHtml()}${st.cls === 'draft' ? '<p class="hint no-print">マスを押すと修正できます。日付を押すと、休診日や特記事項を設定できます。</p>' : ''}${gridHtml(ym, st.cls === 'draft')}`
      : '<div class="notice">「下書きを自動作成」を押すと、基本パターン・申請・休日の自動割り振りを反映した表ができます。</div>';

    return `<section class="panel">
      <h2 class="print-only">おがわ歯科 シフト表 ${C.formatMonthJa(ym)}</h2>
      <div class="no-print">${monthNav(ym, 'admin-month')}${info}
      <div class="actions">${actions}</div>
      ${notes}${warnings}
      <details class="box"${m && m.schedule ? '' : ' open'}><summary>診療日の設定（休診日・急患対応・特記事項）</summary>${dayStripHtml(ym)}</details>
      <details class="box"><summary>申請の一覧</summary><table class="req-table">${reqRows}</table></details>
      </div>
      ${grid}
    </section>`;
  }

  function dayStripHtml(ym) {
    const dates = C.monthDates(ym);
    const cells = dates.map((d) => {
      const day = C.dayInfo(db, ym, d);
      const kindLabel = day.kind === 'closed' ? '休診' : day.kind === 'limited' ? '急患対応等'
        : !day.pmOpen ? '午前のみ' : !day.amOpen ? '午後のみ' : '';
      const cls = [day.dow === 0 || day.holiday ? 'sun' : day.dow === 6 ? 'sat' : '', day.kind].join(' ');
      return `<button type="button" class="day-btn ${cls}" data-action="edit-day" data-date="${d}">
        <b>${C.parseYmd(d).d}</b>${C.WEEKDAYS[day.dow]}<small>${esc([day.holiday, kindLabel, day.note].filter(Boolean).join(' '))}</small></button>`;
    }).join('');
    return `<p class="hint">日付を押して設定します。祝日は最初から休診になっています。</p><div class="day-strip">${cells}</div>`;
  }

  function openCellModal(sid, date) {
    const ym = state.admin.ym;
    const m = db.months[ym];
    const s = staffById(sid);
    const day = C.dayInfo(db, ym, date);
    const c = m.schedule[sid][date];
    const req = m.requests && m.requests[sid] && m.requests[sid][date];
    const body = `
      ${req ? `<p class="banner info">本人の申請: <b>${esc(requestLabel(req, day))}</b>${req.comment ? `「${esc(req.comment)}」` : ''}</p>` : ''}
      <p class="hint">今の内容: ${esc(C.cellLabel(c, day) || '空欄')}（${SRC_LABELS[c.src] || ''}）</p>
      <div class="choices">${Object.keys(TYPE_LABELS).map((t) =>
        `<label class="choice"><input type="radio" name="type" value="${t}"${t === c.type ? ' checked' : ''}><span>${TYPE_LABELS[t]}</span></label>`).join('')}</div>
      <div class="time-row"><label>時間指定のとき:
        <input type="time" name="start" value="${esc(c.start || day.hours.amStart)}" step="900"> 〜
        <input type="time" name="end" value="${esc(c.end || day.hours.pmEnd)}" step="900"></label></div>
      <label class="block">表に表示する文字（任意）
        <input type="text" name="note" maxlength="12" value="${esc(c.note || '')}" placeholder="例: セミナー、北九州"></label>
      <p class="hint">入力すると、記号の代わりにこの文字を表に表示します。人数の数え方は上で選んだ種類に従います。</p>`;
    openModal(`${s.name} ${C.formatDateJa(date)}`, body, {
      noFocus: true,
      onSave: () => {
        const f = modalForm();
        const type = f.type.value;
        if (type === 'time' && (!f.start.value || !f.end.value || f.start.value >= f.end.value)) {
          alert('時間指定は「開始 < 終了」になるように入れてください。');
          return false;
        }
        const cell = { type, src: 'manual' };
        if (type === 'time') { cell.start = f.start.value; cell.end = f.end.value; }
        if (f.note.value.trim()) cell.note = f.note.value.trim();
        m.schedule[sid][date] = cell;
        save();
        return true;
      },
    });
  }

  function openDayModal(date) {
    const ym = state.admin.ym;
    const m = C.getMonth(db, ym);
    const day = C.dayInfo(db, ym, date);
    const cur = day.kind === 'closed' ? 'closed' : day.kind === 'limited' ? 'limited'
      : !day.pmOpen ? 'am' : !day.amOpen ? 'pm' : 'open';
    const kinds = [
      ['open', '通常の診療'], ['am', '午前のみ診療'], ['pm', '午後のみ診療'], ['closed', '休診'],
      ['limited', '急患対応など（人数チェックなし・出勤者は手で入れる）'],
    ];
    const body = `
      ${day.holiday ? `<p class="hint">この日は祝日（${esc(day.holiday)}）です。祝日は最初から休診になっています。</p>` : ''}
      <div class="choices one-col">${kinds.map(([k, l]) =>
        `<label class="choice"><input type="radio" name="kind" value="${k}"${k === cur ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <label class="block">特記事項（表の左に表示）
        <input type="text" name="note" maxlength="30" value="${esc(day.note)}" placeholder="例: 勉強会、保育園健診、院長不在"></label>
      ${m.schedule ? '<p class="hint">診療の種類を変えると、この日のマスを作り直します（手で直したマスと自動の休みは残ります）。</p>' : ''}`;
    openModal(`${C.formatDateJa(date)} の診療`, body, {
      noFocus: true,
      onSave: () => {
        const f = modalForm();
        const k = f.kind.value;
        const note = f.note.value.trim();
        const defKind = day.holiday ? 'closed' : 'open';
        let ov = {};
        if (k === 'am') ov = { kind: 'open', pmOpen: false };
        else if (k === 'pm') ov = { kind: 'open', amOpen: false };
        else if (k !== defKind) ov = { kind: k };
        if (note) ov.note = note;
        if (Object.keys(ov).length) m.days[date] = ov;
        else delete m.days[date];
        // 特記事項だけの変更ならマスは作り直さない
        if (k !== cur && m.schedule && m.status !== 'fixed') C.rebuildDate(db, ym, date);
        save();
        return true;
      },
    });
  }

  // --- スタッフ ---
  function staffStateToday(s) {
    const st = C.staffStateOn(s, todayStr());
    return st.active ? '在籍' : st.label;
  }

  function patternSummary(s) {
    const day = { hours: db.settings.hours.weekday };
    return s.pattern.map((p, i) => `${C.WEEKDAYS[i]}${patternLabel(p, day)}`).join(' ');
  }

  function renderAdminStaff() {
    const list = C.sortStaff(db.staff);
    const rows = list.map((s) => `<tr class="${staffStateToday(s) === '退職' ? 'muted' : ''}">
      <td class="nowrap"><button type="button" class="btn tiny" data-action="staff-move" data-sid="${s.id}" data-delta="-1" title="上へ">▲</button>
        <button type="button" class="btn tiny" data-action="staff-move" data-sid="${s.id}" data-delta="1" title="下へ">▼</button></td>
      <td><b>${esc(s.name)}</b></td><td>${esc(roleText(s))}</td>
      <td>${s.employment === 'full' ? '常勤' : 'パート・非常勤'}</td>
      <td class="pattern">${esc(patternSummary(s))}</td>
      <td>${esc(s.joinDate)}</td><td>${esc(s.leaveDate)}</td><td>${esc(staffStateToday(s))}</td>
      <td><button type="button" class="btn small" data-action="staff-edit" data-sid="${s.id}">編集</button></td></tr>`).join('');
    return `<section class="panel">
      <div class="actions"><button type="button" class="btn primary" data-action="staff-add">スタッフを追加</button></div>
      <p class="hint">並び順はシフト表の列の順番です（職種ごと）。退職した人は削除せず「退職日」を入れてください。過去のシフト表に名前が残ります。</p>
      <div class="table-scroll"><table class="list"><thead><tr><th>順番</th><th>名前</th><th>職種</th><th>雇用</th><th>基本パターン</th><th>入職日</th><th>退職日</th><th>今日の状態</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="muted">まだ登録されていません</td></tr>'}</tbody></table></div>
    </section>`;
  }

  function openStaffModal(sid) {
    const s = sid ? staffById(sid) : C.normalizeStaff({ name: ' ', roles: ['DH'], employment: 'full' }, db.staff.length);
    const isNew = !sid;
    const day = { hours: db.settings.hours.weekday };
    const absRows = (s.absences || []).map((a) => absenceRow(a)).join('');
    const body = `
      <label class="block">名前（表に出る短い名前。例: 田中Dr、田中花）<input type="text" name="name" maxlength="10" value="${esc(isNew ? '' : s.name)}" required></label>
      <fieldset><legend>職種（兼任は複数選ぶ）</legend><div class="choices">
        ${C.ROLES.map((r) => `<label class="choice"><input type="checkbox" name="roles" value="${r}"${s.roles.includes(r) ? ' checked' : ''}><span>${C.ROLE_NAMES[r]}（${r}）</span></label>`).join('')}
      </div></fieldset>
      <fieldset><legend>雇用</legend><div class="choices one-col">
        <label class="choice"><input type="radio" name="employment" value="full"${s.employment === 'full' ? ' checked' : ''}><span>常勤（祝日以外に月${db.settings.requiredOffDays}日の休みを自動で割り振る）</span></label>
        <label class="choice"><input type="radio" name="employment" value="part"${s.employment !== 'full' ? ' checked' : ''}><span>パート・非常勤（基本パターンどおりに出勤。自動の休みはなし）</span></label>
      </div></fieldset>
      <fieldset><legend>基本パターン（いつもの出勤）</legend>
        <p class="hint">常勤は「〇 終日」が基本です。毎週決まった休みがあれば「× 固定休」にします。</p>
        <table class="pattern-table">${s.pattern.map((p, i) => `<tr><th>${C.WEEKDAYS[i]}</th><td>
          <select name="p${i}">${Object.entries(PATTERN_LABELS).map(([k, l]) => `<option value="${k}"${p.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
          <td><input type="time" name="ps${i}" value="${esc(p.start || day.hours.amStart)}" step="900"> 〜 <input type="time" name="pe${i}" value="${esc(p.end || day.hours.pmEnd)}" step="900"></td></tr>`).join('')}
        </table><p class="hint">時刻は「時間指定」を選んだ曜日だけ使います。</p></fieldset>
      <div class="two-col">
        <label class="block">入職日<input type="date" name="joinDate" value="${esc(s.joinDate)}"></label>
        <label class="block">退職日（最後の勤務日）<input type="date" name="leaveDate" value="${esc(s.leaveDate)}"></label>
      </div>
      <fieldset><legend>産休・育休・休職の期間</legend>
        <div id="absences">${absRows}</div>
        <button type="button" class="btn small" data-action="absence-add">期間を追加</button>
      </fieldset>`;
    openModal(isNew ? 'スタッフを追加' : `${s.name} さんの編集`, body, {
      extra: isNew ? '' : `<button type="button" class="btn danger" data-action="staff-delete" data-sid="${s.id}">削除</button>`,
      onSave: () => {
        const f = modalForm();
        const name = f.name.value.trim();
        const roles = [...f.querySelectorAll('input[name=roles]:checked')].map((x) => x.value);
        if (!name) { alert('名前を入れてください。'); return false; }
        if (!roles.length) { alert('職種を1つ以上選んでください。'); return false; }
        if (db.staff.some((o) => o.name === name && o.id !== s.id)) { alert('同じ名前の人がいます。区別できる名前にしてください（例: 田中花・田中由）。'); return false; }
        const pattern = C.WEEKDAYS.map((w, i) => {
          const type = f[`p${i}`].value;
          const p = { type };
          if (type === 'time') {
            p.start = f[`ps${i}`].value;
            p.end = f[`pe${i}`].value;
          }
          return p;
        });
        const bad = pattern.findIndex((p) => p.type === 'time' && (!p.start || !p.end || p.start >= p.end));
        if (bad >= 0) { alert(`${C.WEEKDAYS[bad]}曜の時間指定を「開始 < 終了」にしてください。`); return false; }
        const absences = [...f.querySelectorAll('.absence-row')].map((row) => ({
          type: row.querySelector('select').value,
          from: row.querySelector('[data-k=from]').value,
          to: row.querySelector('[data-k=to]').value,
        })).filter((a) => a.from);
        if (f.joinDate.value && f.leaveDate.value && f.leaveDate.value < f.joinDate.value) {
          alert('退職日が入職日より前になっています。'); return false;
        }
        const updated = Object.assign(s, {
          name, roles, pattern, absences,
          employment: f.employment.value,
          joinDate: f.joinDate.value,
          leaveDate: f.leaveDate.value,
        });
        if (isNew) {
          updated.id = C.newId();
          updated.order = Math.max(-1, ...db.staff.map((x) => x.order)) + 1;
          db.staff.push(updated);
        }
        save();
        flash(`${name} さんを保存しました。`);
        return true;
      },
    });
  }

  function absenceRow(a) {
    return `<div class="absence-row">
      <select>${C.ABSENCE_TYPES.map((t) => `<option${a.type === t ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <input type="date" data-k="from" value="${esc(a.from || '')}"> 〜 <input type="date" data-k="to" value="${esc(a.to || '')}">
      <button type="button" class="btn tiny" data-action="absence-remove">削除</button></div>`;
  }

  // --- 設定 ---
  function renderAdminSettings() {
    const s = db.settings;
    const hoursRow = (key, label) => {
      const h = s.hours[key];
      return `<tr><th>${label}</th>
        <td><input type="time" name="${key}-amStart" value="${h.amStart}" step="900"> 〜 <input type="time" name="${key}-amEnd" value="${h.amEnd}" step="900"></td>
        <td><input type="time" name="${key}-pmStart" value="${h.pmStart}" step="900"> 〜 <input type="time" name="${key}-pmEnd" value="${h.pmEnd}" step="900"></td></tr>`;
    };
    return `<section class="panel">
      <form data-form="settings" class="stack">
        <h2>最少人数</h2>
        <p class="hint">この人数を下回らないように休みを割り振ります。下回る日は表の人数欄が赤くなります。
          「1日に1人以上」は、午前か午後のどちらかにいればよい職種（例: CS）に使います。</p>
        <table class="min-table"><thead><tr><th>職種</th><th>人数</th><th>数え方</th></tr></thead><tbody>
        ${C.ROLES.map((r) => `<tr><th>${C.ROLE_NAMES[r]}（${r}）</th>
          <td><input type="number" name="min-${r}" min="0" max="20" value="${s.minStaff[r] || 0}" aria-label="${C.ROLE_NAMES[r]}の最少人数"></td>
          <td><select name="mode-${r}" aria-label="${C.ROLE_NAMES[r]}の数え方">
            <option value="half"${s.minMode[r] !== 'day' ? ' selected' : ''}>午前・午後それぞれ</option>
            <option value="day"${s.minMode[r] === 'day' ? ' selected' : ''}>1日に1人以上（午前か午後）</option>
          </select></td></tr>`).join('')}
        </tbody></table>
        <h2>休みと締切</h2>
        <div class="min-grid">
          <label>常勤の月の休み（祝日を除く）<input type="number" name="requiredOffDays" min="0" max="20" step="0.5" value="${s.requiredOffDays}"></label>
          <label>連続勤務の上限（日）<input type="number" name="maxConsecutive" min="2" max="14" value="${s.maxConsecutive}"></label>
          <label>申請の締切（前々月の何日）<input type="number" name="deadlineDay" min="1" max="31" value="${s.deadlineDay}"></label>
        </div>
        <h2>診療時間</h2>
        <p class="hint">「17時まで」などの時間指定が、午前・午後のどちらに入るかの判定に使います。</p>
        <table class="hours-table"><thead><tr><th></th><th>午前</th><th>午後</th></tr></thead><tbody>
          ${hoursRow('weekday', '平日')}${hoursRow('sat', '土曜')}${hoursRow('sun', '日曜')}
        </tbody></table>
        <div><button type="submit" class="btn primary">設定を保存</button></div>
      </form>
    </section>
    <section class="panel narrow">
      <h2>管理者パスワードの変更</h2>
      <form data-form="change-password" class="stack">
        <label>今のパスワード<input type="password" name="old" autocomplete="current-password" required></label>
        <label>新しいパスワード（4文字以上）<input type="password" name="pw1" autocomplete="new-password" required minlength="4"></label>
        <label>もう一度<input type="password" name="pw2" autocomplete="new-password" required minlength="4"></label>
        <button type="submit" class="btn">変更する</button>
      </form>
    </section>`;
  }

  // --- バックアップ ---
  function renderAdminBackup() {
    const last = db.settings.lastBackupAt;
    return `<section class="panel narrow">
      <h2>バックアップを保存</h2>
      <p>データはこのPCのブラウザの中にだけあります。PCの故障やブラウザの履歴削除で消えるため、ファイルに保存しておきます。</p>
      <p class="hint">おすすめ: シフトを確定したときと、2週間に1回。保存したファイルはUSBメモリなどPC以外にも置いてください。</p>
      <p>前回の保存: <b>${last ? fmtDateTime(last) : 'まだありません'}</b></p>
      <button type="button" class="btn primary" data-action="backup-save">バックアップをファイルに保存</button>
    </section>
    <section class="panel narrow">
      <h2>バックアップから復元</h2>
      <p>保存したファイル（.json）を選ぶと、今のデータをそのファイルの内容に置き換えます。初期データ（スタッフ一覧）のファイルもここから読み込めます。</p>
      <input type="file" accept=".json,application/json" data-action-change="backup-load">
    </section>`;
  }

  // ---------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------
  function render() {
    document.querySelectorAll('.tabs [data-tab]').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === state.tab));
    let html = '';
    if (storageError) html += `<div class="banner error no-print">${esc(storageError)}</div>`;
    if (state.flash) {
      html += `<div class="banner ${state.flash.kind} no-print">${esc(state.flash.text)}</div>`;
      state.flash = null;
    }
    if (state.tab === 'view') html += renderView();
    else if (state.tab === 'input') html += renderInput();
    else html += renderAdmin();
    $app.innerHTML = html;
  }

  // ---------------------------------------------------------------
  // 操作
  // ---------------------------------------------------------------
  const actions = {
    tab(el) {
      state.tab = el.dataset.tab;
      state.input.staffId = null; // 共有PCなので、タブを移ったら名前の選択を解除する
      render();
    },
    'view-month'(el) {
      state.viewYm = C.shiftYm(state.viewYm, Number(el.dataset.delta));
      render();
    },
    'pick-staff'(el) {
      state.input.staffId = el.dataset.sid;
      state.input.ym = C.firstOpenMonth(db.settings, todayStr());
      render();
    },
    'input-done'() {
      state.input.staffId = null;
      render();
    },
    'input-month'(el) {
      state.input.ym = el.dataset.ym;
      render();
    },
    'edit-request'(el) {
      openRequestModal(el.dataset.date);
    },
    'delete-request'() {
      const m = db.months[state.input.ym];
      const r = m && m.requests[state.input.staffId];
      if (r) delete r[state.modalDate];
      save();
      closeModal();
      render();
    },
    'admin-tab'(el) {
      state.admin.tab = el.dataset.tab;
      render();
    },
    'admin-lock'() {
      state.admin.unlocked = false;
      render();
    },
    'admin-month'(el) {
      state.admin.ym = C.shiftYm(state.admin.ym, Number(el.dataset.delta));
      render();
    },
    generate() {
      const ym = state.admin.ym;
      const m = C.getMonth(db, ym);
      const run = (keepManual) => {
        const res = C.generateSchedule(db, ym, { keepManual });
        m.schedule = res.schedule;
        m.notes = res.notes;
        m.status = 'draft';
        m.generatedAt = new Date().toISOString();
        save();
        flash('下書きを作成しました。表を確認して、必要ならマスを押して修正してください。');
      };
      if (!m.schedule) { run(true); render(); return; }
      openModal('下書きを作り直す', `<p>今の下書きを作り直します。自動で割り振った休みは入れ替わります。</p>
        <label class="choice"><input type="checkbox" name="keep" checked><span>手で直したマス（太枠）は残す</span></label>`, {
        saveLabel: '作り直す',
        noFocus: true,
        onSave: () => { run(modalForm().keep.checked); return true; },
      });
    },
    fix() {
      const ym = state.admin.ym;
      const m = db.months[ym];
      const w = C.computeStats(db, ym, m.schedule).warnings;
      confirmModal('シフトを確定する', `${C.formatMonthJa(ym)}のシフトを確定します。確定すると「シフト表」タブに公開され、スタッフの入力は締め切られます。` +
        (w.length ? `<br><b class="bad">確認が必要な点が${w.length}件残っています。</b>` : ''), '確定する', () => {
        m.status = 'fixed';
        m.fixedAt = new Date().toISOString();
        save();
        flash(`${C.formatMonthJa(ym)}のシフトを確定しました。バックアップの保存もおすすめします。`);
        return true;
      });
    },
    unfix() {
      const m = db.months[state.admin.ym];
      m.status = 'draft';
      save();
      render();
    },
    print() {
      window.print();
    },
    csv() {
      const ym = state.admin.ym;
      download(`シフト表_${ym}.csv`, C.toCSV(db, ym), 'text/csv;charset=utf-8');
    },
    'edit-cell'(el) {
      openCellModal(el.dataset.sid, el.dataset.date);
    },
    'edit-day'(el) {
      openDayModal(el.dataset.date);
    },
    'staff-add'() {
      openStaffModal(null);
    },
    'staff-edit'(el) {
      openStaffModal(el.dataset.sid);
    },
    'staff-move'(el) {
      const s = staffById(el.dataset.sid);
      const group = C.sortStaff(db.staff.filter((x) => C.primaryRole(x) === C.primaryRole(s)));
      const i = group.indexOf(s);
      const j = i + Number(el.dataset.delta);
      if (j < 0 || j >= group.length) return;
      group.splice(i, 1);
      group.splice(j, 0, s);
      const orders = group.map((x) => x.order).sort((a, b) => a - b);
      // 同じ順番の値が重なっていたら振り直す
      const unique = new Set(orders).size === orders.length ? orders : orders.map((o, k) => orders[0] + k);
      group.forEach((x, k) => { x.order = unique[k]; });
      save();
      render();
    },
    'staff-delete'(el) {
      const s = staffById(el.dataset.sid);
      confirmModal('スタッフの削除', `${esc(s.name)} さんを削除します。過去のシフト表からもこの人の列が消えます。<br>退職した人は削除せず「退職日」を入れることをおすすめします。`, '削除する', () => {
        db.staff = db.staff.filter((x) => x.id !== s.id);
        save();
        flash(`${s.name} さんを削除しました。`);
        return true;
      }, true);
    },
    'absence-add'() {
      document.getElementById('absences').insertAdjacentHTML('beforeend', absenceRow({ type: '育休' }));
    },
    'absence-remove'(el) {
      el.closest('.absence-row').remove();
    },
    'backup-save'() {
      db.settings.lastBackupAt = new Date().toISOString();
      save();
      download(`シフト管理バックアップ_${todayStr()}.json`, JSON.stringify(db, null, 1), 'application/json');
      flash('バックアップを保存しました（ブラウザの「ダウンロード」フォルダに入ります）。');
      render();
    },
    'modal-close'() {
      closeModal();
    },
    'modal-backdrop'(el, e) {
      if (e.target === el) closeModal();
    },
    'modal-save'() {
      if (state.modalSave && state.modalSave() === false) return;
      closeModal();
      render();
    },
  };

  const forms = {
    'set-password'(f) {
      if (f.pw1.value !== f.pw2.value) { alert('2回のパスワードが一致しません。'); return; }
      db.settings.adminHash = C.hashPassword(f.pw1.value);
      save();
      state.admin.unlocked = true;
      render();
    },
    login(f) {
      if (C.hashPassword(f.pw.value) !== db.settings.adminHash) { alert('パスワードが違います。'); return; }
      state.admin.unlocked = true;
      render();
    },
    'change-password'(f) {
      if (C.hashPassword(f.old.value) !== db.settings.adminHash) { alert('今のパスワードが違います。'); return; }
      if (f.pw1.value !== f.pw2.value) { alert('新しいパスワードが一致しません。'); return; }
      db.settings.adminHash = C.hashPassword(f.pw1.value);
      save();
      flash('パスワードを変更しました。');
      render();
    },
    settings(f) {
      const s = db.settings;
      for (const r of C.ROLES) {
        s.minStaff[r] = Math.max(0, Number(f[`min-${r}`].value) || 0);
        s.minMode[r] = f[`mode-${r}`].value === 'day' ? 'day' : 'half';
      }
      s.requiredOffDays = Math.max(0, Number(f.requiredOffDays.value) || 0);
      s.maxConsecutive = Math.max(2, Number(f.maxConsecutive.value) || 5);
      s.deadlineDay = Math.min(31, Math.max(1, Number(f.deadlineDay.value) || 25));
      for (const key of ['weekday', 'sat', 'sun']) {
        for (const part of ['amStart', 'amEnd', 'pmStart', 'pmEnd']) {
          const v = f[`${key}-${part}`].value;
          if (v) s.hours[key][part] = v;
        }
      }
      save();
      flash('設定を保存しました。作成済みの下書きに反映するには「下書きを作り直す」を押してください。');
      render();
    },
    modal() {
      actions['modal-save']();
    },
  };

  function loadBackupFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = C.normalizeData(JSON.parse(reader.result));
      } catch (e) {
        alert('このファイルは読み込めません。シフト管理のバックアップファイル（.json）を選んでください。');
        return;
      }
      confirmModal('バックアップから復元', `「${esc(file.name)}」を読み込みます（スタッフ${data.staff.length}人、シフト${Object.keys(data.months).length}か月分）。<br>今のデータは置き換わります。`, '復元する', () => {
        if (!data.settings.adminHash) data.settings.adminHash = db.settings.adminHash;
        db = data;
        save();
        storageError = '';
        flash('復元しました。');
        return true;
      });
    };
    reader.readAsText(file);
  }

  document.addEventListener('click', (e) => {
    state.lastActive = Date.now();
    const el = e.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    if (el.tagName === 'LABEL' || el.tagName === 'INPUT') return;
    actions[el.dataset.action](el, e);
  });
  document.addEventListener('keydown', (e) => {
    state.lastActive = Date.now();
    if (e.key === 'Escape' && $modal.innerHTML) closeModal();
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    if (forms[f.dataset.form]) forms[f.dataset.form](f);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.closest && el.closest('#modal-root')) syncTimeInputs();
    if (el.dataset && el.dataset.actionChange === 'backup-load' && el.files && el.files[0]) {
      loadBackupFile(el.files[0]);
      el.value = '';
    }
  });

  // 一定時間操作がなければ、管理者をロックし、入力画面を名前選択に戻す
  setInterval(() => {
    const idle = Date.now() - state.lastActive;
    let changed = false;
    if (state.admin.unlocked && idle > ADMIN_TIMEOUT_MS) { state.admin.unlocked = false; changed = true; }
    if (state.input.staffId && idle > INPUT_TIMEOUT_MS) { state.input.staffId = null; changed = true; }
    if (changed) { closeModal(); render(); }
  }, 30000);

  // ---------------------------------------------------------------
  // 起動
  // ---------------------------------------------------------------
  // パスワードを忘れたとき: index.html#reset-admin で開くと再設定できる（README 参照）
  function checkResetHash() {
    if (location.hash !== '#reset-admin') return;
    history.replaceState(null, '', location.pathname);
    if (db.settings.adminHash && window.confirm('管理者パスワードを消して、設定し直しますか？')) {
      db.settings.adminHash = null;
      state.admin.unlocked = false;
      save();
      state.tab = 'admin';
    }
    render();
  }
  window.addEventListener('hashchange', checkResetHash);

  load();
  const today = todayStr();
  const firstOpen = C.firstOpenMonth(db.settings, today);
  state.viewYm = C.ymOfDate(today);
  state.input.ym = firstOpen;
  state.admin.ym = C.shiftYm(firstOpen, -1); // 締切を過ぎて、これから作る月
  render();
  checkResetHash();
})();
