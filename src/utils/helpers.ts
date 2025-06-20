import { fromString } from "uint8arrays/from-string";

// Ugly implementation to solve 'No "exports" main defined in package.json' problem
const dynamicImport = async (packageName: string) => new Function(`return import('${packageName}')`)();

export async function initDynamicImports(libs: string[]) {
    return await Promise.all(libs.map(lib => dynamicImport(lib)));
}

export async function streamSink(stream: any, data: string | Buffer | Uint8Array) {
    await stream.sink(
        (async function* () {
            if (typeof data === 'string') {
                yield fromString(data);
            } else {
                yield data;
            }
        })(),
    );
}