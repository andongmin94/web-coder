// 공통 UI를 출력하는 프레젠테이션 파일입니다.
import React, { useState, useRef, useEffect, useId } from 'react';
import { CSSProperties } from 'react';
import './VerticalSplitView.css';

type VerticalSplitViewProps = {
    top: JSX.Element;
    bottom: JSX.Element;
    topStyle?: CSSProperties;
    bottomStyle?: CSSProperties;
};

const VerticalSplitView: React.FC<VerticalSplitViewProps> = (props: VerticalSplitViewProps) => {
    const [panelsHeight, setPanelsHeight] = useState<number[]>([50, 50]);
    const [resizingIndex, setResizingIndex] = useState<number | null>(null);
    const [mouseOffset, setMouseOffset] = useState<number>(0);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const panelId = useId();

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (resizingIndex === null || !wrapperRef.current) return;

            const wrapperRect = wrapperRef.current.getBoundingClientRect();
            const totalHeight = wrapperRect.height;
            const mouseY = e.clientY - wrapperRect.top - mouseOffset;
            const topPanelHeight = Math.max(0, Math.min(100, (mouseY / totalHeight) * 100));
            const bottomPanelHeight = 100 - topPanelHeight;

            const newHeights = [...panelsHeight];
            newHeights[resizingIndex] = topPanelHeight;
            newHeights[resizingIndex + 1] = bottomPanelHeight;
            setPanelsHeight(newHeights);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingIndex, panelsHeight]);

    const disableTextSelection = () => {
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'row-resize';
    };

    const enableTextSelection = () => {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    };

    const handleMouseUp = () => {
        enableTextSelection();
        setResizingIndex(null);
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement, MouseEvent>, index: number) => {
        const resizerRect = e.currentTarget.getBoundingClientRect();
        const resizerMiddle = resizerRect.height / 2;
        const offset = e.clientY - resizerRect.top - resizerMiddle;
        setMouseOffset(offset);
        disableTextSelection();
        setResizingIndex(index);
    };

    return (
        <div className="vertical split-view" ref={wrapperRef}>
            <div
                id={panelId}
                className="vertical panel top"
                style={{
                    ...props.topStyle,
                    height: `${panelsHeight[0]}%`,
                }}
            >
                {props.top}
            </div>
            <div
                className="vertical resizer"
                tabIndex={0}
                role="separator"
                aria-label="위쪽 영역 높이"
                aria-orientation="horizontal"
                aria-controls={panelId}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(panelsHeight[0])}
                onKeyDown={(event) => {
                    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const height =
                        event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? 100
                              : Math.max(
                                    0,
                                    Math.min(
                                        100,
                                        panelsHeight[0] +
                                            (event.key === 'ArrowDown' ? 1 : -1) *
                                                (event.shiftKey ? 10 : 1)
                                    )
                                );
                    setPanelsHeight([height, 100 - height]);
                }}
                onMouseDown={(e) => handleMouseDown(e, 0)}
            />
            <div
                className="vertical panel bottom"
                style={{
                    ...props.bottomStyle,
                    height: `${panelsHeight[1]}%`,
                    overflowY: 'scroll',
                }}
            >
                {props.bottom}
            </div>
        </div>
    );
};

export default VerticalSplitView;
