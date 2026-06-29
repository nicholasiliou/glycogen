import { createRoot } from "react-dom/client";
import { LiveApp } from "@/ui/app/LiveApp";
import { RemoteControllerApp } from "@/ui/app/RemoteControllerApp";
import { isRemoteWindow } from "@/controls/remoteChannel";
import "./index.css";

document.fonts.ready.then(() => {
  // The pop-out controller window boots at `#controller`: just the surface, relaying to the host.
  const App = isRemoteWindow() ? RemoteControllerApp : LiveApp;
  createRoot(document.getElementById("root")!).render(<App />);
});
