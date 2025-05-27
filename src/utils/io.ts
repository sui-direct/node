import { join } from "path";
import { homedir } from "os";

export const expandHomeDir = (p: string) => {
    return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
};
