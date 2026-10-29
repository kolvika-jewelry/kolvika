const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'landings/custom-jewelry/dist/assets/lead-analytics.js'), 'utf8');
const receiver = fs.readFileSync(path.join(root, 'integrations/google-apps-script/lead-receiver.gs'), 'utf8');
const requestId = '11111111-2222-4333-8444-555555555555';

function runFrontend({ receipt = 'saved', fetchResult = 'opaque', ymEnabled = true, goalThrows = false } = {}) {
  const fields = [];
  const sent = [];
  const goals = [];
  const button = { textContent: 'Отправить', disabled: false };
  const form = {
    querySelector(selector) {
      if (selector === '[type="submit"]') return button;
      if (selector === '.lead-send-status') return fields.find(x => x.className === 'lead-send-status') || null;
      if (selector === 'input[name="ym_client_id"]') return fields.find(x => x.name === 'ym_client_id') || null;
      return null;
    },
    appendChild(field) { fields.push(field); }
  };
  let now = 0;
  let receiptMode = receipt;
  let nextTimer = 0;
  const timers = new Map();
  const window = {
    crypto: { randomUUID: () => requestId },
    location: { search: '?utm_source=yandex', href: 'https://example.test/repair/' },
    setTimeout(callback, ms) {
      const id = ++nextTimer;
      timers.set(id, true);
      queueMicrotask(() => {
        if (!timers.has(id)) return;
        timers.delete(id);
        now += ms;
        callback();
      });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  if (ymEnabled) window.ym = (counter, method, arg) => {
    if (method === 'getClientID') arg('1234567890123456');
    if (method === 'reachGoal') {
      if (goalThrows) throw new Error('Metrica blocked');
      goals.push(arg);
    }
  };
  const document = {
    readyState: 'complete',
    body: { dataset: { landing: 'Ремонт украшений' } },
    title: 'Ремонт',
    referrer: '',
    querySelectorAll: () => [form],
    createElement: () => ({
      style: {},
      remove() {},
      setAttribute() {}
    }),
    addEventListener() {},
    head: {
      appendChild(script) {
        if (receiptMode === 'saved') window.__kolvikaLeadAck({ request_id: requestId, saved: true });
        if (receiptMode === 'false') window.__kolvikaLeadAck({ request_id: requestId, saved: false });
        if (receiptMode === 'malformed') window.__kolvikaLeadAck({ request_id: requestId, saved: 'true' });
        if (receiptMode === 'error') script.onerror();
      }
    }
  };
  vm.runInNewContext(frontend, {
    window, document, URLSearchParams, Date: { now: () => now },
    fetch(url, options) {
      sent.push({ url, options });
      if (fetchResult === 'reject') return Promise.reject(new Error('offline'));
      return Promise.resolve({ type: fetchResult, ok: fetchResult === 'ok' });
    }
  });
  return { window, form, fields, sent, goals, button, setReceipt(value) { receiptMode = value; } };
}

test('ClientID Метрики попадает в скрытое поле и POST; цель ждёт подтверждения строки', async () => {
  const page = runFrontend();
  assert.equal(page.fields[0].type, 'hidden');
  assert.equal(page.fields[0].name, 'ym_client_id');
  assert.equal(page.fields[0].value, '1234567890123456');
  assert.deepEqual(page.goals, []);
  const result = await page.window.KolvikaLead.submit({ name: 'Тест', phone: '+79999999999' }, page.form);
  assert.equal(result.ok, true);
  const body = new URLSearchParams(page.sent[0].options.body);
  assert.equal(body.get('ym_client_id'), '1234567890123456');
  assert.equal(body.get('request_id'), requestId);
  assert.deepEqual(page.goals, ['lead_submit']);
});

test('без Метрики заявка всё равно отправляется с пустым ClientID', async () => {
  const page = runFrontend({ ymEnabled: false });
  assert.equal((await page.window.KolvikaLead.submit({ name: 'Тест' }, page.form)).ok, true);
  assert.equal(new URLSearchParams(page.sent[0].options.body).get('ym_client_id'), '');
});

for (const [label, config] of [
  ['строки нет', { receipt: 'false' }],
  ['сеть недоступна', { receipt: 'error', fetchResult: 'reject' }],
  ['таймаут приёмника', { receipt: 'none' }],
  ['некорректный ответ', { receipt: 'malformed' }],
  ['opaque POST без подтверждения', { receipt: 'false', fetchResult: 'opaque' }]
]) {
  test(label + ': нет цели и форма доступна для повтора', async () => {
    const page = runFrontend(config);
    const result = await page.window.KolvikaLead.submit({ name: 'Тест' }, page.form);
    assert.equal(result.ok, false);
    assert.deepEqual(page.goals, []);
    assert.equal(page.button.disabled, false);
    assert.match(page.fields.find(x => x.className === 'lead-send-status').textContent, /Не удалось подтвердить/);
  });
}

test('двойной клик и повтор после подтверждения не создают вторую заявку и цель', async () => {
  const page = runFrontend();
  const payload = { name: 'Тест' };
  const first = page.window.KolvikaLead.submit(payload, page.form);
  const second = page.window.KolvikaLead.submit(payload, page.form);
  assert.equal(first, second);
  assert.equal((await first).ok, true);
  assert.equal((await page.window.KolvikaLead.submit(payload, page.form)).ok, true);
  assert.equal(page.sent.length, 1);
  assert.deepEqual(page.goals, ['lead_submit']);
});

test('после неподтверждённой попытки повтор использует тот же ID и фиксирует цель один раз', async () => {
  const page = runFrontend({ receipt: 'false' });
  const payload = { name: 'Тест' };
  assert.equal((await page.window.KolvikaLead.submit(payload, page.form)).ok, false);
  page.setReceipt('saved');
  assert.equal((await page.window.KolvikaLead.submit(payload, page.form)).ok, true);
  assert.equal(page.sent.length, 1);
  assert.deepEqual(page.goals, ['lead_submit']);
});

test('ошибка fetch не мешает засчитать фактически сохранённую заявку', async () => {
  const page = runFrontend({ receipt: 'saved', fetchResult: 'reject' });
  assert.equal((await page.window.KolvikaLead.submit({ name: 'Тест' }, page.form)).ok, true);
  assert.deepEqual(page.goals, ['lead_submit']);
});

test('ошибка Метрики не превращает сохранённую заявку в ошибку формы', async () => {
  const page = runFrontend({ goalThrows: true });
  assert.equal((await page.window.KolvikaLead.submit({ name: 'Тест' }, page.form)).ok, true);
  assert.equal(page.button.disabled, true);
  assert.equal(page.button.textContent, 'Заявка отправлена');
});

function runReceiver() {
  const rows = [];
  let appendFails = false;
  const sheet = {
    getMaxColumns: () => 18,
    getLastRow: () => rows.length + 1,
    getRange(row, column) {
      if (row === 1 && column === 18) return { getDisplayValue: () => 'ID заявки' };
      return {
        createTextFinder(value) {
          return { matchEntireCell: () => ({ findNext: () => rows.find(r => r[17] === value) || null }) };
        }
      };
    },
    appendRow(value) {
      if (appendFails) throw new Error('Sheets unavailable');
      rows.push(value);
    }
  };
  const lock = { tryLock: () => true, releaseLock() {} };
  const context = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }),
      flush() {}
    },
    LockService: { getScriptLock: () => lock },
    ContentService: {
      MimeType: { JSON: 'JSON', JAVASCRIPT: 'JAVASCRIPT' },
      createTextOutput(text) { return { text, setMimeType(type) { this.type = type; return this; } }; }
    }
  };
  vm.runInNewContext(receiver, context);
  return { context, rows, failAppend() { appendFails = true; } };
}

test('приёмник сохраняет ClientID в Q, ID заявки в R и подтверждает только записанную строку', () => {
  const app = runReceiver();
  const data = { landing: 'Ремонт украшений', ym_client_id: '1234567890123456', request_id: requestId };
  assert.match(app.context.doGet({ parameter: { receipt: requestId } }).text, /"saved":false/);
  app.context.doPost({ parameter: data });
  assert.equal(app.rows.length, 1);
  assert.equal(app.rows[0].length, 18);
  assert.equal(app.rows[0][15], '');
  assert.equal(app.rows[0][16], "'1234567890123456");
  assert.equal(app.rows[0][17], requestId);
  assert.match(app.context.doGet({ parameter: { receipt: requestId } }).text, /"saved":true/);
  app.context.doPost({ parameter: data });
  assert.equal(app.rows.length, 1);
});

test('при ошибке записи приёмник не подтверждает заявку', () => {
  const app = runReceiver();
  app.failAppend();
  assert.throws(() => app.context.doPost({ parameter: { request_id: requestId } }), /Sheets unavailable/);
  assert.match(app.context.doGet({ parameter: { receipt: requestId } }).text, /"saved":false/);
});
