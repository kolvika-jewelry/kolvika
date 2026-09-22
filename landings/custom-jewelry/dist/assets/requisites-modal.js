(() => {
  const triggers = document.querySelectorAll('[data-requisites]');
  if (!triggers.length) return;
  const style = document.createElement('style');
  style.textContent = `.requisites-modal{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:20px}.requisites-modal[hidden]{display:none}.requisites-modal__shade{position:absolute;inset:0;background:rgba(25,21,19,.62)}.requisites-modal__panel{position:relative;width:min(100%,620px);max-height:calc(100svh - 40px);overflow:auto;background:#fffdf9;color:#211e1b;padding:clamp(28px,5vw,52px);box-shadow:0 20px 60px rgba(0,0,0,.32)}.requisites-modal h2{margin:0 40px 22px 0;font:400 clamp(2rem,4vw,3.4rem)/.95 Georgia,serif}.requisites-modal__close{position:absolute;right:18px;top:15px;border:0;background:transparent;color:#211e1b;font-size:36px;line-height:1;cursor:pointer}.requisites-modal__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:#d7cdbf}.requisites-modal__grid div{padding:14px;background:#f7f3ed}.requisites-modal__grid b,.requisites-modal__grid span{display:block}.requisites-modal__grid b{margin-bottom:5px;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase}.requisites-modal__grid span{font-size:.95rem;line-height:1.35}.requisites-modal__note{margin:20px 0 0;font-size:.9rem;line-height:1.45}@media(max-width:560px){.requisites-modal__grid{grid-template-columns:1fr}.requisites-modal__panel{padding:28px 22px}}`;
  document.head.append(style);
  const modal = document.createElement('div');
  modal.className = 'requisites-modal';
  modal.hidden = true;
  modal.innerHTML = `<div class="requisites-modal__shade" data-requisites-close></div><section class="requisites-modal__panel" role="dialog" aria-modal="true" aria-labelledby="requisites-title"><button class="requisites-modal__close" type="button" aria-label="Закрыть" data-requisites-close>×</button><h2 id="requisites-title">Реквизиты KOLVIKA</h2><div class="requisites-modal__grid"><div><b>Юридическое лицо</b><span>ООО «КОЛВИКА»</span></div><div><b>ОГРН</b><span>1207700182580</span></div><div><b>ИНН</b><span>7730257442</span></div><div><b>КПП</b><span>773001001</span></div></div><p class="requisites-modal__note">Юридический и фактический адрес: 121087, Москва, Береговой проезд, д. 4/6, стр. 2, эт. 1, пом. 1, ком. 35.</p></section>`;
  document.body.append(modal);
  let previous;
  const close = () => { modal.hidden = true; document.body.style.overflow = ''; previous?.focus(); };
  triggers.forEach((trigger) => trigger.addEventListener('click', (event) => { event.preventDefault(); previous = document.activeElement; modal.hidden = false; document.body.style.overflow = 'hidden'; modal.querySelector('.requisites-modal__close').focus(); }));
  modal.querySelectorAll('[data-requisites-close]').forEach((button) => button.addEventListener('click', close));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) close(); });
})();
