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

// YouTube IFrame Player wrapper
let player = null;
let playerReadyPromise = null;

function initYouTubePlayer(elementId, onStateChange, onError) {
  playerReadyPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => {
      player = new YT.Player(elementId, {
        height: "100%",
        width: "100%",
        playerVars: {
          autoplay: 1,
          controls: 0,  // Hide YouTube controls (we have our own overlay)
          rel: 0,
          modestbranding: 1,
          fs: 0,         // Disable native fullscreen (we use our own)
          iv_load_policy: 3,  // Hide annotations
          disablekb: 0   // Keep keyboard shortcuts (space = play/pause)
        },
        events: {
          onReady: () => resolve(player),
          onStateChange: (event) => {
            if (onStateChange) onStateChange(event);
          },
          onError: (event) => {
            console.warn("YouTube player error:", event.data);
            if (onError) onError(event);
          }
        }
      });
    };

    // Load the YouTube IFrame API script if not already loaded
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    } else if (window.YT && window.YT.Player) {
      // API already loaded, call ready handler directly
      window.onYouTubeIframeAPIReady();
    }
  });

  return playerReadyPromise;
}

async function loadVideo(videoId) {
  if (!player) {
    await playerReadyPromise;
  }
  loadedVideoId = videoId;
  player.loadVideoById(videoId);
}

async function stopVideo() {
  if (player) {
    player.stopVideo();
  }
}

function togglePlayPause() {
  if (!player) return;
  const state = player.getPlayerState();
  // 1 = playing, 2 = paused
  if (state === 1) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
}

function getPlayerTime() {
  return player ? player.getCurrentTime() : 0;
}

function getPlayerDuration() {
  return player ? player.getDuration() : 0;
}

function getPlayerState() {
  return player ? player.getPlayerState() : null;
}

// Ad detection: check if the current video URL differs from what we loaded
let loadedVideoId = null;

function setLoadedVideoId(id) {
  loadedVideoId = id;
}

function isAdPlaying() {
  if (!player || !loadedVideoId) return false;
  try {
    const url = player.getVideoUrl();
    if (!url) return false;
    // During ads, getVideoUrl() still returns the main video URL on some players,
    // but getVideoData() may have ad info. Check multiple signals:
    const data = player.getVideoData();
    // If video_id from player doesn't match what we loaded, likely an ad
    if (data && data.video_id && data.video_id !== loadedVideoId) return true;
    return false;
  } catch {
    return false;
  }
}

function mutePlayer() {
  if (player) player.mute();
}

function unmutePlayer() {
  if (player) player.unMute();
}

function isPlayerMuted() {
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
  mutePlayer,
  unmutePlayer,
  isPlayerMuted
};
