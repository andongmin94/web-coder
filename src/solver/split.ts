// 드래그(또는 방향키)로 패널 너비 조절: 문제 | 에디터 | 결과
import { storage, type Prefs } from './storage.ts';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const drag = (gutter: HTMLElement, onMove: (e: PointerEvent) => void, onEnd: () => void) => {
    gutter.addEventListener('pointerdown', (start) => {
        start.preventDefault();
        gutter.setPointerCapture(start.pointerId);
        document.body.classList.add('dragging');
        const move = (e: PointerEvent) => onMove(e);
        const up = () => {
            gutter.removeEventListener('pointermove', move);
            gutter.removeEventListener('pointerup', up);
            gutter.removeEventListener('pointercancel', up);
            document.body.classList.remove('dragging');
            onEnd();
        };
        gutter.addEventListener('pointermove', move);
        gutter.addEventListener('pointerup', up);
        gutter.addEventListener('pointercancel', up);
    });
};

export const setupSplit = (prefs: Prefs) => {
    const root = document.documentElement;
    const panes = document.getElementById('panes')!;
    let problem = prefs.problemRatio ?? 0.34;
    let results = prefs.resultsRatio ?? 0.3;

    const apply = () => {
        root.style.setProperty('--problem-width', `${(problem * 100).toFixed(2)}%`);
        root.style.setProperty('--results-width', `${(results * 100).toFixed(2)}%`);
    };
    apply();
    const save = () => void storage.updatePrefs({ problemRatio: problem, resultsRatio: results });

    const problemGutter = document.getElementById('gutter-problem')!;
    const resultsGutter = document.getElementById('gutter-results')!;

    drag(
        problemGutter,
        (e) => {
            const rect = panes.getBoundingClientRect();
            problem = clamp((e.clientX - rect.left) / rect.width, 0.15, 0.6);
            apply();
        },
        save
    );
    drag(
        resultsGutter,
        (e) => {
            const rect = panes.getBoundingClientRect();
            results = clamp((rect.right - e.clientX) / rect.width, 0.18, 0.5);
            apply();
        },
        save
    );

    const keys = (gutter: HTMLElement, change: (delta: number) => void) =>
        gutter.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            change(e.key === 'ArrowLeft' ? -0.02 : 0.02);
            apply();
            save();
        });
    keys(problemGutter, (d) => (problem = clamp(problem + d, 0.15, 0.6)));
    keys(resultsGutter, (d) => (results = clamp(results - d, 0.18, 0.5)));
};
