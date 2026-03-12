import { YOUTUBE_API_KEY, PIPED_PROXY_URL } from "./config.js";

// --- Search cache (avoids duplicate API calls) ---
const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const entry = searchCache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) {
    console.log("Search result from cache");
    return entry.data;
  }
  searchCache.delete(key);
  return null;
}

function setCache(key, data) {
  searchCache.set(key, { data, time: Date.now() });
}

// Extract video ID from a YouTube URL (returns null if not a YouTube URL)
function extractVideoId(input) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/  // bare video ID
  ];
  for (const pattern of patterns) {
    const match = input.trim().match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Check if input looks like a YouTube URL
function isYouTubeUrl(input) {
  return /(?:youtube\.com|youtu\.be)/.test(input.trim());
}

// --- Piped API via Cloudflare Worker proxy (free, unlimited) ---

async function pipedSearch(queryText, maxResults = 10) {
  try {
    const response = await fetch(`${PIPED_PROXY_URL}/search?q=${encodeURIComponent(queryText)}&filter=videos`, {
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.error) return null;

    const items = (data.items || []).slice(0, maxResults);

    const results = items.map((item) => ({
      videoId: item.url?.replace("/watch?v=", "") || "",
      title: item.title || "Unknown",
      channelTitle: item.uploaderName || "",
      thumbnailUrl: item.thumbnail || ""
    }));

    // Filter out non-embeddable videos using YouTube's free oEmbed endpoint
    const checked = await Promise.all(
      results.map(async (r) => {
        try {
          const res = await fetch(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${r.videoId}&format=json`,
            { method: "HEAD", signal: AbortSignal.timeout(3000) }
          );
          return res.ok ? r : null;
        } catch {
          return r; // On timeout, keep the result (let player handle it)
        }
      })
    );

    return checked.filter(Boolean);
  } catch {
    return null;
  }
}

async function pipedGetVideo(videoId) {
  try {
    const response = await fetch(`${PIPED_PROXY_URL}/streams/${videoId}`, {
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.error) return null;

    return {
      videoId,
      title: data.title || "Unknown",
      channelTitle: data.uploader || "",
      thumbnailUrl: data.thumbnailUrl || ""
    };
  } catch {
    return null;
  }
}

// --- YouTube Data API (fallback, uses quota) ---

async function youtubeApiSearch(queryText, maxResults = 10) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(queryText)}&type=video&videoEmbeddable=true&videoSyndicated=true&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "YouTube search failed");
  }

  const data = await response.json();

  return data.items.map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url
  }));
}

async function youtubeApiGetVideo(videoId) {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch video details");
  }

  const data = await response.json();

  if (!data.items || !data.items.length) {
    throw new Error("Video not found");
  }

  const item = data.items[0];
  return {
    videoId: item.id,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url
  };
}

// --- Public API: Piped proxy first, YouTube API fallback ---

// Check if a title looks like a karaoke/instrumental video (not just lyrics)
function isLikelyKaraoke(title) {
  const lower = title.toLowerCase();
  const karaokeTerms = ["karaoke", "instrumental", "backing track", "sing along", "minus one"];
  const lyricsOnly = /\blyrics?\b/i.test(title) && !karaokeTerms.some((t) => lower.includes(t));
  return !lyricsOnly;
}

async function searchKaraoke(queryText, maxResults = 10) {
  const searchQuery = `${queryText} karaoke`;

  // Check cache first
  const cached = getCached(searchQuery);
  if (cached) return cached;

  // Try Piped proxy first (free, unlimited)
  // Fetch extra results since some may be filtered out (lyrics-only, non-embeddable)
  const pipedResults = await pipedSearch(searchQuery, maxResults + 10);
  if (pipedResults && pipedResults.length > 0) {
    console.log("Search via Piped proxy (free)");
    const filtered = pipedResults.filter((r) => isLikelyKaraoke(r.title)).slice(0, maxResults);
    const final = filtered.length > 0 ? filtered : pipedResults.slice(0, maxResults);
    setCache(searchQuery, final);
    return final;
  }

  // Fallback to YouTube Data API (100 units per search)
  console.warn("Piped proxy unavailable, falling back to YouTube API");
  const ytResults = await youtubeApiSearch(searchQuery, maxResults);
  const filtered = ytResults.filter((r) => isLikelyKaraoke(r.title)).slice(0, maxResults);
  const final = filtered.length > 0 ? filtered : ytResults.slice(0, maxResults);
  setCache(searchQuery, final);
  return final;
}

async function getVideoById(videoId) {
  // Check cache
  const cacheKey = `video:${videoId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Try Piped proxy first (free)
  const pipedResult = await pipedGetVideo(videoId);
  if (pipedResult) {
    console.log("Video lookup via Piped proxy (free)");
    setCache(cacheKey, pipedResult);
    return pipedResult;
  }

  // Fallback to YouTube Data API (1 unit)
  console.warn("Piped proxy unavailable, falling back to YouTube API");
  const ytResult = await youtubeApiGetVideo(videoId);
  setCache(cacheKey, ytResult);
  return ytResult;
}

// --- Dual Player: HTML5 (Piped, ad-free) + YouTube IFrame (fallback) ---

let player = null; // YouTube IFrame player
let playerReadyPromise = null;
let htmlPlayer = null; // HTML5 <video> element
let activePlayer = "none"; // "html" | "youtube" | "none"
let loadedVideoId = null;
let htmlPlayerState = -1; // Tracks state using YT state codes

// Callbacks stored during init
let stateChangeCallback = null;
let errorCallback = null;

function initYouTubePlayer(elementId, onStateChange, onError) {
  stateChangeCallback = onStateChange;
  errorCallback = onError;

  // Init HTML5 player
  htmlPlayer = document.getElementById("html-player");
  if (htmlPlayer) {
    htmlPlayer.addEventListener("playing", () => {
      htmlPlayerState = 1; // PLAYING
      if (stateChangeCallback) stateChangeCallback({ data: 1 });
    });
    htmlPlayer.addEventListener("pause", () => {
      if (htmlPlayer.ended) return; // Let 'ended' handle this
      htmlPlayerState = 2; // PAUSED
      if (stateChangeCallback) stateChangeCallback({ data: 2 });
    });
    htmlPlayer.addEventListener("ended", () => {
      htmlPlayerState = 0; // ENDED
      if (stateChangeCallback) stateChangeCallback({ data: 0 });
    });
    htmlPlayer.addEventListener("waiting", () => {
      htmlPlayerState = 3; // BUFFERING
      if (stateChangeCallback) stateChangeCallback({ data: 3 });
    });
    htmlPlayer.addEventListener("error", () => {
      console.warn("HTML5 player error, falling back to YouTube");
      if (activePlayer === "html" && loadedVideoId) {
        // Fallback to YouTube iframe
        fallbackToYouTube(loadedVideoId);
      } else if (errorCallback) {
        errorCallback({ data: 2 });
      }
    });
  }

  // Init YouTube IFrame player
  playerReadyPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => {
      player = new YT.Player(elementId, {
        height: "100%",
        width: "100%",
        playerVars: {
          autoplay: 1,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          fs: 0,
          iv_load_policy: 3,
          disablekb: 0
        },
        events: {
          onReady: () => resolve(player),
          onStateChange: (event) => {
            if (activePlayer === "youtube" && stateChangeCallback) stateChangeCallback(event);
          },
          onError: (event) => {
            console.warn("YouTube player error:", event.data);
            if (activePlayer === "youtube" && errorCallback) errorCallback(event);
          }
        }
      });
    };

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    } else if (window.YT && window.YT.Player) {
      window.onYouTubeIframeAPIReady();
    }
  });

  return playerReadyPromise;
}

// --- Piped stream URL fetching ---

async function getPipedStreamUrl(videoId) {
  try {
    const response = await fetch(`${PIPED_PROXY_URL}/streams/${videoId}`, {
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.error) return null;

    // Prefer HLS stream (adaptive, has audio+video)
    if (data.hls) return { url: data.hls, type: "hls" };

    // Fallback: find a video stream that includes audio (videoOnly === false)
    const combinedStreams = (data.videoStreams || [])
      .filter((s) => !s.videoOnly && s.url)
      .sort((a, b) => {
        // Prefer higher quality but cap at 720p for performance
        const aRes = parseInt(a.quality) || 0;
        const bRes = parseInt(b.quality) || 0;
        const aScore = aRes <= 720 ? aRes : 720 - (aRes - 720);
        const bScore = bRes <= 720 ? bRes : 720 - (bRes - 720);
        return bScore - aScore;
      });

    if (combinedStreams.length > 0) {
      return { url: combinedStreams[0].url, type: "direct" };
    }

    return null;
  } catch {
    return null;
  }
}

// --- Player visibility switching ---

function showHtmlPlayer() {
  if (htmlPlayer) htmlPlayer.classList.remove("hidden");
  const ytEl = document.getElementById("youtube-player");
  if (ytEl) ytEl.style.display = "none";
  const shield = document.getElementById("iframe-shield");
  if (shield) shield.style.display = "none";
}

function showYouTubePlayer() {
  if (htmlPlayer) {
    htmlPlayer.classList.add("hidden");
    htmlPlayer.pause();
    htmlPlayer.removeAttribute("src");
    htmlPlayer.load();
  }
  const ytEl = document.getElementById("youtube-player");
  if (ytEl) ytEl.style.display = "";
  const shield = document.getElementById("iframe-shield");
  if (shield) shield.style.display = "";
}

// --- Load video: Piped first, YouTube fallback ---

async function loadVideo(videoId) {
  loadedVideoId = videoId;

  // Try Piped stream first (ad-free)
  const stream = await getPipedStreamUrl(videoId);

  if (stream && htmlPlayer) {
    try {
      activePlayer = "html";
      showHtmlPlayer();

      if (stream.type === "hls" && htmlPlayer.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS support (Safari)
        htmlPlayer.src = stream.url;
      } else if (stream.type === "hls") {
        // Non-Safari: HLS not natively supported, use direct stream or fallback
        console.log("HLS not supported natively, trying direct stream...");
        const directStream = await getPipedDirectStream(videoId);
        if (directStream) {
          htmlPlayer.src = directStream;
        } else {
          throw new Error("No playable stream");
        }
      } else {
        htmlPlayer.src = stream.url;
      }

      htmlPlayer.load();
      await htmlPlayer.play();
      console.log("Playing via Piped (ad-free)");
      return;
    } catch (err) {
      console.warn("Piped playback failed:", err.message);
    }
  }

  // Fallback to YouTube IFrame
  await fallbackToYouTube(videoId);
}

async function getPipedDirectStream(videoId) {
  try {
    const response = await fetch(`${PIPED_PROXY_URL}/streams/${videoId}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const data = await response.json();

    const streams = (data.videoStreams || [])
      .filter((s) => !s.videoOnly && s.url)
      .sort((a, b) => {
        const aRes = parseInt(a.quality) || 0;
        const bRes = parseInt(b.quality) || 0;
        const aScore = aRes <= 720 ? aRes : 720 - (aRes - 720);
        const bScore = bRes <= 720 ? bRes : 720 - (bRes - 720);
        return bScore - aScore;
      });

    return streams.length > 0 ? streams[0].url : null;
  } catch {
    return null;
  }
}

async function fallbackToYouTube(videoId) {
  activePlayer = "youtube";
  showYouTubePlayer();

  if (!player) {
    await playerReadyPromise;
  }

  console.log("Playing via YouTube IFrame (fallback)");
  player.loadVideoById(videoId);
}

// --- Unified player controls ---

async function stopVideo() {
  if (activePlayer === "html" && htmlPlayer) {
    htmlPlayer.pause();
    htmlPlayer.removeAttribute("src");
    htmlPlayer.load();
  } else if (player) {
    player.stopVideo();
  }
  activePlayer = "none";
}

function togglePlayPause() {
  if (activePlayer === "html" && htmlPlayer) {
    if (htmlPlayer.paused) {
      htmlPlayer.play();
    } else {
      htmlPlayer.pause();
    }
  } else if (player) {
    const state = player.getPlayerState();
    if (state === 1) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }
}

function getPlayerTime() {
  if (activePlayer === "html" && htmlPlayer) {
    return htmlPlayer.currentTime || 0;
  }
  return player ? player.getCurrentTime() : 0;
}

function getPlayerDuration() {
  if (activePlayer === "html" && htmlPlayer) {
    return htmlPlayer.duration || 0;
  }
  return player ? player.getDuration() : 0;
}

function getPlayerState() {
  if (activePlayer === "html") {
    return htmlPlayerState;
  }
  return player ? player.getPlayerState() : null;
}

// --- Ad detection (YouTube only — HTML5 player has no ads) ---

function isAdPlaying() {
  if (activePlayer === "html") return false; // No ads in Piped stream
  if (!player || !loadedVideoId) return false;
  try {
    const data = player.getVideoData();
    if (data && data.video_id && data.video_id !== loadedVideoId) return true;
    return false;
  } catch {
    return false;
  }
}

function isUsingHtmlPlayer() {
  return activePlayer === "html";
}

function mutePlayer() {
  if (activePlayer === "html" && htmlPlayer) {
    htmlPlayer.muted = true;
  } else if (player) {
    player.mute();
  }
}

function unmutePlayer() {
  if (activePlayer === "html" && htmlPlayer) {
    htmlPlayer.muted = false;
  } else if (player) {
    player.unMute();
  }
}

function isPlayerMuted() {
  if (activePlayer === "html" && htmlPlayer) {
    return htmlPlayer.muted;
  }
  return player ? player.isMuted() : false;
}

export {
  searchKaraoke,
  extractVideoId,
  isYouTubeUrl,
  getVideoById,
  initYouTubePlayer,
  loadVideo,
  stopVideo,
  togglePlayPause,
  getPlayerTime,
  getPlayerDuration,
  getPlayerState,
  isAdPlaying,
  isUsingHtmlPlayer,
  mutePlayer,
  unmutePlayer,
  isPlayerMuted
};
