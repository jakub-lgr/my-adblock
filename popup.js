const siteEl = document.getElementById("site");
const statusEl = document.getElementById("status");
const button = document.getElementById("toggle");

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try {
    const url = new URL(tab.url);
    if (url.protocol === "http:" || url.protocol === "https:") {
      host = url.hostname.replace(/^www\./, "");
    }
  } catch (e) {}

  if (!host) {
    siteEl.textContent = "This page can't be filtered.";
    button.textContent = "Not available";
    button.disabled = true;
    return;
  }
  siteEl.textContent = host;

  async function render() {
    const { allowlist = [] } = await chrome.storage.local.get("allowlist");
    const allowed = allowlist.includes(host);
    statusEl.textContent = allowed ? "Ads are allowed on this site." : "Blocking ads on this site.";
    button.textContent = allowed ? "Turn blocking back on" : "Pause on this site";
    button.className = allowed ? "off" : "";
    return allowlist;
  }

  let allowlist = await render();

  button.addEventListener("click", async () => {
    allowlist = allowlist.includes(host)
      ? allowlist.filter((d) => d !== host)
      : [...allowlist, host];
    await chrome.storage.local.set({ allowlist });
    await render();
    // Give the background a moment to update rules, then reload the page.
    setTimeout(() => chrome.tabs.reload(tab.id), 300);
  });
})();
