(function () {
  "use strict";

  var COUNTER_ID = 112938684;
  var LEAD_ENDPOINT = "/api/leads";
  var clientId = "";
  var formStates = new WeakMap();

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
    if (window.KolvikaUtm && typeof window.KolvikaUtm.get === "function") {
      return Object.assign(tags, window.KolvikaUtm.get());
    }
    return tags;
  }

  function makeRequestId() {
    return window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : "";
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
    state.attempts++;
    return fetch(LEAD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.data),
      keepalive: true
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        return response.ok && body.ok === true &&
          body.saved === true && body.request_id === requestId;
      });
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
      var data = state ? state.data : Object.assign(
        {
          landing: document.body.dataset.landing || document.title,
          type: "Заявка",
          page: window.location.href,
          referrer: document.referrer || "",
          utm: tags,
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
      feedback(form, state, "pending", "Сохраняем заявку на сервере…");
      data.ym_client_id = clientId;
      state.promise = sendAndConfirm(state).then(function (saved) {
        if (saved) {
          state.confirmed = true;
          reachGoal("lead_submit");
          feedback(form, state, "success", "Заявка принята и передана в обработку.");
          state.promise = null;
          return { ok: true };
        }
        feedback(form, state, "error", "Сервер не подтвердил сохранение заявки. Данные остались в форме. Попробуйте ещё раз или напишите ювелиру.");
        state.promise = null;
        return { ok: false, reason: "unconfirmed" };
      }).catch(function () {
        feedback(form, state, "error", "Сервер не подтвердил сохранение заявки. Данные остались в форме. Попробуйте ещё раз или напишите ювелиру.");
        state.promise = null;
        return { ok: false, reason: "unconfirmed" };
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
