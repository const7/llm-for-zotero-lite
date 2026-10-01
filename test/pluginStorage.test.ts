import { assert } from "chai";
import { getPluginDataDir } from "../src/utils/pluginDataDir";
import {
  extractManagedBlobHash,
  persistAttachmentBlob,
  readAttachmentBytes,
} from "../src/modules/contextPanel/attachmentStorage";
import {
  loadCachedEmbeddings,
  saveCachedEmbeddings,
} from "../src/modules/contextPanel/embeddingCache";
import {
  readCachedMineruMd,
  readMineruImageAsBase64,
  ensureManifest,
} from "../src/modules/contextPanel/mineruCache";

describe("plugin storage directories", function () {
  const originalZotero = globalThis.Zotero;
  const originalIO = (globalThis as any).IOUtils;
  const files = new Map<string, Uint8Array>();
  let blobPath = "";
  beforeEach(function () {
    files.clear();
    blobPath = "";
    globalThis.Zotero = {
      DataDirectory: { dir: "/data" },
      DB: {
        queryAsync: async (sql: string, args: any[]) => {
          if (sql.includes("SELECT path"))
            return blobPath ? [{ path: blobPath }] : [];
          if (sql.includes("INSERT OR REPLACE")) blobPath = args[1];
          return [];
        },
      },
    } as any;
    (globalThis as any).IOUtils = {
      exists: async (path: string) => files.has(path),
      read: async (path: string) => {
        if (!files.has(path)) throw new Error("missing");
        return files.get(path);
      },
      makeDirectory: async () => {},
      write: async (path: string, bytes: Uint8Array) => files.set(path, bytes),
    };
  });
  afterEach(function () {
    globalThis.Zotero = originalZotero;
    (globalThis as any).IOUtils = originalIO;
  });
  it("stores, deduplicates and restores attachments within the plugin root", async function () {
    const bytes = new Uint8Array([1, 2, 3]);
    const created = await persistAttachmentBlob("paper.pdf", bytes);
    assert.include(
      created.storedPath,
      getPluginDataDir("attachments", "blobs"),
    );
    assert.equal(
      extractManagedBlobHash(created.storedPath),
      created.contentHash,
    );
    assert.equal(
      extractManagedBlobHash(
        `/elsewhere/blobs/${created.contentHash}/paper.pdf`,
      ),
      "",
    );
    assert.deepEqual(await readAttachmentBytes(created.storedPath), bytes);
    assert.equal(
      (await persistAttachmentBlob("renamed.pdf", bytes)).storedPath,
      created.storedPath,
    );
    files.delete(created.storedPath);
    assert.equal(
      (await persistAttachmentBlob("renamed.pdf", bytes)).storedPath,
      created.storedPath,
    );
    assert.deepEqual(await readAttachmentBytes(created.storedPath), bytes);
  });
  it("stores embedding caches under the plugin root and validates their identity", async function () {
    assert.isNull(await loadCachedEmbeddings(1, "h", "m", "p"));
    await saveCachedEmbeddings(1, "h", "m", "p", 1, [[2]]);
    assert.isTrue(files.has(getPluginDataDir("cache", "embeddings", "1.json")));
    assert.deepEqual(await loadCachedEmbeddings(1, "h", "m", "p"), [[2]]);
    assert.isNull(await loadCachedEmbeddings(1, "h", "m", "other"));
    assert.isNull(await loadCachedEmbeddings(1, "changed", "m", "p"));
  });
  it("reads MinerU text, images and manifests from the unified cache", async function () {
    const current = getPluginDataDir("cache", "mineru", "1");
    assert.isNull(await readCachedMineruMd(1));
    files.set(`${current}/full.md`, new TextEncoder().encode("new"));
    files.set(`${current}/image.png`, new Uint8Array([1]));
    files.set(
      `${current}/manifest.json`,
      new TextEncoder().encode('{"totalChars":3}'),
    );
    assert.equal(await readCachedMineruMd(1), "new");
    assert.equal(
      await readMineruImageAsBase64(1, "image.png"),
      "data:image/png;base64,AQ==",
    );
    assert.equal((await ensureManifest(1))?.totalChars, 3);
  });
});
