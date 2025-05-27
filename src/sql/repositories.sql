CREATE TABLE IF NOT EXISTS repositories (
    blobID TEXT NOT NULL,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    timestamp DATE DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (blobID)
);