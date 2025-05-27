import { WalrusClient } from "@mysten/walrus";
import { Keypair } from "@mysten/sui/cryptography";

import { SUI_CLIENT } from "./wallet";

export default class Walrus {
    private client: WalrusClient;

    constructor() {
        this.client = new WalrusClient({
            network: "mainnet",
            suiClient: SUI_CLIENT,
        });
    }

    async readBlob(blobId: string) {
        const blob = await this.client.readBlob({ blobId });
        return blob;
    }

    async writeBlob(
        file: Uint8Array<ArrayBufferLike>,
        signer: Keypair,
        options: { deletable?: boolean; epochs?: number } = {},
    ) {
        const { blobId } = await this.client.writeBlob({
            blob: file,
            deletable: options.deletable ?? true,
            epochs: options.epochs ?? 3,
            signer,
        });

        return blobId;
    }

    async storageCost(size: number, epochs: number) {
        const cost = await this.client.storageCost(size, epochs);
        return cost;
    }
}
