/** Offline benchmark orchestration; installs nothing and changes no production DSP. */
import { spawnSync } from "node:child_process";
const python = process.env.CREPE_PYTHON ?? "work/crepe/venv/bin/python";
function run(command: string, args: string[], pythonEnvironment = false) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: pythonEnvironment
      ? {
          ...process.env,
          OMP_NUM_THREADS: "1",
          MKL_NUM_THREADS: "1",
          OPENBLAS_NUM_THREADS: "1",
          NUMBA_NUM_THREADS: "1",
        }
      : process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed (status ${result.status}, signal ${result.signal})`,
    );
}
if (!process.argv.includes("--score-only")) {
  run(process.execPath, ["--import", "tsx", "scripts/crepe/prepare.ts"]);
  run(python, ["scripts/crepe/verify_models.py"], true);
  for (const capacity of ["tiny", "full"])
    run(python, ["scripts/crepe/infer.py", capacity], true);
  if (process.argv.includes("--browser")) {
    run(python, ["scripts/crepe/export_browser.py"], true);
    run(process.execPath, ["scripts/crepe/browser.mjs"]);
  }
}
run(process.execPath, ["--import", "tsx", "scripts/crepe/summarize.ts"]);
