import * as Main from "resource:///org/gnome/shell/ui/main.js";
import St from "gi://St";
//import Clutter from "gi://Clutter";

//import * as ExtensionUtils from "resource:///org/gnome/shell/misc/extensionUtils.js";
//import * as Util from "resource:///org/gnome/shell/misc/util.js";

import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";

function myError(string) {
  console.log("Error [tailscale-manager]: " + string);
}

function SetTailscaleStatus() {
  try {
    let proc = Gio.Subprocess.new(
      ["tailscale", "status", "--json"],
      Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    );

    proc.communicate_utf8_async(null, null, (proc, res) => {
      let [, stdout, stderr] = proc.communicate_utf8_finish(res);
      if (!proc.get_successful()) {
        myError(stderr);
      }
      const jsonData = JSON.parse(stdout);

      tailscale_manager.setStatusUI(jsonData["BackendState"] == "Running");
    });
  } catch (e) {
    myError(e);
    return False;
  }
}

const TailscaleMenu = GObject.registerClass(
  class TailscaleMenu extends PanelMenu.Button {
    _init(dir_path) {
      this.dir_path = dir_path;
      this.icon = null;
      this.status_item = null;

      super._init(0);
      SetTailscaleStatus();

      this.connect("button-press-event", this._onButtonClick.bind(this));
    }

    _onButtonClick() {
      SetTailscaleStatus();
    }

    setStatusUI(status) {
      let icon_on = Gio.icon_new_for_string(this.dir_path + "/icon-on.svg");
      let icon_off = Gio.icon_new_for_string(this.dir_path + "/icon-off.svg");

      let used_icon = icon_off;
      let status_string = "Off";

      if (status == true) {
        used_icon = icon_on;
        status_string = "On";
      }

      if (this.icon) {
        this.icon.gicon = used_icon;
      } else {
        this.icon = new St.Icon({
          gicon: used_icon,
          style_class: "system-status-icon",
        });
        this.add_child(this.icon);
      }

      if (this.status_item) {
        this.status_item.label.text = status_string;
      } else {
        this.status_item = new PopupMenu.PopupMenuItem(status_string, {
          reactive: false,
        });
        this.menu.addMenuItem(this.status_item);
      }
    }
  },
);

let tailscale_manager;
export default class TailscaleManagerExtension extends Extension {
  enable() {
    tailscale_manager = new TailscaleMenu(this.path);
    Main.panel.addToStatusArea("Tailscale Manager", tailscale_manager, 1);
  }

  disable() {
    tailscale_manager.destroy();
    tailscale_manager = null;
  }
}
