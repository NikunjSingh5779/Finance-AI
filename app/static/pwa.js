(() => {
  "use strict";

  if (!("serviceWorker" in navigator)) return;

  const makeBanner = ({id, message, actionLabel, onAction, dismissLabel = "Dismiss"}) => {
    let banner = document.getElementById(id);
    if (banner) return banner;

    banner = document.createElement("section");
    banner.id = id;
    banner.className = "pwa-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");

    const text = document.createElement("p");
    text.className = "pwa-banner-message";
    text.textContent = message;

    const actions = document.createElement("div");
    actions.className = "pwa-banner-actions";

    if (actionLabel && onAction) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "pwa-action";
      action.textContent = actionLabel;
      action.addEventListener("click", onAction);
      actions.appendChild(action);
    }

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "pwa-dismiss";
    dismiss.textContent = dismissLabel;
    dismiss.setAttribute("aria-label", dismissLabel);
    dismiss.addEventListener("click", () => banner.remove());
    actions.appendChild(dismiss);

    banner.append(text, actions);
    document.body.appendChild(banner);
    return banner;
  };

  const updateConnectivity = () => {
    const id = "pwa-offline-status";
    if (navigator.onLine) {
      document.getElementById(id)?.remove();
      return;
    }
    makeBanner({
      id,
      message: "You're offline. Transactions, budgets and AI need an internet connection."
    });
  };

  window.addEventListener("online", updateConnectivity);
  window.addEventListener("offline", updateConnectivity);
  updateConnectivity();

  const installButton = document.getElementById("pwa-install-button");
  let deferredInstallPrompt = null;
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  const userAgent = window.navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(userAgent);

  const showInstallButton = () => {
    if (installButton && !isStandalone) installButton.hidden = false;
  };
  const hideInstallButton = () => {
    if (installButton) installButton.hidden = true;
  };
  const showManualInstallHelp = () => {
    let message = "Open your browser menu and choose “Install app” or “Add to Home screen”.";
    if (isIOS) {
      message = "In Safari, tap Share, choose “Add to Home Screen”, then tap Add.";
    } else if (isAndroid) {
      message = "In Chrome, tap ⋮, choose “Add to home screen” or “Install app”, then confirm.";
    } else {
      message = "In Chrome or Edge, open the browser menu and choose “Install FinanceAI” or “Apps → Install this site as an app”.";
    }
    makeBanner({id:"pwa-install-help",message,dismissLabel:"Got it"});
  };

  if (!isStandalone) showInstallButton();

  const runInstall = async () => {
    if (!deferredInstallPrompt) {
      showManualInstallHelp();
      return;
    }
    const promptEvent = deferredInstallPrompt;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === "accepted") {
        hideInstallButton();
        document.getElementById("pwa-install-prompt")?.remove();
      }
    } catch (error) {
      console.warn("FinanceAI installation could not be started:", error);
      showManualInstallHelp();
    } finally {
      deferredInstallPrompt = null;
    }
  };

  installButton?.addEventListener("click", runInstall);

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (isStandalone) return;
    showInstallButton();

    makeBanner({
      id: "pwa-install-prompt",
      message: "Install FinanceAI for quick access from your home screen.",
      actionLabel: "Install",
      onAction: runInstall
    });
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    hideInstallButton();
    document.getElementById("pwa-install-prompt")?.remove();
    document.getElementById("pwa-install-help")?.remove();
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none"
      });

      const showUpdate = () => {
        if (!registration.waiting || !navigator.serviceWorker.controller) return;
        makeBanner({
          id: "pwa-update-prompt",
          message: "A new FinanceAI version is ready.",
          actionLabel: "Update now",
          onAction: () => {
            const waitingWorker = registration.waiting;
            if (!waitingWorker) {
              registration.update().catch(error => console.warn("FinanceAI update check failed:", error));
              return;
            }
            const updateButton = document.querySelector("#pwa-update-prompt .pwa-action");
            if (updateButton) {
              updateButton.disabled = true;
              updateButton.textContent = "Updating…";
            }
            waitingWorker.postMessage({type: "SKIP_WAITING"});
          }
        });
      };

      if (registration.waiting) showUpdate();
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdate();
          }
        });
      });

      await registration.update();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update().catch(error => console.warn("FinanceAI update check failed:", error));
        }
      });
    } catch (error) {
      console.warn("FinanceAI PWA registration failed:", error);
    }
  });
})();
