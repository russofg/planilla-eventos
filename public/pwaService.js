// filepath: /Users/fernandogabrielrusso/Desktop/planilla eventos/public/pwaService.js
import { showSuccessToast, showInfoToast } from "./notifications.js";

let deferredPrompt;
const INSTALL_PROMPT_DISMISSED_KEY = "install-prompt-dismissed";

export function initPwaService() {
  const installContainer = document.createElement("div");
  installContainer.id = "install-container"; // Add ID for easier selection
  installContainer.className =
    "fixed bottom-0 left-0 right-0 bg-blue-600 text-white p-4 text-center z-30 dark:bg-blue-800";
  installContainer.style.display = "none"; // Hide initially
  installContainer.innerHTML = `
      <div class="flex justify-between items-center max-w-screen-xl mx-auto">
        <p class="font-semibold">¡Instala esta aplicación en tu dispositivo!</p>
        <div class="flex space-x-2">
          <button id="install-button" class="bg-white text-blue-600 px-4 py-2 rounded font-semibold hover:bg-gray-100">Instalar</button>
          <button id="close-install" class="bg-transparent border border-white text-white px-3 py-2 rounded hover:bg-white hover:text-blue-600">Cerrar</button>
        </div>
      </div>
    `;
  document.body.appendChild(installContainer);

  // Listen for the browser's install prompt event
  window.addEventListener("beforeinstallprompt", (e) => {
    // Prevent Chrome <= 67 from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Show our custom install banner if not previously dismissed
    if (localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY) !== "true") {
      installContainer.style.display = "block";
    }
  });

  // Setup button listeners (ensure container exists first)
  const installButton = installContainer.querySelector("#install-button");
  const closeInstallButton = installContainer.querySelector("#close-install");

  if (installButton) {
    installButton.addEventListener("click", handleInstallClick);
  }
  if (closeInstallButton) {
    closeInstallButton.addEventListener("click", handleCloseClick);
  }

  // Listen for app installed event
  window.addEventListener("appinstalled", () => {
    // Hide the install banner
    installContainer.style.display = "none";
    // Clear the deferredPrompt so it can't be triggered again
    deferredPrompt = null;
    // Optionally clear the dismissed flag
    localStorage.removeItem(INSTALL_PROMPT_DISMISSED_KEY);
    showSuccessToast("¡Aplicación instalada con éxito!");
  });

  // Check if already dismissed on load
  if (localStorage.getItem(INSTALL_PROMPT_DISMISSED_KEY) === "true") {
    // Ensure banner is hidden if the beforeinstallprompt hasn't fired yet
    installContainer.style.display = "none";
  }
}

async function handleInstallClick() {
  const installContainer = document.getElementById("install-container");
  if (!deferredPrompt) {
    return;
  }

  // Show the browser's install prompt
  deferredPrompt.prompt();

  // Wait for the user to respond to the prompt
  try {
    const { outcome } = await deferredPrompt.userChoice;

    // We've used the prompt, clear it
    deferredPrompt = null;

    // Hide our custom banner regardless of the choice
    if (installContainer) installContainer.style.display = "none";

    if (outcome === "accepted") {
      showSuccessToast("¡Gracias por instalar la app!");
    } else {
      showInfoToast(
        "Puedes instalar la app más tarde desde el menú del navegador."
      );
    }
  } catch (error) {
    if (installContainer) installContainer.style.display = "none";
  }
}

function handleCloseClick() {
  const installContainer = document.getElementById("install-container");
  if (installContainer) {
    installContainer.style.display = "none";
  }
  // Remember that the user dismissed the banner
  localStorage.setItem(INSTALL_PROMPT_DISMISSED_KEY, "true");
}
