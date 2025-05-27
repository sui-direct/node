CREATE TABLE IF NOT EXISTS wallets (
    account TEXT NOT NULL,
    publicKey TEXT NOT NULL,
    privateKey TEXT NOT NULL,
    timestamp DATE DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (account)
);