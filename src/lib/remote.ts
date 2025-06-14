import { join } from "path";
import Database from "better-sqlite3";
import { toString } from "uint8arrays/to-string";
import { adjectives, names, type Config as NamesConfig, uniqueNamesGenerator } from "unique-names-generator";

import Auth from "./auth";
import Walrus from "./walrus";
import Wallet from "./wallet";
import { streamSink } from "../utils/helpers";

const MAX_SIZE = 6 * 1024 ** 3;
const CHUNK_SIZE = 64 * 1024;

export default class Remote {
    public node: any;
    private auth: Auth;

    constructor(node: any, auth: Auth) {
        this.node = node;
        this.auth = auth;
        this.push(node);
        this.pull(node);
        this.rename(node);
    }

    push(node: any) {
        node.handle("/push/1.0.0", ({ stream, connection }: { stream: any; connection: any }) => {
            return new Promise(async (resolve, reject) => {
                // Authenticate
                const peerID = connection.remotePeer.toString();

                if (!this.auth.isTemporaryAuthenticated(peerID)) {
                    await streamSink(
                        stream,
                        JSON.stringify({
                            status: false,
                            message: "You must be authenticated to push files.",
                        }),
                    );
                    return resolve(false);
                }

                let total = 0;
                let chunks: Buffer[] = [];

                try {
                    // Collect all chunks first
                    for await (const chunk of stream.source) {
                        // Handle Uint8ArrayList
                        let buffer: Buffer;
                        if (chunk.constructor.name === "Uint8ArrayList") {
                            // Extract the actual data from Uint8ArrayList
                            if (chunk.bufs && chunk.bufs.length > 0) {
                                // Combine all buffers in the Uint8ArrayList
                                buffer = Buffer.concat(chunk.bufs);
                            } else {
                                // Fallback: use the slice method if available
                                buffer = Buffer.from(chunk.slice());
                            }
                        } else if (chunk instanceof Buffer) {
                            buffer = chunk;
                        } else if (chunk instanceof Uint8Array) {
                            buffer = Buffer.from(chunk);
                        } else {
                            buffer = Buffer.from(chunk);
                        }

                        total += buffer.length;

                        if (total > MAX_SIZE) {
                            await streamSink(
                                stream,
                                JSON.stringify({
                                    status: false,
                                    message: "File size exceeds limit",
                                }),
                            );
                            return resolve(false);
                        }

                        chunks.push(buffer);
                    }
                } catch (e) {
                    await streamSink(
                        stream,
                        JSON.stringify({
                            status: false,
                            message: "Failed to receive files",
                        }),
                    );

                    return reject(e);
                }

                // Combine all chunks into a single buffer
                const completeBuffer = Buffer.concat(chunks);

                // Get deposit keypair of user
                const account = await Auth.getWalletFromPeerID(peerID);
                const keypair = Wallet.getDepositKeypair(account!);
                const address = keypair.getPublicKey().toSuiAddress();

                // Save file with Walrus
                const walrus = new Walrus();

                // Calculate estimated storage cost
                const wallet = new Wallet(address);
                const cost = (await walrus.storageCost(total, 2)).totalCost;
                const balance = BigInt((await wallet.getBalance(address)).WAL.totalBalance);

                if (cost > balance) {
                    await streamSink(
                        stream,
                        JSON.stringify({
                            status: false,
                            message:
                                "Not enough WAL coins to push repository. Deposit some WAL coins to your deposit account.",
                        }),
                    );
                    return resolve(false);
                }

                let blobId: string = "";
                try {
                    blobId = await walrus.writeBlob(completeBuffer, keypair, {
                        deletable: true,
                        epochs: 2,
                    });
                } catch (e: any) {
                    console.error("Failed to push repository:", e);
                    if (e.toString().includes("Not enough coins")) {
                        await streamSink(
                            stream,
                            JSON.stringify({
                                status: false,
                                message:
                                    "Not enough coins to push repository. Deposit some WAL coins to your deposit account.",
                            }),
                        );
                    } else {
                        await streamSink(
                            stream,
                            JSON.stringify({
                                status: false,
                                message: "Failed to push repository",
                            }),
                        );
                    }
                    return resolve(false);
                }

                const config: NamesConfig = {
                    dictionaries: [adjectives, names],
                    separator: "-",
                    seed: blobId,
                };

                const nameFromSeed: string = uniqueNamesGenerator(config).toLowerCase();

                // Save repository to database
                const repoDB = new Database(join(__dirname, "../../db", "repositories.db"));

                repoDB
                    .prepare(
                        `INSERT INTO repositories (blobID, owner, name, description, timestamp) VALUES (?, ?, ?, ?, ?)`,
                    )
                    .run(blobId, account, nameFromSeed, "", new Date().toISOString());
                repoDB.close();

                await streamSink(
                    stream,
                    JSON.stringify({
                        status: true,
                        blobId,
                        id: nameFromSeed,
                    }),
                );

                resolve(true);
            });
        });
    }

    pull(node: any, id?: string) {
        const pullEvent = async (id: string) => {
            const repoDB = new Database(join(__dirname, "../../db", "repositories.db"));

            try {
                // Define the repository type
                interface Repository {
                    blobID: string;
                    name: string;
                    owner: string;
                    description: string;
                    timestamp: string;
                }

                // Check if repository exists
                const repo = repoDB
                    .prepare("SELECT * FROM repositories WHERE (name = ? OR blobID = ?)")
                    .get(id, id) as Repository;

                if (!repo) return { status: false, message: "Repository not found" };

                const walrus = new Walrus();
                let content;
                try {
                    content = await walrus.readBlob(repo.blobID);
                } catch (e) {
                    return { status: false, message: "Failed to read repository content" };
                }

                return { content };
            } finally {
                repoDB.close();
            }
        };

        if (!node && id) return pullEvent(id);

        node.handle("/pull/1.0.0", async ({ stream, connection }: { stream: any; connection: any }) => {
            const timeoutController = new AbortController();
            const timeout = setTimeout(() => {
                timeoutController.abort();
            }, 30000);

            try {
                return await new Promise(async (resolve, reject) => {
                    let data: { id?: string; blobId?: string } = {};

                    try {
                        let raw = "";
                        const chunks: Buffer[] = [];

                        for await (const chunk of stream.source) {
                            if (timeoutController.signal.aborted) {
                                throw new Error("Stream aborted during request parsing");
                            }

                            let buffer: Buffer;
                            if (chunk.constructor.name === "Uint8ArrayList") {
                                if (chunk.bufs && chunk.bufs.length > 0) {
                                    buffer = Buffer.concat(chunk.bufs);
                                } else {
                                    buffer = Buffer.from(chunk.slice());
                                }
                            } else if (chunk instanceof Buffer) {
                                buffer = chunk;
                            } else if (chunk instanceof Uint8Array) {
                                buffer = Buffer.from(chunk);
                            } else {
                                buffer = Buffer.from(chunk);
                            }

                            chunks.push(buffer);

                            // Prevent memory issues with large requests
                            if (chunks.reduce((sum, b) => sum + b.length, 0) > 1024 * 1024) {
                                throw new Error("Request too large");
                            }
                        }

                        raw = Buffer.concat(chunks).toString("utf8");
                        data = JSON.parse(raw);
                    } catch (e) {
                        await streamSink(
                            stream,
                            JSON.stringify({
                                status: false,
                                message: "Failed to parse request",
                            }),
                        );
                        return reject(e);
                    }

                    if (!data.id && !data.blobId) {
                        await streamSink(
                            stream,
                            JSON.stringify({
                                status: false,
                                message: "Repository ID or Blob ID is required",
                            }),
                        );
                        return resolve(false);
                    }

                    try {
                        const pullResponse = await pullEvent(data.id || data.blobId || "");

                        if (pullResponse?.status === false) {
                            await streamSink(
                                stream,
                                JSON.stringify({
                                    status: false,
                                    message: pullResponse.message,
                                }),
                            );
                            return resolve(false);
                        }

                        await this.streamContentToClient(
                            stream,
                            pullResponse.content!,
                            timeoutController.signal,
                        );
                        resolve(true);
                    } catch (error) {
                        await streamSink(
                            stream,
                            JSON.stringify({
                                status: false,
                                message: "Failed to retrieve repository content",
                            }),
                        );
                        resolve(false);
                    }
                });
            } finally {
                clearTimeout(timeout);
            }
        });
    }

    rename(node: any) {
        node.handle("/rename/1.0.0", async ({ stream, connection }: { stream: any; connection: any }) => {
            return new Promise(async (resolve, reject) => {
                // Authenticate
                const peerID = connection.remotePeer.toString();

                if (!this.auth.isTemporaryAuthenticated(peerID)) {
                    await streamSink(
                        stream,
                        JSON.stringify({
                            status: false,
                            message: "You must be authenticated to rename repositories.",
                        }),
                    );
                    return resolve(false);
                }

                const address = await Auth.getWalletFromPeerID(peerID);

                let data: { id?: string; blobId?: string; name: string } = { name: "" };
                try {
                    // Parse the incoming raw stream data
                    let raw = "";
                    for await (const chunk of stream.source) {
                        raw += toString(chunk.subarray());
                    }

                    data = JSON.parse(raw);
                } catch (e) {
                    await streamSink(
                        stream,
                        JSON.stringify({
                            status: false,
                            message: "Failed to parse request",
                        }),
                    );
                    return reject(e);
                }

                if (!data.id && !data.blobId) {
                    await streamSink(
                        stream,
                        JSON.stringify({
                            status: false,
                            message: "Repository ID or Blob ID is required",
                        }),
                    );
                    return resolve(false);
                }

                if (!data.name || typeof data.name !== "string") {
                    await streamSink(
                        stream,
                        JSON.stringify({
                            status: false,
                            message: "New name is required",
                        }),
                    );
                    return resolve(false);
                }

                if (data.name.length < 3 || data.name.length > 64) {
                    await streamSink(
                        stream,
                        JSON.stringify({
                            status: false,
                            message: "New name must be between 3 and 64 characters",
                        }),
                    );
                    return resolve(false);
                }

                const repoDB = new Database(join(__dirname, "../../db", "repositories.db"));

                // Check if repository exists
                const repo = repoDB
                    .prepare("SELECT * FROM repositories WHERE (name = ? OR blobID = ?) AND owner = ?")
                    .get(data.id || "", data.blobId || "", address);

                if (!repo) {
                    await streamSink(
                        stream,
                        JSON.stringify({
                            status: false,
                            message: "Repository not found",
                        }),
                    );
                    return resolve(false);
                }

                // Update repository name
                repoDB
                    .prepare("UPDATE repositories SET name = ? WHERE (name = ? OR blobID = ?) AND owner = ?")
                    .run(data.name, data.id || "", data.blobId || "", address);

                repoDB.close();

                await streamSink(
                    stream,
                    JSON.stringify({
                        status: true,
                        message: "Repository renamed successfully",
                    }),
                );

                resolve(true);
            });
        });
    }

    // Helper method to stream content in chunks
    private async streamContentToClient(
        stream: any,
        content: Buffer | Uint8Array | string,
        abortSignal: AbortSignal,
    ): Promise<void> {
        try {
            // Convert content to buffer if needed
            let buffer: Buffer;
            if (typeof content === "string") {
                buffer = Buffer.from(content, "base64");
            } else if (content instanceof Uint8Array) {
                buffer = Buffer.from(content);
            } else {
                buffer = content;
            }

            console.log(`[DEBUG] Streaming ${buffer.length} bytes in chunks of ${CHUNK_SIZE}`);

            // Send chunks with a small delay to prevent overwhelming the connection
            for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
                if (abortSignal.aborted) {
                    throw new Error("Stream aborted during transmission");
                }

                const chunk = buffer.slice(i, i + CHUNK_SIZE);
                await streamSink(stream, chunk);

                // Small delay to prevent overwhelming the connection
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        } catch (error) {
            console.log("[DEBUG] Error during content streaming:", error);
            throw error;
        }
    }
}
