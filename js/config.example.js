// Copy this file to config.js and fill in your values
// DO NOT commit config.js — it's in .gitignore

// Firebase Configuration
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// YouTube Data API v3 Key
const YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY";

// reCAPTCHA v3 Site Key (public key only — never put secret key in client code)
const RECAPTCHA_SITE_KEY = "YOUR_RECAPTCHA_SITE_KEY";

// Base URL for the app
const BASE_URL = window.location.origin + "/KaraOK";

export { firebaseConfig, YOUTUBE_API_KEY, RECAPTCHA_SITE_KEY, BASE_URL };
