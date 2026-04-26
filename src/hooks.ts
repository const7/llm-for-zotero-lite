import { initLocale } from "./utils/locale";
import { initI18n } from "./utils/i18n";
import { PREFERENCES_PANE_ID } from "./modules/contextPanel/constants";
import {
  registerReaderContextPanel,
  registerLLMStyles,
  registerReaderSelectionTracking,
} from "./modules/contextPanel";
import { invalidatePaperSearchCache } from "./modules/contextPanel/paperSearch";
import { initChatStore } from "./utils/chatStore";
import { createZToolkit } from "./utils/ztoolkit";
import { clearAllState, initFontScale } from "./modules/contextPanel/state";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  initI18n();
  initFontScale();

  try {
    await initChatStore();
  } catch (err) {
    ztoolkit.log("LLM: Failed to initialize chat store", err);
  }

  registerPrefsPane();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  registerLLMStyles(win);
  registerReaderContextPanel();
  registerReaderSelectionTracking();
}

function registerPrefsPane() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    id: PREFERENCES_PANE_ID,
    src: `chrome://${addon.data.config.addonRef}/content/preferences.xhtml`,
    label: "llm-for-zotero-lite",
    image: `chrome://${addon.data.config.addonRef}/content/icons/icon-20.png`,
  });
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  if (paperSearchInvalidateTimer !== null) {
    clearTimeout(paperSearchInvalidateTimer);
    paperSearchInvalidateTimer = null;
  }
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  try {
    const { unregisterWebChatRelay } = require("./webchat/relayServer");
    unregisterWebChatRelay();
  } catch {
    /* ignore if module not loaded */
  }
  clearAllState();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

let paperSearchInvalidateTimer: ReturnType<typeof setTimeout> | null = null;

async function onNotify(
  event: string,
  type: string,
  _ids: Array<string | number>,
  _extraData: { [key: string]: any },
) {
  const shouldInvalidatePaperSearch =
    (type === "item" || type === "file") &&
    ["add", "modify", "delete", "move", "remove", "trash", "refresh"].includes(
      event,
    );
  if (shouldInvalidatePaperSearch) {
    // Debounce: during bulk operations (import, sync) this fires hundreds
    // of times — coalesce into a single invalidation after 500ms of quiet.
    if (paperSearchInvalidateTimer !== null)
      clearTimeout(paperSearchInvalidateTimer);
    paperSearchInvalidateTimer = setTimeout(() => {
      paperSearchInvalidateTimer = null;
      invalidatePaperSearchCache();
    }, 500);
  }
  return;
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load": {
      const { registerPrefsScripts } =
        await import("./modules/preferenceScript");
      registerPrefsScripts(data.window);
      break;
    }
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
