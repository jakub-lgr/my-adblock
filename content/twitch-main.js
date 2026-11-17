// Twitch stream ad blocker. Runs in the page itself (MAIN world).
//
// Twitch "stitches" ads into the video stream, so blocking ad domains does
// nothing. The Twitch player downloads its video playlist (.m3u8) inside a
// Web Worker. We wrap that worker and check every playlist it downloads:
//   1. If the playlist contains ads, ask Twitch for the same stream as a
//      different player type (embed / popout / autoplay), which often has no
//      ads, and give the player that playlist instead.
//   2. If every backup also has ads, remove the ad segments. The stream then
//      pauses or buffers for the ad's length instead of showing it.

(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Code that runs INSIDE the player's worker. It must be self-contained,
  // because it is turned into text and placed in front of the worker's code.
  // ---------------------------------------------------------------------
  function workerPatch() {
    const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // Twitch website's public client id
    const BACKUP_PLAYER_TYPES = ["embed", "popout", "picture-by-picture", "autoplay"];
    const AD_MARKERS = ["stitched-ad", "X-TV-TWITCH-AD", "twitch-stitched-ad", "twitch-maf-ad", "twitch-ad-quartile"];
    const TOKEN_QUERY =
      'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {' +
      ' streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename }' +
      ' videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }';

    const realFetch = self.fetch.bind(self);
    // media playlist URL -> { channel, resolution, frameRate, backupUrl }
    const mediaInfo = new Map();
    let adActive = false;

    const urlOf = (input) => (typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url) || "";
    const hasAds = (text) => AD_MARKERS.some((m) => text.includes(m));
    // Shown in DevTools console only during ad breaks; filter by "My AdBlock".
    const log = (...args) => console.info("[My AdBlock Twitch]", ...args);

    // A separate channel, so Twitch's player never sees our messages.
    let channel = null;
    try { channel = new BroadcastChannel("my-adblock-twitch"); } catch (e) {}
    function notify(type) {
      try { channel && channel.postMessage(type); } catch (e) {}
    }

    // Read a master playlist and return [{ url, resolution, frameRate }].
    function parseMaster(text) {
      const lines = text.split("\n");
      const out = [];
      for (let i = 0; i < lines.length - 1; i++) {
        if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
        const res = (lines[i].match(/RESOLUTION=(\d+x\d+)/) || [])[1] || "";
        const fps = parseFloat((lines[i].match(/FRAME-RATE=([\d.]+)/) || [])[1] || "0");
        const url = lines[i + 1].trim();
        if (url.startsWith("http")) out.push({ url, resolution: res, frameRate: fps });
      }
      return out;
    }

    // Remove ad segments: Twitch marks real stream segments with ",live".
    // Returns null when nothing would be left: an empty live playlist makes
    // the Twitch player think the stream ended and show "offline".
    function stripAds(text) {
      const lines = text.split("\n");
      const out = [];
      let kept = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith("#EXTINF")) {
          if (!line.includes(",live")) {
            i++; // also skip the segment URL on the next line
            continue;
          }
          kept++;
        }
        if (line.startsWith("#EXT-X-TWITCH-PREFETCH")) continue; // prefetch may be an ad
        if (line.startsWith("#EXT-X-DATERANGE") && hasAds(line)) continue;
        out.push(line);
      }
      return kept > 0 ? out.join("\n") : null;
    }

    // Headers the Twitch website sends with its own GQL requests (device id,
    // integrity token...). Without them Twitch often refuses or ad-loads the
    // backup tokens. The page script sends them over the channel.
    let pageHeaders = {};
    if (channel) channel.onmessage = (msg) => {
      const d = msg.data;
      if (d && d.type === "gql-headers" && d.headers) pageHeaders = { ...pageHeaders, ...d.headers };
    };

    async function getToken(channel, playerType) {
      const res = await realFetch("https://gql.twitch.tv/gql", {
        method: "POST",
        headers: { ...pageHeaders, "Client-ID": CLIENT_ID, "Content-Type": "application/json" },
        body: JSON.stringify({
          operationName: "PlaybackAccessToken_Template",
          query: TOKEN_QUERY,
          variables: { isLive: true, login: channel, isVod: false, vodID: "", playerType }
        })
      });
      if (!res.ok) { log(playerType, "token HTTP", res.status); return null; }
      const json = await res.json();
      if (json && json.errors) log(playerType, "token errors", JSON.stringify(json.errors));
      return json && json.data && json.data.streamPlaybackAccessToken;
    }

    async function getBackupMediaUrl(info, playerType) {
      const token = await getToken(info.channel, playerType);
      if (!token) { log(playerType, "no token"); return null; }
      // Same request the player made (same API path and parameters), only
      // with the backup token.
      const backup = new URL(info.masterUrl);
      backup.searchParams.set("sig", token.signature);
      backup.searchParams.set("token", token.value);
      backup.searchParams.set("p", String(Math.floor(Math.random() * 1e7)));
      backup.searchParams.delete("play_session_id");
      const res = await realFetch(backup.href);
      if (!res.ok) { log(playerType, "master playlist HTTP", res.status); return null; }
      const streams = parseMaster(await res.text());
      if (!streams.length) { log(playerType, "master playlist has no streams"); return null; }
      // Same quality as the user picked, otherwise the closest one.
      const same = streams.find((s) => s.resolution === info.resolution && Math.round(s.frameRate) === Math.round(info.frameRate))
        || streams.find((s) => s.resolution === info.resolution);
      return (same || streams[0]).url;
    }

    // A backup media playlist without ads. If it has ads but also real
    // stream segments, those segments are good enough too.
    async function tryPlaylist(url, label) {
      try {
        const res = await realFetch(url);
        if (!res.ok) { log(label, "media playlist HTTP", res.status); return null; }
        const text = await res.text();
        if (!hasAds(text)) return text;
        const stripped = stripAds(text);
        log(label, stripped ? "has ads, using its live segments" : "has ads too");
        return stripped;
      } catch (e) {
        log(label, "failed", String(e));
        return null;
      }
    }

    async function replaceAdPlaylist(url, text) {
      const info = mediaInfo.get(url);
      if (!info) log("unknown media playlist, no backup possible:", url.split("?")[0]);
      if (info) {
        // Re-use the backup stream we found last time while the ad break lasts.
        if (info.backupUrl) {
          const clean = await tryPlaylist(info.backupUrl, "previous backup");
          if (clean) return clean;
        }
        for (const type of BACKUP_PLAYER_TYPES) {
          try {
            const backupUrl = await getBackupMediaUrl(info, type);
            if (!backupUrl) continue;
            const clean = await tryPlaylist(backupUrl, type);
            if (clean) {
              log(type, "OK, ad replaced");
              info.backupUrl = backupUrl;
              return clean;
            }
          } catch (e) {
            log(type, "failed", String(e));
          }
        }
      }
      const stripped = stripAds(text);
      if (stripped) return stripped;
      // The whole playlist is ads (typically a pre-roll) and no clean backup
      // was found. Let the ad play rather than break the stream.
      log("no clean stream found, letting the ad play");
      notify("ad-shown");
      return text;
    }

    self.fetch = async function (input, init) {
      const url = urlOf(input);

      // Master playlist: remember which media playlists belong to which channel.
      // Twitch uses both /api/channel/hls/ and /api/v2/channel/hls/.
      const master = url.match(/usher\.ttvnw\.net\/api\/(?:v\d+\/)?channel\/hls\/([^/.?]+)\.m3u8/);
      if (master) {
        const res = await realFetch(input, init);
        if (res.status !== 200) return res;
        const text = await res.text();
        const channel = master[1].toLowerCase();
        for (const s of parseMaster(text)) {
          mediaInfo.set(s.url, { channel, masterUrl: url, resolution: s.resolution, frameRate: s.frameRate });
        }
        return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
      }

      // Media playlist (refreshed every few seconds while watching).
      if (url.includes("ttvnw.net") && url.includes(".m3u8")) {
        const res = await realFetch(input, init);
        if (res.status !== 200) return res;
        let text = await res.text();
        if (hasAds(text)) {
          if (!adActive) { adActive = true; notify("ad-start"); }
          text = await replaceAdPlaylist(url, text);
        } else if (adActive) {
          adActive = false;
          const info = mediaInfo.get(url);
          if (info) info.backupUrl = null;
          notify("ad-end");
        }
        return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
      }

      return realFetch(input, init);
    };
  }

  // ---------------------------------------------------------------------
  // Page side: wrap the Worker constructor so our patch runs first.
  // ---------------------------------------------------------------------
  const RealWorker = window.Worker;
  if (!RealWorker || RealWorker.__myAdblock) return;

  function readSync(url) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, false);
      xhr.send();
      return xhr.status === 200 || xhr.status === 0 ? xhr.responseText : null;
    } catch (e) {
      return null;
    }
  }

  function isPlayerWorker(absUrl, source) {
    const text = (absUrl + " " + (source || "")).toLowerCase();
    return text.includes("amazon-ivs") || text.includes("wasmworker") || text.includes("ivs-worker");
  }

  class PatchedWorker extends RealWorker {
    constructor(scriptURL, options) {
      let absUrl = "";
      try { absUrl = new URL(String(scriptURL), location.href).href; } catch (e) {}
      const source = absUrl.startsWith("blob:") ? readSync(absUrl) : `importScripts(${JSON.stringify(absUrl)});`;

      if (!source || !isPlayerWorker(absUrl, source)) {
        super(scriptURL, options);
        return;
      }
      const blob = new Blob([`(${workerPatch.toString()})();\n${source}`], { type: "text/javascript" });
      super(URL.createObjectURL(blob), options);
    }
  }
  PatchedWorker.__myAdblock = true;
  window.Worker = PatchedWorker;

  // Small on-screen note while an ad break is being replaced.
  let banner = null;
  let channel = null;
  try { channel = new BroadcastChannel("my-adblock-twitch"); } catch (e) {}

  // Copy the headers Twitch's own GQL requests carry, for the worker's backup
  // token requests. Only these names; the login token is never copied.
  const COPY_HEADERS = ["device-id", "x-device-id", "client-integrity", "client-session-id", "client-version"];
  function captureHeaders(input, init) {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
      if (!url || !url.includes("gql.twitch.tv")) return;
      const all = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers((init && init.headers) || undefined).forEach((v, k) => all.set(k, v));
      const found = {};
      for (const name of COPY_HEADERS) if (all.get(name)) found[name] = all.get(name);
      // Sent every time (they are tiny), so a newly created player worker
      // gets them too, e.g. after switching channels.
      if (Object.keys(found).length && channel) channel.postMessage({ type: "gql-headers", headers: found });
    } catch (e) {}
  }
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    captureHeaders(input, init);
    return realFetch.apply(this, arguments);
  };

  if (channel) channel.onmessage = (msg) => {
    const e = { detail: msg.data };
    if (typeof e.detail !== "string") return;
    if (e.detail === "ad-shown") e.detail = "ad-end"; // ad is playing: no "skipping" note
    const container = document.querySelector(".video-player__container") || document.querySelector("[data-a-target='video-player']");
    if (e.detail === "ad-start" && container && !banner) {
      banner = document.createElement("div");
      banner.textContent = "My AdBlock: skipping ad break…";
      banner.style.cssText = "position:absolute;top:10px;left:10px;z-index:9999;padding:4px 8px;" +
        "background:rgba(0,0,0,.7);color:#fff;font:12px sans-serif;border-radius:4px;pointer-events:none";
      container.appendChild(banner);
    } else if (e.detail === "ad-end" && banner) {
      banner.remove();
      banner = null;
    }
  };
})();
