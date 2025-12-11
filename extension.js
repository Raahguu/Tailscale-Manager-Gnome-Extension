import * as Main from "resource:///org/gnome/shell/ui/main.js";
import St from "gi://St";

import GObject from "gi://GObject";
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
        const [, stdout, stderr] = proc.communicate_utf8_finish(res);

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
    const success = TailscaleControler.Control(
      ["tailscale", "status", "--json"],
      (stdout) => {
        const jsonData = JSON.parse(stdout);
        for (const i in jsonData["Peer"])
          tailscale_manager.SetStatusUI(
            jsonData["BackendState"] == "Running",
            jsonData.hasOwnProperty("ExitNodeStatus"),
          );
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

    const arg = state ? "up" : "down";
    const success = TailscaleControler.Control(["tailscale", arg], (_) => {
      TailscaleControler.GetTailscaleStatus();
    });

    // Error check if it worked
    if (success == false) {
      myError("SetTailscaleStatus Failed");
    }
    return success;
  },

  // Get all the tailscale node elements and set the submenu to contain them
  GetTailscaleNodes: function () {
    const success = TailscaleControler.Control(
      ["tailscale", "status", "--json"],
      (stdout) => {
        const jsonData = JSON.parse(stdout);

        let nodes = [];

        // add the current computer to the list
        const self = jsonData["Self"];
        const self_node = {
          name: self["HostName"],
          status: self["Online"],
          status_string: "💻",
          ip: self["TailscaleIPs"][+tailscale_manager.settings.IPv6_over_4],
        };
        nodes.push(self_node);

        // get just the json data containing all the peers
        const peers = jsonData["Peer"];
        // gets all the keys in peers which are the node keys
        for (const i in peers) {
          // get the actual json data for each node as 'peer'
          const peer = peers[i];
          // create the node object
          const node = {
            name: peer["HostName"],
            status: peer["Online"],
            status_string: peer["Online"] ? "🟢" : "🔴",
            ip: peer["TailscaleIPs"][+tailscale_manager.settings.IPv6_over_4],
          };
          // build up the nodes list
          nodes.push(node);
        }

        // actually change the UI
        tailscale_manager.SetNodesUI(nodes);
      },
    );

    // Check if it worked
    if (success == false) {
      myError("GetTailscaleNodes failed");
    }
    return success;
  },

  GetExitNodes: function () {
    const success = TailscaleControler.Control(
      ["tailscale", "status", "--json"],
      (stdout) => {
        const jsonData = JSON.parse(stdout);
        let exit_nodes = [];

        // get just the json data containing all the peers
        const peers = jsonData["Peer"];
        // gets all the keys in peers which are the node keys
        for (const i in peers) {
          // get the actual json data for each node as 'peer'
          const peer = peers[i];
          if (peer["ExitNodeOption"] == false) {
            continue;
          }
          // create the exit_node object
          const exit_node = {
            name: peer["HostName"],
            status: peer["Online"],
            status_string: peer["ExitNode"] ? "●" : "○",
            ip: peer["TailscaleIPs"][+tailscale_manager.settings.IPv6_over_4],
            current_exit_node: peer["ExitNode"],
          };
          // build up the nodes list
          exit_nodes.push(exit_node);
        }

        const using_none_exit_node = !exit_nodes.reduce(
          (accumulator, current_value) => {
            return accumulator + current_value.current_exit_node;
          },
          0,
        );

        const none_exit_node = {
          name: "none",
          status: true,
          status_string: using_none_exit_node ? "●" : "○",
          ip: "",
          current_exit_node: using_none_exit_node,
        };

        exit_nodes.unshift(none_exit_node);

        tailscale_manager.SetExitNodesUI(exit_nodes);
      },
    );

    // Check for  errors
    if (success == false) {
      myError("GetExitNodes failed");
    }
    return success;
  },

  SetExitNode: function (exit_node_name) {
    // Set the exit node
    const success = TailscaleControler.Control(
      ["tailscale", "set", "--exit-node=" + exit_node_name],
      (stdout) => {
        // Now get the exit node and set the UI
        TailscaleControler.GetExitNodes();
        TailscaleControler.GetTailscaleStatus();
      },
    );

    // Check for errors
    if (success == false) {
      myError("SetExitNode failed");
    }
    return success;
  },
};

// The actual menu item class
const TailscaleMenu = GObject.registerClass(
  class TailscaleMenu extends PanelMenu.Button {
    // The initliasation function that gets called when GNOME starts to create the item
    _init(dir_path, caller) {
      // Define our properties
      this.dir_path = dir_path;
      this.settings = null;
      this.icon = null;
      this.status_item = null;
      this.nodes_submenu = null;
      this.exit_nodes_submenu = null;

      // Call the super classes initialisation to do complex stuff
      super._init(0);

      // Set up the original menu
      this.setupMenu(caller);
      this.setupSettings(caller);
      // Update the menu externally
      TailscaleControler.GetTailscaleStatus();

      // Call _onButtonClick when the system tray icon is ever clicked
      this.connect("button-press-event", this._OnButtonClick.bind(this));
    }

    setupMenu(caller) {
      // Status toggle
      this.status_item = new PopupMenu.PopupSwitchMenuItem("Off", false);
      // event listener
      this.status_item.connect("toggled", () => {
        if (this.status_item.state) {
          TailscaleControler.SetTailscaleStatus(true);
        } else {
          TailscaleControler.SetTailscaleStatus(false);
        }
      });

      // Nodes submenu
      this.nodes_submenu = new PopupMenu.PopupSubMenuMenuItem("Nodes", false);

      // Exit Nodes submenu
      this.exit_nodes_submenu = new PopupMenu.PopupSubMenuMenuItem(
        "Exit Nodes",
        false,
      );

      // Adding the children, this order affects where they appear in the menu
      this.menu.addMenuItem(this.status_item);
      this.menu.addMenuItem(this.nodes_submenu);
      this.menu.addMenuItem(this.exit_nodes_submenu);

      // Add Preferences menu item
      this.menu.addAction(_("Preferences"), () => caller.openPreferences());
    }

    setupSettings(caller) {
      // Create the settings object other objects can then call
      this.settings = {
        IPv6_over_4: false,
      };

      // Get the settings and save them to _settings property
      caller._settings = caller.getSettings();

      // copy-ipv6 setting
      // set the current value
      this.settings.IPv6_over_4 =
        caller._settings.get_value("copy-ipv6").print(true) == "true";
      // set an event listener to check if 'copy-ipv6' ever changes and set 'IPv6_over_4' to its new value
      caller._settings.connect("changed::copy-ipv6", (settings, key) => {
        this.settings.IPv6_over_4 =
          settings.get_value(key).print(true) == "true";
      });
    }

    // Event handler for when the system tray icon is clicked
    // This is used to update all the menu internals before the user sees it
    _OnButtonClick() {
      TailscaleControler.GetTailscaleStatus();
      TailscaleControler.GetTailscaleNodes();
      TailscaleControler.GetExitNodes();
    }

    // Set the icon and the toggle
    SetStatusUI(status, using_exit_node) {
      const icon_on = Gio.icon_new_for_string(this.dir_path + "/icon-on.svg");
      const icon_off = Gio.icon_new_for_string(this.dir_path + "/icon-off.svg");
      const icon_exit_node = Gio.icon_new_for_string(
        this.dir_path + "/icon-exit-node.png",
      );

      let used_icon = icon_off;
      let status_string = "Off";

      if (status == true) {
        if (using_exit_node == true) {
          used_icon = icon_exit_node;
        } else {
          used_icon = icon_on;
        }
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

      // Set the status toggle in the menu and the label for it
      this.status_item.label.text = status_string;
      this.status_item.setToggleState(status);
    }

    SetNodesUI(nodes) {
      // remove the old nodes
      this.nodes_submenu.menu.removeAll();

      nodes.forEach((node) => {
        this.nodes_submenu.menu.addAction(
          node.status_string + " " + node.name,
          () => {
            St.Clipboard.get_default().set_text(
              St.ClipboardType.CLIPBOARD,
              node.ip,
            );
          },
        );
      });
    }

    SetExitNodesUI(nodes) {
      // remove the old nodes
      this.exit_nodes_submenu.menu.removeAll();

      nodes.forEach((exit_node) => {
        this.exit_nodes_submenu.menu.addAction(
          exit_node.status_string + " " + exit_node.name,
          () => {
            // There is no point running a command to change the exit node into the same exit node
            if (exit_node.current_exit_node == true) {
              return 0;
            }
            TailscaleControler.SetExitNode(exit_node.ip);
          },
        );
      });
    }
  },
);

let tailscale_manager;
export default class TailscaleManagerExtension extends Extension {
  enable() {
    // Setup the menu
    tailscale_manager = new TailscaleMenu(this.path, this);
    // Add to system tray
    Main.panel.addToStatusArea("Tailscale Manager", tailscale_manager, 1);
  }

  disable() {
    tailscale_manager.destroy();
    this._settings = null;
    tailscale_manager = null;
  }
}
