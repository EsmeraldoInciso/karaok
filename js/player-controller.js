import { initYouTubePlayer, loadVideo, stopVideo, togglePlayPause, getPlayerTime, getPlayerDuration, getPlayerState } from "./youtube-api.js";
import {
  updateQueueItemStatus,
  removeQueueItem,
  onQueueChanged,
  onParticipantsChanged
} from "./firebase-client.js";
import { endKaraokeSession } from "./session-manager.js";
import { appUrl } from "./links.js";

let currentSessionCode = null;
let currentSong = null;
let queue = [];
let isPlaying = false;
let unsubscribeQueue = null;
let unsubscribeParticipants = null;

// DOM references (set during init)
let elements = {};

// Overlay auto-hide timer
let overlayTimer = null;
const OVERLAY_HIDE_DELAY = 3000;

// End screen detection timer
let endScreenTimer = null;

function initPlayerController(sessionCode, domElements) {
  currentSessionCode = sessionCode;
  elements = domElements;

  // Initialize YouTube player
  initYouTubePlayer("youtube-player", onPlayerStateChange, onPlayerError);

  // Listen for queue changes
  unsubscribeQueue = onQueueChanged(sessionCode, (songs) => {
    queue = songs;
    renderQueue();
    playNextIfIdle();
  });

  // Listen for participant changes
  if (elements.participantCount) {
    unsubscribeParticipants = onParticipantsChanged(sessionCode, (participants) => {
      elements.participantCount.textContent = participants.length;
    });
  }

  // Host controls
  if (elements.skipBtn) {
    elements.skipBtn.addEventListener("click", skipCurrentSong);
  }
  if (elements.endSessionBtn) {
    elements.endSessionBtn.addEventListener("click", handleEndSession);
  }

  // Overlay skip button
  const overlaySkipBtn = document.getElementById("overlay-skip-btn");
  if (overlaySkipBtn) {
    overlaySkipBtn.addEventListener("click", skipCurrentSong);
  }

  // Overlay play/pause button
  const playPauseBtn = document.getElementById("overlay-playpause-btn");
  if (playPauseBtn) {
    playPauseBtn.addEventListener("click", () => {
      togglePlayPause();
    });
  }

  // Overlay fullscreen button
  const fullscreenBtn = document.getElementById("overlay-fullscreen-btn");
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", toggleFullscreen);
  }

  // Listen for fullscreen changes (including Escape key exit)
  document.addEventListener("fullscreenchange", onFullscreenChange);

  // Overlay auto-hide on mouse activity
  const playerContainer = document.getElementById("player-container");
  if (playerContainer) {
    playerContainer.addEventListener("mousemove", showOverlay);
    playerContainer.addEventListener("mouseenter", showOverlay);
    playerContainer.addEventListener("mouseleave", hideOverlay);
    // Also show on touch for mobile
    playerContainer.addEventListener("touchstart", showOverlay, { passive: true });
  }
}

function onPlayerStateChange(event) {
  // YT.PlayerState.ENDED === 0
  if (event.data === 0) {
    markCurrentAsPlayed();
  }

  // Start monitoring for end screen when playing
  if (event.data === 1) {
    startEndScreenMonitor();
  } else if (event.data === 0 || event.data === 5) {
    stopEndScreenMonitor();
  }

  updatePlayPauseIcon(event.data);
}

function startEndScreenMonitor() {
  stopEndScreenMonitor();
  endScreenTimer = setInterval(() => {
    const current = getPlayerTime();
    const duration = getPlayerDuration();
    const playerEl = document.getElementById("youtube-player");
    if (!playerEl || !duration) return;

    const remaining = duration - current;

    // Show overlay with up-next info 10 seconds before end
    if (remaining <= 10 && remaining > 0) {
      showOverlay();
    }
  }, 1000);
}

function stopEndScreenMonitor() {
  if (endScreenTimer) {
    clearInterval(endScreenTimer);
    endScreenTimer = null;
  }
}

function updatePlayPauseIcon(state) {
  const btn = document.getElementById("overlay-playpause-btn");
  const playIcon = document.getElementById("pp-play-icon");
  const pauseIcon = document.getElementById("pp-pause-icon");
  if (!btn || !playIcon || !pauseIcon) return;

  // Show button when a video is loaded
  if (currentSong) {
    btn.classList.remove("hidden");
  }

  // 1 = playing, 2 = paused, 3 = buffering
  if (state === 1 || state === 3) {
    playIcon.classList.add("hidden");
    pauseIcon.classList.remove("hidden");
  } else {
    playIcon.classList.remove("hidden");
    pauseIcon.classList.add("hidden");
  }
}

function onPlayerError(event) {
  // Auto-skip unplayable videos (embedding disabled, removed, etc.)
  if (currentSong) {
    console.warn(`Skipping unplayable video: ${currentSong.title}`);
    updateQueueItemStatus(currentSessionCode, currentSong.id, "skipped");
    currentSong = null;
    isPlaying = false;
    playNextIfIdle();
  }
}

async function markCurrentAsPlayed() {
  if (currentSong) {
    await updateQueueItemStatus(currentSessionCode, currentSong.id, "played");
    currentSong = null;
    isPlaying = false;
    playNextIfIdle();
  }
}

async function playNextIfIdle() {
  if (isPlaying || !queue.length) {
    updateNowPlaying();
    return;
  }

  // Find first queued song (not already playing)
  const nextSong = queue.find((s) => s.status === "queued");
  if (!nextSong) {
    updateNowPlaying();
    return;
  }

  isPlaying = true;
  currentSong = nextSong;

  // Hide placeholder when a song starts
  const placeholder = document.getElementById("player-placeholder");
  if (placeholder) placeholder.classList.add("hidden");

  await updateQueueItemStatus(currentSessionCode, nextSong.id, "playing");
  await loadVideo(nextSong.videoId);
  updateNowPlaying();
}

async function skipCurrentSong() {
  if (currentSong) {
    await updateQueueItemStatus(currentSessionCode, currentSong.id, "skipped");
    currentSong = null;
    isPlaying = false;
    stopVideo();
    playNextIfIdle();
  }
}

async function removeFromQueue(queueItemId) {
  await removeQueueItem(currentSessionCode, queueItemId);
}

async function handleEndSession() {
  if (confirm("Are you sure you want to end this session?")) {
    await endKaraokeSession(currentSessionCode);
    window.location.href = appUrl("/dashboard/");
  }
}

function showOverlay() {
  const overlay = document.getElementById("player-overlay");
  const container = document.getElementById("player-container");
  if (!overlay) return;
  overlay.classList.remove("opacity-0");
  overlay.classList.add("opacity-100");
  if (container) container.classList.add("overlay-visible");

  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(hideOverlay, OVERLAY_HIDE_DELAY);
}

function hideOverlay() {
  const overlay = document.getElementById("player-overlay");
  const container = document.getElementById("player-container");
  if (!overlay) return;
  overlay.classList.remove("opacity-100");
  overlay.classList.add("opacity-0");
  if (container) container.classList.remove("overlay-visible");
  clearTimeout(overlayTimer);
}

function toggleFullscreen() {
  const container = document.getElementById("player-container");
  if (!container) return;

  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    container.requestFullscreen();
  }
}

function onFullscreenChange() {
  const isFs = !!document.fullscreenElement;
  const expandIcon = document.getElementById("fs-expand-icon");
  const shrinkIcon = document.getElementById("fs-shrink-icon");
  const overlayNowPlaying = document.getElementById("overlay-now-playing");

  if (expandIcon && shrinkIcon) {
    expandIcon.classList.toggle("hidden", isFs);
    shrinkIcon.classList.toggle("hidden", !isFs);
  }

  // Show now-playing info in fullscreen overlay (since bottom bar is hidden)
  if (overlayNowPlaying) {
    overlayNowPlaying.classList.toggle("hidden", !isFs);
  }

  // Show overlay briefly when entering/exiting fullscreen
  showOverlay();
}

function updateOverlay() {
  const upNextEl = document.getElementById("overlay-up-next");
  const skipWrap = document.getElementById("overlay-skip-wrap");
  if (!upNextEl || !skipWrap) return;

  // Show/hide skip button based on whether a song is playing
  if (currentSong) {
    skipWrap.classList.remove("hidden");
  } else {
    skipWrap.classList.add("hidden");
  }

  // Show/hide up-next bar
  const nextSong = queue.find((s) => s.status === "queued" && (!currentSong || s.id !== currentSong.id));
  if (nextSong) {
    upNextEl.classList.remove("hidden");
    const thumbEl = document.getElementById("overlay-next-thumb");
    const titleEl = document.getElementById("overlay-next-title");
    const byEl = document.getElementById("overlay-next-by");
    if (titleEl) titleEl.textContent = nextSong.title || "Unknown";
    if (byEl) byEl.textContent = nextSong.addedByName || "";
    if (thumbEl && nextSong.thumbnailUrl) {
      thumbEl.src = nextSong.thumbnailUrl;
      thumbEl.classList.remove("hidden");
    } else if (thumbEl) {
      thumbEl.classList.add("hidden");
    }
  } else {
    upNextEl.classList.add("hidden");
  }

  // Update overlay now-playing (visible in fullscreen)
  const overlayNowTitle = document.getElementById("overlay-now-title");
  const overlayNowBy = document.getElementById("overlay-now-by");
  if (overlayNowTitle && overlayNowBy) {
    if (currentSong) {
      overlayNowTitle.textContent = currentSong.title || "";
      overlayNowBy.textContent = `Requested by ${currentSong.addedByName || ""}`;
    } else {
      overlayNowTitle.textContent = "";
      overlayNowBy.textContent = "";
    }
  }
}

function updateNowPlaying() {
  if (!elements.nowPlaying) return;

  if (currentSong) {
    elements.nowPlaying.innerHTML = `
      <p class="text-sm text-gray-400">Now Playing</p>
      <p class="text-lg font-semibold text-white truncate">${escapeHtml(currentSong.title)}</p>
      <p class="text-sm text-gray-400">Requested by ${escapeHtml(currentSong.addedByName)}</p>
    `;
  } else {
    elements.nowPlaying.innerHTML = `
      <p class="text-gray-400">No song playing. Queue a song to get started!</p>
    `;
  }

  // Also update the fullscreen overlay
  updateOverlay();
}

function renderQueue() {
  if (!elements.queueList) return;

  const queuedSongs = queue.filter((s) => s.status === "queued");

  if (!queuedSongs.length) {
    elements.queueList.innerHTML = `
      <p class="text-gray-500 text-center py-4">Queue is empty</p>
    `;
    return;
  }

  elements.queueList.innerHTML = queuedSongs
    .map(
      (song, index) => `
      <div class="flex items-center gap-3 p-3 bg-gray-800 rounded-lg">
        <span class="text-gray-500 font-mono text-sm w-6 text-center">${index + 1}</span>
        <img src="${escapeHtml(song.thumbnailUrl)}" alt="" class="w-16 h-12 object-cover rounded">
        <div class="flex-1 min-w-0">
          <p class="text-white text-sm truncate">${escapeHtml(song.title)}</p>
          <p class="text-gray-400 text-xs">${escapeHtml(song.addedByName)}</p>
        </div>
        <button onclick="window.playerRemoveFromQueue('${song.id}')" class="text-red-400 hover:text-red-300 p-1" title="Remove">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
    `
    )
    .join("");
}

// Expose for inline onclick handlers
window.playerRemoveFromQueue = removeFromQueue;

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function cleanup() {
  if (unsubscribeQueue) unsubscribeQueue();
  if (unsubscribeParticipants) unsubscribeParticipants();
}

export { initPlayerController, cleanup };
