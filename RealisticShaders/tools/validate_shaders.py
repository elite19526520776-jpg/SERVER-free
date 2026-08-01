#!/usr/bin/env python3
"""
把每个 .vsh / .fsh 展开 #include 后交给 glslangValidator 编译，抓语法和类型错误。
Expands #include in every .vsh/.fsh and compiles it with glslangValidator.

游戏跑不起来的时候，这是唯一能提前发现"着色器写错了"的办法。
When you cannot launch the game, this is the only way to catch a broken shader early.

    sudo apt-get install glslang-tools
    python3 tools/validate_shaders.py
"""

import os
import re
import subprocess
import sys
import tempfile

SHADER_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shaders")

# OptiFine/Iris 自己解析这些常量名，GLSL 里并不存在，校验时先喂个定义。
# These tokens are parsed by OptiFine/Iris, not by GLSL. Define them for the validator.
BUFFER_FORMAT_TOKENS = [
    "R8", "RG8", "RGB8", "RGBA8", "R16", "RG16", "RGB16", "RGBA16",
    "R16F", "RG16F", "RGB16F", "RGBA16F", "R32F", "RG32F", "RGB32F", "RGBA32F",
    "R8_SNORM", "RGB10_A2", "R11F_G11F_B10F", "RGB5_A1",
]

INCLUDE_RE = re.compile(r'^\s*#include\s+"([^"]+)"\s*$')


def expand(path, seen=None, depth=0):
    if seen is None:
        seen = set()
    if depth > 16:
        raise RuntimeError("include nesting too deep at " + path)
    out = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            match = INCLUDE_RE.match(line)
            if not match:
                out.append(line)
                continue
            target = match.group(1)
            # OptiFine 里以 / 开头的路径是相对 shaders/ 的。
            # A leading slash is relative to shaders/ in OptiFine.
            if target.startswith("/"):
                resolved = os.path.join(SHADER_DIR, target.lstrip("/"))
            else:
                resolved = os.path.join(os.path.dirname(path), target)
            resolved = os.path.normpath(resolved)
            if resolved in seen:
                # 头文件自带 include guard，重复展开会重定义。
                # The headers carry include guards; expanding twice would redefine everything.
                out.append("// (already included) " + target + "\n")
                continue
            seen.add(resolved)
            out.append("// ---- begin " + target + " ----\n")
            out.extend(expand(resolved, seen, depth + 1))
            out.append("// ---- end " + target + " ----\n")
    return out


def prepare(path):
    lines = expand(path)
    prelude = ["#define %s %d\n" % (name, i) for i, name in enumerate(BUFFER_FORMAT_TOKENS)]
    # #version 必须是第一条非注释指令，所以定义要插在它后面。
    # #version must come first, so the defines go right after it.
    for index, line in enumerate(lines):
        if line.lstrip().startswith("#version"):
            return "".join(lines[:index + 1] + prelude + lines[index + 1:])
    return "".join(prelude + lines)


def validate(path):
    stage = "vert" if path.endswith(".vsh") else "frag"
    source = prepare(path)
    suffix = ".vert" if stage == "vert" else ".frag"
    with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False, encoding="utf-8") as tmp:
        tmp.write(source)
        tmp_path = tmp.name
    try:
        result = subprocess.run(
            ["glslangValidator", "-S", stage, tmp_path],
            capture_output=True, text=True)
        return result.returncode, result.stdout + result.stderr
    finally:
        os.unlink(tmp_path)


def main():
    files = sorted(
        os.path.join(SHADER_DIR, name)
        for name in os.listdir(SHADER_DIR)
        if name.endswith(".vsh") or name.endswith(".fsh")
    )
    failures = 0
    for path in files:
        code, output = validate(path)
        name = os.path.basename(path)
        if code == 0:
            print("  ok    %s" % name)
        else:
            failures += 1
            print("  FAIL  %s" % name)
            for line in output.splitlines():
                if line.strip() and not line.startswith("/tmp"):
                    print("        " + line)
    print("\n%d/%d shaders compiled" % (len(files) - failures, len(files)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
