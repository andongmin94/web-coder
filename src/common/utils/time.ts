// 공통으로 재사용하는 실행 로직과 도우미 함수를 담은 유틸 파일입니다.
const getDiffTime = (date1: Date, date2: Date): number => {
    return date1.getTime() - date2.getTime();
};

export { getDiffTime };
