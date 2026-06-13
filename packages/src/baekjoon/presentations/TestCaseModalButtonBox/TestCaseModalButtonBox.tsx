// 백준 화면에 표시할 순수 프레젠테이션 UI 파일입니다.
import React from 'react';

type TestCaseModalButtonBoxProps = {
    addTestCaseHandle: () => void;
    saveTestCaseHandle: () => void;
};

const TestCaseModalButtonBox: React.FC<TestCaseModalButtonBoxProps> = ({
    addTestCaseHandle,
    saveTestCaseHandle,
}) => {
    return (
        <div>
            <button className='btn btn-default' onClick={addTestCaseHandle}>
                + 추가
            </button>
            <button className='btn btn-primary' onClick={saveTestCaseHandle}>
                저장
            </button>
        </div>
    );
};

export default TestCaseModalButtonBox;
