import Database from "better-sqlite3";

export default class DB {
    static dbPath(file: string) {
        return `${process.cwd()}/db/${file}`;
    }

    static load(dbName: string) {
        const dbPath = DB.dbPath(dbName + ".db");
        return new Database(dbPath);
    }
}
