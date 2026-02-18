// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDomwqmCthXvO6iu1hokF1m-ppb1W5RbmI",
  authDomain: "karaok-e7094.firebaseapp.com",
  projectId: "karaok-e7094",
  storageBucket: "karaok-e7094.firebasestorage.app",
  messagingSenderId: "801764438838",
  appId: "1:801764438838:web:3a481eb60c0fb05a95b997"
};

// YouTube Data API v3 Key
const YOUTUBE_API_KEY = "AIzaSyBgN1vw06WvEoWZvcCXGANOmhHojPcb3ro";

// reCAPTCHA v3 Site Key (public — secret key stays server-side only)
const RECAPTCHA_SITE_KEY = "6LciQm8sAAAAAJN2WbfPOLZK94nJTODTMLnjboZ_";

// Base URL for the app (auto-detects local vs GitHub Pages)
const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const BASE_URL = isLocal ? "" : window.location.origin + "/karaok";

export { firebaseConfig, YOUTUBE_API_KEY, RECAPTCHA_SITE_KEY, BASE_URL };
