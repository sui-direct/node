import { type Libp2pOptions } from "libp2p";

import Auth from "./lib/auth";
import Remote from "./lib/remote";
import { peerID } from "./config/peerID";
import { CONFIG } from "./config/config";
import { colorize } from "./utils/colors";
import { initDynamicImports } from "./utils/helpers";

async function imports() {
    const [
        { createLibp2p },
        { tcp },
        { ping },
        { kadDHT },
        { getPeerInfo, identify },
        { bootstrap },
        { noise },
        { yamux },
    ] = await initDynamicImports([
        "libp2p",
        "@libp2p/tcp",
        "@libp2p/ping",
        "@libp2p/kad-dht",
        "@libp2p/identify",
        "@libp2p/bootstrap",
        "@chainsafe/libp2p-noise",
        "@chainsafe/libp2p-yamux",
    ]);

    return {
        createLibp2p,
        tcp,
        ping,
        kadDHT,
        identify,
        getPeerInfo,
        bootstrap,
        noise,
        yamux,
    };
}

export async function startNode() {
    const { createLibp2p, tcp, ping, kadDHT, identify, bootstrap, noise, yamux } = await imports();
    const peerId = await peerID();

    if (!CONFIG.node?.port || !CONFIG.node?.name) {
        console.log(
            colorize.errorIcon("Please run `direct setup` command to setup your node before starting it.\n"),
        );
        return;
    }

    const node = await createLibp2p({
        peerId,
        addresses: {
            listen: [`/ip4/127.0.0.1/tcp/${CONFIG.node.port}`],
        },
        transports: [tcp()],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        peerDiscovery: [
            CONFIG.node?.bootstrappers?.length > 0 &&
                bootstrap({
                    list: CONFIG.node?.bootstrappers,
                    timeout: 1000,
                }),
        ].filter(t => !!t),
        services: {
            kadDHT: kadDHT({
                protocol: "/ipfs/kad/1.0.0",
                clientMode: false,
            }),
            identify: identify(),
            ping: ping(),
        },
    } as Libp2pOptions<any>);

    await node.start();

    node.addEventListener("peer:discovery", (peerId: any) => {
        console.log(colorize.successIcon(`Discovered peer ${peerId.detail.id.toString()}`));
    });

    console.log(
        colorize.successIcon(
            `sui.direct Node (${CONFIG.node.name}) is running on address: ${node
                .getMultiaddrs()
                .map((addr: any) => addr.toString())
                .join(", ")}`,
        ),
    );

    // Listeners
    try {
        const auth = new Auth(node);
        new Remote(node, auth);
    } catch (error) {
        console.log(colorize.errorIcon("A listener error occurred"));
        console.log(error);
    }
}
