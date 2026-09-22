// Editors/terminals hosted inside an Electron app (e.g. VS Code) can leak
// ELECTRON_RUN_AS_NODE=1 into child processes. When set, `electron.exe`
// launches as a plain Node runtime instead of a real Electron app, so
// `require("electron")` resolves to a path string instead of the real API
// and the app crashes on startup. Strip it before spawning electron-vite.
delete process.env.ELECTRON_RUN_AS_NODE;

const { spawn } = await import("node:child_process");

const child = spawn("electron-vite", ["dev"], {
  stdio: "inherit",
  shell: true,
  env: process.env
});

child.on("exit", (code) => process.exit(code ?? 0));
