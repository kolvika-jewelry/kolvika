(() => {
  const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent && !parent.closest('script, style, textarea') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const textNodes = [];
  while (textWalker.nextNode()) textNodes.push(textWalker.currentNode);
  textNodes.forEach((node) => {
    node.nodeValue = node.nodeValue.replace(/\b(в|во|к|ко|с|со|у|о|об|от|до|за|на|по|из|изо|и|а|но)\s+/giu, '$1\u00a0');
  });
  const isRepair = location.pathname.includes('/repair');
  const repairAction = isRepair ? '<button class="mobile-direct-contact__repair" type="button">Обсудить</button>' : '';
  const directBar = document.querySelector('.mobile-contact-bar') ? '' : `
    <nav class="mobile-direct-contact${isRepair ? ' mobile-direct-contact--repair' : ''}" aria-label="Быстрая связь">
      <a class="mobile-direct-contact__call" href="tel:+74957998910">Позвонить</a>
      <a class="mobile-direct-contact__telegram" href="https://t.me/kolvikajewelry" target="_blank" rel="noopener">Telegram</a>
      <a class="mobile-direct-contact__max" href="https://max.ru/u/f9LHodD0cOI4g-uBJsVW5pUD094Y6odkduNePwKVwKDNAKVIAYgPVIW1dg4" target="_blank" rel="noopener">MAX</a>
      ${repairAction}
    </nav>`;
  const markup = `${directBar}
    <button class="mobile-quick-contact" type="button" aria-label="Открыть способы связи" aria-controls="quick-contact-dialog">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 15.5a4 4 0 0 1-4 4H9l-5 3v-14a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v7Z" stroke="currentColor" stroke-width="1.7"/><path d="M8 10h8M8 14h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
    </button>
    <div class="quick-contact-modal" id="quick-contact-dialog" hidden aria-hidden="true">
      <div class="quick-contact-shade" data-quick-close></div>
      <section class="quick-contact-panel" role="dialog" aria-modal="true" aria-labelledby="quick-contact-title">
        <button class="quick-contact-close" type="button" aria-label="Закрыть" data-quick-close>×</button>
        <h2 id="quick-contact-title">Готово! Куда прислать расчёт?</h2>
        <p>Или напишите сразу в Telegram / MAX — фото украшения можно прикрепить к сообщению.</p>
        <div class="quick-contact-channels">
          <div class="quick-contact-channel telegram"><b>Telegram</b><a href="https://t.me/kolvikajewelry" target="_blank" rel="noopener">Telegram</a></div>
          <div class="quick-contact-channel max"><b>MAX</b><a href="https://max.ru/u/f9LHodD0cOI4g-uBJsVW5pUD094Y6odkduNePwKVwKDNAKVIAYgPVIW1dg4" target="_blank" rel="noopener">MAX</a></div>
        </div>
        <form class="quick-contact-form">
          <h3>Оставьте телефон — мастер перезвонит</h3>
          <div class="quick-contact-fields"><input name="name" autocomplete="name" placeholder="Ваше имя" required><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 (___) ___-__-__" required></div>
          <label class="quick-contact-consent"><input type="checkbox" required><span>Соглашаюсь с <a href="https://kolvika.jewelry/page/politika-konfidentsialnosti" target="_blank" rel="noopener">политикой конфиденциальности</a>.</span></label>
          <button class="quick-contact-send" type="submit">Оставить контакты</button>
          <p class="quick-contact-send-note" hidden>Чтобы отправить заявку мастеру, выберите Telegram или MAX выше.</p>
        </form>
      </section>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', markup);
  const trigger = document.querySelector('.mobile-quick-contact');
  const dialog = document.querySelector('.quick-contact-modal');
  const close = () => { dialog.hidden = true; dialog.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; trigger.focus(); };
  const open = () => { dialog.hidden = false; dialog.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; dialog.querySelector('.quick-contact-close').focus(); };
  trigger.addEventListener('click', open);
  document.querySelector('.mobile-direct-contact__repair')?.addEventListener('click', () => document.querySelector('.contact-trigger')?.click());
  dialog.querySelectorAll('[data-quick-close]').forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dialog.hidden) { close(); return; }
    if (event.key !== 'Tab' || dialog.hidden) return;
    const focusable = [...dialog.querySelectorAll('button,a[href],input')].filter((el) => el.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  const maskPhone = (input) => {
    if (input.dataset.phoneMaskReady) return;
    input.dataset.phoneMaskReady = 'true';
    input.placeholder = '+7 (___) ___-__-__';
    input.inputMode = 'tel';
    input.autocomplete = 'tel';
    input.addEventListener('input', () => {
      let digits = input.value.replace(/\D/g, '');
      if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
      if (digits && !digits.startsWith('7')) digits = `7${digits}`;
      digits = digits.slice(0, 11);
      const local = digits.slice(1);
      let value = '+7';
      if (local.length) value += ` (${local.slice(0, 3)}`;
      if (local.length >= 3) value += ')';
      if (local.length > 3) value += ` ${local.slice(3, 6)}`;
      if (local.length > 6) value += `-${local.slice(6, 8)}`;
      if (local.length > 8) value += `-${local.slice(8, 10)}`;
      input.value = value;
      input.setCustomValidity(digits.length === 11 ? '' : 'Введите номер в формате +7 (___) ___-__-__');
    });
    input.addEventListener('blur', () => {
      if (input.value && input.value.replace(/\D/g, '').length !== 11) input.reportValidity();
    });
  };
  document.querySelectorAll('input[type="tel"]').forEach(maskPhone);
  dialog.querySelector('.quick-contact-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    form.querySelector('.quick-contact-send-note').hidden = false;
  });
})();
