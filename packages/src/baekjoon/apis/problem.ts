const getCurrentPageProblemHtml = (): string | null => {
    const problemRoot = document.querySelector('#problem-body');

    if (!problemRoot) {
        return null;
    }

    const html = problemRoot.outerHTML;
    if (!html || html.trim().length === 0) {
        return null;
    }

    return html;
};

async function fetchProblemHtml(
    problemId: string | null,
    success: (html: string) => void,
    fail: (error: any) => void
) {
    const currentPageHtml = getCurrentPageProblemHtml();
    if (currentPageHtml) {
        success(currentPageHtml);
        return;
    }

    await fetch(`https://www.acmicpc.net/problem/${problemId}`)
        .then((response) => response.text())
        .then(success)
        .catch(fail);
}

export { fetchProblemHtml };
