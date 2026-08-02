"use client";

import { Download, Plus, Share, X } from "lucide-react";
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || iosNavigator.standalone === true;
}

export default function PwaRegister() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showUpdateToast, setShowUpdateToast] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registering in dev caused exactly the "code changes don't show up" symptom this was built
    // to fix: a service worker persists across next-dev restarts, serving assets cached from a
    // previous session regardless of what the dev server is currently running.
    if (process.env.NODE_ENV !== "production") return;

    // sw.js already calls self.skipWaiting()/clients.claim() unconditionally, so a new worker
    // takes control of open tabs on its own — this only needs to notice that happened and offer
    // a refresh. Only a controllerchange that follows an ALREADY-controlled tab is a real update;
    // the first-ever activation on a fresh visit also fires this event and must not show a toast.
    const hadControllerAlready = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (hadControllerAlready) setShowUpdateToast(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
        const checkForUpdate = () => {
          if (document.visibilityState === "visible") registration.update().catch(() => {});
        };
        document.addEventListener("visibilitychange", checkForUpdate);
      }).catch(() => {
        // PWA support is progressive; the web app remains fully usable if registration fails.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("load", register);
    };
  }, []);

  useEffect(() => {
    if (isStandalone()) return;

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIos(ios);

    const revealForIos = window.setTimeout(() => {
      if (ios && !isStandalone()) setShowInstall(true);
    }, 1200);

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
      setShowInstall(true);
    };
    const handleInstalled = () => {
      setShowInstall(false);
      setShowIosHelp(false);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.clearTimeout(revealForIos);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function install() {
    if (isIos) {
      setShowIosHelp(true);
      return;
    }
    if (!installPrompt) return;

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setShowInstall(false);
    setInstallPrompt(null);
  }

  if (!showInstall && !showUpdateToast) return null;

  return (
    <>
      {showUpdateToast && (
        <div className="fixed inset-x-4 bottom-4 z-[80] mx-auto flex max-w-sm items-center justify-between gap-4 rounded-2xl border border-white/14 bg-[#0d0d0d] px-5 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.5)] sm:inset-x-auto sm:right-8">
          <p className="text-sm text-white/76">A new version of F.U.N is available.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90"
          >
            Refresh
          </button>
        </div>
      )}

      {showInstall && (
      <button
        type="button"
        onClick={install}
        className="fixed right-4 top-[4.75rem] z-[70] inline-flex h-10 items-center gap-2 rounded-full border border-white/16 bg-black/80 px-4 text-sm font-medium text-white/76 shadow-[0_10px_36px_rgba(0,0,0,0.42)] backdrop-blur-xl transition hover:border-white/28 hover:text-white sm:right-8"
        aria-label="Install F.U.N on this device"
      >
        <Download size={15} />
        Install F.U.N
      </button>
      )}

      {showIosHelp && (
        <div
          className="fixed inset-0 z-[100] grid place-items-end bg-black/66 p-4 backdrop-blur-sm sm:place-items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-fun-title"
          onClick={() => setShowIosHelp(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/12 bg-[#0d0d0d] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.72)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-red-300">Install F.U.N</p>
                <h2 id="install-fun-title" className="mt-2 font-serif text-3xl text-white">
                  Keep F.U.N close.
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowIosHelp(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/54 transition hover:text-white"
                aria-label="Close installation instructions"
              >
                <X size={17} />
              </button>
            </div>

            <p className="mt-3 leading-6 text-white/58">
              Keep F.U.N on your home screen for faster access.
            </p>

            <ol className="mt-6 space-y-3">
              <li className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.07] text-white">
                  <Share size={17} />
                </span>
                <span className="text-sm leading-5 text-white/72">Tap the Share button in Safari.</span>
              </li>
              <li className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.07] text-white">
                  <Plus size={17} />
                </span>
                <span className="text-sm leading-5 text-white/72">Choose Add to Home Screen, then tap Add.</span>
              </li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
}
