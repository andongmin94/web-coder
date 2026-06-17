// Chrome 확장의 권한과 진입점을 정의하는 매니페스트 파일입니다.
import { defineManifest } from '@crxjs/vite-plugin';

// Chrome 확장 전체 동작 범위를 정의하는 MV3 매니페스트입니다.
export default defineManifest({
    manifest_version: 3,
    name: '웹 코더',
    description: '백준 제출 페이지 실행/제출 보조 에디터',
    version: '1.0.5',
    icons: {
        16: 'asset/icon16.png',
        32: 'asset/icon32.png',
        48: 'asset/icon48.png',
        128: 'asset/icon128.png',
    },
    action: {
        default_icon: 'asset/icon.png',
        default_popup: 'src/popup.html',
    },
    // BOJ 페이지에 커스텀 화면을 주입하는 content script 설정입니다.
    content_scripts: [
        {
            matches: ['https://www.acmicpc.net/*', 'https://boj.kr/*'],
            js: ['src/main.ts'],
        },
    ],
    // 코드 실행 요청은 background service worker에서 처리합니다.
    background: {
        service_worker: 'src/background.ts',
        type: 'module',
    },
    // WebAssembly 기반 C++/Python 실행을 위해 확장 페이지에서 wasm 실행을 허용합니다.
    content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    permissions: ['storage'],
    // 문제 조회와 제출 연동에 필요한 BOJ 도메인 접근 권한입니다.
    host_permissions: [
        'https://www.acmicpc.net/*',
        'https://boj.kr/*',
    ],
} as any);
