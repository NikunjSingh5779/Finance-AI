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

  let deferredInstallPrompt = null;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
    !window.MSStream;

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (isStandalone) return;
    makeBanner({
      id: "pwa-install-prompt",
      message: "Install FinanceAI for quick access from your home screen.",
      actionLabel: "Install",
      onAction: async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        document.getElementById("pwa-install-prompt")?.remove();
      }
    });
  });

  if (isIOS && !isStandalone) {
    makeBanner({
      id: "pwa-install-prompt",
      message: "Add FinanceAI to your Home Screen: tap Share, then “Add to Home Screen”."
    });
  }

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    document.getElementById("pwa-install-prompt")?.remove();
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
          onAction: () => registration.waiting?.postMessage({type: "SKIP_WAITING"})
        });
      };

      if (registration.waiting) showUpdate();
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed") showUpdate();
        });
      });
      await registration.update();
    } catch (error) {
      console.warn("FinanceAI PWA registration failed:", error);
    }
  });
})();
