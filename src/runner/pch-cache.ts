// 미리 컴파일된 헤더(PCH)를 IndexedDB에 저장합니다. 워커에서도 동작합니다.
const DB_NAME = 'webcoder';
const STORE = 'pch';

const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

/** 트랜잭션이 실제로 커밋(complete)된 뒤에 결과를 돌려줍니다. */
const tx = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
    const db = await open();
    try {
        return await new Promise<T>((resolve, reject) => {
            const transaction = db.transaction(STORE, mode);
            const req = fn(transaction.objectStore(STORE));
            transaction.oncomplete = () => resolve(req.result);
            transaction.onerror = () => reject(transaction.error ?? req.error);
            transaction.onabort = () =>
                reject(transaction.error ?? new Error('IndexedDB 트랜잭션 중단'));
        });
    } finally {
        db.close();
    }
};

export const getPch = async (key: string): Promise<Uint8Array | undefined> => {
    try {
        return await tx<Uint8Array | undefined>('readonly', (s) => s.get(key));
    } catch {
        return undefined;
    }
};

export const putPch = async (key: string, data: Uint8Array) => {
    // 컴파일러 버전이나 헤더가 달라진 예전 PCH는 지웁니다. (표준 버전별 PCH는 유지)
    const [version, , hash] = key.split(':');
    const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).catch(() => []);
    for (const old of keys) {
        const [v, , h] = String(old).split(':');
        if (v !== version || h !== hash)
            await tx('readwrite', (s) => s.delete(old)).catch(() => {});
    }
    // data가 더 큰 버퍼(wasm 메모리 등)의 뷰일 수 있어 딱 맞는 크기로 복사해 저장합니다.
    await tx('readwrite', (s) => s.put(data.slice(), key));
};

export const pchKey = (compilerVersion: string, std: string, header: string) => {
    let hash = 0;
    for (let i = 0; i < header.length; i++) hash = (hash * 31 + header.charCodeAt(i)) | 0;
    return `${compilerVersion}:${std}:${(hash >>> 0).toString(16)}`;
};
