const SHEET_NAME = 'Лиды с AI-лендингов';
const RECEIPT_COLUMN = 18; // R: случайный ID заявки; P и Q сохраняют прежнее назначение.
const RECEIPT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function doGet(e) {
  const requestId = e && e.parameter ? String(e.parameter.receipt || '') : '';
  if (requestId) {
    // JSONP возвращает только факт записи по непредсказуемому ID, без данных клиента.
    const validId = RECEIPT_PATTERN.test(requestId) ? requestId : '';
    const saved = Boolean(validId && findReceiptRow_(leadSheet_(), validId));
    const response = { request_id: validId, saved: saved };
    return ContentService.createTextOutput('window.__kolvikaLeadAck(' + JSON.stringify(response) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_({ ok: true, service: 'kolvika-leads' });
}

function doPost(e) {
  const data = e && e.parameter ? e.parameter : {};
  const sheet = leadSheet_();
  const requestId = String(data.request_id || '');
  if (requestId && !RECEIPT_PATTERN.test(requestId)) throw new Error('Некорректный ID заявки');

  const clientId = clean_(data.ym_client_id);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Не удалось получить блокировку записи');
  try {
    // Повтор после сетевого сбоя не создаёт вторую строку и вторую конверсию.
    if (requestId && findReceiptRow_(sheet, requestId)) {
      return json_({ ok: true, request_id: requestId, duplicate: true });
    }
    sheet.appendRow([
      new Date(),
      clean_(data.landing),
      clean_(data.type || 'Форма'),
      clean_(data.name),
      asText_(data.phone),
      clean_(data.message),
      clean_(data.utm_source),
      clean_(data.utm_medium),
      clean_(data.utm_campaign),
      clean_(data.utm_term),
      clean_(data.utm_content),
      clean_(data.utm_other),
      clean_(data.page),
      clean_(data.referrer),
      'Новый',
      '', // P: статус email-уведомления заполняет LeadEmails.gs.
      /^\d+$/.test(clientId) ? "'" + clientId : '', // Q: Яндекс ClientID как текст.
      requestId // R: подтверждение и дедупликация заявок.
    ]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  return json_({ ok: true, request_id: requestId });
}

function leadSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Лист для лидов не найден');
  if (sheet.getMaxColumns() < RECEIPT_COLUMN ||
      sheet.getRange(1, RECEIPT_COLUMN).getDisplayValue() !== 'ID заявки') {
    throw new Error('Столбец R «ID заявки» не подготовлен');
  }
  return sheet;
}

function findReceiptRow_(sheet, requestId) {
  if (sheet.getLastRow() < 2) return null;
  return sheet.getRange(2, RECEIPT_COLUMN, sheet.getLastRow() - 1, 1)
    .createTextFinder(requestId).matchEntireCell(true).findNext();
}

function clean_(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 2000);
}

function asText_(value) {
  const text = clean_(value);
  return text ? "'" + text : '';
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
