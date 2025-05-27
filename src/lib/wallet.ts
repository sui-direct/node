import { join } from "path";
import Database from "better-sqlite3";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

const SUI_ADDR = "0x2::sui::SUI";
const WALRUS_ADDR = "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL";
// const WALRUS_ADDR = "0xb1b0650a8862e30e3f604fd6c5838bc25464b8d3d827fbd58af7cb9685b832bf::wwal::WWAL";

export const SUI_CLIENT = new SuiClient({
    url: getFullnodeUrl("mainnet"),
});

export default class Wallet {
    private client: SuiClient;
    private wallet: string | null = null;

    constructor(wallet?: string) {
        this.client = SUI_CLIENT;
        if (wallet) this.wallet = wallet;
    }

    static getDepositAddress(account: string) {
        const db = new Database(join(__dirname, "../../db", "wallets.db"));
        const stmt = db.prepare("SELECT publicKey FROM wallets WHERE account = ?");
        const row = stmt.get(account) as { publicKey: string } | undefined;

        if (!row || !row.publicKey) {
            throw new Error("No deposit address is found for this account.");
        }

        return row.publicKey;
    }

    static getDepositKeypair(account: string) {
        const db = new Database(join(__dirname, "../../db", "wallets.db"));
        const stmt = db.prepare("SELECT privateKey FROM wallets WHERE account = ?");
        const row = stmt.get(account) as { privateKey: string } | undefined;

        if (!row || !row.privateKey) {
            throw new Error("No deposit address is found for this account.");
        }

        const { schema, secretKey } = decodeSuiPrivateKey(row.privateKey);

        if (schema !== "ED25519") {
            throw new Error(`Unsupported key scheme: ${schema}`);
        }

        const keypair = Ed25519Keypair.fromSecretKey(secretKey);
        return keypair;
    }

    async getBalance(wallet?: string) {
        if (!wallet || !this.wallet) throw new Error("Wallet address is required");
        const targetWallet = wallet || this.wallet;

        const [SUI_BALANCE, WAL_BALANCE] = await Promise.all([
            this.client.getBalance({
                owner: targetWallet,
                coinType: SUI_ADDR,
            }),
            this.client.getBalance({
                owner: targetWallet,
                coinType: WALRUS_ADDR,
            }),
        ]);

        return {
            SUI: SUI_BALANCE,
            WAL: WAL_BALANCE,
        };
    }
}
