// 드래그로 패널 크기 조절 (문제|작업 영역, 에디터/테스트)
import { storage, type Prefs } from './storage.ts';

const clamp = (v: number) => Math.min(0.8, Math.max(0.2, v));

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
    const app = document.getElementById('app')!;
    const work = document.getElementById('work-pane')!;
    let problemRatio = prefs.problemRatio ?? 0.42;
    let editorRatio = prefs.editorRatio ?? 0.6;

    const apply = () => {
        root.style.setProperty('--problem-ratio', String(problemRatio));
        root.style.setProperty('--editor-ratio', String(editorRatio));
    };
    apply();

    const save = () => void storage.updatePrefs({ problemRatio, editorRatio });

    const colGutter = document.getElementById('gutter-col');
    const rowGutter = document.getElementById('gutter-row');

    if (colGutter) {
        drag(
            colGutter,
            (e) => {
                const rect = app.getBoundingClientRect();
                problemRatio = clamp((e.clientX - rect.left) / rect.width);
                apply();
            },
            save
        );
        colGutter.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            problemRatio = clamp(problemRatio + (e.key === 'ArrowLeft' ? -0.02 : 0.02));
            apply();
            save();
        });
    }

    if (rowGutter) {
        drag(
            rowGutter,
            (e) => {
                const toolbar = document.getElementById('toolbar')!;
                const top = toolbar.getBoundingClientRect().bottom;
                const rect = work.getBoundingClientRect();
                editorRatio = clamp((e.clientY - top) / (rect.bottom - top));
                apply();
            },
            save
        );
        rowGutter.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            editorRatio = clamp(editorRatio + (e.key === 'ArrowUp' ? -0.02 : 0.02));
            apply();
            save();
        });
    }
};
