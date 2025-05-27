import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { toString } from "uint8arrays/to-string";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";

import DB from "../utils/db";
import { colorize } from "../utils/colors";
import { streamSink } from "../utils/helpers";
import { CONFIG, SECRET } from "../config/config";
import Database from "better-sqlite3";
import { join } from "path";
import Wallet from "./wallet";

const CLEAN_INTERVAL = 1000 * 60 * 60;

const errorGenerator = (message: string): string => {
    return JSON.stringify({ error: message });
};

export default class Auth {
    public node: any;
    public peerIDs: Map<string, Date> = new Map();
    public nonces: Map<string, number> = new Map();
    public temporaryValidated: Map<string, number> = new Map();

    constructor(node: any) {
        this.node = node;

        // Protocols
        this.nonce(node);
        this.handshake(node);
        this.signature(node);
        this.validate(node);

        setInterval(() => {
            this.cleaner();
        }, CLEAN_INTERVAL);
    }

    generateNonce(): number {
        const bytes = randomBytes(6); // 6 bytes = 48 bits
        const nonce = bytes.readUIntBE(0, 6); // Read as big-endian unsigned integer
        return nonce;
    }

    /**
     * @description: Validate the signature of user
     */
    async validateSignature(message: string, signature: string, address: string): Promise<boolean> {
        const encodedMessage = new TextEncoder().encode(message);
        try {
            const newAddress = await verifyPersonalMessageSignature(encodedMessage, signature);
            return newAddress.toSuiAddress().toLowerCase() === address.toLowerCase().trim();
        } catch (error) {
            console.log("Error validating signature", error);
            return false;
        }
    }

    /**
     * @description: Validate the auth signature
     */
    async validateAuthSignature({
        address,
        nonce,
        signature,
    }: {
        address: string;
        nonce: string;
        signature: string;
    }): Promise<boolean> {
        return await this.validateSignature(
            "Welcome to sui.direct!\n\nSign this message to authenticate in the CLI.\n\nNonce: " + nonce,
            signature,
            address,
        );
    }

    /**
     * @description: Get user data from the token
     */
    static validateToken(token: string): {
        status: "ok" | false;
        decoded?: any;
        error?: string | null;
        expired?: boolean;
    } {
        try {
            const decoded = jwt.verify(token, SECRET.JWT_SECRET!);
            if (typeof decoded === "object" && decoded.data) {
                return { status: "ok", decoded };
            }
            return { status: false, error: "Invalid token structure" };
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                return {
                    status: false,
                    error: "Session expired, please log in.",
                    expired: true,
                };
            } else {
                return { status: false, error: "Invalid token" };
            }
        }
    }

    isTemporaryAuthenticated(peerID: string): boolean {
        // Check if peer ID is in temporary validated
        return this.temporaryValidated.has(peerID);
    }

    static async getWalletFromPeerID(peerID: string): Promise<string | null> {
        const db = new Database(join(__dirname, "../../db", "auth.db"));
        const query = db.prepare("SELECT account FROM auth WHERE peerID = ?");
        const row = query.get(peerID) as { account: string } | undefined;

        if (!row || !row.account) return null;
        return row.account;
    }

    /* Listeners */
    // Handshake protocol
    handshake(node: any) {
        node.handle("/handshake/1.0.0", async ({ stream }: { stream: any }) => {
            // Parse the incoming raw stream data
            let raw = "";
            for await (const chunk of stream.source) {
                raw += toString(chunk.subarray());
            }

            const data = JSON.parse(raw);
            if (!data?.peerID) throw new Error("Invalid handshake data");

            // Save peer ID
            this.peerIDs.set(data.peerID, new Date());

            const response = JSON.stringify({ status: "ok" });

            streamSink(stream, response);
        });
    }

    // Nonce protocol
    nonce(node: any) {
        node.handle("/nonce/1.0.0", async ({ stream }: { stream: any }) => {
            // Parse the incoming raw stream data
            let raw = "";
            for await (const chunk of stream.source) {
                raw += toString(chunk.subarray());
            }

            const data = JSON.parse(raw);
            if (!data?.peerID) {
                streamSink(stream, JSON.stringify({ error: "Invalid nonce data" }));
                return;
            }

            // Check if peer ID is valid
            if (!this.peerIDs.has(data.peerID)) {
                streamSink(stream, JSON.stringify({ error: "Invalid peer ID" }));
                return;
            }

            // Generate nonce
            const nonce = this.generateNonce();
            this.nonces.set(data.peerID, nonce);

            // Send nonce to peer
            const response = JSON.stringify({ nonce: nonce });

            streamSink(stream, response);
        });
    }

    // Signature protocol
    signature(node: any) {
        node.handle(
            "/signature/1.0.0",
            async ({ stream, connection }: { stream: any; connection: any }): Promise<void> => {
                // Parse the incoming raw stream data
                let raw = "";
                for await (const chunk of stream.source) {
                    raw += toString(chunk.subarray());
                }

                const data: {
                    peerID: string;
                    signature: string;
                    publicKey: string;
                } = JSON.parse(raw);

                // Check if peer ID is valid
                if (
                    !this.peerIDs.has(data.peerID) ||
                    !data?.peerID ||
                    data.peerID !== connection.remotePeer.toString()
                ) {
                    streamSink(stream, errorGenerator("Invalid peer ID"));
                    return;
                }

                // Get nonce from peer ID
                const nonce = this.nonces.get(data.peerID);

                if (!nonce) {
                    streamSink(stream, errorGenerator("Invalid nonce"));
                    return;
                }

                // Validate signature
                const invalidSignature = async () =>
                    streamSink(
                        stream,
                        errorGenerator(
                            "Failed to authenticate. Please be sure you sign the message with the wallet you provided.",
                        ),
                    );
                try {
                    const isValid = await this.validateAuthSignature({
                        address: data.publicKey,
                        nonce: nonce.toString(),
                        signature: data.signature,
                    });

                    if (!isValid) {
                        await invalidSignature();
                        return;
                    }
                } catch (error) {
                    await invalidSignature();
                    return;
                }

                // Deposit wallet
                const keypair = new Ed25519Keypair();
                const depositPrivateKey = keypair.getSecretKey();
                let depositPublicKey: string = keypair.getPublicKey().toSuiAddress();

                // Check if user exists in the database
                const authDB = DB.load("auth");
                const walletsDB = DB.load("wallets");

                const user = authDB.prepare(`SELECT * FROM auth WHERE account = ?`);
                const userRecord = user.get([data.publicKey]);

                if (userRecord) {
                    // Update nonce
                    const updateRecord = authDB.prepare(
                        `UPDATE auth SET nonce = ?, peerID = ? WHERE account = ?`,
                    );
                    updateRecord.run([Number(nonce), data.peerID, data.publicKey]);

                    // Get deposit wallet
                    depositPublicKey = Wallet.getDepositAddress(data.publicKey);
                } else {
                    /// Save details in the database
                    // New user
                    const newRecord = authDB.prepare(`
                    INSERT INTO auth (
                        account,
                        peerID,
                        nonce,
                        timestamp
                    ) VALUES (?, ?, ?, ?)`);

                    newRecord.run([data.publicKey, data.peerID, Number(nonce), Date.now()]);

                    // New deposit wallet
                    const newDepositRecord = walletsDB.prepare(`
                    INSERT INTO wallets (
                        account,
                        publicKey,
                        privateKey,
                        timestamp
                    ) VALUES (?, ?, ?, ?)`);

                    newDepositRecord.run([data.publicKey, depositPublicKey, depositPrivateKey, Date.now()]);
                }

                // Generate JWT token
                const token = jwt.sign(
                    {
                        data: {
                            peerID: data.peerID,
                            publicKey: data.publicKey,
                            signature: data.signature,
                            deposit: depositPublicKey,
                        },
                    },
                    SECRET.JWT_SECRET!,
                    { expiresIn: "30d" },
                );

                // Return the token to the client
                await streamSink(stream, JSON.stringify({ token, status: "ok" }));
            },
        );
    }

    validate(node: any) {
        node.handle("/validate/1.0.0", async ({ stream }: { stream: any }) => {
            // Parse the incoming raw stream data
            let raw = "";
            for await (const chunk of stream.source) {
                raw += toString(chunk.subarray());
            }

            const data = JSON.parse(raw);

            if (!data?.token) {
                streamSink(stream, errorGenerator("Invalid token"));
                return;
            }
            if (!data?.peerID) {
                streamSink(stream, errorGenerator("Invalid peer ID"));
                return;
            }

            // Validate token and send response
            const validation = Auth.validateToken(data.token);
            streamSink(stream, JSON.stringify(validation));

            if (validation.status !== "ok") {
                // If token is invalid, do not add to temporary validated
                return;
            }

            // Add to temporary validated
            this.temporaryValidated.set(data.peerID, Date.now());
        });
    }

    /**
     * @description: Clean temporary nonces & peer IDs
     */
    async cleaner(): Promise<void> {
        let cleanedRecords = 0;
        for (const [peerID, date] of this.peerIDs.entries()) {
            if (new Date().getTime() - date.getTime() > CLEAN_INTERVAL) {
                this.peerIDs.delete(peerID);
                cleanedRecords++;

                if (this.nonces.has(peerID)) {
                    this.nonces.delete(peerID);
                }
            }
        }

        if (cleanedRecords > 0 && CONFIG.node.logLevel >= 2) {
            console.log(
                `${colorize.info(`Cleaned ${cleanedRecords} records from peer IDs`)}${colorize.reset()}`,
            );
        }

        for (const [peerID, nonce] of this.temporaryValidated.entries()) {
            if (new Date().getTime() - nonce > CLEAN_INTERVAL) {
                this.temporaryValidated.delete(peerID);
            }
        }
    }
}
