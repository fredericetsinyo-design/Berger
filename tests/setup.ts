import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
import { Blob as NodeBlob } from 'node:buffer';
// jsdom ne fournit pas Blob.arrayBuffer
Object.defineProperty(globalThis, 'Blob', { value: NodeBlob, configurable: true });
