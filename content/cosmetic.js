// Hides ad boxes that remain on the page (empty slots, sponsored widgets).
// Add your own CSS selectors to the lists below.

const AD_SELECTORS = [
  // General ad slots
  "ins.adsbygoogle",
  ".adsbygoogle",
  "[id^='google_ads_iframe']",
  "[id^='div-gpt-ad']",
  "[data-google-query-id]",
  "[data-ad-slot]",
  "[data-ad-unit]",
  "iframe[src*='doubleclick.net']",
  "iframe[src*='googlesyndication.com']",
  "iframe[src*='amazon-adsystem.com']",
  "[id^='taboola-']",
  ".trc_related_container",
  ".OUTBRAIN",
  "[data-widget-id^='outbrain']",
  ".ad-banner",
  ".ad-container",
  ".ad-wrapper",
  ".ad-slot",
  ".advertisement",
  ".sponsored-ad",
  "#ad-banner",
  "#ad-container",

  // YouTube
  "#masthead-ad",
  "#player-ads",
  "ytd-ad-slot-renderer",
  "ytd-in-feed-ad-layout-renderer",
  "ytd-banner-promo-renderer",
  "ytd-promoted-sparkles-web-renderer",
  "ytd-display-ad-renderer",
  "ytd-companion-slot-renderer",
  "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
  ".ytp-ad-overlay-container",

  // Twitch
  ".stream-display-ad__wrapper",
  "[data-a-target='video-ad-label']"
];

(() => {
  const style = document.createElement("style");
  style.id = "my-adblock-style";
  style.textContent = AD_SELECTORS.join(",\n") + " { display: none !important; }";
  (document.head || document.documentElement).appendChild(style);
})();
