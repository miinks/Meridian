import { spawn } from "node:child_process";

const rest = process.argv.slice(2);
if (!rest.length) {
  console.error("usage: node scripts/run-python.mjs <script.py> [args]");
  process.exit(1);
}

const candidates =
  process.platform === "win32"
    ? [
        { cmd: "py", args: ["-3", ...rest] },
        { cmd: "python", args: rest },
        { cmd: "python3", args: rest },
      ]
    : [
        { cmd: "python3", args: rest },
        { cmd: "python", args: rest },
        { cmd: "py", args: ["-3", ...rest] },
      ];

function run(index) {
  if (index >= candidates.length) {
    console.error("Python 3 not found. On Windows use: py -3");
    process.exit(1);
    return;
  }
  const { cmd, args } = candidates[index];
  const child = spawn(cmd, args, { stdio: "inherit" });
  child.on("error", (error) => {
    if (error.code === "ENOENT") {
      run(index + 1);
      return;
    }
    console.error(error.message);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 1);
  });
}

run(0);
