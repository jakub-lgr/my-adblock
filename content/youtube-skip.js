// YouTube backup: if an ad still starts playing, mute it, jump to its end
// and press "Skip".

(() => {
  "use strict";
  const SKIP_BUTTONS = ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-overlay-close-button";

  function check() {
    const player = document.querySelector("#movie_player");
    if (!player || !player.classList.contains("ad-showing")) return;

    const video = player.querySelector("video");
    if (video) {
      video.muted = true;
      if (isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
    }
    document.querySelectorAll(SKIP_BUTTONS).forEach((b) => b.click());
  }

  setInterval(check, 250);
})();
