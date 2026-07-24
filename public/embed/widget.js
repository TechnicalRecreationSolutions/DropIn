(function () {
  "use strict";

  var BASE_URL = "https://dropin.app";

  function init(script) {
    var orgId = script.getAttribute("data-org-id");
    var facilityId = script.getAttribute("data-facility-id") || "";
    var theme = script.getAttribute("data-theme") || "light";
    var containerSelector = script.getAttribute("data-container") || "#dropin-widget";
    var height = script.getAttribute("data-height") || "600";

    if (!orgId) {
      console.error("[Dropin] data-org-id is required on the dropin widget script tag.");
      return;
    }

    var container = document.querySelector(containerSelector);
    if (!container) {
      console.error("[Dropin] Could not find container element: " + containerSelector);
      return;
    }

    // Build iframe src
    var src = BASE_URL + "/widget/" + encodeURIComponent(orgId);
    var params = [];
    if (facilityId) params.push("facilityId=" + encodeURIComponent(facilityId));
    if (theme && theme !== "light") params.push("theme=" + encodeURIComponent(theme));
    if (params.length) src += "?" + params.join("&");

    // Create iframe
    var iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.style.width = "100%";
    iframe.style.height = height + "px";
    iframe.style.border = "none";
    iframe.style.overflow = "hidden";
    iframe.style.borderRadius = "12px";
    iframe.setAttribute("title", "Dropin Drop-in Schedule");
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("allow", "");

    // Clear container and inject iframe
    container.innerHTML = "";
    container.appendChild(iframe);

    // Auto-resize via postMessage from the widget page
    window.addEventListener("message", function (event) {
      if (
        typeof event.data === "object" &&
        event.data.type === "dropin:resize" &&
        typeof event.data.height === "number"
      ) {
        iframe.style.height = event.data.height + "px";
      }
    });

    // Track widget view (fire-and-forget; no PII)
    try {
      fetch(BASE_URL + "/api/analytics/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "widget_view",
          orgId: orgId,
          facilityId: facilityId || null,
          referrer: document.referrer || null,
          pathname: window.location.pathname,
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (_) {}
  }

  // Find the script tag that loaded this file
  var scripts = document.querySelectorAll("script[data-org-id]");
  for (var i = 0; i < scripts.length; i++) {
    init(scripts[i]);
  }

  // Also handle dynamically added script tags (data-dropin-late)
  document.addEventListener("dropin:init", function (e) {
    if (e.detail && e.detail.script) init(e.detail.script);
  });
})();
