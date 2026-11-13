// Service worker: shows the blocked-request count on the icon, registers the
// page scripts, and applies the "paused" sites to both.

const ALLOW_RULE_ID = 1000;

// Page scripts. Paused sites are excluded from all of them.
const SCRIPTS = [
  {
    id: "cosmetic",
    matches: ["<all_urls>"],
    js: ["content/cosmetic.js"],
    runAt: "document_start",
    allFrames: true
  },
  {
    id: "youtube-main",
    matches: ["*://*.youtube.com/*"],
    js: ["content/youtube-main.js"],
    runAt: "document_start",
    world: "MAIN"
  },
  {
    id: "youtube-skip",
    matches: ["*://*.youtube.com/*"],
    js: ["content/youtube-skip.js"],
    runAt: "document_idle"
  },
  {
    id: "twitch-main",
    matches: ["*://*.twitch.tv/*"],
    js: ["content/twitch-main.js"],
    runAt: "document_start",
    allFrames: true,
    world: "MAIN"
  }
];

async function getAllowlist() {
  const { allowlist = [] } = await chrome.storage.local.get("allowlist");
  return allowlist;
}

async function syncBlockRules(allowlist) {
  const update = { removeRuleIds: [ALLOW_RULE_ID] };
  if (allowlist.length > 0) {
    update.addRules = [
      {
        id: ALLOW_RULE_ID,
        priority: 100, // higher than block rules, so it wins
        action: { type: "allowAllRequests" },
        condition: {
          requestDomains: allowlist,
          resourceTypes: ["main_frame", "sub_frame"]
        }
      }
    ];
  }
  await chrome.declarativeNetRequest.updateDynamicRules(update);
}

async function syncScripts(allowlist) {
  const excludeMatches = allowlist.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]);
  const existing = await chrome.scripting.getRegisteredContentScripts();
  if (existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
  }
  await chrome.scripting.registerContentScripts(
    SCRIPTS.map((s) => (excludeMatches.length ? { ...s, excludeMatches } : s))
  );
}

async function syncAll() {
  const allowlist = await getAllowlist();
  await syncBlockRules(allowlist);
  await syncScripts(allowlist);
}

async function setup() {
  await chrome.declarativeNetRequest.setExtensionActionOptions({
    displayActionCountAsBadgeText: true
  });
  await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  await syncAll();
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.allowlist) syncAll();
});
