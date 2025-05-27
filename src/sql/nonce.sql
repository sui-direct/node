CREATE TABLE IF NOT EXISTS nonce (
    peerID TEXT NOT NULL,
    nonce UNSIGNED INTEGER NOT NULL,
    timestamp DATE DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (peerID)
);