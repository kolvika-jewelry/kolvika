(() => {
  const nav = document.querySelector('header.nav');
  if (!nav) return;

  let toggle = nav.querySelector('.hamburger, .hamb');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'hamburger';
    toggle.textContent = '☰';
    toggle.setAttribute('aria-label', 'Открыть меню');
    nav.append(toggle);
  }

  toggle.setAttribute('aria-label', 'Открыть меню');
  toggle.setAttribute('aria-expanded', 'false');
  const links = [...nav.querySelectorAll('.nav-links > a, .links > a')]
    .map((link) => `<a href="${link.getAttribute('href')}">${link.textContent.trim()}</a>`)
    .join('');
  const telegram = nav.querySelector('a[href*="t.me"]');
  const max = nav.querySelector('a[href*="max.ru"]');
  if (!telegram || !max) return;

  const menu = document.createElement('nav');
  menu.className = 'mobile-site-menu';
  menu.setAttribute('aria-label', 'Мобильное меню');
  menu.innerHTML = `
    <div class="mobile-site-menu__links">${links}</div>
    <div class="mobile-site-menu__contacts">
      <a class="mobile-site-menu__messenger" href="${telegram.href}" target="_blank" rel="noopener" aria-label="Telegram"><img src="${telegram.querySelector('img').src}" alt=""></a>
      <a class="mobile-site-menu__messenger" href="${max.href}" target="_blank" rel="noopener" aria-label="MAX"><img src="${max.querySelector('img').src}" alt=""></a>
      <a class="mobile-site-menu__call" href="tel:+74957998910">+7 (495) 799-89-10</a>
    </div>`;
  nav.insertAdjacentElement('afterend', menu);

  const syncMenuTop = () => {
    menu.style.top = `${nav.getBoundingClientRect().height}px`;
  };
  syncMenuTop();
  window.addEventListener('resize', syncMenuTop);

  const close = () => {
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Открыть меню');
  };
  toggle.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
  });
  menu.querySelectorAll('.mobile-site-menu__links a').forEach((link) => link.addEventListener('click', close));
})();
