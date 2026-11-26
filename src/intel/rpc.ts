// 언어 워커(TypeScript, Pyright)에 보낸 요청과 답을 잇는 공통 부분.
// 답이 시간 안에 안 오거나 워커가 죽으면 null로 끝냅니다. (인텔리센스는 없어도 편집은 되어야 하므로)

export const createRequests = () => {
    let nextId = 1;
    const pending = new Map<number, (result: unknown) => void>();
    /** 워커가 죽었으면 이후 요청은 기다리지 않고 바로 null */
    let dead = false;
    return {
        /** send(id)로 요청을 보내고 답(없으면 null)을 기다립니다. */
        request<T>(send: (id: number) => void, timeoutMs: number): Promise<T | null> {
            if (dead) return Promise.resolve(null);
            return new Promise<T | null>((resolve) => {
                const id = nextId++;
                const timer = setTimeout(() => {
                    pending.delete(id);
                    resolve(null);
                }, timeoutMs);
                pending.set(id, (result) => {
                    clearTimeout(timer);
                    resolve(result as T);
                });
                send(id);
            });
        },
        /** 워커의 답 */
        resolve(id: number, result: unknown) {
            pending.get(id)?.(result);
            pending.delete(id);
        },
        /** 워커 오류: 기다리던 요청을 모두 null로 끝내고, 앞으로의 요청도 바로 끝냅니다. */
        fail() {
            dead = true;
            for (const done of pending.values()) done(null);
            pending.clear();
        },
    };
};
