import React, { ChangeEvent } from 'react';

interface LanguageSelectBoxProps {
    value: string;
    onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
    onFocus: () => void;
    onChangeDefaultLanguage: () => void;
}

const LanguageSelectBox: React.FC<LanguageSelectBoxProps> = ({
    value,
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
                    <option value='84' data-mime='text/x-c++src'>
                        C++17
                    </option>
                    <option value='93' data-mime='text/x-java'>
                        Java 11
                    </option>
                    <option value='28' data-mime='text/x-python'>
                        Python 3
                    </option>
                    <option value='95' data-mime='text/x-c++src'>
                        C++20
                    </option>
                    <option value='116' data-mime='text/x-rustsrc'>
                        Rust 2024
                    </option>
                </select>
            </div>
        </div>
    );
};

export default LanguageSelectBox;
