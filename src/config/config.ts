import dotenv from "dotenv";

import JSONIO from "../utils/json";

dotenv.config();

export const CONFIG = {
    ENV: process.env.NODE_ENV,
    HTTP_PORT: process.env.HTTP_SERVER_PORT || 5000,
    node: JSONIO.getConfig(),
};

export const SECRET = {
    JWT_SECRET: process.env.JWT_SECRET,
}
