import React from 'react';
import { createRoot } from 'react-dom/client';
import './popup.css';

const PopupApp: React.FC = () => {
    const logoSrc =
        typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? chrome.runtime.getURL('asset/icon128.png')
            : '/asset/icon128.png';

    return (
        <main className='popup-root'>
            <header className='popup-header'>
                <img src={logoSrc} alt='웹 코더 로고' className='popup-logo' />
                <div>
                    <h1>웹 코더 설정</h1>
                    <p className='subtitle'>외부 API 키 설정은 더 이상 필요하지 않습니다.</p>
                </div>
            </header>
            <ul className='info-list'>
                <li>C++ / Python: 로컬 WebAssembly 실행</li>
                <li>Rust / Java: Piston 실행 API</li>
                <li>동작이 이전 상태로 보이면 확장 프로그램을 다시 로드하고 BOJ 탭을 새로고침하세요.</li>
            </ul>
        </main>
    );
};

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('팝업 루트 요소를 찾을 수 없습니다.');
}

createRoot(rootElement).render(<PopupApp />);
