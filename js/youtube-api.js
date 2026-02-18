import { YOUTUBE_API_KEY } from "./config.js";

// Search YouTube for karaoke videos
async function searchKaraoke(queryText, maxResults = 10) {
  const searchQuery = `${queryText} karaoke`;
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery)}&type=video&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;

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

// YouTube IFrame Player wrapper
let player = null;
let playerReadyPromise = null;

function initYouTubePlayer(elementId, onStateChange) {
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
  initYouTubePlayer,
  loadVideo,
  stopVideo,
  getPlayerState
};
