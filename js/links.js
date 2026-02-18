import { BASE_URL } from "./config.js";

// Resolve all data-link attributes to proper href values
// Usage: add data-link="/login/" to <a> tags instead of hardcoded paths
export function resolveLinks() {
  document.querySelectorAll("[data-link]").forEach(el => {
    el.href = BASE_URL + el.dataset.link;
  });
}

// Helper to build a URL with BASE_URL prefix
export function appUrl(path) {
  return BASE_URL + path;
}
