// 언어별 문법 강조. CodeMirror 기본 문법이 일반 이름처럼 표시해 색이 들지 않던 곳을 고칩니다.
// (함수·메서드 선언 이름, Java의 record·어노테이션·클래스 선언 이름 등. 무엇이 비었는지는 syntax.test.ts)
// 각 언어의 원래 부가 기능(support)은 그대로 둡니다.
import type { Extension } from '@codemirror/state';
import { LanguageSupport, type LRLanguage } from '@codemirror/language';
import { styleTags, tags as t, type Tag } from '@lezer/highlight';
import { cpp, cppLanguage } from '@codemirror/lang-cpp';
import { python, pythonLanguage } from '@codemirror/lang-python';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { java, javaLanguage } from '@codemirror/lang-java';
import type { RuntimeInfo } from '../shared/languages.ts';

const withTags = (language: LRLanguage, extra: Record<string, Tag | readonly Tag[]>) =>
    language.configure({ props: [styleTags(extra)] });

const functionName = t.function(t.definition(t.variableName));
const methodName = t.function(t.definition(t.propertyName));

export const SYNTAX: Record<RuntimeInfo['editor'], LRLanguage> = {
    // 클래스·구조체 안에서 정의한 멤버 함수 (void update(int i) { ... })
    cpp: withTags(cppLanguage, {
        'FunctionDeclarator/FieldIdentifier': methodName,
    }),
    // 타입 힌트 (n: int, -> list)
    python: withTags(pythonLanguage, {
        'TypeDef/VariableName': t.typeName,
    }),
    // 클래스 메서드 선언 (update(i) { ... }), 이름 있는 함수 식 (function named() {})
    javascript: withTags(javascriptLanguage, {
        'MethodDeclaration/PropertyDefinition': methodName,
        'FunctionExpression/VariableDefinition': functionName,
    }),
    java: withTags(javaLanguage, {
        // 메서드·생성자 선언 이름 (main 등)
        'MethodDeclaration/Definition ConstructorDeclaration/Definition': functionName,
        // 클래스·레코드·인터페이스·enum 선언 이름
        'ClassDeclaration/Definition RecordDeclaration/Definition InterfaceDeclaration/Definition EnumDeclaration/Definition':
            t.definition(t.className),
        // record, sealed 등 문맥 키워드 (원래 아무 색도 없음)
        'record permits': t.definitionKeyword,
        'sealed non': t.modifier,
        // @Override 같은 어노테이션 (@ 포함)
        'MarkerAnnotation Annotation': t.annotation,
        'MarkerAnnotation/Identifier Annotation/Identifier': t.annotation,
    }),
};

const SUPPORT: Record<RuntimeInfo['editor'], () => LanguageSupport> = {
    cpp,
    python,
    javascript,
    java,
};

export const languageExtension = (editor: RuntimeInfo['editor']): Extension =>
    new LanguageSupport(SYNTAX[editor], SUPPORT[editor]().support);
