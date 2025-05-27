import { join } from "path";
import Database from "better-sqlite3";
import { toString } from "uint8arrays/to-string";
import { adjectives, names, type Config as NamesConfig, uniqueNamesGenerator } from "unique-names-generator";

import Auth from "./auth";
import Walrus from "./walrus";
import Wallet from "./wallet";
import { streamSink } from "../utils/helpers";

const MAX_SIZE = 6 * 1024 ** 3;

export default class Remote {
    public node: any;
    private auth: Auth;

    constructor(node: any, auth: Auth) {
        this.node = node;
        this.auth = auth;
        this.push(node);
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
}
