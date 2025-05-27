import type { PeerId } from "@libp2p/interface-peer-id";
import { existsSync, readFileSync, writeFileSync } from "fs";

import { initDynamicImports } from "../utils/helpers";

const peerIDPath = `${process.cwd()}/data/peer-id.json`;
let cachedPeerID: PeerId | null = null;

async function imports() {
    const [{ createFromJSON, createEd25519PeerId }] = await initDynamicImports(["@libp2p/peer-id-factory"]);

    return {
        createFromJSON,
        createEd25519PeerId,
    };
}

export const peerID = async (): Promise<PeerId> => {
    if (cachedPeerID) return cachedPeerID;

    const { createFromJSON } = await imports();
    if (existsSync(peerIDPath)) {
        cachedPeerID = await createFromJSON(JSON.parse(readFileSync(peerIDPath, "utf-8")));
    } else {
        cachedPeerID = await generatePeerID();
    }
    return cachedPeerID!;
};

const generatePeerID = async () => {
    const { createEd25519PeerId } = await imports();
    const peerID = await createEd25519PeerId() as PeerId;

    writeFileSync(
        peerIDPath,
        JSON.stringify({
            id: peerID.toString(),
            privKey: Buffer.from(peerID.privateKey!).toString("base64"),
            pubKey: Buffer.from(peerID.publicKey!).toString("base64"),
        }),
        {
            encoding: "utf-8",
            flag: "w+",
        },
    );

    return peerID;
};
