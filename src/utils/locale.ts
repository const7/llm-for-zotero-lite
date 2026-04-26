import { config } from "../../package.json";
import { FluentMessageId } from "../../typings/i10n";

export { initLocale, getLocaleID };

function initLocale() {
  const l10n = new (
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization
  )([`${config.addonRef}-mainWindow.ftl`], true);
  addon.data.locale = {
    current: l10n,
  };
}

function getLocaleID(id: FluentMessageId) {
  return id;
}
