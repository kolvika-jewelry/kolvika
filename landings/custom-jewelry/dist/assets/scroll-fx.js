/* Scroll storytelling: staggered reveals, parallax, tilt, pinned process story. No dependencies. */
(function () {
  "use strict";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) return;
  var root = document.documentElement;
  root.classList.add("fx");
  var isMobile = function () { return window.matchMedia("(max-width: 800px)").matches; };

  /* 1. Staggered reveal ---------------------------------------------------- */
  var ITEMS = [
    ".service", ".extra", ".gallery-grid .card", ".catalog-grid .work", "#works .gallery .work",
    ".reviews-block__card", ".price-group", ".trust-block__item", ".company-story__fact",
    ".process-grid > article", ".steps > .step:not([data-process-image])", ".metrics > *", ".numbers > *",
    ".before-after-mini figure", ".repair-cases article"
  ].join(",");
  var seen = new Set();
  var groups = new Map();
  document.querySelectorAll(ITEMS).forEach(function (el) {
    if (seen.has(el) || el.closest(".fx-pinned")) return;
    seen.add(el);
    var p = el.parentElement;
    var i = groups.get(p) || 0;
    groups.set(p, i + 1);
    el.classList.add("fx-item");
    el.style.setProperty("--fx-d", Math.min(i * 70, 350) + "ms");
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("fx-in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  seen.forEach(function (el) { io.observe(el); });
  setTimeout(function () {
    seen.forEach(function (el) {
      if (!el.classList.contains("fx-in") && el.getBoundingClientRect().top < window.innerHeight * 1.1) el.classList.add("fx-in");
    });
  }, 3500);

  /* 3. Parallax ------------------------------------------------------------ */
  var PAR = ".hero-photo img, .hero-visual img, .materials-band img, .final-cta > img, .company-story__visual img, .trust-block__visual img, .gift-block img";
  var pars = [];
  document.querySelectorAll(PAR).forEach(function (img) {
    if (img.closest(".fx-pinned")) return;
    var w = img.parentElement;
    if (!w) return;
    w.classList.add("fx-par-wrap");
    img.classList.add("fx-par");
    pars.push({ img: img, wrap: w });
  });

  /* 4. Tilt (desktop pointer only) ---------------------------------------- */
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    document.querySelectorAll(".gallery-grid .card, .catalog-grid .work, .service, .extra, #works .gallery .work").forEach(function (el) {
      el.classList.add("fx-tilt");
      el.addEventListener("mousemove", function (ev) {
        var r = el.getBoundingClientRect();
        var x = (ev.clientX - r.left) / r.width - 0.5, y = (ev.clientY - r.top) / r.height - 0.5;
        el.classList.add("is-tilt");
        el.style.transform = "perspective(900px) rotateX(" + (-y * 5).toFixed(2) + "deg) rotateY(" + (x * 6).toFixed(2) + "deg) translateZ(0)";
      });
      el.addEventListener("mouseleave", function () { el.classList.remove("is-tilt"); el.style.transform = ""; });
    });
  }

  /* 6. One rAF loop for everything scroll-linked -------------------------- */
  var nav = document.querySelector(".nav");
  var ticking = false;
  function frame() {
    ticking = false;
    var vh = window.innerHeight;
    var amp = isMobile() ? 14 : 30;
    for (var i = 0; i < pars.length; i++) {
      var r = pars[i].wrap.getBoundingClientRect();
      if (r.bottom < -80 || r.top > vh + 80) continue;
      var prog = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
      pars[i].img.style.setProperty("--py", (-prog * amp).toFixed(1) + "px");
    }
    if (nav) nav.classList.toggle("is-scrolled", window.scrollY > 12);
  }
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  frame();
})();
