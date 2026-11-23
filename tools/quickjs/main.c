// 웹 코더 node.js 깊은 재귀 모드용 QuickJS 실행기.
// 사용: main <boot.js>  - std, os를 전역에 올린 뒤 boot.js를 스크립트로 실행하고 이벤트 루프를 돕니다.
// (QuickJS-ng의 qjs.c에서 필요한 부분만 가져왔습니다. MIT License)
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "quickjs.h"
#include "quickjs-libc.h"

static int eval_buf(JSContext *ctx, const void *buf, size_t len, const char *name, int flags)
{
    JSValue val;
    if ((flags & JS_EVAL_TYPE_MASK) == JS_EVAL_TYPE_MODULE) {
        val = JS_Eval(ctx, buf, len, name, flags | JS_EVAL_FLAG_COMPILE_ONLY);
        if (!JS_IsException(val))
            val = JS_EvalFunction(ctx, val);
        val = js_std_await(ctx, val);
    } else {
        val = JS_Eval(ctx, buf, len, name, flags);
    }
    if (JS_IsException(val)) {
        js_std_dump_error(ctx);
        JS_FreeValue(ctx, val);
        return -1;
    }
    JS_FreeValue(ctx, val);
    return 0;
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: %s boot.js\n", argv[0]);
        return 2;
    }
    JSRuntime *rt = JS_NewRuntime();
    js_std_init_handlers(rt);
    JSContext *ctx = JS_NewContext(rt);
    js_init_module_std(ctx, "qjs:std");
    js_init_module_os(ctx, "qjs:os");
    JS_SetModuleLoaderFunc2(rt, NULL, js_module_loader, js_module_check_attributes, NULL);
    js_std_add_helpers(ctx, argc - 1, argv + 1);

    static const char glue[] =
        "import * as std from 'qjs:std';\n"
        "import * as os from 'qjs:os';\n"
        "globalThis.std = std;\n"
        "globalThis.os = os;\n";
    if (eval_buf(ctx, glue, strlen(glue), "<glue>", JS_EVAL_TYPE_MODULE))
        return 1;

    size_t len;
    uint8_t *buf = js_load_file(ctx, &len, argv[1]);
    if (!buf) {
        fprintf(stderr, "cannot load %s\n", argv[1]);
        return 2;
    }
    int failed = eval_buf(ctx, buf, len, argv[1], JS_EVAL_TYPE_GLOBAL);
    js_free(ctx, buf);
    if (!failed && js_std_loop(ctx)) {
        js_std_dump_error(ctx);
        failed = 1;
    }
    fflush(stdout);
    return failed ? 1 : 0;
}
