// 테스트용 가짜 워커: 보낸 메시지를 모아 두고, 테스트가 워커 쪽 응답을 흉내 냅니다.
import type { WorkerLike } from './clients.ts';

export class FakeWorker implements WorkerLike {
    sent: Record<string, unknown>[] = [];
    terminated = false;
    private listeners = new Map<string, ((event: unknown) => void)[]>();

    postMessage(message: unknown) {
        this.sent.push(message as Record<string, unknown>);
    }

    addEventListener(type: string, listener: (event: unknown) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
    }

    terminate() {
        this.terminated = true;
    }

    /** 워커가 보낸 메시지처럼 */
    reply(data: Record<string, unknown>) {
        for (const listener of this.listeners.get('message') ?? []) listener({ data });
    }

    /** 워커 안에서 잡히지 않은 오류 */
    crash(message = 'boom') {
        for (const listener of this.listeners.get('error') ?? [])
            listener({ message, preventDefault() {} });
    }

    /** 마지막 요청의 id */
    get lastId() {
        return this.sent.at(-1)?.id as number;
    }
}
