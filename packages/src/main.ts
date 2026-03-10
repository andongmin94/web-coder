import { customBaekjoonPage } from '@/baekjoon/scripts/main';

const href: string = location.href;

if (href.includes('acmicpc.net') || href.includes('boj.kr')) {
    customBaekjoonPage();
}
