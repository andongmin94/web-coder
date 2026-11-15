// 백준 화면에 표시할 순수 프레젠테이션 UI 파일입니다.
import React, { useEffect, useId, useRef } from 'react';
import './Modal.css';

type ModalProps = {
    width: string | number;
    height: string | number;
    title: string | JSX.Element;
    content: JSX.Element;
    footer: JSX.Element;
    modalOpen: boolean;
    onClose: () => void;
};

const Modal: React.FC<ModalProps> = ({
    width,
    height,
    title,
    content,
    footer,
    modalOpen,
    onClose,
}) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        const dialog = dialogRef.current!;
        if (modalOpen && !dialog.open) dialog.showModal();
        if (!modalOpen && dialog.open) dialog.close();
    }, [modalOpen]);

    return (
        <dialog
            ref={dialogRef}
            className="boj-modal"
            aria-labelledby={titleId}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            style={{ width, height }}
        >
            <div className="modal-header">
                <div id={titleId} className="modal-title" style={{ width: '100%' }}>
                    {title}
                </div>
                <button
                    type="button"
                    className="boj-modal-close"
                    aria-label="닫기"
                    onClick={onClose}
                >
                    ×
                </button>
            </div>
            <div className="modal-body boj-modal-body">{content}</div>
            <div className="modal-footer">{footer}</div>
        </dialog>
    );
};

export default Modal;
