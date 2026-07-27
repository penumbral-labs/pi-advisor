import { register } from "node:module";

register(new URL("./ts-specifier-loader.mjs", import.meta.url));
