import { getSessionJoinUrl } from "./session-manager.js";

// Generate a QR code for the session join URL
// Uses the qrcodejs library (loaded via CDN)
function generateQRCode(sessionCode, containerElement, size = 200) {
  const joinUrl = getSessionJoinUrl(sessionCode);

  // Clear previous QR code
  containerElement.innerHTML = "";

  // qrcodejs creates the QR code in the container
  new QRCode(containerElement, {
    text: joinUrl,
    width: size,
    height: size,
    colorDark: "#ffffff",
    colorLight: "#00000000",
    correctLevel: QRCode.CorrectLevel.M
  });
}

export { generateQRCode };
