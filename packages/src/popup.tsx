import React from 'react';
import { createRoot } from 'react-dom/client';
import './popup.css';

const PopupApp: React.FC = () => {
    return (
        <main className='popup-root'>
            <h1>Web Coder Settings</h1>
            <p className='subtitle'>
                No external API key setup is required.
            </p>
            <ul className='info-list'>
                <li>C++ / Python: local WebAssembly execution</li>
                <li>Rust / Java: Piston execution API</li>
                <li>If behavior looks stale, reload the extension and refresh BOJ tab</li>
            </ul>
        </main>
    );
};

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Popup root element not found.');
}

createRoot(rootElement).render(<PopupApp />);
