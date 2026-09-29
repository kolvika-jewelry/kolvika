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
  const landing = String(row[1] || '').toLowerCase();
  const type = String(row[2] || '').toLowerCase();
  const message = String(row[5] || '').toLowerCase();

  // Переделка и переплавка идут ювелиру, даже если запрос пришёл с лендинга ремонта.
  if (/передел|переплав/.test(type + ' ' + message)) return KOLVIKA_LEADS.jewelryEmail;
  if (/ремонт|пайк|закрепк|полировк|чистк|реставрац|родирован/.test(type + ' ' + landing)) {
    return KOLVIKA_LEADS.repairEmail;
  }
  if (/заказ|изготовлен|квиз|украшен/.test(type + ' ' + landing)) {
    return KOLVIKA_LEADS.jewelryEmail;
  }
  return null;
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
      const recipient = kolvikaLeadRecipient_(row);
      if (!recipient) {
        sheet.getRange(offset + 2, KOLVIKA_LEADS.notificationColumn).setValue('ТРЕБУЕТ МАРШРУТА');
        return;
      }
      if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Исчерпан дневной лимит писем');
      const subject = 'KOLVIKA — новая заявка: ' + (row[2] || row[1]);
      const labels = ['Дата и время', 'Лендинг', 'Тип обращения', 'Имя', 'Телефон',
        'Сообщение', 'UTM source', 'UTM medium', 'UTM campaign', 'UTM term',
        'UTM content', 'Другие UTM', 'Страница', 'Referrer'];
      const body = labels.map((label, index) => label + ': ' + (row[index] || '—')).join('\n') +
        '\n\nЛид записан в таблице «Лиды и Оффлайн конверсии Колвика».';
      MailApp.sendEmail({to: recipient, subject: subject, body: body, name: 'KOLVIKA — заявки сайта'});
      sheet.getRange(offset + 2, KOLVIKA_LEADS.notificationColumn)
        .setValue('ОТПРАВЛЕНО ' + recipient + ' ' + new Date().toISOString());
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}
