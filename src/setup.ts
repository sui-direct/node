import ora from "ora";
import { join } from "path";
import prompts from "prompts";
import Database from "better-sqlite3";
import minimist, { ParsedArgs } from "minimist";
import { closeSync, existsSync, openSync, readFileSync } from "fs";

import JSONIO from "./utils/json";
import { run } from "./utils/run";
import { colorize } from "./utils/colors";
import { expandHomeDir } from "./utils/io";

const config = JSONIO.getConfig();
const argv: ParsedArgs = minimist(process.argv.slice(2));

async function setup() {
    // Set values for config if provided by arguments
    if (argv?.["port"] && typeof argv["port"] === "number") {
        config.port = Math.round(argv["port"]);
    }
    if (argv?.["log-level"] && typeof argv["log-level"] === "number") {
        config.logLevel = Math.round(argv["log-level"]);
    }

    // Check if Walrus client is installed
    let spinner = ora("Checking if Walrus client is installed").start();
    spinner.color = "blue";

    try {
        const com = await run("walrus", { silent: true });
        if (com === 127) throw new Error("Walrus client is not installed");

        console.log(`\n${colorize.successIcon("Walrus client is already installed.")}`);
        spinner.stop();
    } catch (error) {
        // console.log(`Error: ${error}`);
        console.log(`\n${colorize.errorIcon("Walrus client is not installed.")}`);
        spinner.stop();

        // Install Walrus client
        const installCommand =
            "cargo install --git https://github.com/MystenLabs/walrus --branch mainnet walrus-service --locked";
        console.log(`${colorize.highlight(installCommand)}${colorize.reset()}\n`);

        try {
            await run(installCommand, {
                silent: config.logLevel < 2,
                spinMsg: "Installing Walrus client using Cargo tool. This process may take a while.\n",
                expectCode: false,
            });
            spinner.stop();
            console.log(colorize.successIcon("Walrus client installed successfully.\n"));
        } catch (error) {
            console.error(error);
            return failed();
        }
    }

    // Ask for each information missing in the config
    if (!config.name) {
        const response = await prompts({
            type: "text",
            name: "name",
            message: "What is the name of your node? (only alphanumeric characters)",
            validate: (value: string) =>
                !/^[a-zA-Z0-9]+$/.test(value)
                    ? "Name must be alphanumeric characters only"
                    : value.length > 64
                      ? "Name must be less than 64 characters"
                      : true,
        });

        required("Node name", response.name);
        config.name = response.name;
    }

    if (!config?.port) {
        const response = await prompts({
            type: "number",
            name: "port",
            message: "What port do you want to use?",
            initial: 4002,
            validate: (value: number) =>
                value > 0 && value < 65536 ? true : "Port must be between 1 and 65535",
        });

        required("Node port", response.port);
        config.port = response.port;
    }

    if (!config.walletPath) {
        const walletChoice = await prompts({
            type: "select",
            name: "wallet",
            message: "Do you want to use an existing wallet or create a new wallet?",
            choices: [
                { title: "Use an existing wallet", value: "use" },
                { title: "Create a new wallet", value: "create" },
            ],
        });

        // Ask for the path to the wallet file if the user chose to use an existing wallet
        if (walletChoice.wallet === "use") {
            const checkWalletFile = (path: string): boolean => {
                try {
                    const content = readFileSync(path, "utf-8");
                    if (content.includes("active_address")) return true;
                    return false;
                } catch (error) {
                    return false;
                }
            };

            const response = await prompts({
                type: "text",
                name: "path",
                message: "What is the absolute path to your active SUI wallet?",
                initial: "~/.sui/sui_config/client.yaml",
                validate: (value: string) =>
                    checkWalletFile(expandHomeDir(value.trim()))
                        ? true
                        : "File must be a valid SUI wallet file",
            });

            const expandedPath = expandHomeDir(response.path.trim());

            required("Wallet path", expandedPath);
            config.walletPath = expandedPath;
        }

        // Create a new wallet using Walrus client
        else {
            const externalPath = "/data/wallet.yaml";
            const completePath = `${process.cwd()}${externalPath}`;

            // Create empty wallet.yaml file
            closeSync(openSync(completePath, "w"));

            // Walrus command to create a new wallet
            const generateWalletCommand = `walrus generate-sui-wallet --sui-network mainnet --path ${completePath}`;
            console.log(`${colorize.highlight(generateWalletCommand)}${colorize.reset()}\n`);

            await run(generateWalletCommand, {
                silent: config.logLevel < 2,
                spinMsg: "Creating a new wallet using Walrus client. This process may take a while.\n",
                expectCode: true,
            });

            config.walletPath = completePath;
        }
    }

    if (!config.bootstrappers) {
        const response = await prompts({
            type: "text",
            name: "bootstrappers",
            message: "Enter addresses of bootstrap nodes if exist (comma separated)",
        });
        config.bootstrappers = response.bootstrappers
            .split(",")
            .filter((d: string) => Boolean(d))
            .map((url: string) => url.trim());
    }

    // Save config
    JSONIO.setConfig(config);
    console.log(
        colorize.successIcon(
            "Configuration saved successfully. " +
                `You can find the config file at ${colorize.highlight(
                    join(__dirname, "../config.json"),
                )}${colorize.reset()}`,
        ),
    );

    // Create database files if not exist
    const databaseFiles = ["auth.db", "wallets.db", "repositories.db"];

    for (const file of databaseFiles) {
        const dbPath = `${process.cwd()}/db/${file}`;
        const sqlPath = `${process.cwd()}/src/sql/${file.replace(".db", ".sql")}`;

        if (!existsSync(dbPath)) {
            const db = new Database(dbPath); // Creates database file
            db.exec(readFileSync(sqlPath, "utf8")); // Creates tables
        }
    }
}

function failed() {
    console.log(`\n${colorize.errorIcon("Failed to setup the node.")}`);
    process.exit(1);
}

function required(key: string, value: string) {
    if (!value) {
        console.log(
            `\n${colorize.errorIcon(`Missing required argument: ${colorize.warning(key)}`)}`,
            colorize.reset(),
        );
        return failed();
    }
}

setup();
