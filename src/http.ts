import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import express, { Request, Response } from "express";

import { peerID } from "./config/peerID";
import { CONFIG } from "./config/config";
import { colorize } from "./utils/colors";
import Remote from "./lib/remote";

const app = express();
const PORT = CONFIG.HTTP_PORT;

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(
    rateLimit({
        windowMs: 5 * 60 * 1000,
        max: 100,
        message: "Too many requests, please try again later.",
        standardHeaders: true,
        legacyHeaders: false,
        skip: req => req.path === "/ping",
    }),
);

const pingLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5000, // 5000 per minute
    message: "Too many /ping requests, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * @route GET /peer-id
 * @returns { id: string } - The peer ID of the node
 * @description Returns the peer ID of the node, for CLIs to connect to
 */
app.get("/peer-id", async (req: Request, res: Response) => {
    res.send({ id: await peerID() });
    return;
});

/**
 * @route GET /ping
 * @returns { status: "ok" }
 */
app.get("/ping", pingLimiter, async (req: Request, res: Response) => {
    res.send({ status: "ok" });
});

/**
 * @route GET /list/:owner
 * @param {string} owner - Owner's address
 * @returns { repositories: object[] } - List of repositories owned by the user
 * @description Returns a list of repositories owned by the specified user
 */
app.get("/list/:owner", async (req: Request, res: Response) => {
    const { owner } = req.params;
    if (!owner) {
        res.status(400).send({ error: "Owner address is required" });
        return;
    }

    const resp = await Remote.list(owner);
    if (resp?.status === false) {
        res.send({ repositories: [], message: resp.message || "No repositories found" });
        return;
    }

    res.send({ repositories: resp.repositories });
});

/**
 * @route GET /repo/metadata/:id
 * @param {string} id - Repository ID or Blob ID
 * @returns { repository: object } - The repository details
 * @description Returns repository metadata
 */
app.get("/repo/metadata/:id", async (req: Request, res: Response) => {});

/**
 * @route GET /repo/:id
 * @param {string} id - Repository ID or Blob ID
 * @returns { repository: object } - The repository content
 * @description Returns repository content
 */
app.get("/repo/:id", async (req: Request, res: Response) => {});

export function server() {
    return new Promise<void>((resolve, reject) => {
        try {
            app.listen(PORT, () => {
                console.log(colorize.successIcon(`sui.direct HTTP server is running on port ${PORT}`));
                resolve();
            });
        } catch (error) {
            reject(error);
        }
    });
}
