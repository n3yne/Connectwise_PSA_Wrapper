// Launch script that ensures ELECTRON_RUN_AS_NODE is removed
// (VSCode's integrated terminal sets this, which breaks Electron apps)
delete process.env.ELECTRON_RUN_AS_NODE;

const { spawn } = require("child_process");
const path = require("path");

const electronPath = require("electron");
const appPath = path.join(__dirname, ".");

// Build a clean env with ELECTRON_RUN_AS_NODE fully removed
const cleanEnv = Object.assign({}, process.env);
delete cleanEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [appPath], {
  stdio: "inherit",
  env: cleanEnv,
});

child.on("close", (code) => {
  process.exit(code);
});
