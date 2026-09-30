// 計算ロジックのテスト。実行: cd shift-app && node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

// テスト用の架空スタッフ（実在の人名は使わない）
function makeClinic() {
  const data = C.defaultData();
  let n = 0;
  const add = (name, roles, employment, pattern) => {
    const s = C.normalizeStaff({ id: `t${n}`, name, roles, employment, pattern, order: n }, n);
    n++;
    data.staff.push(s);
    return s;
  };
  const P = (arr) => arr.map((t) => (typeof t === 'string' ? { type: t } : t));
  const full = P(['full', 'full', 'full', 'full', 'full', 'full', 'full']);
  // 歯科医師: 常勤2・非常勤2
  add('医師A', ['Dr'], 'full', full);
  add('医師B', ['Dr'], 'full', full);
  add('医師C', ['Dr'], 'part', P(['na', 'full', 'na', 'na', 'na', 'na', 'na']));
  add('医師D', ['Dr'], 'part', P(['full', 'na', 'na', 'na', 'na', 'na', 'full']));
  // 歯科衛生士: 常勤5・パート2
  for (const x of ['A', 'B', 'C', 'D', 'E']) add(`衛生士${x}`, ['DH'], 'full', full);
  add('衛生士F', ['DH'], 'part', P(['na', { type: 'time', start: '10:00', end: '13:00' }, 'na', 'na', { type: 'time', start: '10:00', end: '13:00' }, 'na', 'na']));
  add('衛生士G', ['DH'], 'part', P(['na', 'full', 'full', 'na', 'full', 'full', 'na']));
  // 歯科助手・受付: 常勤4（うち1人は兼任）・受付常勤2
  for (const x of ['A', 'B', 'C']) add(`助手${x}`, ['DA'], 'full', full);
  add('助手D', ['DA', '受付'], 'full', full);
  add('受付A', ['受付'], 'full', full);
  add('受付B', ['受付'], 'full', full);
  // クリーンスタッフ: 常勤2
  add('清掃A', ['CS'], 'full', full);
  add('清掃B', ['CS'], 'full', full);
  return data;
}

test('2026年の祝日（振替休日・国民の休日を含む）', () => {
  const h = C.holidaysOfYear(2026);
  assert.deepEqual(Object.keys(h).sort(), [
    '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29',
    '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11',
    '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  ]);
  assert.equal(h['2026-05-06'], '振替休日');
  assert.equal(h['2026-09-22'], '国民の休日');
});

test('締切は前々月の25日、確定期限は前月1日', () => {
  const s = C.defaultSettings();
  assert.equal(C.deadlineOf(s, '2026-11'), '2026-09-25');
  assert.equal(C.deadlineOf(s, '2027-01'), '2026-11-25');
  assert.equal(C.fixDueOf('2026-11'), '2026-10-01');
  assert.equal(C.firstOpenMonth(s, '2026-09-30'), '2026-12');
  assert.equal(C.firstOpenMonth(s, '2026-09-25'), '2026-11');
});

test('DA・受付の兼任者はどちらの不足にも回せる', () => {
  const min = { DA: 1, 受付: 1 };
  assert.equal(C.allocateRoles([{ roles: ['DA', '受付'] }, { roles: ['DA'] }], min).feasible, true);
  assert.equal(C.allocateRoles([{ roles: ['DA', '受付'] }, { roles: ['受付'] }], min).feasible, true);
  const r = C.allocateRoles([{ roles: ['DA', '受付'] }], min);
  assert.equal(r.feasible, false);
  assert.equal(Object.values(r.short).reduce((a, b) => a + b, 0), 1);
});

test('半日勤務は0.5日の休み、有給と祝日は休みに数えない', () => {
  const data = C.defaultData();
  const ym = '2026-11';
  const day = C.dayInfo(data, ym, '2026-11-04'); // 水曜
  assert.equal(C.offUnits({ type: 'am' }, day), 0.5);
  assert.equal(C.offUnits({ type: 'full' }, day), 0);
  assert.equal(C.offUnits({ type: 'off' }, day), 1);
  assert.equal(C.offUnits({ type: 'paid' }, day), 0);
  assert.equal(C.offUnits({ type: 'time', start: '09:00', end: '17:00' }, day), 0);
  assert.equal(C.offUnits({ type: 'time', start: '16:00', end: '18:00' }, day), 0.5);
  const holiday = C.dayInfo(data, ym, '2026-11-03');
  assert.equal(holiday.kind, 'closed');
  assert.equal(C.offUnits({ type: 'na', src: 'closed' }, holiday), 0);
});

test('時間指定は表のマスに収まる短い表記にする', () => {
  const h = C.defaultSettings().hours.weekday;
  assert.equal(C.formatTimeRange('09:00', '17:00', h), '17時まで');
  assert.equal(C.formatTimeRange('16:00', '18:00', h), '16時〜');
  assert.equal(C.formatTimeRange('10:00', '13:00', h), '10〜13時');
  assert.equal(C.formatTimeRange('14:30', '17:00', h), 'PM〜17時');
  assert.equal(C.formatTimeRange('08:30', '10:30', h), '8:30〜10:30');
});

test('常勤は祝日以外にちょうど8日休み・最少人数と連勤上限を守る', () => {
  const data = makeClinic();
  const ym = '2026-11';
  const m = C.getMonth(data, ym);
  // 希望休と有給
  m.requests.t0 = { '2026-11-07': { type: 'off' }, '2026-11-08': { type: 'off' } };
  m.requests.t4 = { '2026-11-10': { type: 'paid' } };
  const { schedule, notes } = C.generateSchedule(data, ym);
  m.schedule = schedule;
  assert.deepEqual(notes, []);

  assert.equal(schedule.t0['2026-11-07'].type, 'off');
  assert.equal(schedule.t0['2026-11-07'].src, 'request');
  assert.equal(schedule.t4['2026-11-10'].type, 'paid');
  assert.equal(schedule.t0['2026-11-03'].type, 'na'); // 文化の日は休診

  const stats = C.computeStats(data, ym, schedule);
  assert.deepEqual(stats.warnings.map((w) => w.text), []);
  for (const s of data.staff.filter((x) => x.employment === 'full')) {
    assert.equal(stats.perStaff[s.id].off, 8, `${s.name}の休み`);
    assert.ok(stats.perStaff[s.id].maxRun <= 5, `${s.name}の連勤 ${stats.perStaff[s.id].maxRun}`);
  }
  // 土日の休みの偏り（常勤間の差が3日以内）
  const weekendOffs = data.staff.filter((x) => x.employment === 'full').map((s) =>
    C.monthDates(ym).filter((d) => [0, 6].includes(C.dowOfDate(d)) && schedule[s.id][d].type === 'off').length);
  assert.ok(Math.max(...weekendOffs) - Math.min(...weekendOffs) <= 3, `土日休み ${weekendOffs}`);
});

test('休診日（祝日以外）は8日に含める', () => {
  const data = makeClinic();
  const ym = '2026-12';
  const m = C.getMonth(data, ym);
  for (const d of ['2026-12-29', '2026-12-30', '2026-12-31']) m.days[d] = { kind: 'closed', note: '年末休診' };
  const { schedule } = C.generateSchedule(data, ym);
  const stats = C.computeStats(data, ym, schedule);
  const s = data.staff[0];
  assert.equal(stats.perStaff[s.id].off, 8);
  const autoOffs = C.monthDates(ym).filter((d) => schedule[s.id][d].src === 'auto').length;
  assert.equal(autoOffs, 5); // 休診3日 + 自動5日 = 8日
});

test('途中入職は日割り、育休中は在籍外', () => {
  const data = makeClinic();
  const ym = '2026-11';
  data.staff[0].joinDate = '2026-11-16'; // 30日中15日在籍 → 4日
  data.staff[1].absences = [{ type: '育休', from: '2026-10-01', to: '2027-03-31' }];
  assert.equal(C.targetOffUnits(data, data.staff[0], ym), 4);
  assert.equal(C.targetOffUnits(data, data.staff[1], ym), 0);
  const { schedule } = C.generateSchedule(data, ym);
  assert.equal(schedule.t0['2026-11-10'].src, 'out');
  assert.equal(schedule.t1['2026-11-10'].note, '育休');
  const stats = C.computeStats(data, ym, schedule);
  assert.equal(stats.perStaff.t0.off, 4);
});

test('手で直したマスは作り直しても残る', () => {
  const data = makeClinic();
  const ym = '2026-11';
  const m = C.getMonth(data, ym);
  m.schedule = C.generateSchedule(data, ym).schedule;
  m.schedule.t5['2026-11-12'] = { type: 'event', note: 'セミナー', src: 'manual' };
  const again = C.generateSchedule(data, ym).schedule;
  assert.equal(again.t5['2026-11-12'].note, 'セミナー');
  assert.equal(C.computeStats(data, ym, again).perStaff.t5.off, 8);
});

test('1日だけ作り直しても、通常診療の日なら自動の休みは残る', () => {
  const data = makeClinic();
  const ym = '2026-11';
  const m = C.getMonth(data, ym);
  m.schedule = C.generateSchedule(data, ym).schedule;
  const date = C.monthDates(ym).find((d) => data.staff.some((s) => m.schedule[s.id][d].src === 'auto'));
  const before = data.staff.map((s) => m.schedule[s.id][date].type);
  C.rebuildDate(data, ym, date);
  assert.deepEqual(data.staff.map((s) => m.schedule[s.id][date].type), before);
  // 休診にすると全員「ー」になり、常勤の休みは8日のまま（休診日は休みに数える）
  m.days[date] = { kind: 'closed' };
  C.rebuildDate(data, ym, date);
  assert.ok(data.staff.every((s) => m.schedule[s.id][date].type === 'na'));
  const stats = C.computeStats(data, ym, m.schedule);
  const offs = data.staff.filter((s) => s.employment === 'full').map((s) => stats.perStaff[s.id].off);
  assert.ok(offs.every((o) => o >= 8));
});

test('CSは1日単位で数え、不足している職種と関係ない人の休みは止めない', () => {
  const data = makeClinic();
  const ym = '2026-11';
  // 常勤CSを外し、パートCSを1人だけにする（月曜は午後のみ、水曜は不在、他は午前のみ）
  data.staff = data.staff.filter((s) => !s.roles.includes('CS'));
  data.staff.push(C.normalizeStaff({
    id: 'cs', name: '清掃P', roles: ['CS'], employment: 'part', order: 99,
    pattern: ['am', 'pm', 'am', 'na', 'am', 'am', 'am'].map((type) => ({ type })),
  }, 99));
  const { schedule } = C.generateSchedule(data, ym);
  const stats = C.computeStats(data, ym, schedule);
  const shortDates = [...new Set(stats.warnings.filter((w) => w.kind === 'short').map((w) => w.date))];
  // 水曜（祝日を除く）だけがCS不足になる
  const weds = C.monthDates(ym).filter((d) => C.dowOfDate(d) === 3 && !C.holidayName(d));
  assert.deepEqual(shortDates.sort(), weds);
  assert.ok(stats.warnings.filter((w) => w.kind === 'short').every((w) => w.half === 'day'));
  // CSが不足する水曜でも、他の常勤の休みは割り振られ、全員8日になる
  for (const s of data.staff.filter((x) => x.employment === 'full')) {
    assert.equal(stats.perStaff[s.id].off, 8, s.name);
  }
  assert.ok(data.staff.some((s) => weds.some((d) => schedule[s.id][d].src === 'auto')));
});

test('CSVは日付の行とスタッフの列を持つ', () => {
  const data = makeClinic();
  const ym = '2026-11';
  C.getMonth(data, ym).schedule = C.generateSchedule(data, ym).schedule;
  const lines = C.toCSV(data, ym).split('\r\n');
  assert.equal(lines.length, 1 + 30 + 2);
  assert.ok(lines[0].includes('"医師A"'));
  assert.ok(lines[3].includes('"文化の日"'));
});
