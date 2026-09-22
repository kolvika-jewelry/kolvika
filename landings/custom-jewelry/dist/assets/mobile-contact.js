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
  const requisitesTriggers = document.querySelectorAll('[data-requisites]');
  if (requisitesTriggers.length) {
    const requisitesStyle = document.createElement('style');
    requisitesStyle.textContent = '.requisites-modal{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:20px}.requisites-modal[hidden]{display:none}.requisites-modal__shade{position:absolute;inset:0;background:rgba(25,21,19,.62)}.requisites-modal__panel{position:relative;width:min(100%,620px);max-height:calc(100svh - 40px);overflow:auto;background:#fffdf9;color:#211e1b;padding:clamp(28px,5vw,52px);box-shadow:0 20px 60px rgba(0,0,0,.32)}.requisites-modal h2{margin:0 40px 22px 0;font:400 clamp(2rem,4vw,3.4rem)/.95 Georgia,serif}.requisites-modal__close{position:absolute;right:18px;top:15px;border:0;background:transparent;color:#211e1b;font-size:36px;line-height:1;cursor:pointer}.requisites-modal__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#d7cdbf}.requisites-modal__grid div{padding:14px;background:#f7f3ed}.requisites-modal__grid b,.requisites-modal__grid span{display:block}.requisites-modal__grid b{margin-bottom:5px;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase}.requisites-modal__grid span{font-size:.95rem;line-height:1.35}.requisites-modal__note{margin:20px 0 0;font-size:.9rem;line-height:1.45}@media(max-width:560px){.requisites-modal__grid{grid-template-columns:1fr}.requisites-modal__panel{padding:28px 22px}}';
    document.head.append(requisitesStyle);
    const requisites = document.createElement('div');
    requisites.className = 'requisites-modal';
    requisites.hidden = true;
    requisites.innerHTML = '<div class="requisites-modal__shade" data-requisites-close></div><section class="requisites-modal__panel" role="dialog" aria-modal="true" aria-labelledby="requisites-title"><button class="requisites-modal__close" type="button" aria-label="Закрыть" data-requisites-close>×</button><h2 id="requisites-title">Реквизиты KOLVIKA</h2><div class="requisites-modal__grid"><div><b>Юридическое лицо</b><span>ООО «КОЛВИКА»</span></div><div><b>ОГРН</b><span>1207700182580</span></div><div><b>ИНН</b><span>7730257442</span></div><div><b>КПП</b><span>773001001</span></div></div><p class="requisites-modal__note">Юридический и фактический адрес: 121087, Москва, Береговой проезд, д. 4/6, стр. 2, эт. 1, пом. 1, ком. 35.</p></section>';
    document.body.append(requisites);
    let lastRequisitesFocus;
    const closeRequisites = () => { requisites.hidden = true; document.body.style.overflow = ''; lastRequisitesFocus?.focus(); };
    requisitesTriggers.forEach((trigger) => trigger.addEventListener('click', (event) => { event.preventDefault(); lastRequisitesFocus = document.activeElement; requisites.hidden = false; document.body.style.overflow = 'hidden'; requisites.querySelector('.requisites-modal__close').focus(); }));
    requisites.querySelectorAll('[data-requisites-close]').forEach((button) => button.addEventListener('click', closeRequisites));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !requisites.hidden) closeRequisites(); });
  }
})();
