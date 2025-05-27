import { join } from "path";
import { readFileSync, writeFileSync } from "fs";

export default class JSONIO {
    static configPath = join(__dirname, "../../config.json");

    static read(path: string, absolutePath = false): any {
        const data = readFileSync(absolutePath ? path : join(__dirname, path), "utf-8");
        const parsedData = JSON.parse(data);
        return parsedData;
    }

    static write(path: string, data: any, absolutePath = false): void {
        const jsonData = JSON.stringify(data, null, 4);
        writeFileSync(absolutePath ? path : join(__dirname, path), jsonData, "utf-8");
    }

    static getConfig(): any {
        return JSONIO.read(this.configPath, true);
    }

    static setConfig(data: any): void {
        JSONIO.write(this.configPath, data, true);
    }
}
