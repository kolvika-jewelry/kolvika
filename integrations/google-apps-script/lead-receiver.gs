const SHEET_NAME = 'Лиды с AI-лендингов';

function doGet() {
  return json_({ ok: true, service: 'kolvika-leads' });
}

function doPost(e) {
  const data = e && e.parameter ? e.parameter : {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Лист для лидов не найден');

  const clientId = clean_(data.ym_client_id);
  const lock = LockService.getScriptLock();
  lock.tryLock(5000);
  try {
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
      /^\d+$/.test(clientId) ? "'" + clientId : '' // Q: Яндекс ClientID как текст.
    ]);
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }

  return json_({ ok: true });
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
