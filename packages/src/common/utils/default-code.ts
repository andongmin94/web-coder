import { EditorLanguage } from '@/common/types/language';

const DEFAULT_CPP_CODE = `#include <bits/stdc++.h>

using namespace std;

int main()
{
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    
}
`;

const DEFAULT_JAVA_CODE = `public class Main {
    public static void main(String[] args) {
        
    }
}
`;

const DEFAULT_PYTHON_CODE = ``;

const DEFAULT_RUST_CODE = `use std::io::{self, Read};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();

    
}
`;

const defaultCode: Record<EditorLanguage, string> = {
    cpp: DEFAULT_CPP_CODE,
    java: DEFAULT_JAVA_CODE,
    python: DEFAULT_PYTHON_CODE,
    rust: DEFAULT_RUST_CODE,
};

const getDefaultCode = (language: EditorLanguage): string => {
    return defaultCode[language];
};

export { getDefaultCode };
