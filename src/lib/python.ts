import { spawn } from "node:child_process";
import path from "node:path";
import { env } from "../config/env";

/**
 * Runs workers/<script> with python and returns its stdout parsed as JSON.
 * `input` (optional) is sent to the script on stdin as UTF-8, which avoids
 * Windows command-line quoting problems for long texts.
 * Must be started from the backend folder (npm scripts do this).
 */
export function runPython<T = unknown>(
  script: string,
  args: string[] = [],
  timeoutMs = 60_000,
  input?: string
): Promise<T> {
  const scriptPath = path.resolve(process.cwd(), "workers", script);

  return new Promise<T>((resolve, reject) => {
    const child = spawn(env.PYTHON_BIN, [scriptPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1" },
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Python script timed out after ${timeoutMs}ms: ${script}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.stdin.on("error", () => {}); // python may exit before reading stdin
    child.stdin.end(input ?? "");

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Cannot start "${env.PYTHON_BIN}": ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Python exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        reject(new Error(`Invalid JSON from ${script}: ${stdout.slice(0, 200)}`));
      }
    });
  });
}
