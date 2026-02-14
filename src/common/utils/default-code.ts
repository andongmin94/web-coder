import { EditorLanguage } from '@/common/types/language';

const defaultCode: Record<EditorLanguage, string> = {
    cpp: '#include <bits/stdc++.h>\n\nusing namespace std;\n\nint main()\n{\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    \n}\n',
    java: 'public class Main {\n    public static void main(String[] args) {\n        // Write your code here\n    }\n}\n',
    python: '# Write your code here\n',
    rust: 'use std::io::{self, Read};\n\nfn main() {\n    // Write your code here\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n}\n',
};

const getDefaultCode = (language: EditorLanguage): string => {
    return defaultCode[language];
};

export { getDefaultCode };
