/**
 * KOLVIKA: уведомления о новых заявках из вкладки «Лиды с AI-лендингов».
 * Устанавливается в проект Apps Script с доступом к указанной таблице.
 * Существующий doPost и запись строк менять не требуется.
 */
const KOLVIKA_LEADS = Object.freeze({
  spreadsheetId: '1R7hsc5a53_GsPp62ca5kbUL6qRrkiDfxu7Vuvg_NOmI',
  sheetName: 'Лиды с AI-лендингов',
  notificationColumn: 16,
  repairEmail: 'info@kolvika.ru',
  jewelryEmail: 'jewelry@kolvika.ru'
});

function kolvikaLeadRecipient_(row) {
  const landing = String(row[1] || '').trim();
  if (landing === 'Ремонт украшений') {
    return { email: KOLVIKA_LEADS.repairEmail, subject: 'Заявка на ремонт — KOLVIKA' };
  }
  if (landing === 'Украшения на заказ' || landing === 'Квиз украшения на заказ') {
    return { email: KOLVIKA_LEADS.jewelryEmail, subject: 'Заявка на изготовление — KOLVIKA' };
  }
  return null; // Незнакомый лендинг нельзя отправлять наугад.
}

function kolvikaLeadSheet_() {
  const sheet = SpreadsheetApp.openById(KOLVIKA_LEADS.spreadsheetId)
    .getSheetByName(KOLVIKA_LEADS.sheetName);
  if (!sheet) throw new Error('Вкладка с лидами не найдена');
  const headers = sheet.getRange(1, 1, 1, 5).getDisplayValues()[0];
  if (headers[1] !== 'Лендинг' || headers[2] !== 'Тип обращения' || headers[4] !== 'Телефон') {
    throw new Error('Структура вкладки с лидами изменилась; отправка остановлена');
  }
  return sheet;
}

/** Выполнить вручную ОДИН раз. Старые строки помечаются без отправки писем. */
function setupKolvikaLeadEmails() {
  const sheet = kolvikaLeadSheet_();
  if (sheet.getMaxColumns() < KOLVIKA_LEADS.notificationColumn) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), KOLVIKA_LEADS.notificationColumn - sheet.getMaxColumns());
  }
  const statusHeader = sheet.getRange(1, KOLVIKA_LEADS.notificationColumn);
  const currentHeader = statusHeader.getDisplayValue();
  if (currentHeader && currentHeader !== 'Email-уведомление') {
    throw new Error('Столбец P уже занят; установка остановлена');
  }
  statusHeader.setValue('Email-уведомление');
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const range = sheet.getRange(2, KOLVIKA_LEADS.notificationColumn, lastRow - 1, 1);
    const statuses = range.getValues().map(values => [values[0] || 'ПРОПУЩЕНО: до включения уведомлений']);
    range.setValues(statuses);
  }
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'sendKolvikaLeadEmails')) {
    ScriptApp.newTrigger('sendKolvikaLeadEmails').timeBased().everyMinutes(5).create();
  }
}

/** Автоматический запуск каждые 5 минут; отправляет только новые строки. */
function sendKolvikaLeadEmails() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Не удалось получить блокировку отправки');
  try {
    const sheet = kolvikaLeadSheet_();
    if (sheet.getRange(1, KOLVIKA_LEADS.notificationColumn).getDisplayValue() !== 'Email-уведомление') {
      throw new Error('Сначала выполните setupKolvikaLeadEmails');
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const rows = sheet.getRange(2, 1, lastRow - 1, KOLVIKA_LEADS.notificationColumn).getDisplayValues();
    rows.forEach((row, offset) => {
      const state = row[KOLVIKA_LEADS.notificationColumn - 1];
      if (/^(ОТПРАВЛЕНО|ПРОПУЩЕНО)/.test(state)) return;
      if (!row[4]) return; // Ещё не завершённая строка.
      const route = kolvikaLeadRecipient_(row);
      if (!route) {
        sheet.getRange(offset + 2, KOLVIKA_LEADS.notificationColumn).setValue('ТРЕБУЕТ МАРШРУТА');
        return;
      }
      if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Исчерпан дневной лимит писем');
      const labels = ['Дата и время', 'Лендинг', 'Тип обращения', 'Имя', 'Телефон',
        'Сообщение', 'UTM source', 'UTM medium', 'UTM campaign', 'UTM term',
        'UTM content', 'Другие UTM', 'Страница', 'Referrer'];
      const body = labels.map((label, index) => label + ': ' + (row[index] || '—')).join('\n') +
        '\n\nЛид записан в таблице «Лиды и Оффлайн конверсии Колвика».';
      MailApp.sendEmail({to: route.email, subject: route.subject, body: body, name: 'KOLVIKA — заявки сайта'});
      sheet.getRange(offset + 2, KOLVIKA_LEADS.notificationColumn)
        .setValue('ОТПРАВЛЕНО ' + route.email + ' ' + new Date().toISOString());
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}
