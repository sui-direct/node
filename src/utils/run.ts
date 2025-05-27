import ora from "ora";
import { spawn } from "child_process";

import { colorize } from "./colors";

interface RunOptions {
    silent?: boolean;
    spinMsg?: string;
    expectCode?: boolean;
}

export async function run(
    command: string,
    options: RunOptions = {
        silent: false,
        spinMsg: undefined,
        expectCode: false,
    },
): Promise<void> {
    const spinner = options.spinMsg && !options.silent ? ora(options.spinMsg).start() : null;

    return new Promise((resolve, reject) => {
        const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });

        const handleData = (data: Buffer, isErr = false) => {
            if (options.silent) return;
            const lines = data.toString().split(/\r?\n/).filter(Boolean);

            if (spinner) spinner.stop();
            for (const line of lines) {
                console[isErr ? "error" : "log"](line);
            }
            if (spinner) spinner.start();
        };

        child.stdout?.on("data", d => handleData(d));
        child.stderr?.on("data", d => handleData(d, true));

        child.on("error", err => {
            spinner?.stop();
            if (!options.silent) console.error(colorize.error(`Error: ${err.message}`));
            reject(err);
        });

        child.on("close", code => {
            spinner?.stop();
            if (code !== 0 && options.expectCode) {
                if (!options.silent) console.error(colorize.error(`Exited with code ${code}`));
                reject(new Error(`Command failed: ${command}`));
            } else {
                resolve();
            }
        });
    });
}
