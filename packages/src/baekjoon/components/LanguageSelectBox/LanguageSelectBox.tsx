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
                gap: '20px',
                justifyContent: 'right',
                marginRight: '10px',
            }}
        >
            <a onClick={onChangeDefaultLanguage} style={{ cursor: 'pointer' }}>
                현재 언어를 기본값으로 설정
            </a>
            <label className='control-label'>언어</label>
            <div>
                <select
                    id='language'
                    name='language'
                    data-placeholder='언어를 선택해 주세요'
                    className='language-select chosen-select'
                    data-no_results_text='검색 결과가 없습니다'
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
