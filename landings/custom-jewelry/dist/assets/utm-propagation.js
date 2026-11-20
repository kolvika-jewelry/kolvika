(function () {
  "use strict";

  var LANDING_HOSTS = new Set([
    "custom.kolvika.jewelry",
    "repair.kolvika.jewelry",
    "quiz.kolvika.jewelry"
  ]);
  var COOKIE_NAME = "kolvika_utm";
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
  var UTM_KEY = /^utm_[a-z0-9_]{1,63}$/i;
  var activeTags = {};
  var activeUpdatedAt = 0;

  function isUtmKey(key) {
    return UTM_KEY.test(key);
  }

  function readUtmParams(url) {
    var tags = {};
    url.searchParams.forEach(function (value, key) {
      if (isUtmKey(key) && value.trim()) tags[key.toLowerCase()] = value;
    });
    return tags;
  }

  function readCookie() {
    var prefix = COOKIE_NAME + "=";
    var item = document.cookie.split(";").map(function (part) {
      return part.trim();
    }).find(function (part) {
      return part.indexOf(prefix) === 0;
    });

    if (!item) return { tags: {}, updatedAt: 0 };
    try {
      var value = JSON.parse(decodeURIComponent(item.slice(prefix.length)));
      if (!value || typeof value !== "object" || Array.isArray(value) ||
          !value.tags || typeof value.tags !== "object" || Array.isArray(value.tags)) {
        return { tags: {}, updatedAt: 0 };
      }
      var tags = Object.keys(value.tags).reduce(function (collected, key) {
        if (isUtmKey(key) && typeof value.tags[key] === "string") {
          collected[key.toLowerCase()] = value.tags[key].slice(0, 1024);
        }
        return collected;
      }, {});
      return {
        tags: tags,
        updatedAt: Number(value.updatedAt) || 0
      };
    } catch (error) {
      return { tags: {}, updatedAt: 0 };
    }
  }

  function writeCookie(tags, updatedAt) {
    var serialized = encodeURIComponent(JSON.stringify({ updatedAt: updatedAt, tags: tags }));
    if (serialized.length > 3500) return false;

    var cookie = COOKIE_NAME + "=" + serialized +
      "; Max-Age=" + COOKIE_MAX_AGE +
      "; Path=/; SameSite=Lax";
    if (window.location.protocol === "https:") cookie += "; Secure";
    if (LANDING_HOSTS.has(window.location.hostname.toLowerCase())) {
      cookie += "; Domain=.kolvika.jewelry";
    }
    document.cookie = cookie;
    return true;
  }

  function hasUtm(url) {
    var found = false;
    url.searchParams.forEach(function (_, key) {
      if (isUtmKey(key)) found = true;
    });
    return found;
  }

  function syncTags() {
    var persisted = readCookie();
    if (persisted.updatedAt > activeUpdatedAt) {
      activeTags = persisted.tags;
      activeUpdatedAt = persisted.updatedAt;
    }
    return activeTags;
  }

  function decorateLink(link) {
    syncTags();
    var href = link.getAttribute("href");
    if (!href || href.charAt(0) === "#" || !Object.keys(activeTags).length) return;

    var url;
    try {
      url = new URL(href, document.baseURI);
    } catch (error) {
      return;
    }

    if ((url.protocol !== "https:" && url.protocol !== "http:") ||
        !LANDING_HOSTS.has(url.hostname.toLowerCase()) || hasUtm(url)) {
      return;
    }

    if (url.protocol === "http:") url.protocol = "https:";
    Object.keys(activeTags).forEach(function (key) {
      url.searchParams.set(key, activeTags[key]);
    });
    link.setAttribute("href", url.href);
  }

  function decorateLinks(root) {
    if (root && root.matches && root.matches("a[href]")) decorateLink(root);
    if (root && root.querySelectorAll) {
      root.querySelectorAll("a[href]").forEach(decorateLink);
    }
  }

  var incomingTags = readUtmParams(new URL(window.location.href));
  if (Object.keys(incomingTags).length) {
    // Новая рекламная метка заменяет предыдущую атрибуцию целиком.
    activeTags = incomingTags;
    activeUpdatedAt = Date.now() + Math.random();
    writeCookie(activeTags, activeUpdatedAt);
  } else {
    var stored = readCookie();
    activeTags = stored.tags;
    activeUpdatedAt = stored.updatedAt;
  }

  window.KolvikaUtm = {
    get: function () {
      return Object.assign({}, syncTags());
    },
    refreshLinks: function () {
      decorateLinks(document);
    }
  };

  decorateLinks(document);
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[href]");
    if (link) decorateLink(link);
  }, true);

  if (typeof MutationObserver === "function") {
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) decorateLinks(node);
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
