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

const TailscaleControler = {
  // Wrapper to handle all of the command line calls to control tailscale
  Control: function (command, func) {
    try {
      // Create an object that will run the command
      let proc = Gio.Subprocess.new(
        command,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      );

      // Run the command asynchronously and pass in the function to call when we get it back
      proc.communicate_utf8_async(null, null, (proc, res) => {
        // get the output of the function
        let [, stdout, stderr] = proc.communicate_utf8_finish(res);

        // if it threw an error
        if (!proc.get_successful()) {
          myError(stderr);
          return 0;
        }

        // otherwise called the passed in function
        func(stdout);
        return 1;
      });

      return true;
    } catch (e) {
      myError(e);
      return false;
    }
  },

  // Gets the current tailscale status and then calls setStatusUI to inform it of the new status
  GetTailscaleStatus: function () {
    let success = TailscaleControler.Control(
      ["tailscale", "status", "--json"],
      (stdout) => {
        let jsonData = JSON.parse(stdout);
        tailscale_manager.setStatusUI(jsonData["BackendState"] == "Running");
      },
    );

    // Error check if it worked
    if (success == false) {
      myError("GetTailscaleStatus failed");
    }
    return success;
  },

  // Turn tailscale on or off, then calls GetTailscaleStatus to update the menu and ensure it worked
  SetTailscaleStatus: function (state) {
    // make sure state is of the correct type so we don't get undefined behaviour
    if (typeof state != "boolean") {
      myError("SetTailscaleStatus did not recieve a boolean");
      return false;
    }

    let arg = "";
    arg = state ? "up" : "down";
    let success = TailscaleControler.Control(["tailscale", arg], (_) => {
      TailscaleControler.GetTailscaleStatus();
    });

    // Error check if it worked
    if (success == false) {
      myError("SetTailscaleStatus Failed");
    }
    return success;
  },
};

// The actual menu item class
const TailscaleMenu = GObject.registerClass(
  class TailscaleMenu extends PanelMenu.Button {
    // The initliasation function that gets called when GNOME starts to create the item
    _init(dir_path) {
      // Define our properties
      this.dir_path = dir_path;
      this.icon = null;
      this.status_item = null;
      this.nodes_submenu = null;

      super._init(0);
      // Get the original status and setup the menu
      TailscaleControler.GetTailscaleStatus();

      // Call _onButtonClick when the system tray icon is ever clicked
      this.connect("button-press-event", this._onButtonClick.bind(this));
    }

    // Event handler for when the system tray icon is clicked
    _onButtonClick() {
      TailscaleControler.GetTailscaleStatus();
    }

    // Set the icon and the toggle
    setStatusUI(status) {
      let icon_on = Gio.icon_new_for_string(this.dir_path + "/icon-on.svg");
      let icon_off = Gio.icon_new_for_string(this.dir_path + "/icon-off.svg");

      let used_icon = icon_off;
      let status_string = "Off";

      if (status == true) {
        used_icon = icon_on;
        status_string = "On";
      }

      // Set the system tray icon
      if (this.icon) {
        this.icon.gicon = used_icon;
      } else {
        this.icon = new St.Icon({
          gicon: used_icon,
          style_class: "system-status-icon",
        });
        this.add_child(this.icon);
      }

      // Set the status toggle in the menu
      if (this.status_item) {
        this.status_item.label.text = status_string;
        this.setToggledState(status);
      } else {
        this.status_item = new PopupMenu.PopupSwitchMenuItem(
          status_string,
          status,
        );
        //
        this.status_item.connect("toggled", () => {
          if (this.status_item.state) {
            TailscaleControler.SetTailscaleStatus(true);
          } else {
            TailscaleControler.SetTailscaleStatus(false);
          }
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
