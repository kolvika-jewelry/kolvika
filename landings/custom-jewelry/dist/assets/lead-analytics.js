(function () {
  "use strict";

  var COUNTER_ID = 112938684;

  function reachGoal(name) {
    if (typeof window.ym === "function") {
      window.ym(COUNTER_ID, "reachGoal", name);
    }
  }

  function utm(name) {
    return new URLSearchParams(window.location.search).get("utm_" + name) || "";
  }

  window.KolvikaLead = {
    submit: function (payload) {
      var data = Object.assign(
        {
          landing: document.documentElement.dataset.landing || document.title,
          type: "Заявка",
          page: window.location.href,
          referrer: document.referrer || "",
          utm_source: utm("source"),
          utm_medium: utm("medium"),
          utm_campaign: utm("campaign")
        },
        payload || {}
      );

      reachGoal("lead_submit");

      if (!window.KOLVIKA_LEAD_ENDPOINT) return;
      var body = new URLSearchParams();
      Object.keys(data).forEach(function (key) {
        body.append(key, data[key] == null ? "" : String(data[key]));
      });

      fetch(window.KOLVIKA_LEAD_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: body.toString(),
        keepalive: true
      }).catch(function () {});
    },
    goal: reachGoal
  };

  document.addEventListener("click", function (event) {
    var link = event.target.closest("a[href]");
    if (!link) return;
    var href = link.getAttribute("href") || "";
    if (/^tel:/i.test(href)) reachGoal("phone_click");
    if (/(?:t\.me|telegram\.me|max\.ru)/i.test(href)) reachGoal("messenger_click");
  });
})();
