/* KOLVIKA · вовлечённость посетителей для Яндекс Метрики (счётчик 112938684).
   Шлёт JavaScript-цели (reachGoal) по одному разу за визит-страницу:
   eng_scroll_50, eng_scroll_90 — прокрутка страницы;
   eng_time_30, eng_time_90 — активное время (вкладка видна, было действие за последние 15 с);
   eng_view_works, eng_view_price, eng_view_contacts — ключевой блок был на экране ≥1 с;
   eng_form_start — начал заполнять любую форму;
   quiz_start, quiz_step_4, quiz_contacts — шаги квиза (2, 4, 6);
   eng_engaged — вовлечённый визит: (≥45 с активно и прокрутка ≥50%) или квиз до шага 3,
   или начало формы, или клик по телефону/мессенджеру. */
(function () {
  "use strict";
  var COUNTER_ID = 112938684;
  var sent = {};
  var state = { active: 0, scroll: 0, quizStep: 1, formStart: false, contactClick: false };

  function goal(name) {
    if (sent[name]) return;
    sent[name] = true;
    if (typeof window.ym === "function") {
      try { window.ym(COUNTER_ID, "reachGoal", name); } catch (e) { /* счётчик недоступен */ }
    }
  }

  function checkEngaged() {
    if ((state.active >= 45 && state.scroll >= 50) || state.quizStep >= 3 || state.formStart || state.contactClick) {
      goal("eng_engaged");
    }
  }

  // Прокрутка
  function onScroll() {
    var doc = document.documentElement;
    var max = Math.max(doc.scrollHeight - window.innerHeight, 1);
    var pct = Math.min(100, Math.round((window.scrollY || doc.scrollTop) / max * 100));
    if (pct > state.scroll) state.scroll = pct;
    if (state.scroll >= 50) goal("eng_scroll_50");
    if (state.scroll >= 90) goal("eng_scroll_90");
    checkEngaged();
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  // Активное время
  var lastAction = Date.now();
  ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"].forEach(function (type) {
    window.addEventListener(type, function () { lastAction = Date.now(); }, { passive: true });
  });
  setInterval(function () {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastAction > 15000) return;
    state.active += 1;
    if (state.active >= 30) goal("eng_time_30");
    if (state.active >= 90) goal("eng_time_90");
    checkEngaged();
  }, 1000);

  // Ключевые блоки на экране
  function watchBlocks() {
    var blocks = [
      ["eng_view_works", "#works"],
      ["eng_view_price", "#price"],
      ["eng_view_contacts", ".final-cta, #contacts"]
    ];
    if (!("IntersectionObserver" in window)) return;
    blocks.forEach(function (pair) {
      var els = document.querySelectorAll(pair[1]);
      if (!els.length) return;
      var timers = new Map();
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var visible = en.intersectionRect.height;
          var enough = Math.min(en.boundingClientRect.height * 0.3, window.innerHeight * 0.4);
          if (en.isIntersecting && visible >= enough) {
            if (!timers.has(en.target)) timers.set(en.target, setTimeout(function () { goal(pair[0]); io.disconnect(); }, 1000));
          } else if (timers.has(en.target)) {
            clearTimeout(timers.get(en.target)); timers.delete(en.target);
          }
        });
      }, { threshold: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1] });
      els.forEach(function (el) { io.observe(el); });
    });
  }

  // Начало заполнения формы
  function onFormTouch(e) {
    var t = e.target;
    if (t && t.form && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== "hidden") {
      state.formStart = true; goal("eng_form_start"); checkEngaged();
    }
  }
  ["focusin", "input", "pointerdown"].forEach(function (type) { document.addEventListener(type, onFormTouch, true); });

  // Клик по телефону / мессенджеру
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    if (/^tel:|t\.me|telegram\.me|max\.ru/i.test(a.getAttribute("href") || "")) { state.contactClick = true; checkEngaged(); }
  });

  // Шаги квиза
  function watchQuiz() {
    var steps = document.querySelectorAll(".step[data-step]");
    if (!steps.length) return;
    function update() {
      var active = document.querySelector(".step.active[data-step]");
      var n = active ? parseInt(active.getAttribute("data-step"), 10) : 1;
      if (n > state.quizStep) state.quizStep = n;
      if (state.quizStep >= 2) goal("quiz_start");
      if (state.quizStep >= 4) goal("quiz_step_4");
      if (state.quizStep >= 6) goal("quiz_contacts");
      checkEngaged();
    }
    var mo = new MutationObserver(update);
    steps.forEach(function (s) { mo.observe(s, { attributes: true, attributeFilter: ["class"] }); });
  }

  function init() { watchBlocks(); watchQuiz(); onScroll(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
