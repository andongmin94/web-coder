// 확장 팝업에서 현재 지원 언어와 실행 방식을 안내하는 화면 파일입니다.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './popup.css';

// 확장 팝업에서 현재 빌드 상태와 지원 언어를 간단히 보여 주는 화면입니다.
const PopupApp: React.FC = () => {
    // 확장 내부 리소스 경로를 우선 사용하고, 개발 환경에서는 공개 경로를 fallback으로 사용합니다.
    const logoSrc =
        typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? chrome.runtime.getURL('asset/icon128.png')
            : '/asset/icon128.png';

    return (
        <main className='popup-root'>
            <header className='popup-header'>
                <img src={logoSrc} alt='웹 코더 로고' className='popup-logo' />
                <div>
                    <h1>Web Coder</h1>
                    <p className='subtitle'>C++17과 Python 3을 로컬에서 바로 실행할 수 있습니다.</p>
                </div>
            </header>

            <section className='settings-card'>
                <p className='status-message'>현재 빌드는 C++17과 Python 3만 지원합니다.</p>
            </section>

            <ul className='info-list'>
                <li>C++17: 로컬 WebAssembly 실행</li>
                <li>Python 3: 로컬 WebAssembly 실행</li>
            </ul>
        </main>
    );
};

// 팝업 HTML에 렌더링할 루트 요소를 찾습니다.
const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('팝업 루트 요소를 찾을 수 없습니다.');
}

createRoot(rootElement).render(<PopupApp />);
