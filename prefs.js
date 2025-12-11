import Gio from "gi://Gio";
import Adw from "gi://Adw";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class ExamplePreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    // Create a preferences page, with a single group
    const page = new Adw.PreferencesPage({
      title: _("Tailscale Manager Settings"),
      icon_name: "dialog-information-symbolic",
    });
    window.add(page);

    const group = new Adw.PreferencesGroup({
      title: _("General"),
    });
    page.add(group);

    // Create a new preferences row
    const row = new Adw.SwitchRow({
      title: _("Use IPv6"),
      subtitle: _(
        "Which IP addressing scheme should be used by default when copied from nodes. If the node only has one type of address, that will be copied regardless",
      ),
    });
    group.add(row);

    // Create a settings object and bind the row to the `show-indicator` key
    window._settings = this.getSettings();
    window._settings.bind(
      "copy-ipv6",
      row,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );
  }
}
