import { mkdir, readFile, stat, writeFile, open, realpath, unlink, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { isContainerRuntime } from "../runtime/runtime-readiness.ts";

export const HOST_APP_RUN_DATA_ROOT = "/var/lib/zook/appRunData";
export const CONTAINER_APP_RUN_DATA_ROOT = "/app/appRunData";

export function resolvePersistentFileStorageRoot(
  insideContainer = isContainerRuntime(),
): string {
  const override = process.env.ZOOK_APP_RUN_DATA_ROOT?.trim();
  if (override) {
    return resolve(override);
  }
  return insideContainer ? CONTAINER_APP_RUN_DATA_ROOT : HOST_APP_RUN_DATA_ROOT;
}

export interface PersistentFileWriteResult {
  fileName: string;
  filePath: string;
  sizeBytes: number;
}

export class PersistentFileStore {
  constructor(private readonly rootDir = resolvePersistentFileStorageRoot()) {}

  get root(): string {
    return this.rootDir;
  }

  resolvePath(...segments: string[]): string {
    return resolve(this.rootDir, ...segments);
  }

  async ensureDirectory(...segments: string[]): Promise<string> {
    const dirPath = this.resolvePath(...segments);
    await mkdir(dirPath, { recursive: true });
    return dirPath;
  }

  async writeText(
    relativePath: string,
    content: string,
  ): Promise<PersistentFileWriteResult> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    return {
      fileName: relativePath.split("/").at(-1) ?? relativePath,
      filePath,
      sizeBytes: Buffer.byteLength(content, "utf8"),
    };
  }

  async writeBuffer(
    relativePath: string,
    content: Buffer,
  ): Promise<PersistentFileWriteResult> {
    const filePath = this.resolvePath(relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    return {
      fileName: relativePath.split("/").at(-1) ?? relativePath,
      filePath,
      sizeBytes: content.length,
    };
  }

  async readText(filePath: string): Promise<string> {
    return await readFile(this.resolvePath(filePath), "utf8");
  }

  async readBuffer(filePath: string): Promise<Buffer> {
    return await readFile(this.resolvePath(filePath));
  }

  /** Bounded UTF-8 text for authorized ingestion; never accepts paths outside this store. */
  async readBoundedText(relativePath: string, maximumBytes: number): Promise<string> {
    if (!Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 200000) throw Error("Invalid text capacity");
    const root = await realpath(this.rootDir), path = await realpath(this.resolvePath(relativePath));
    if (!path.startsWith(root + sep)) throw Error("File path is outside the persistent store");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > maximumBytes) throw Error("Text file exceeds capacity");
      const buffer = Buffer.alloc(maximumBytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > maximumBytes) throw Error("Text file exceeds capacity");
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } finally { await handle.close(); }
  }

  async removeOwnedFile(relativePath:string):Promise<void>{
    const root=await realpath(this.rootDir),path=resolve(root,relativePath);
    if(!path.startsWith(root+sep))throw Error('File purge path is outside the store');
    try{const parent=await realpath(dirname(path));if(parent!==root&&!parent.startsWith(root+sep))throw Error('File purge parent is outside the store');
      const entry=await lstat(path);if(!entry.isFile()&&!entry.isSymbolicLink())throw Error('File purge only removes a single file');await unlink(path);
    }catch(error:any){if(error?.code!=='ENOENT')throw error;}
  }
  async stat(filePath: string) {
    return await stat(this.resolvePath(filePath));
  }
}

export async function assertPersistentFileStoreReady(
  rootDir = resolvePersistentFileStorageRoot(),
): Promise<void> {
  const store = new PersistentFileStore(rootDir);
  const randomToken = randomBytes(8).toString("hex");
  const relativePath = `.smoke/hello_world_${process.pid}_${randomToken}.txt`;
  const expected = `hello_world:${randomToken}`;
  const writeResult = await store.writeText(relativePath, expected);
  const actual = await store.readText(writeResult.filePath);

  if (actual !== expected) {
    throw new Error(
      "Persistent file storage smoke test failed: content mismatch.",
    );
  }
}
