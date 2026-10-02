const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'landings/custom-jewelry/dist/assets/lead-analytics.js'), 'utf8');
const receiver = fs.readFileSync(path.join(root, 'integrations/google-apps-script/lead-receiver.gs'), 'utf8');

function runFrontend(ym) {
  const fields = [];
  const sent = [];
  const form = {
    querySelector: () => fields[0] || null,
    appendChild: (field) => fields.push(field)
  };
  const document = {
    readyState: 'complete',
    body: { dataset: { landing: 'Ремонт украшений' } },
    title: 'Ремонт',
    referrer: '',
    querySelectorAll: () => [form],
    createElement: () => ({}),
    addEventListener: () => {}
  };
  const window = {
    ym,
    location: { search: '?utm_source=yandex', href: 'https://example.test/repair/' },
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(frontend, {
    window,
    document,
    URLSearchParams,
    fetch: (url, options) => { sent.push({ url, options }); return Promise.resolve(); }
  });
  window.KolvikaLead.submit({ name: 'Тест', phone: '+79999999999' });
  return { fields, sent };
}

test('ClientID Метрики попадает в скрытое поле и POST-заявку', () => {
  const result = runFrontend((counter, method, callback) => {
    if (method === 'getClientID') callback('1234567890123456');
  });
  assert.equal(result.fields[0].type, 'hidden');
  assert.equal(result.fields[0].name, 'ym_client_id');
  assert.equal(result.fields[0].value, '1234567890123456');
  assert.equal(new URLSearchParams(result.sent[0].options.body).get('ym_client_id'), '1234567890123456');
});

test('заявка отправляется и без доступной Метрики', () => {
  const result = runFrontend(undefined);
  assert.equal(result.sent.length, 1);
  assert.equal(new URLSearchParams(result.sent[0].options.body).get('ym_client_id'), '');
});

test('приёмник сохраняет ClientID в Q и оставляет P для email-статуса', () => {
  let row;
  const lock = { tryLock: () => true, hasLock: () => true, releaseLock: () => {} };
  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({ appendRow: (value) => { row = value; } }) }) },
    LockService: { getScriptLock: () => lock },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: () => ({ setMimeType: () => ({}) }) }
  };
  vm.runInNewContext(receiver, context);
  context.doPost({ parameter: { landing: 'Ремонт украшений', ym_client_id: '1234567890123456' } });
  assert.equal(row.length, 17);
  assert.equal(row[15], '');
  assert.equal(row[16], "'1234567890123456");
});
