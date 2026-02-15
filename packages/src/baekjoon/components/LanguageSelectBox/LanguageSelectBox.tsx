import React, { ChangeEvent } from 'react';
import type { SupportedLanguageOption } from '@/baekjoon/utils/language';

interface LanguageSelectBoxProps {
    value: string;
    options: SupportedLanguageOption[];
    onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
    onFocus: () => void;
    onChangeDefaultLanguage: () => void;
}

const LanguageSelectBox: React.FC<LanguageSelectBoxProps> = ({
    value,
    options,
    onChange,
    onFocus,
    onChangeDefaultLanguage,
}) => {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '20px',
                justifyContent: 'right',
                marginRight: '10px',
            }}
        >
            <a
                onClick={onChangeDefaultLanguage}
                style={{
                    cursor: 'pointer',
                    fontSize: '12px',
                    lineHeight: '20px',
                    display: 'inline-flex',
                    alignItems: 'center',
                }}
            >
                현재 언어를 기본값으로 설정
            </a>
            <label
                className='control-label'
                style={{ marginBottom: 0, lineHeight: '20px' }}
            >
                언어
            </label>
            <div>
                <select
                    id='language'
                    name='language'
                    className='language-select chosen-select'
                    value={value}
                    onChange={onChange}
                    onFocus={onFocus}
                    style={{
                        cursor: 'pointer',
                    }}
                >
                    {options.map((option) => (
                        <option
                            key={option.id}
                            value={option.id}
                            data-mime={option.mime}
                        >
                            {option.label}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
};

export default LanguageSelectBox;
