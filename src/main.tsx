import { createRoot } from "react-dom/client";
import { LiveApp } from "@/ui/app/LiveApp";
import { RemoteControllerApp } from "@/ui/app/RemoteControllerApp";
import { isRemoteWindow } from "@/controls/remoteChannel";
import { bootDb } from "@/db/boot";
import "./index.css";

document.fonts.ready.then(() => {
  // The pop-out controller window boots at `#controller`: just the surface, relaying to the host —
  // it never touches the binding db, so only the host window boots it.
  const remote = isRemoteWindow();
  if (!remote) bootDb({ plugins: [], params: [] });
  const App = remote ? RemoteControllerApp : LiveApp;
  createRoot(document.getElementById("root")!).render(<App />);
});
