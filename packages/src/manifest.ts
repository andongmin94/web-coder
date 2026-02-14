import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
    manifest_version: 3,
    name: '웹 코더',
    description: '백준 제출 페이지 실행/제출 보조 에디터',
    version: '1.0.0',
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
    content_scripts: [
        {
            matches: ['https://www.acmicpc.net/*', 'https://boj.kr/*'],
            js: ['src/main.ts'],
        },
    ],
    background: {
        service_worker: 'src/background.ts',
        type: 'module',
    },
    permissions: ['storage'],
    host_permissions: [
        'https://www.acmicpc.net/*',
        'https://boj.kr/*',
        'https://api.jdoodle.com/v1/execute',
    ],
});
