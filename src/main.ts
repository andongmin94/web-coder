// BOJ 페이지에 웹 코더 화면을 주입하는 content script 진입 파일입니다.
import { customBaekjoonPage } from '@/baekjoon/scripts/main';

const href: string = location.href;

if (href.includes('acmicpc.net') || href.includes('boj.kr')) {
    customBaekjoonPage();
}
