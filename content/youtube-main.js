// YouTube: remove ad data before the player sees it. Runs in the page (MAIN world).
// YouTube serves video ads from its own servers, so instead of blocking requests
// we delete the "ads" fields from the video info the player receives.

(() => {
  "use strict";
  const AD_KEYS = ["adPlacements", "adSlots", "playerAds", "adBreakHeartbeatParams"];

  function prune(obj) {
    if (!obj || typeof obj !== "object") return obj;
    for (const key of AD_KEYS) if (key in obj) delete obj[key];
    if (obj.playerResponse) prune(obj.playerResponse);
    return obj;
  }

  // 1. Video info embedded in the first page load.
  let initial;
  try {
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      get: () => initial,
      set: (v) => { initial = prune(v); }
    });
  } catch (e) {}

  // 2. Anything parsed with JSON.parse.
  const realParse = JSON.parse;
  JSON.parse = function (...args) {
    const result = realParse.apply(this, args);
    try { prune(result); } catch (e) {}
    return result;
  };

  // 3. Video info loaded when you click to another video.
  const realFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await realFetch.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (url.includes("/youtubei/v1/player") || url.includes("/youtubei/v1/next")) {
        const json = await res.clone().json();
        prune(json);
        return new Response(JSON.stringify(json), { status: res.status, statusText: res.statusText, headers: res.headers });
      }
    } catch (e) {}
    return res;
  };
})();
