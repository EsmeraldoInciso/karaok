import { YOUTUBE_API_KEY } from "./config.js";

// Piped API instances (fallback chain)
const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.in.projectsegfau.lt"
];

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

// --- Piped API (free, unlimited) ---

async function pipedSearch(queryText, maxResults = 10) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const response = await fetch(`${instance}/search?q=${encodeURIComponent(queryText)}&filter=videos`, {
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) continue;

      const data = await response.json();
      const items = (data.items || []).slice(0, maxResults);

      return items.map((item) => ({
        videoId: item.url?.replace("/watch?v=", "") || "",
        title: item.title || "Unknown",
        channelTitle: item.uploaderName || "",
        thumbnailUrl: item.thumbnail || ""
      }));
    } catch {
      continue; // Try next instance
    }
  }
  return null; // All instances failed
}

async function pipedGetVideo(videoId) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const response = await fetch(`${instance}/streams/${videoId}`, {
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) continue;

      const data = await response.json();
      return {
        videoId,
        title: data.title || "Unknown",
        channelTitle: data.uploader || "",
        thumbnailUrl: data.thumbnailUrl || ""
      };
    } catch {
      continue;
    }
  }
  return null;
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

// --- Public API: Piped first, YouTube API fallback ---

async function searchKaraoke(queryText, maxResults = 10) {
  const searchQuery = `${queryText} karaoke`;

  // Try Piped first (free, unlimited)
  const pipedResults = await pipedSearch(searchQuery, maxResults);
  if (pipedResults && pipedResults.length > 0) {
    console.log("Search via Piped (free)");
    return pipedResults;
  }

  // Fallback to YouTube Data API (100 units per search)
  console.warn("Piped unavailable, falling back to YouTube API");
  return youtubeApiSearch(searchQuery, maxResults);
}

async function getVideoById(videoId) {
  // Try Piped first (free)
  const pipedResult = await pipedGetVideo(videoId);
  if (pipedResult) {
    console.log("Video lookup via Piped (free)");
    return pipedResult;
  }

  // Fallback to YouTube Data API (1 unit)
  console.warn("Piped unavailable, falling back to YouTube API");
  return youtubeApiGetVideo(videoId);
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
          controls: 1,
          rel: 0,
          modestbranding: 1
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
  player.loadVideoById(videoId);
}

async function stopVideo() {
  if (player) {
    player.stopVideo();
  }
}

function getPlayerState() {
  return player ? player.getPlayerState() : null;
}

export {
  searchKaraoke,
  extractVideoId,
  isYouTubeUrl,
  getVideoById,
  initYouTubePlayer,
  loadVideo,
  stopVideo,
  getPlayerState
};
