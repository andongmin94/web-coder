// 솔버 화면(solver.html)의 요소. 스크립트가 body 끝에서 실행되므로 불러오는 시점에 모두 있습니다.
import { $ } from './dom.ts';

export const els = {
    panes: $('#panes'),
    problemPane: $('#problem-pane'),
    problemContent: $('#problem-content'),
    problemLink: $<HTMLAnchorElement>('#problem-link'),
    problemTitle: $('#problem-title'),
    problemLimits: $('#problem-limits'),
    toggleProblemButton: $<HTMLButtonElement>('#toggle-problem'),
    editor: $('#editor'),
    languageSelect: $<HTMLSelectElement>('#language'),
    codeOpenSelect: $<HTMLSelectElement>('#code-open'),
    runButton: $<HTMLButtonElement>('#run'),
    stopButton: $<HTMLButtonElement>('#stop'),
    submitButton: $<HTMLButtonElement>('#submit'),
    confirmBox: $('#confirm'),
    confirmText: $('#confirm-text'),
    confirmOk: $<HTMLButtonElement>('#confirm-ok'),
    confirmCancel: $<HTMLButtonElement>('#confirm-cancel'),
    settingsButton: $<HTMLButtonElement>('#settings-button'),
    settingsPanel: $('#settings'),
    resetButton: $<HTMLButtonElement>('#reset'),
    saveTemplateButton: $<HTMLButtonElement>('#save-template'),
    clearTemplateButton: $<HTMLButtonElement>('#clear-template'),
    closeButton: $<HTMLButtonElement>('#close'),
    addTestButton: $<HTMLButtonElement>('#add-test'),
    testList: $('#test-list'),
    statusBox: $('#status'),
    compileBox: $('#compile-box'),
    toast: $('#toast'),
};

export type Elements = typeof els;
