import React, { FormEvent, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    EMPTY_JDOODLE_CREDENTIALS,
    JDOODLE_CREDENTIALS_STORAGE_KEY,
    JdoodleCredentials,
} from '@/common/config/jdoodle';
import {
    getObjectFromLocalStorage,
    removeObjectFromLocalStorage,
    saveObjectInLocalStorage,
} from '@/common/utils/storage';
import './popup.css';

const JDOODLE_CLIENT_KEY_DOC_URL =
    'https://www.jdoodle.com/docs/compiler-apis/client-id-secret-key/';
const JDOODLE_API_DASHBOARD_URL = 'https://www.jdoodle.com/subscribe-api';

const parseSavedCredentials = (value: unknown): JdoodleCredentials => {
    if (!value || typeof value !== 'object') {
        return { ...EMPTY_JDOODLE_CREDENTIALS };
    }

    const candidate = value as JdoodleCredentials;

    return {
        clientId:
            typeof candidate.clientId === 'string' ? candidate.clientId : '',
        clientSecret:
            typeof candidate.clientSecret === 'string'
                ? candidate.clientSecret
                : '',
    };
};

const PopupApp: React.FC = () => {
    const [credentials, setCredentials] = useState<JdoodleCredentials>({
        ...EMPTY_JDOODLE_CREDENTIALS,
    });
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [statusType, setStatusType] = useState<'idle' | 'success' | 'error'>(
        'idle'
    );

    useEffect(() => {
        getObjectFromLocalStorage(JDOODLE_CREDENTIALS_STORAGE_KEY)
            .then((saved) => {
                setCredentials(parseSavedCredentials(saved));
            })
            .catch(() => {
                setStatusType('error');
                setStatusMessage('저장된 설정을 불러오지 못했습니다.');
            });
    }, []);

    const setField =
        (field: keyof JdoodleCredentials) =>
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const { value } = event.target;
            setCredentials((prev) => ({ ...prev, [field]: value }));
            if (statusType !== 'idle') {
                setStatusType('idle');
                setStatusMessage('');
            }
        };

    const saveCredentials = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const sanitizedCredentials: JdoodleCredentials = {
            clientId: credentials.clientId.trim(),
            clientSecret: credentials.clientSecret.trim(),
        };

        if (
            !sanitizedCredentials.clientId ||
            !sanitizedCredentials.clientSecret
        ) {
            setStatusType('error');
            setStatusMessage('Client ID와 Client Secret을 모두 입력해주세요.');
            return;
        }

        await saveObjectInLocalStorage({
            [JDOODLE_CREDENTIALS_STORAGE_KEY]: sanitizedCredentials,
        });

        setCredentials(sanitizedCredentials);
        setStatusType('success');
        setStatusMessage('설정이 저장되었습니다.');
    };

    const clearCredentials = async () => {
        await removeObjectFromLocalStorage(JDOODLE_CREDENTIALS_STORAGE_KEY);
        setCredentials({ ...EMPTY_JDOODLE_CREDENTIALS });
        setStatusType('success');
        setStatusMessage('저장된 설정을 초기화했습니다.');
    };

    return (
        <main className='popup-root'>
            <h1>웹 코더 설정</h1>
            <p className='subtitle'>
                BOJ 실행 버튼은 JDoodle API를 사용합니다. 아래 링크에서 키를
                발급한 뒤 입력하세요.
            </p>
            <form onSubmit={saveCredentials}>
                <label htmlFor='client-id'>Client ID</label>
                <input
                    id='client-id'
                    type='text'
                    value={credentials.clientId}
                    onChange={setField('clientId')}
                    autoComplete='off'
                    placeholder='예: 12ab34cd...'
                />

                <label htmlFor='client-secret'>Client Secret</label>
                <input
                    id='client-secret'
                    type='password'
                    value={credentials.clientSecret}
                    onChange={setField('clientSecret')}
                    autoComplete='off'
                    placeholder='예: 98ef76gh...'
                />

                <div className='button-row'>
                    <button type='submit'>저장</button>
                    <button
                        type='button'
                        className='secondary'
                        onClick={clearCredentials}
                    >
                        초기화
                    </button>
                </div>

                {statusType !== 'idle' && (
                    <p className={`status ${statusType}`}>{statusMessage}</p>
                )}

                <div className='helper-block'>
                    <p className='helper'>JDoodle 키 발급 링크</p>
                    <a
                        className='helper-link'
                        href={JDOODLE_CLIENT_KEY_DOC_URL}
                        target='_blank'
                        rel='noopener noreferrer'
                    >
                        Client ID/Secret 발급 가이드
                    </a>
                    <a
                        className='helper-link'
                        href={JDOODLE_API_DASHBOARD_URL}
                        target='_blank'
                        rel='noopener noreferrer'
                    >
                        JDoodle API 대시보드
                    </a>
                </div>
            </form>
        </main>
    );
};

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Popup root element not found.');
}

createRoot(rootElement).render(<PopupApp />);
