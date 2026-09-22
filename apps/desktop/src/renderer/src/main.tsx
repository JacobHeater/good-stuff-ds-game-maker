import { EditorShell } from "@goodstuff/ui";
import React from "react";
import ReactDOM from "react-dom/client";

import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <EditorShell />
  </React.StrictMode>
);
