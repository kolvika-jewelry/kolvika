(function () {
  "use strict";

  var COUNTER_ID = 112938684;
  var LEAD_ENDPOINT = "https://script.google.com/macros/s/AKfycbxtuT4b6ZFmorJqCanJS_IWlUKlKqmjpbXcekvGsY5n3u_x2cf5yMfDt-V6k6Ie3Ie_BA/exec";
  var clientId = "";
  var formStates = new WeakMap();
  var receiptCallbacks = Object.create(null);

  // Google Apps Script не даёт прочитать ответ no-cors POST. Отдельный GET
  // подтверждает наличие именно этой заявки в таблице, не раскрывая её данные.
  window.__kolvikaLeadAck = function (receipt) {
    if (receipt && receiptCallbacks[receipt.request_id]) {
      receiptCallbacks[receipt.request_id](receipt);
    }
  };

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
      try {
        window.ym(COUNTER_ID, "reachGoal", name);
      } catch (error) {
        // Сбой счётчика не меняет результат сохранения заявки.
      }
    }
  }

  function collectUtms() {
    var tags = {};
    new URLSearchParams(window.location.search).forEach(function (value, key) {
      if (/^utm_/i.test(key)) tags[key.toLowerCase()] = value;
    });
    return tags;
  }

  function makeRequestId() {
    return window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : "";
  }

  function receiptExists(requestId) {
    return new Promise(function (resolve) {
      var script = document.createElement("script");
      var finished = false;
      var timer;
      function finish(saved) {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        delete receiptCallbacks[requestId];
        script.remove();
        resolve(saved);
      }
      receiptCallbacks[requestId] = function (receipt) {
        finish(receipt.request_id === requestId && receipt.saved === true);
      };
      script.onerror = function () { finish(false); };
      script.async = true;
      script.src = LEAD_ENDPOINT + "?receipt=" + encodeURIComponent(requestId) + "&t=" + Date.now();
      timer = window.setTimeout(function () { finish(false); }, 1800);
      document.head.appendChild(script);
    });
  }

  function waitForReceipt(requestId) {
    var deadline = Date.now() + 12000;
    function check() {
      return receiptExists(requestId).then(function (saved) {
        if (saved || Date.now() >= deadline) return saved;
        return new Promise(function (resolve) {
          window.setTimeout(resolve, 500);
        }).then(check);
      });
    }
    return check();
  }

  function feedback(form, state, phase, message) {
    var button = form.querySelector('[type="submit"]');
    if (button) {
      button.disabled = phase !== "error";
      button.textContent = phase === "pending" ? "Отправляем…" :
        phase === "success" ? "Заявка отправлена" : state.buttonLabel;
    }
    var note = form.querySelector(".lead-send-status");
    if (!note) {
      note = document.createElement("p");
      note.className = "lead-send-status";
      note.setAttribute("role", "status");
      note.setAttribute("aria-live", "polite");
      note.style.gridColumn = "1 / -1";
      note.style.fontSize = "14px";
      note.style.lineHeight = "1.4";
      note.style.margin = "12px 0 0";
      form.appendChild(note);
    }
    note.textContent = message;
  }

  function sendAndConfirm(state) {
    var requestId = state.data.request_id;
    var checkBeforeRetry = state.attempts > 0
      ? receiptExists(requestId)
      : Promise.resolve(false);
    return checkBeforeRetry.then(function (alreadySaved) {
      if (alreadySaved) return true;
      state.attempts++;
      var body = new URLSearchParams();
      Object.keys(state.data).forEach(function (key) {
        body.append(key, state.data[key] == null ? "" : String(state.data[key]));
      });
      // Opaque response и успешное завершение fetch не считаются подтверждением.
      try {
        Promise.resolve(fetch(LEAD_ENDPOINT, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: body.toString(),
          keepalive: true
        })).catch(function () {});
      } catch (error) {
        // Запрос мог дойти до сервера даже при сетевой ошибке: проверим ID.
      }
      return waitForReceipt(requestId);
    });
  }

  window.KolvikaLead = {
    submit: function (payload, form) {
      if (!form) return Promise.resolve({ ok: false, reason: "missing_form" });
      var signature = JSON.stringify(payload || {});
      var state = formStates.get(form);
      if (state && state.promise) return state.promise;
      if (state && state.confirmed) return Promise.resolve({ ok: true });
      if (state && state.signature !== signature) {
        feedback(form, state, "error", "Данные изменились после первой попытки. Чтобы не создать дубль, напишите ювелиру напрямую.");
        return Promise.resolve({ ok: false, reason: "changed" });
      }
      var requestId = state ? state.data.request_id : makeRequestId();
      if (!requestId) {
        var fallback = state || { buttonLabel: form.querySelector('[type="submit"]')?.textContent || "Отправить" };
        feedback(form, fallback, "error", "Не удалось отправить заявку. Напишите ювелиру напрямую.");
        return Promise.resolve({ ok: false, reason: "no_request_id" });
      }
      var tags = collectUtms();
      var standardTags = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
      var data = state ? state.data : Object.assign(
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
            .join("&"),
          request_id: requestId
        },
        payload || {}
      );
      data.request_id = requestId;
      if (!state) {
        state = {
          data: data,
          signature: signature,
          attempts: 0,
          confirmed: false,
          buttonLabel: form.querySelector('[type="submit"]')?.textContent || "Отправить"
        };
        formStates.set(form, state);
      }
      feedback(form, state, "pending", "Проверяем, дошла ли заявка…");
      state.promise = new Promise(function (resolve) {
        requestClientId(function (id) {
          data.ym_client_id = id;
          sendAndConfirm(state).then(function (saved) {
            if (saved) {
              state.confirmed = true;
              reachGoal("lead_submit");
              feedback(form, state, "success", "Заявка получена.");
              resolve({ ok: true });
            } else {
              feedback(form, state, "error", "Не удалось подтвердить получение заявки. Данные остались в форме. Попробуйте ещё раз или напишите ювелиру.");
              resolve({ ok: false, reason: "unconfirmed" });
            }
            state.promise = null;
          }).catch(function () {
            feedback(form, state, "error", "Не удалось подтвердить получение заявки. Данные остались в форме. Попробуйте ещё раз или напишите ювелиру.");
            state.promise = null;
            resolve({ ok: false, reason: "unconfirmed" });
          });
        });
      });
      return state.promise;
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
