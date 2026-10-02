(function () {
  "use strict";

  var COUNTER_ID = 112938684;
  var LEAD_ENDPOINT = "https://script.google.com/macros/s/AKfycbxtuT4b6ZFmorJqCanJS_IWlUKlKqmjpbXcekvGsY5n3u_x2cf5yMfDt-V6k6Ie3Ie_BA/exec";
  var clientId = "";

  function syncClientIdFields() {
    document.querySelectorAll("form").forEach(function (form) {
      var field = form.querySelector('input[name="ym_client_id"]');
      if (!field) {
        field = document.createElement("input");
        field.type = "hidden";
        field.name = "ym_client_id";
        form.appendChild(field);
      }
      field.value = clientId;
    });
  }

  function requestClientId(done) {
    if (clientId || typeof window.ym !== "function") {
      done(clientId);
      return;
    }
    var finished = false;
    var timeout = window.setTimeout(function () { finish(""); }, 1000);
    function finish(value) {
      if (value && /^\d+$/.test(String(value))) {
        clientId = String(value);
        syncClientIdFields();
      }
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      done(clientId);
    }
    try {
      window.ym(COUNTER_ID, "getClientID", finish);
    } catch (error) {
      finish("");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncClientIdFields);
  } else {
    syncClientIdFields();
  }
  requestClientId(function () {});

  function reachGoal(name) {
    if (typeof window.ym === "function") {
      window.ym(COUNTER_ID, "reachGoal", name);
    }
  }

  function collectUtms() {
    var tags = {};
    new URLSearchParams(window.location.search).forEach(function (value, key) {
      if (/^utm_/i.test(key)) tags[key.toLowerCase()] = value;
    });
    return tags;
  }

  window.KolvikaLead = {
    submit: function (payload) {
      var tags = collectUtms();
      var standardTags = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
      var data = Object.assign(
        {
          landing: document.body.dataset.landing || document.title,
          type: "Заявка",
          page: window.location.href,
          referrer: document.referrer || "",
          utm_source: tags.utm_source || "",
          utm_medium: tags.utm_medium || "",
          utm_campaign: tags.utm_campaign || "",
          utm_term: tags.utm_term || "",
          utm_content: tags.utm_content || "",
          utm_other: Object.keys(tags)
            .filter(function (key) { return standardTags.indexOf(key) === -1; })
            .map(function (key) { return key + "=" + tags[key]; })
            .join("&")
        },
        payload || {}
      );

      reachGoal("lead_submit");

      requestClientId(function (id) {
        data.ym_client_id = id;
        var body = new URLSearchParams();
        Object.keys(data).forEach(function (key) {
          body.append(key, data[key] == null ? "" : String(data[key]));
        });

        fetch(LEAD_ENDPOINT, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: body.toString(),
          keepalive: true
        }).catch(function () {});
      });
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
