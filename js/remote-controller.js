import { searchKaraoke } from "./youtube-api.js";
import { addToQueue, onFullQueueChanged, updateQueueItemStatus } from "./firebase-client.js";

let currentSessionCode = null;
let currentUser = null;
let queue = [];
let unsubscribeQueue = null;
let searchTimeout = null;

// DOM references
let elements = {};

function initRemoteController(sessionCode, user, domElements) {
  currentSessionCode = sessionCode;
  currentUser = user;
  elements = domElements;

  // Listen for queue changes
  unsubscribeQueue = onFullQueueChanged(sessionCode, (songs) => {
    queue = songs;
    renderQueue();
    renderNowPlaying();
  });

  // Search input with debounce
  if (elements.searchInput) {
    elements.searchInput.addEventListener("input", () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        handleSearch(elements.searchInput.value.trim());
      }, 500);
    });
  }

  // Search form submit
  if (elements.searchForm) {
    elements.searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      clearTimeout(searchTimeout);
      handleSearch(elements.searchInput.value.trim());
    });
  }
}

async function handleSearch(queryText) {
  if (!queryText) {
    if (elements.searchResults) {
      elements.searchResults.innerHTML = "";
    }
    return;
  }

  if (elements.searchResults) {
    elements.searchResults.innerHTML = `
      <div class="flex justify-center py-8">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
      </div>
    `;
  }

  try {
    const results = await searchKaraoke(queryText);
    renderSearchResults(results);
  } catch (error) {
    if (elements.searchResults) {
      elements.searchResults.innerHTML = `
        <p class="text-red-400 text-center py-4">Search failed: ${escapeHtml(error.message)}</p>
      `;
    }
  }
}

function renderSearchResults(results) {
  if (!elements.searchResults) return;

  if (!results.length) {
    elements.searchResults.innerHTML = `
      <p class="text-gray-400 text-center py-4">No results found</p>
    `;
    return;
  }

  elements.searchResults.innerHTML = results
    .map(
      (result) => `
      <div class="flex items-center gap-3 p-3 bg-gray-800 rounded-lg">
        <img src="${escapeHtml(result.thumbnailUrl)}" alt="" class="w-20 h-14 object-cover rounded flex-shrink-0">
        <div class="flex-1 min-w-0">
          <p class="text-white text-sm leading-tight line-clamp-2">${escapeHtml(result.title)}</p>
          <p class="text-gray-400 text-xs mt-1">${escapeHtml(result.channelTitle)}</p>
        </div>
        <button onclick="window.remoteAddToQueue('${result.videoId}', '${escapeAttr(result.title)}', '${escapeAttr(result.thumbnailUrl)}')"
          class="flex-shrink-0 bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors">
          + Queue
        </button>
      </div>
    `
    )
    .join("");
}

async function handleAddToQueue(videoId, title, thumbnailUrl) {
  try {
    await addToQueue(currentSessionCode, {
      videoId,
      title,
      thumbnailUrl,
      addedBy: currentUser.uid,
      addedByName: currentUser.displayName || "Guest"
    });

    showToast("Song added to queue!");
  } catch (error) {
    showToast("Failed to add song: " + error.message, true);
  }
}

function renderNowPlaying() {
  if (!elements.nowPlaying) return;

  const playingSong = queue.find((s) => s.status === "playing");

  if (playingSong) {
    elements.nowPlaying.innerHTML = `
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="w-3 h-3 bg-green-500 rounded-full animate-pulse flex-shrink-0"></div>
        <div class="min-w-0">
          <p class="text-xs text-gray-400">Now Playing</p>
          <p class="text-sm text-white truncate">${escapeHtml(playingSong.title)}</p>
        </div>
      </div>
      <button onclick="window.remoteSkipSong('${playingSong.id}')"
        class="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>
        Skip
      </button>
    `;
  } else {
    elements.nowPlaying.innerHTML = `
      <p class="text-gray-500 text-sm">No song playing</p>
    `;
  }
}

function renderQueue() {
  if (!elements.queueList) return;

  const queuedSongs = queue.filter((s) => s.status === "queued");

  if (!queuedSongs.length) {
    elements.queueList.innerHTML = `
      <p class="text-gray-500 text-center py-4 text-sm">Queue is empty. Search for a song!</p>
    `;
    return;
  }

  elements.queueList.innerHTML = queuedSongs
    .map(
      (song, index) => `
      <div class="flex items-center gap-2 p-2 bg-gray-800 rounded-lg">
        <span class="text-gray-500 font-mono text-xs w-5 text-center">${index + 1}</span>
        <div class="flex-1 min-w-0">
          <p class="text-white text-xs truncate">${escapeHtml(song.title)}</p>
          <p class="text-gray-400 text-xs">${escapeHtml(song.addedByName)}</p>
        </div>
      </div>
    `
    )
    .join("");
}

function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = `fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm text-white z-50 transition-opacity ${
    isError ? "bg-red-600" : "bg-green-600"
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function escapeAttr(text) {
  return (text || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

async function handleSkipSong(queueItemId) {
  try {
    await updateQueueItemStatus(currentSessionCode, queueItemId, "skipped");
    showToast("Song skipped!");
  } catch (error) {
    showToast("Failed to skip: " + error.message, true);
  }
}

// Expose for inline onclick handlers
window.remoteAddToQueue = handleAddToQueue;
window.remoteSkipSong = handleSkipSong;

function cleanup() {
  if (unsubscribeQueue) unsubscribeQueue();
}

export { initRemoteController, cleanup };
