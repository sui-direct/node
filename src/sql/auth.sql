CREATE TABLE IF NOT EXISTS auth (
    account TEXT NOT NULL,
    peerID TEXT NOT NULL,
    nonce UNSIGNED INTEGER NOT NULL,
    timestamp DATE DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (account)
);