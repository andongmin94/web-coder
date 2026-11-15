// 공통 UI를 출력하는 프레젠테이션 파일입니다.
import React, { useState, useRef, useEffect, useId } from 'react';
import './HorizontalSplitView.css';

type HorizontalSplitViewProps = {
    left: JSX.Element;
    right: JSX.Element;
    leftStyle?: React.CSSProperties;
    rightStyle?: React.CSSProperties;
    height?: string | number;
};

const HorizontalSplitView: React.FC<HorizontalSplitViewProps> = (
    props: HorizontalSplitViewProps
) => {
    const [panelsWidth, setPanelsWidth] = useState<number[]>([50, 50]);
    const [resizingIndex, setResizingIndex] = useState<number | null>(null);
    const [mouseOffset, setMouseOffset] = useState<number>(0);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const panelId = useId();

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (resizingIndex === null || !wrapperRef.current) return;

            const wrapperRect = wrapperRef.current.getBoundingClientRect();
            const totalWidth = wrapperRect.width;
            const mouseX = e.clientX - wrapperRect.left - mouseOffset;
            const leftPanelWidth = Math.max(0, Math.min(100, (mouseX / totalWidth) * 100));
            const rightPanelWidth = 100 - leftPanelWidth;

            const newWidths = [...panelsWidth];
            newWidths[resizingIndex] = leftPanelWidth;
            newWidths[resizingIndex + 1] = rightPanelWidth;
            setPanelsWidth(newWidths);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingIndex, panelsWidth]);

    const disableTextSelection = () => {
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
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
        const resizerMiddle = resizerRect.width / 2;
        const offset = e.clientX - resizerRect.left - resizerMiddle;
        setMouseOffset(offset);
        disableTextSelection();
        setResizingIndex(index);
    };

    return (
        <div
            className="horizontal split-view"
            ref={wrapperRef}
            style={{ height: props.height || '100%' }}
        >
            <div
                id={panelId}
                className="horizontal panel left"
                style={{
                    ...props.leftStyle,
                    width: `${panelsWidth[0]}%`,
                }}
            >
                {props.left}
            </div>
            <div
                className="horizontal resizer"
                tabIndex={0}
                role="separator"
                aria-label="왼쪽 영역 너비"
                aria-orientation="vertical"
                aria-controls={panelId}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(panelsWidth[0])}
                onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const width =
                        event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? 100
                              : Math.max(
                                    0,
                                    Math.min(
                                        100,
                                        panelsWidth[0] +
                                            (event.key === 'ArrowRight' ? 1 : -1) *
                                                (event.shiftKey ? 10 : 1)
                                    )
                                );
                    setPanelsWidth([width, 100 - width]);
                }}
                onMouseDown={(e) => handleMouseDown(e, 0)}
            />
            <div
                className="horizontal panel right"
                style={{
                    ...props.rightStyle,
                    width: `${panelsWidth[1]}%`,
                }}
            >
                {props.right}
            </div>
        </div>
    );
};

export default HorizontalSplitView;
