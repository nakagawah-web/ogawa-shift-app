/*
 * おがわ歯科 シフト管理 — 計算ロジック（画面に依存しない部分）
 * ブラウザでは window.ShiftCore、Node.js（テスト）では require('./core.js') で使う。
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------
  // 定数
  // ---------------------------------------------------------------
  const ROLES = ['Dr', 'DH', 'DA', '受付', 'CS', 'DT'];
  const ROLE_NAMES = {
    Dr: '歯科医師', DH: '歯科衛生士', DA: '歯科助手',
    受付: '受付', CS: 'クリーンスタッフ', DT: '歯科技工士',
  };
  const ROLE_SHORT = { Dr: 'Dr', DH: 'DH', DA: 'DA', 受付: '受', CS: 'CS', DT: 'DT' };
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const ABSENCE_TYPES = ['産休', '育休', '休職', 'その他'];
  const WORK_TYPES = ['full', 'am', 'pm', 'time'];
  const CELL_SYMBOLS = {
    full: '〇', am: 'AM', pm: 'PM', off: '×', paid: '有給', event: '研修', na: 'ー',
  };

  // ---------------------------------------------------------------
  // 日付（すべて 'YYYY-MM-DD' / 'YYYY-MM' の文字列で扱う）
  // ---------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const ymKey = (y, m) => `${y}-${pad(m)}`;

  function parseYmd(s) {
    const [y, m, d] = s.split('-').map(Number);
    return { y, m, d };
  }
  function parseYm(k) {
    const [y, m] = k.split('-').map(Number);
    return { y, m };
  }
  function dowOf(y, m, d) {
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  function dowOfDate(s) {
    const { y, m, d } = parseYmd(s);
    return dowOf(y, m, d);
  }
  function addDays(s, n) {
    const { y, m, d } = parseYmd(s);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function shiftYm(k, n) {
    const { y, m } = parseYm(k);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    return ymKey(t.getUTCFullYear(), t.getUTCMonth() + 1);
  }
  function monthDates(k) {
    const { y, m } = parseYm(k);
    return Array.from({ length: daysInMonth(y, m) }, (_, i) => ymd(y, m, i + 1));
  }
  function ymOfDate(s) {
    return s.slice(0, 7);
  }
  function formatMonthJa(k) {
    const { y, m } = parseYm(k);
    return `${y}年${m}月`;
  }
  function formatDateJa(s, withDow = true) {
    const { m, d } = parseYmd(s);
    return withDow ? `${m}月${d}日（${WEEKDAYS[dowOfDate(s)]}）` : `${m}月${d}日`;
  }
  function toMin(t) {
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + (m || 0);
  }

  // ---------------------------------------------------------------
  // 祝日（1980〜2099年の計算式。春分・秋分は国立天文台の近似式）
  // ---------------------------------------------------------------
  const holidayCache = {};

  function nthMonday(y, m, n) {
    const first = dowOf(y, m, 1);
    return 1 + ((8 - first) % 7) + (n - 1) * 7;
  }
  function vernalEquinoxDay(y) {
    return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }
  function autumnalEquinoxDay(y) {
    return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }

  function holidaysOfYear(y) {
    if (holidayCache[y]) return holidayCache[y];
    const h = {};
    const add = (m, d, name) => { h[ymd(y, m, d)] = name; };
    add(1, 1, '元日');
    add(1, nthMonday(y, 1, 2), '成人の日');
    add(2, 11, '建国記念の日');
    add(2, 23, '天皇誕生日');
    add(3, vernalEquinoxDay(y), '春分の日');
    add(4, 29, '昭和の日');
    add(5, 3, '憲法記念日');
    add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');
    add(7, nthMonday(y, 7, 3), '海の日');
    add(8, 11, '山の日');
    add(9, nthMonday(y, 9, 3), '敬老の日');
    add(9, autumnalEquinoxDay(y), '秋分の日');
    add(10, nthMonday(y, 10, 2), 'スポーツの日');
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');

    // 国民の休日: 祝日にはさまれた平日
    for (const s of Object.keys(h).sort()) {
      const mid = addDays(s, 1);
      if (!h[mid] && h[addDays(s, 2)] && dowOfDate(mid) !== 0) h[mid] = '国民の休日';
    }
    // 振替休日: 祝日が日曜なら、その後の最初の祝日でない日
    for (const s of Object.keys(h).sort()) {
      if (dowOfDate(s) !== 0 || h[s] === '国民の休日') continue;
      let t = addDays(s, 1);
      while (h[t]) t = addDays(t, 1);
      h[t] = '振替休日';
    }
    holidayCache[y] = h;
    return h;
  }

  function holidayName(s) {
    return holidaysOfYear(parseYmd(s).y)[s] || null;
  }

  // ---------------------------------------------------------------
  // データの初期値
  // ---------------------------------------------------------------
  function defaultSettings() {
    return {
      adminHash: null,
      minStaff: { Dr: 1, DH: 2, DA: 1, 受付: 1, CS: 1, DT: 0 },
      // 最少人数の数え方: 'half' = 午前・午後それぞれ / 'day' = 1日のうちどこかにいればよい
      minMode: { Dr: 'half', DH: 'half', DA: 'half', 受付: 'half', CS: 'day', DT: 'half' },
      requiredOffDays: 8,
      maxConsecutive: 5,
      deadlineDay: 25,
      deadlineMonthsBefore: 2,
      hours: {
        weekday: { amStart: '09:00', amEnd: '13:00', pmStart: '14:30', pmEnd: '18:00' },
        sat: { amStart: '09:00', amEnd: '13:00', pmStart: '14:30', pmEnd: '18:00' },
        sun: { amStart: '09:00', amEnd: '12:00', pmStart: '13:30', pmEnd: '17:00' },
      },
      lastBackupAt: null,
    };
  }

  function defaultData() {
    return { app: 'ogawa-shift', version: 1, settings: defaultSettings(), staff: [], months: {} };
  }

  // バックアップ読み込み時などに、足りない項目を初期値で補う
  function normalizeData(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.staff)) {
      throw new Error('シフト管理のデータではありません');
    }
    const base = defaultData();
    const settings = Object.assign(base.settings, raw.settings || {});
    settings.minStaff = Object.assign(defaultSettings().minStaff, (raw.settings || {}).minStaff || {});
    settings.minMode = Object.assign(defaultSettings().minMode, (raw.settings || {}).minMode || {});
    settings.hours = Object.assign(defaultSettings().hours, (raw.settings || {}).hours || {});
    const staff = raw.staff.map((s, i) => normalizeStaff(s, i));
    const months = {};
    for (const [k, m] of Object.entries(raw.months || {})) {
      months[k] = Object.assign({ days: {}, requests: {}, schedule: null, status: 'none' }, m);
    }
    return { app: 'ogawa-shift', version: 1, settings, staff, months };
  }

  function defaultPattern(employment) {
    return WEEKDAYS.map(() => ({ type: employment === 'full' ? 'full' : 'na' }));
  }

  function normalizeStaff(s, i) {
    const employment = s.employment === 'full' ? 'full' : 'part';
    const roles = (s.roles || []).filter((r) => ROLES.includes(r));
    const pattern = Array.isArray(s.pattern) && s.pattern.length === 7 ? s.pattern : defaultPattern(employment);
    return {
      id: s.id || newId(),
      name: String(s.name || '').trim() || `スタッフ${i + 1}`,
      roles: roles.length ? roles : ['DA'],
      employment,
      joinDate: s.joinDate || '',
      leaveDate: s.leaveDate || '',
      absences: Array.isArray(s.absences) ? s.absences : [],
      pattern,
      order: typeof s.order === 'number' ? s.order : i,
    };
  }

  function newId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getMonth(data, ym) {
    if (!data.months[ym]) data.months[ym] = { days: {}, requests: {}, schedule: null, status: 'none' };
    return data.months[ym];
  }

  // ---------------------------------------------------------------
  // 締切
  // ---------------------------------------------------------------
  // 例: 11月分の締切 = 9月25日（前々月の25日）
  function deadlineOf(settings, ym) {
    const src = shiftYm(ym, -(settings.deadlineMonthsBefore || 2));
    const { y, m } = parseYm(src);
    return ymd(y, m, Math.min(settings.deadlineDay || 25, daysInMonth(y, m)));
  }
  // 確定の期限 = 前月1日（1か月前には決める）
  function fixDueOf(ym) {
    return shiftYm(ym, -1) + '-01';
  }
  function isInputOpen(settings, ym, today) {
    return today <= deadlineOf(settings, ym);
  }
  // 今日の時点で入力を受け付けている最初の月
  function firstOpenMonth(settings, today) {
    let ym = shiftYm(ymOfDate(today), 1);
    for (let i = 0; i < 24 && !isInputOpen(settings, ym, today); i++) ym = shiftYm(ym, 1);
    return ym;
  }

  // ---------------------------------------------------------------
  // 日の情報（診療日・休診日・祝日）
  // ---------------------------------------------------------------
  function hoursFor(settings, dow) {
    if (dow === 0) return settings.hours.sun;
    if (dow === 6) return settings.hours.sat;
    return settings.hours.weekday;
  }

  // kind: 'open'（通常診療）/ 'closed'（休診）/ 'limited'（急患対応など。人数チェック・基本パターンなし）
  function dayInfo(data, ym, date) {
    const dow = dowOfDate(date);
    const holiday = holidayName(date);
    const m = data.months[ym];
    const ov = (m && m.days && m.days[date]) || {};
    let kind = ov.kind || (holiday ? 'closed' : 'open');
    let amOpen = kind !== 'closed' && ov.amOpen !== false;
    let pmOpen = kind !== 'closed' && ov.pmOpen !== false;
    if (!amOpen && !pmOpen) kind = 'closed';
    return {
      date, dow, holiday, kind, amOpen, pmOpen,
      note: ov.note || '',
      hours: hoursFor(data.settings, dow),
    };
  }

  // ---------------------------------------------------------------
  // マスの意味（出勤しているか・何日分の休みか）
  // ---------------------------------------------------------------
  function presence(cell, day) {
    const r = { am: false, pm: false };
    if (!cell) return r;
    const h = day.hours;
    switch (cell.type) {
      case 'full': r.am = true; r.pm = true; break;
      case 'am': r.am = true; break;
      case 'pm': r.pm = true; break;
      case 'time': {
        const s = toMin(cell.start || '00:00');
        const e = toMin(cell.end || '23:59');
        r.am = s < toMin(h.amEnd) && e > toMin(h.amStart);
        r.pm = s < toMin(h.pmEnd) && e > toMin(h.pmStart);
        break;
      }
      default: break;
    }
    r.am = r.am && day.amOpen;
    r.pm = r.pm && day.pmOpen;
    return r;
  }

  // 出勤量（1 = 終日、0.5 = 半日）。研修・セミナーは出勤扱い
  function workUnits(cell, day) {
    if (!cell) return 0;
    if (cell.type === 'event') return 1;
    const p = presence(cell, day);
    return (p.am ? 0.5 : 0) + (p.pm ? 0.5 : 0);
  }

  // 常勤の「月8日の休み」に数える量。祝日・有給・在籍外は数えない。休診日・半日勤務は数える
  function offUnits(cell, day) {
    if (day.holiday) return 0;
    if (!cell || cell.src === 'out' || cell.type === 'paid') return 0;
    return 1 - workUnits(cell, day);
  }

  function isRest(cell, day) {
    return workUnits(cell, day) === 0;
  }

  // 半日だけ診療する日に合わせて、出勤マスを整える
  function normalizeForDay(cell, day) {
    if (!WORK_TYPES.includes(cell.type)) return cell;
    const p = presence(cell, day);
    if (!p.am && !p.pm) return Object.assign({}, cell, { type: 'na' });
    if (cell.type === 'full' && p.am && !p.pm) return Object.assign({}, cell, { type: 'am' });
    if (cell.type === 'full' && !p.am && p.pm) return Object.assign({}, cell, { type: 'pm' });
    return cell;
  }

  function formatTime(t) {
    const [h, m] = String(t).split(':').map(Number);
    return m ? `${h}:${pad(m)}` : `${h}時`;
  }
  function formatTimeRange(start, end, hours) {
    if (!start && !end) return '時間指定';
    if (start === hours.amStart && end && end < hours.pmEnd) return `${formatTime(end)}まで`;
    if (start && end && end >= hours.pmEnd && start > hours.amStart) return `${formatTime(start)}〜`;
    if (start === hours.pmStart && end) return `PM〜${formatTime(end)}`;
    // 例: 10時〜13時 → 10〜13時（表のマスに収まるように短くする）
    if (start && end && start.endsWith(':00') && end.endsWith(':00')) return `${Number(start.slice(0, 2))}〜${formatTime(end)}`;
    return `${start ? formatTime(start) : ''}〜${end ? formatTime(end) : ''}`;
  }

  function cellLabel(cell, day) {
    if (!cell) return '';
    if (cell.note) return cell.note;
    if (cell.type === 'time') return formatTimeRange(cell.start, cell.end, day.hours);
    return CELL_SYMBOLS[cell.type] || '';
  }

  // ---------------------------------------------------------------
  // スタッフ
  // ---------------------------------------------------------------
  function primaryRole(s) {
    return ROLES.find((r) => s.roles.includes(r)) || 'DA';
  }

  function sortStaff(list) {
    return list.slice().sort((a, b) =>
      ROLES.indexOf(primaryRole(a)) - ROLES.indexOf(primaryRole(b)) || a.order - b.order);
  }

  function staffStateOn(staff, date) {
    if (staff.joinDate && date < staff.joinDate) return { active: false, label: '入職前' };
    if (staff.leaveDate && date > staff.leaveDate) return { active: false, label: '退職' };
    for (const a of staff.absences || []) {
      if (a.from && a.from <= date && (!a.to || date <= a.to)) return { active: false, label: a.type || '休職' };
    }
    return { active: true };
  }

  // その月に在籍している（育休中も含む）スタッフ
  function staffInMonth(data, ym) {
    const dates = monthDates(ym);
    const first = dates[0];
    const last = dates[dates.length - 1];
    return sortStaff(data.staff.filter((s) =>
      !(s.joinDate && s.joinDate > last) && !(s.leaveDate && s.leaveDate < first)));
  }

  // 常勤の休みの目安（途中入職・退職・育休の月は日割り、0.5日単位）
  function targetOffUnits(data, staff, ym) {
    if (staff.employment !== 'full') return null;
    const dates = monthDates(ym);
    const active = dates.filter((d) => staffStateOn(staff, d).active).length;
    return Math.round((data.settings.requiredOffDays * active / dates.length) * 2) / 2;
  }

  // ---------------------------------------------------------------
  // 最少人数の判定（DA・受付の兼任者は、どちらの不足にも回せる）
  // ---------------------------------------------------------------
  // people: [{ id, roles }]。最少人数の枠に人を割り当て（二部マッチング）、人数と不足を返す
  function allocateRoles(people, min) {
    const slots = [];
    for (const r of ROLES) for (let i = 0; i < (min[r] || 0); i++) slots.push(r);
    const slotOwner = new Array(slots.length).fill(-1);

    function tryAssign(pi, seen) {
      for (let si = 0; si < slots.length; si++) {
        if (seen[si] || !people[pi].roles.includes(slots[si])) continue;
        seen[si] = true;
        if (slotOwner[si] === -1 || tryAssign(slotOwner[si], seen)) {
          slotOwner[si] = pi;
          return true;
        }
      }
      return false;
    }
    for (let pi = 0; pi < people.length; pi++) tryAssign(pi, []);

    const assigned = new Array(people.length).fill(null);
    slotOwner.forEach((pi, si) => { if (pi >= 0) assigned[pi] = slots[si]; });
    const counts = {};
    ROLES.forEach((r) => { counts[r] = 0; });
    people.forEach((p, i) => { counts[assigned[i] || ROLES.find((r) => p.roles.includes(r))] += 1; });
    const short = {};
    slotOwner.forEach((pi, si) => { if (pi === -1) short[slots[si]] = (short[slots[si]] || 0) + 1; });
    return { counts, short, feasible: Object.keys(short).length === 0, total: people.length };
  }

  function shortageCount(people, min) {
    return Object.values(allocateRoles(people, min).short).reduce((a, b) => a + b, 0);
  }

  // 最少人数を「午前・午後それぞれ」で数える職種と「1日単位」で数える職種に分ける
  function splitMin(settings) {
    const half = {};
    const day = {};
    for (const r of ROLES) {
      const n = settings.minStaff[r] || 0;
      if ((settings.minMode || {})[r] === 'day') day[r] = n;
      else half[r] = n;
    }
    return { half, day };
  }

  // ---------------------------------------------------------------
  // シフトの下書き作成
  // ---------------------------------------------------------------
  function makeContext(data, ym, schedule) {
    const dates = monthDates(ym);
    const days = {};
    dates.forEach((d) => { days[d] = dayInfo(data, ym, d); });
    const staff = staffInMonth(data, ym);
    const mins = splitMin(data.settings);
    const ctx = {
      data, ym, dates, days, staff,
      index: Object.fromEntries(dates.map((d, i) => [d, i])),
      min: data.settings.minStaff,
      minHalf: mins.half,
      minDay: mins.day,
      maxC: data.settings.maxConsecutive || 99,
      sched: schedule || {},
      prevRun: {},
    };
    // 前月末からの連続勤務を引き継ぐ
    const prev = data.months[shiftYm(ym, -1)];
    if (prev && prev.schedule) {
      const pctx = { data, ym: shiftYm(ym, -1) };
      const pdates = monthDates(pctx.ym);
      for (const s of staff) {
        const row = prev.schedule[s.id];
        if (!row) continue;
        let run = 0;
        for (let i = pdates.length - 1; i >= 0; i--) {
          const d = pdates[i];
          if (isRest(row[d], dayInfo(data, pctx.ym, d))) break;
          run++;
        }
        ctx.prevRun[s.id] = run;
      }
    }
    return ctx;
  }

  function baseCell(ctx, staff, date, existing, keepManual) {
    const st = staffStateOn(staff, date);
    if (!st.active) return { type: 'na', src: 'out', note: st.label };
    if (keepManual && existing && existing.src === 'manual') return existing;
    const day = ctx.days[date];
    if (day.kind === 'closed') return { type: 'na', src: 'closed' };
    const m = ctx.data.months[ctx.ym];
    const req = m && m.requests && m.requests[staff.id] && m.requests[staff.id][date];
    if (req && (day.kind === 'open' || WORK_TYPES.includes(req.type))) {
      const cell = normalizeForDay({ type: req.type, src: 'request' }, day);
      if (req.type === 'time') { cell.start = req.start; cell.end = req.end; }
      return cell;
    }
    if (day.kind === 'limited') return { type: 'na', src: 'closed' };
    const p = (staff.pattern || [])[day.dow] || { type: staff.employment === 'full' ? 'full' : 'na' };
    const cell = { type: p.type, src: 'pattern' };
    if (p.type === 'time') { cell.start = p.start; cell.end = p.end; }
    return normalizeForDay(cell, day);
  }

  // half: 'am' / 'pm' / 'day'（午前か午後のどちらかにいる人）
  function presentPeople(ctx, date, half, excludeId) {
    const day = ctx.days[date];
    const out = [];
    for (const s of ctx.staff) {
      if (s.id === excludeId) continue;
      const p = presence(ctx.sched[s.id][date], day);
      if (half === 'day' ? p.am || p.pm : p[half]) out.push({ id: s.id, roles: s.roles });
    }
    return out;
  }

  function staffOff(ctx, sid) {
    let sum = 0;
    for (const d of ctx.dates) sum += offUnits(ctx.sched[sid][d], ctx.days[d]);
    return sum;
  }

  function isRestAt(ctx, sid, i) {
    const d = ctx.dates[i];
    return isRest(ctx.sched[sid][d], ctx.days[d]);
  }

  // i 日目を出勤とした場合の連続勤務日数
  function runThrough(ctx, sid, i) {
    let left = 0;
    let j = i - 1;
    while (j >= 0 && !isRestAt(ctx, sid, j)) { left++; j--; }
    if (j < 0) left += ctx.prevRun[sid] || 0;
    let right = 0;
    j = i + 1;
    while (j < ctx.dates.length && !isRestAt(ctx, sid, j)) { right++; j++; }
    return left + 1 + right;
  }

  function longestRun(ctx, sid) {
    let best = { len: 0, start: -1, end: -1 };
    let len = ctx.prevRun[sid] || 0;
    let start = 0;
    for (let i = 0; i < ctx.dates.length; i++) {
      if (isRestAt(ctx, sid, i)) { len = 0; start = i + 1; continue; }
      len++;
      if (len > best.len) best = { len, start, end: i };
    }
    return best;
  }

  function nearestRestDistance(ctx, sid, i) {
    for (let k = 1; k < ctx.dates.length; k++) {
      if ((i - k >= 0 && isRestAt(ctx, sid, i - k)) || (i + k < ctx.dates.length && isRestAt(ctx, sid, i + k))) return k;
    }
    return ctx.dates.length;
  }

  // 月曜はじまりの週番号
  function weekOf(ctx, i) {
    const firstMon = (ctx.days[ctx.dates[0]].dow + 6) % 7;
    return Math.floor((i + firstMon) / 7);
  }

  function isWeekendOff(ctx, sid, i) {
    const d = ctx.dates[i];
    const day = ctx.days[d];
    return (day.dow === 0 || day.dow === 6) && !day.holiday && offUnits(ctx.sched[sid][d], day) >= 1;
  }

  function hashJitter(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 1000) / 1000;
  }

  // staff を date の halves から外してよいか（外すと不足が増えるなら不可）。
  // よければ余裕（最少人数より何人多いか）を返す
  function slackIfRemoved(ctx, staff, date, halves) {
    const worse = (half, min) => {
      const all = presentPeople(ctx, date, half);
      const others = all.filter((p) => p.id !== staff.id);
      return shortageCount(others, min) > shortageCount(all, min);
    };
    for (const half of halves) if (worse(half, ctx.minHalf)) return null;
    // 1日単位で数える職種は、その日まったくいなくなる場合だけ影響する
    const p = presence(ctx.sched[staff.id][date], ctx.days[date]);
    const leavesDay = ['am', 'pm'].every((h) => !p[h] || halves.includes(h));
    if (leavesDay && worse('day', ctx.minDay)) return null;

    let best = -Infinity;
    for (const r of staff.roles) {
      const halvesToCheck = r in ctx.minDay ? (leavesDay ? ['day'] : []) : halves;
      let s = Infinity;
      for (const half of halvesToCheck) {
        const n = presentPeople(ctx, date, half, staff.id).filter((x) => x.roles.includes(r)).length;
        s = Math.min(s, n - (ctx.min[r] || 0));
      }
      best = Math.max(best, s === Infinity ? 5 : s);
    }
    return best;
  }

  function scoreCandidate(ctx, staff, i, halves, info) {
    const date = ctx.dates[i];
    const slack = slackIfRemoved(ctx, staff, date, halves);
    if (slack === null) return null;
    const sid = staff.id;

    // 出勤人数が多い日から休ませる（人数を平均化）
    const load = (presentPeople(ctx, date, 'am').length + presentPeople(ctx, date, 'pm').length) / 2;
    // 長い連続勤務を分断する
    const run = runThrough(ctx, sid, i);
    const runTerm = run > ctx.maxC ? 100 + run * 5 : run * 2;
    // 休みを月内に散らす
    const dist = Math.min(nearestRestDistance(ctx, sid, i), info.idealGap);
    const w = weekOf(ctx, i);
    let weekOff = 0;
    let weekLen = 0;
    ctx.dates.forEach((d, j) => {
      if (weekOf(ctx, j) !== w) return;
      weekLen++;
      weekOff += offUnits(ctx.sched[sid][d], ctx.days[d]);
    });
    const weekTerm = -40 * (weekOff / weekLen - info.expectedRatio);
    // 土日の休みを常勤の間で公平に
    const dow = ctx.days[date].dow;
    let weekendTerm = 0;
    if (dow === 0 || dow === 6) {
      const mine = info.weekendOff[sid] || 0;
      weekendTerm = (info.avgWeekendOff() - mine) * 12 - mine * 2;
    }
    return slack * 8 + (load - info.avgLoad) * 3 + runTerm + dist * 3 + weekTerm + weekendTerm +
      hashJitter(sid + date);
  }

  function autoAssignOffs(ctx) {
    const notes = [];
    const fulls = ctx.staff.filter((s) => s.employment === 'full');
    if (!fulls.length) return notes;

    const openIdx = ctx.dates.map((d, i) => i).filter((i) => ctx.days[ctx.dates[i]].kind === 'open');
    const loads = openIdx.map((i) =>
      (presentPeople(ctx, ctx.dates[i], 'am').length + presentPeople(ctx, ctx.dates[i], 'pm').length) / 2);
    const need = {};
    const weekendOff = {};
    for (const s of fulls) {
      need[s.id] = targetOffUnits(ctx.data, s, ctx.ym) - staffOff(ctx, s.id);
      weekendOff[s.id] = ctx.dates.filter((d, i) => isWeekendOff(ctx, s.id, i)).length;
    }
    const info = {
      avgLoad: loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0,
      idealGap: 0,
      expectedRatio: ctx.data.settings.requiredOffDays / ctx.dates.length,
      weekendOff,
      avgWeekendOff: () => fulls.reduce((a, s) => a + weekendOff[s.id], 0) / fulls.length,
    };

    const candidates = (s, fullOnly) => openIdx.filter((i) => {
      const c = ctx.sched[s.id][ctx.dates[i]];
      return c.src === 'pattern' && WORK_TYPES.includes(c.type) &&
        (!fullOnly || workUnits(c, ctx.days[ctx.dates[i]]) === 1);
    });

    function pickBest(s, fullOnly) {
      info.idealGap = Math.max(1, ctx.dates.length / (targetOffUnits(ctx.data, s, ctx.ym) + 1));
      let best = null;
      for (const i of candidates(s, fullOnly)) {
        const c = ctx.sched[s.id][ctx.dates[i]];
        const p = presence(c, ctx.days[ctx.dates[i]]);
        const halves = ['am', 'pm'].filter((h) => p[h]);
        const sc = scoreCandidate(ctx, s, i, halves, info);
        if (sc !== null && (!best || sc > best.score)) best = { i, score: sc };
      }
      return best;
    }

    function setOff(s, i) {
      const d = ctx.dates[i];
      const orig = ctx.sched[s.id][d];
      const gained = 1 - offUnits(orig, ctx.days[d]);
      ctx.sched[s.id][d] = { type: 'off', src: 'auto', orig };
      need[s.id] -= gained;
      if (isWeekendOff(ctx, s.id, i)) weekendOff[s.id]++;
    }

    // 1日単位の休みを、1人1日ずつ順番に割り振る（良い日が特定の人に偏らないように）
    const stuck = new Set();
    for (let round = 0; round < 40; round++) {
      const order = fulls
        .filter((s) => need[s.id] >= 1 && !stuck.has(s.id))
        .sort((a, b) => need[b.id] - need[a.id] ||
          candidates(a, true).length - candidates(b, true).length);
      if (!order.length) break;
      for (const s of order) {
        const best = pickBest(s, true);
        if (best) setOff(s, best.i);
        else stuck.add(s.id);
      }
    }

    // 残り0.5日: 終日勤務の日を半日勤務にする
    for (const s of fulls) {
      if (need[s.id] < 0.5 || stuck.has(s.id)) continue;
      info.idealGap = Math.max(1, ctx.dates.length / (targetOffUnits(ctx.data, s, ctx.ym) + 1));
      let best = null;
      for (const i of candidates(s, true)) {
        for (const drop of ['am', 'pm']) {
          const sc = scoreCandidate(ctx, s, i, [drop], info);
          if (sc !== null && (!best || sc > best.score)) best = { i, drop, score: sc };
        }
      }
      if (best) {
        const d = ctx.dates[best.i];
        const orig = ctx.sched[s.id][d];
        ctx.sched[s.id][d] = { type: best.drop === 'am' ? 'pm' : 'am', src: 'auto', orig };
        need[s.id] -= 0.5;
      }
    }

    repairLongRuns(ctx, fulls, notes);

    for (const s of fulls) {
      if (need[s.id] >= 0.5) {
        notes.push(`${s.name}さん: 最少人数を守るため、休みをあと${need[s.id]}日割り振れませんでした`);
      }
    }
    return notes;
  }

  // 連続勤務の上限を超えたら、自動で入れた休みを1つ移して分断する
  function repairLongRuns(ctx, fulls, notes) {
    for (const s of fulls) {
      for (let guard = 0; guard < 10; guard++) {
        const run = longestRun(ctx, s.id);
        if (run.len <= ctx.maxC) break;
        let moved = false;
        const inside = [];
        for (let i = Math.max(run.start, 0); i <= run.end; i++) inside.push(i);
        const mid = (run.start + run.end) / 2;
        inside.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
        for (const i of inside) {
          const d = ctx.dates[i];
          const c = ctx.sched[s.id][d];
          if (c.src !== 'pattern' || ctx.days[d].kind !== 'open' || workUnits(c, ctx.days[d]) !== 1) continue;
          if (slackIfRemoved(ctx, s, d, ['am', 'pm']) === null) continue;
          ctx.sched[s.id][d] = { type: 'off', src: 'auto', orig: c };
          // 代わりに戻せる自動休みを探す（戻しても上限を超えないもの）
          const autoIdx = ctx.dates.map((x, j) => j).filter((j) => {
            const cj = ctx.sched[s.id][ctx.dates[j]];
            return j !== i && cj.src === 'auto' && cj.type === 'off';
          });
          let reverted = false;
          for (const j of autoIdx) {
            const dj = ctx.dates[j];
            const saved = ctx.sched[s.id][dj];
            ctx.sched[s.id][dj] = saved.orig;
            if (runThrough(ctx, s.id, j) <= ctx.maxC) { reverted = true; break; }
            ctx.sched[s.id][dj] = saved;
          }
          if (reverted) { moved = true; break; }
          ctx.sched[s.id][d] = c;
        }
        if (!moved) {
          notes.push(`${s.name}さん: 連続勤務が${run.len}日になっています（上限${ctx.maxC}日）`);
          break;
        }
      }
    }
  }

  // 下書きを作る。手で直したマス（src: manual）は keepManual=true なら残す
  function generateSchedule(data, ym, opts) {
    const keepManual = !opts || opts.keepManual !== false;
    const month = data.months[ym];
    const prev = (month && month.schedule) || {};
    const ctx = makeContext(data, ym, {});
    for (const s of ctx.staff) {
      ctx.sched[s.id] = {};
      for (const d of ctx.dates) {
        ctx.sched[s.id][d] = baseCell(ctx, s, d, prev[s.id] && prev[s.id][d], keepManual);
      }
    }
    const notes = autoAssignOffs(ctx);
    return { schedule: ctx.sched, notes };
  }

  // 1日分だけ作り直す（休診日の設定を変えたときなど）。手で直したマスは残し、
  // 通常診療の日なら自動で入れた休みも残す（休みの日数が変わらないように）
  function rebuildDate(data, ym, date) {
    const month = data.months[ym];
    if (!month || !month.schedule) return;
    const ctx = makeContext(data, ym, month.schedule);
    const open = ctx.days[date].kind === 'open';
    for (const s of ctx.staff) {
      const row = month.schedule[s.id];
      if (!row) continue;
      if (open && row[date] && row[date].src === 'auto' && row[date].type === 'off') continue;
      row[date] = baseCell(ctx, s, date, row[date], true);
    }
  }

  // 下書き作成後に追加されたスタッフの行を埋める
  function fillMissingRows(data, ym) {
    const month = data.months[ym];
    if (!month || !month.schedule) return false;
    const ctx = makeContext(data, ym, month.schedule);
    let changed = false;
    for (const s of ctx.staff) {
      if (month.schedule[s.id]) continue;
      month.schedule[s.id] = {};
      for (const d of ctx.dates) month.schedule[s.id][d] = baseCell(ctx, s, d, null, false);
      changed = true;
    }
    return changed;
  }

  // ---------------------------------------------------------------
  // 集計と警告
  // ---------------------------------------------------------------
  function computeStats(data, ym, schedule) {
    const ctx = makeContext(data, ym, schedule);
    ctx.staff = ctx.staff.filter((s) => schedule[s.id]);
    const perDay = {};
    const warnings = [];
    const shortText = (short) => Object.entries(short).map(([r, n]) => `${r}が${n}人不足`).join('、');
    for (const d of ctx.dates) {
      const day = ctx.days[d];
      const check = day.kind === 'open';
      const dayAlloc = allocateRoles(presentPeople(ctx, d, 'day'), ctx.minDay);
      const dayShort = check ? dayAlloc.short : {};
      perDay[d] = { dayShort };
      for (const half of ['am', 'pm']) {
        const open = half === 'am' ? day.amOpen : day.pmOpen;
        const alloc = allocateRoles(presentPeople(ctx, d, half), ctx.minHalf);
        const short = check && open ? Object.assign({}, alloc.short, dayShort) : {};
        perDay[d][half] = { open, counts: alloc.counts, total: alloc.total, short };
        if (check && open && !alloc.feasible) {
          warnings.push({
            kind: 'short', date: d, half,
            text: `${formatDateJa(d)} ${half === 'am' ? '午前' : '午後'}: ${shortText(alloc.short)}`,
          });
        }
      }
      if (check && !dayAlloc.feasible) {
        warnings.push({ kind: 'short', date: d, half: 'day', text: `${formatDateJa(d)} 1日を通して: ${shortText(dayAlloc.short)}` });
      }
    }
    const perStaff = {};
    for (const s of ctx.staff) {
      let off = 0;
      let paid = 0;
      let work = 0;
      let requestedOff = 0;
      for (const d of ctx.dates) {
        const c = schedule[s.id][d];
        const day = ctx.days[d];
        off += offUnits(c, day);
        work += workUnits(c, day);
        if (c.type === 'paid') paid++;
        if (c.src === 'request' && c.type === 'off' && !day.holiday) requestedOff++;
      }
      const target = targetOffUnits(data, s, ym);
      const run = longestRun(ctx, s.id);
      perStaff[s.id] = { off, paid, work, target, maxRun: run.len };
      if (target !== null && off !== target) {
        warnings.push({
          kind: 'off', staffId: s.id,
          text: `${s.name}さん: 休み${off}日（目安${target}日）` +
            (off > target && requestedOff > target ? '。希望休が目安を超えています' : ''),
        });
      }
      if (s.employment === 'full' && run.len > ctx.maxC) {
        warnings.push({
          kind: 'run', staffId: s.id,
          text: `${s.name}さん: ${run.len}連勤があります（上限${ctx.maxC}日）`,
        });
      }
    }
    return { perDay, perStaff, warnings, days: ctx.days, dates: ctx.dates, staff: ctx.staff };
  }

  function countsText(half, min) {
    return ROLES
      .filter((r) => (min[r] || 0) > 0 || half.counts[r] > 0)
      .map((r) => ({ role: r, label: `${ROLE_SHORT[r]}${half.counts[r]}`, short: !!half.short[r] }));
  }

  // ---------------------------------------------------------------
  // CSV（Excel で開ける形）
  // ---------------------------------------------------------------
  function toCSV(data, ym) {
    const month = data.months[ym];
    const schedule = (month && month.schedule) || {};
    const stats = computeStats(data, ym, schedule);
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [];
    lines.push(['日', '曜日', '特記事項', ...stats.staff.map((s) => s.name), '午前の人数', '午後の人数'].map(q).join(','));
    for (const d of stats.dates) {
      const day = stats.days[d];
      const note = [day.holiday, day.note].filter(Boolean).join(' ');
      const cells = stats.staff.map((s) => cellLabel(schedule[s.id][d], day));
      const cnt = (h) => (stats.perDay[d][h].open
        ? countsText(stats.perDay[d][h], data.settings.minStaff).map((x) => x.label).join(' ') : '');
      lines.push([parseYmd(d).d, WEEKDAYS[day.dow], note, ...cells, cnt('am'), cnt('pm')].map(q).join(','));
    }
    lines.push(['', '', '休み（常勤は目安）', ...stats.staff.map((s) => {
      const p = stats.perStaff[s.id];
      return p.target === null ? '' : `${p.off}/${p.target}`;
    })].map(q).join(','));
    lines.push(['', '', '有給', ...stats.staff.map((s) => stats.perStaff[s.id].paid || '')].map(q).join(','));
    return '﻿' + lines.join('\r\n');
  }

  // ---------------------------------------------------------------
  // パスワード（誤操作防止用の簡易ハッシュ）
  // ---------------------------------------------------------------
  function hashPassword(pw) {
    const str = 'ogawa-shift:' + pw;
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  const api = {
    ROLES, ROLE_NAMES, ROLE_SHORT, WEEKDAYS, ABSENCE_TYPES, WORK_TYPES, CELL_SYMBOLS,
    pad, ymd, ymKey, parseYmd, parseYm, dowOfDate, addDays, daysInMonth, shiftYm, monthDates,
    ymOfDate, formatMonthJa, formatDateJa, formatTimeRange,
    holidaysOfYear, holidayName,
    defaultData, defaultSettings, normalizeData, normalizeStaff, defaultPattern, newId, getMonth,
    deadlineOf, fixDueOf, isInputOpen, firstOpenMonth,
    dayInfo, presence, workUnits, offUnits, cellLabel,
    primaryRole, sortStaff, staffStateOn, staffInMonth, targetOffUnits,
    allocateRoles, generateSchedule, rebuildDate, fillMissingRows, computeStats, countsText,
    toCSV, hashPassword,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ShiftCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
