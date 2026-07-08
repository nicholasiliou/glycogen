import { createRoot } from "react-dom/client";
import { LiveApp } from "@/ui/app/LiveApp";
import { RemoteControllerApp } from "@/ui/app/RemoteControllerApp";
import { DbPage } from "@/ui/dev/DbPage";
import { isRemoteWindow } from "@/controls/remoteChannel";
import { bootDb } from "@/db/boot";
import { harvestRegistrations } from "@/plugins/registry";
import "./index.css";

document.fonts.ready.then(() => {
  const hash = window.location.hash;
  const remote = isRemoteWindow();

  // #db — binding-db dev page (tables + hardware kind override), boots db so tables are populated
  if (hash.startsWith("#db")) {
    bootDb(harvestRegistrations());
    createRoot(document.getElementById("root")!).render(<DbPage />);
    return;
  }

  // The pop-out controller window boots at `#controller`: just the surface, relaying to the host —
  // it never touches the binding db, so only the host window boots it.
  if (!remote) bootDb(harvestRegistrations());
  const App = remote ? RemoteControllerApp : LiveApp;
  createRoot(document.getElementById("root")!).render(<App />);
});
